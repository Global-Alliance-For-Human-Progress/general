// ==UserScript==
// @name         Instagram Auto Unmute (Active Only)
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Automatically unmute only the active/visible Instagram video
// @author       Liam
// @match        https://www.instagram.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=instagram.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    function isElementVisible(el) {
        const rect = el.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    function triggerClick(element) {
        const targetBtn = element.closest('button') || element;
        if (typeof targetBtn.click === 'function') {
            targetBtn.click();
        } else {
            targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
    }

    function unmuteActiveAudio() {
        // Target only videos that are currently playing and visible in the viewport
        const videos = Array.from(document.querySelectorAll('video')).filter(v => {
            return !v.paused && v.currentTime > 0 && isElementVisible(v);
        });

        videos.forEach(video => {
            if (video.muted) {
                video.muted = false;
                video.volume = 1.0;
            }

            // Find the mute button specific to this active video container
            const container = video.closest('article') || video.closest('div[role="dialog"]') || video.parentElement;
            if (container) {
                const muteBtn = container.querySelector('button[aria-label="Audio is muted"], [aria-label="Audio is muted"]');
                if (muteBtn) {
                    triggerClick(muteBtn);
                }
            }
        });
    }

    let timeout = null;
    const observer = new MutationObserver(() => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(unmuteActiveAudio, 300);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    unmuteActiveAudio();
})();