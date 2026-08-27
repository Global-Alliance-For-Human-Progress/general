// ==UserScript==
// @name         Instagram Auto Unmute
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically unmute Instagram videos on load
// @author       You
// @match        https://www.instagram.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=instagram.com
// @grant        none
// @run-at       document-idle
// ==UserScript==

(function() {
    'use strict';

    function unmuteAudio() {
        // Method 1: Target all video elements on the page directly
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            if (video.muted) {
                video.muted = false;
                video.volume = 1.0;
                video.play().catch(() => {
                    // Browser prevented unmuted autoplay; user interaction required
                });
            }
        });

        // Method 2: Click Instagram's native audio toggle button if video properties are overridden
        const muteButtons = document.querySelectorAll('[aria-label="Audio is muted"], [aria-label="Toggle audio"]');
        muteButtons.forEach(button => {
            button.click();
        });
    }

    // Run periodically to handle dynamically loaded feed items & Reels
    const observer = new MutationObserver(() => {
        unmuteAudio();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Initial run
    unmuteAudio();
})();