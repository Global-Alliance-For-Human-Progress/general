// ==UserScript==
// @name         YouTube Brave Stuck Timer Fix
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Detects YouTube's on-screen timer/scrubber desyncing from real playback (common on Brave) and drives it from the real video time instead of reloading
// @author       You
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const POLL_MS = 500;
    const DRIFT_THRESHOLD_S = 1.5; // display vs real time gap that counts as "desynced"
    const RESYNC_ATTEMPT_INTERVAL_MS = 4000; // how often to ask YT's own player to reseek while desynced
    const HARD_STALL_MS = 6000; // real currentTime not advancing at all while playing this long -> something worse than a display bug
    const INITIAL_STALL_MS = 8000; // video never starts playing at all after this long -> stuck-on-load bug
    const RELOAD_COOLDOWN_MS = 15000;

    let desynced = false;
    let lastResyncAttemptAt = 0;
    let lastRealTime = null;
    let lastRealTimeChangedAt = Date.now();
    let lastReloadAt = 0;
    let firstSeenVideoAt = null;
    let everStartedPlaying = false;

    function getPlayer() {
        return document.querySelector('#movie_player');
    }

    function getVideo() {
        return document.querySelector('video.html5-main-video');
    }

    function parseTime(text) {
        if (!text) return null;
        const parts = text.trim().split(':').map(Number);
        if (parts.some((n) => Number.isNaN(n))) return null;
        return parts.reduce((acc, n) => acc * 60 + n, 0);
    }

    function formatTime(totalSeconds) {
        const s = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const secStr = String(sec).padStart(2, '0');
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${secStr}`;
        return `${m}:${secStr}`;
    }

    function patchDisplay(player, video) {
        const currentEl = player.querySelector('.ytp-time-current');
        const durationEl = player.querySelector('.ytp-time-duration');
        if (currentEl) currentEl.textContent = formatTime(video.currentTime);
        if (durationEl) durationEl.textContent = formatTime(video.duration);

        const pct = video.duration > 0 ? (video.currentTime / video.duration) * 100 : 0;
        const playProgress = player.querySelector('.ytp-play-progress');
        if (playProgress) playProgress.style.width = `${pct}%`;

        const bar = player.querySelector('.ytp-progress-bar');
        if (bar) bar.setAttribute('aria-valuenow', String(Math.floor(video.currentTime)));
    }

    function attemptNativeResync(player, video) {
        try {
            const t = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : video.currentTime;
            if (typeof player.seekTo === 'function') {
                player.seekTo(t, true);
            }
            console.log('[YT Timer Fix] Asked native player to reseek at', t.toFixed(2), 's, hoping it resumes its own UI loop');
        } catch (e) {
            console.warn('[YT Timer Fix] Native resync attempt failed', e);
        }
    }

    function reloadPreservingPosition(video) {
        const now = Date.now();
        if (now - lastReloadAt < RELOAD_COOLDOWN_MS) return;
        lastReloadAt = now;

        const t = Math.max(0, Math.floor(video.currentTime));
        const url = new URL(window.location.href);
        url.searchParams.set('t', `${t}s`);
        console.log('[YT Timer Fix] Playback itself appears stalled, reloading at', t, 's');
        window.location.href = url.toString();
    }

    function resetTracking() {
        desynced = false;
        lastRealTime = null;
        lastRealTimeChangedAt = Date.now();
    }

    function resetInitialStallTracking() {
        firstSeenVideoAt = null;
        everStartedPlaying = false;
    }

    // Video element is present but playback has never actually started (Brave's
    // stuck-on-load bug, distinct from the "playing but display desynced" case in tick(),
    // which requires !paused to even get checked). Returns true if a reload was triggered.
    function checkInitialStall(video, now) {
        if (video.currentTime > 0.25) everStartedPlaying = true;
        if (everStartedPlaying) return false;

        // Paused videos (e.g. a stale player left behind on the homepage) aren't
        // "stuck on load" - only count stall time while playback is actually attempted.
        if (video.paused) {
            firstSeenVideoAt = null;
            return false;
        }

        if (firstSeenVideoAt === null) firstSeenVideoAt = now;
        if (now - firstSeenVideoAt <= INITIAL_STALL_MS) return false;

        reloadPreservingPosition(video);
        return true;
    }

    function tick() {
        const player = getPlayer();
        const video = getVideo();

        if (!player || !video) {
            resetTracking();
            resetInitialStallTracking();
            return;
        }

        const now = Date.now();

        if (checkInitialStall(video, now)) return;

        if (video.paused || video.seeking || !Number.isFinite(video.duration) || video.duration <= 0) {
            resetTracking();
            return;
        }

        // Track whether real playback is actually advancing at all.
        if (lastRealTime === null || video.currentTime !== lastRealTime) {
            lastRealTime = video.currentTime;
            lastRealTimeChangedAt = now;
        } else if (now - lastRealTimeChangedAt > HARD_STALL_MS) {
            // Not a display bug: playback itself is frozen. A display patch can't fix this.
            reloadPreservingPosition(video);
            return;
        }

        const currentEl = player.querySelector('.ytp-time-current');
        const displayedSeconds = parseTime(currentEl && currentEl.textContent);
        const drift = displayedSeconds === null ? Infinity : Math.abs(displayedSeconds - video.currentTime);

        if (drift <= DRIFT_THRESHOLD_S) {
            if (desynced) console.log('[YT Timer Fix] Display resynced naturally');
            desynced = false;
            return;
        }

        if (!desynced) {
            desynced = true;
            console.log('[YT Timer Fix] Detected timer desync: displayed', displayedSeconds, 's vs real', video.currentTime.toFixed(2), 's');
        }

        // Keep the visible timer/scrubber accurate every tick while desynced.
        patchDisplay(player, video);

        // Periodically nudge YouTube's own player in case it recovers on its own.
        if (now - lastResyncAttemptAt > RESYNC_ATTEMPT_INTERVAL_MS) {
            lastResyncAttemptAt = now;
            attemptNativeResync(player, video);
        }
    }

    // Reset tracking whenever YouTube's SPA navigates to a new video/page.
    document.addEventListener('yt-navigate-finish', () => {
        resetTracking();
        resetInitialStallTracking();
    });

    setInterval(tick, POLL_MS);
})();
