// ==UserScript==
// @name         YouTube Music Background Playback Fixer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Prevents YouTube Music from pausing or failing to auto-advance in background tabs
// @author       You
// @match        https://music.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=music.youtube.com
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // 1. Force document visibility state to always report 'visible'
    try {
        Object.defineProperty(document, 'hidden', {
            get: () => false,
            configurable: true
        });
        Object.defineProperty(document, 'visibilityState', {
            get: () => 'visible',
            configurable: true
        });
        Object.defineProperty(document, 'hasFocus', {
            value: () => true,
            configurable: true
        });
    } catch (e) {}

    // Suppress background visibilitychange events
    window.addEventListener('visibilitychange', (e) => {
        e.stopImmediatePropagation();
    }, true);

    // 2. Watchdog to force track progression when media engine stalls in background
    function checkAndAdvance() {
        const video = document.querySelector('video');
        if (!video) return;

        // Automatically bypass "Are you still listening?" or confirmation dialogs
        const confirmBtn = document.querySelector('ytmusic-you-there-renderer paper-button, #confirm-button');
        if (confirmBtn && confirmBtn.offsetWidth > 0) {
            confirmBtn.click();
            return;
        }

        // Handle stalled track states near track end
        const isNearEnd = video.duration && (video.duration - video.currentTime < 1.5);
        if (video.ended || (video.paused && isNearEnd)) {
            const nextButton = document.querySelector('.next-button, [aria-label="Next song"], .ytmusic-player-bar[title="Next"]');
            if (nextButton) {
                nextButton.click();
            } else if (video.paused) {
                video.play().catch(() => {});
            }
        }
    }

    // Attach lifecycle listeners directly to the audio/video element
    function attachMediaWatchdog(video) {
        if (video.dataset.watchdogAttached) return;
        video.dataset.watchdogAttached = 'true';

        ['ended', 'pause', 'stalled', 'waiting'].forEach(eventType => {
            video.addEventListener(eventType, () => {
                setTimeout(checkAndAdvance, 500);
            }, { passive: true });
        });
    }

    // Monitor DOM for player instantiation
    const observer = new MutationObserver(() => {
        const video = document.querySelector('video');
        if (video) attachMediaWatchdog(video);
    });

    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
        const video = document.querySelector('video');
        if (video) attachMediaWatchdog(video);
    });

    // Low-overhead backup check loop
    setInterval(checkAndAdvance, 3000);
})();