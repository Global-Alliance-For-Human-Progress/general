// ==UserScript==
// @name         YouTube Brave Stuck Timer Fix
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Detects YouTube's player timer freezing at 0:00 / 0:00 (common on Brave) and resyncs the player without a full reload when possible
// @author       You
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const CHECK_INTERVAL_MS = 1000;
    const STUCK_THRESHOLD_MS = 2000; // how long the bug must persist before we act
    const MAX_SOFT_FIXES = 3;
    const RELOAD_COOLDOWN_MS = 15000; // don't reload more than once per this window

    let stuckSince = null;
    let softFixCount = 0;
    let lastReloadAt = 0;

    function getPlayer() {
        return document.querySelector('#movie_player');
    }

    function getVideo() {
        return document.querySelector('video.html5-main-video');
    }

    function isTimerStuck(player, video) {
        if (!player || !video) return false;
        if (video.paused || video.readyState < 2) return false;

        const durationEl = player.querySelector('.ytp-time-duration');
        const currentEl = player.querySelector('.ytp-time-current');
        if (!durationEl || !currentEl) return false;

        const realDuration = video.duration;
        // Bug signature: the underlying video has a real, known duration and is
        // actively playing, but the on-screen counter has collapsed to 0:00/0:00
        // because YouTube's UI polling loop desynced from the player state.
        return (
            Number.isFinite(realDuration) &&
            realDuration > 0 &&
            durationEl.textContent.trim() === '0:00' &&
            currentEl.textContent.trim() === '0:00'
        );
    }

    function softFix(player, video) {
        try {
            // Seeking the player to its own current time forces YouTube's internal
            // state machine (and the UI polling loop that drives the timer) to
            // resync, without interrupting playback the way a reload would.
            const t = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : video.currentTime;
            if (typeof player.seekTo === 'function') {
                player.seekTo(t, true);
            } else {
                video.currentTime = t;
            }
            console.log('[YT Timer Fix] Applied soft resync at', t.toFixed(2), 's');
        } catch (e) {
            console.warn('[YT Timer Fix] Soft fix failed', e);
        }
    }

    function reloadPreservingPosition(video) {
        const now = Date.now();
        if (now - lastReloadAt < RELOAD_COOLDOWN_MS) return;
        lastReloadAt = now;

        const t = Math.max(0, Math.floor(video.currentTime));
        const url = new URL(window.location.href);
        url.searchParams.set('t', `${t}s`);
        console.log('[YT Timer Fix] Soft fixes exhausted, reloading at', t, 's');
        window.location.href = url.toString();
    }

    function reset() {
        stuckSince = null;
        softFixCount = 0;
    }

    function tick() {
        const player = getPlayer();
        const video = getVideo();

        if (!player || !video || !isTimerStuck(player, video)) {
            reset();
            return;
        }

        const now = Date.now();
        if (stuckSince === null) {
            stuckSince = now;
            return;
        }

        if (now - stuckSince < STUCK_THRESHOLD_MS) return;

        if (softFixCount < MAX_SOFT_FIXES) {
            softFixCount++;
            stuckSince = now; // give this fix a full window to take effect before retrying
            softFix(player, video);
        } else {
            reloadPreservingPosition(video);
        }
    }

    // Reset tracking whenever YouTube's SPA navigates to a new video/page.
    document.addEventListener('yt-navigate-finish', reset);

    setInterval(tick, CHECK_INTERVAL_MS);
})();
