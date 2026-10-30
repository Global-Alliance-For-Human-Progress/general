// ==UserScript==
// @name         YouTube Music Background Playback Fixer
// @namespace    http://tampermonkey.net/
// @version      2026.10.30
// @description  Keeps YouTube Music playing in background tabs: resumes after track-change stalls, dismisses idle prompts
// @author       You
// @match        https://music.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=music.youtube.com
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // 1. Make the page believe it is always visible and focused
    try {
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        Object.defineProperty(document, 'webkitHidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
        document.hasFocus = () => true;
    } catch (e) {}

    ['visibilitychange', 'webkitvisibilitychange', 'blur', 'pagehide'].forEach(type => {
        window.addEventListener(type, e => e.stopImmediatePropagation(), true);
        document.addEventListener(type, e => e.stopImmediatePropagation(), true);
    });

    // 2. Track user intent so a deliberate pause is never overridden
    let userPausedAt = 0;
    const markUserPause = () => { userPausedAt = Date.now(); };

    document.addEventListener('click', e => {
        if (e.target.closest && e.target.closest('#play-pause-button, .play-pause-button')) markUserPause();
    }, true);
    document.addEventListener('keydown', e => {
        if ((e.key === ' ' || e.key === 'k') && !/INPUT|TEXTAREA/.test(e.target.tagName)) markUserPause();
    }, true);
    try {
        // Media keys / OS media controls go through the Media Session pause action
        const origSet = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
        navigator.mediaSession.setActionHandler = (action, handler) => {
            if (action === 'pause' && handler) {
                return origSet(action, (...args) => { markUserPause(); return handler(...args); });
            }
            return origSet(action, handler);
        };
    } catch (e) {}

    // 3. Prevent the "Are you still listening?" idle timeout by faking user activity
    setInterval(() => { window._lact = Date.now(); }, 30000);

    function dismissPrompt() {
        const btn = document.querySelector(
            'ytmusic-you-there-renderer #button, ytmusic-you-there-renderer paper-button, ' +
            'yt-confirm-dialog-renderer #confirm-button, tp-yt-paper-dialog #confirm-button'
        );
        if (btn && btn.offsetWidth > 0) {
            btn.click();
            return true;
        }
        return false;
    }

    // 4. Resume when the player stalls or pauses without the user asking for it
    let transitionUntil = 0;

    function resumeIfStalled() {
        const video = document.querySelector('video');
        if (!video) return;
        if (dismissPrompt()) return;

        const recentUserPause = Date.now() - userPausedAt < 15000;
        if (recentUserPause) return;

        const nearEnd = video.duration && (video.duration - video.currentTime < 1.5);
        const inTransition = Date.now() < transitionUntil;

        if (video.ended || (video.paused && (nearEnd || inTransition))) {
            const next = document.querySelector('.next-button, ytmusic-player-bar [aria-label="Next"], [aria-label="Next song"]');
            if (video.ended && next) {
                next.click();
            } else {
                video.play().catch(() => {
                    // Autoplay was refused: poke the player bar button instead
                    const pp = document.querySelector('#play-pause-button');
                    if (pp && video.paused) pp.click();
                });
            }
        }
    }

    function attachMediaWatchdog(video) {
        if (video.dataset.watchdogAttached) return;
        video.dataset.watchdogAttached = 'true';

        // A new track is loading: if it pauses itself during this window, resume it
        ['loadstart', 'emptied', 'ended'].forEach(t => {
            video.addEventListener('' + t, () => { transitionUntil = Date.now() + 10000; }, { passive: true });
        });
        ['ended', 'pause', 'stalled', 'waiting', 'suspend'].forEach(t => {
            video.addEventListener(t, () => setTimeout(resumeIfStalled, 500), { passive: true });
        });
    }

    const observer = new MutationObserver(() => {
        const video = document.querySelector('video');
        if (video) attachMediaWatchdog(video);
    });

    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
        const video = document.querySelector('video');
        if (video) attachMediaWatchdog(video);
    });

    // Backup loop in case an event is missed
    setInterval(resumeIfStalled, 3000);
})();
