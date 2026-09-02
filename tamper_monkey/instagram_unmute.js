// ==UserScript==
// @name         Instagram Auto Unmute & Background Play (Active Only)
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Autoplay & unmute ONLY the active visible video, keep unmuted across loops, allow background playback
// @author       Liam
// @match        https://www.instagram.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=instagram.com
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Prevent IG from pausing playback on tab switch
    const preventVisibilityTracking = () => {
        try {
            Object.defineProperty(document, 'hidden', {
                get: () => false,
                configurable: true
            });
            Object.defineProperty(document, 'visibilityState', {
                get: () => 'visible',
                configurable: true
            });
        } catch (e) {}

        window.addEventListener('visibilitychange', (e) => {
            e.stopImmediatePropagation();
        }, true);
    };

    preventVisibilityTracking();

    function isElementVisible(el) {
        const rect = el.getBoundingClientRect();
        const windowHeight = window.innerHeight || document.documentElement.clientHeight;
        const windowWidth = window.innerWidth || document.documentElement.clientWidth;

        // Check if central point of the video element is within the current viewport
        const vertInView = (rect.top <= windowHeight) && ((rect.top + rect.height) >= 0);
        const horizInView = (rect.left <= windowWidth) && ((rect.left + rect.width) >= 0);

        return vertInView && horizInView && rect.height > 0 && rect.width > 0;
    }

    function handleVideoState(video) {
        if (!video) return;

        const visible = isElementVisible(video);

        if (visible) {
            // Unmute active visible video
            if (video.muted) {
                video.muted = false;
            }
            if (video.volume !== 1.0) {
                video.volume = 1.0;
            }

            // Click IG UI mute button if state is muted
            const container = video.closest('article') || video.closest('div[role="dialog"]') || video.parentElement;
            if (container) {
                const muteBtn = container.querySelector('button[aria-label="Audio is muted"], [aria-label="Audio is muted"]');
                if (muteBtn) {
                    muteBtn.click();
                }
            }

            // Ensure active video is playing
            if (video.paused) {
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {
                        video.muted = true;
                        video.play().then(() => {
                            video.muted = false;
                        }).catch(() => {});
                    });
                }
            }
        } else {
            // Mute and pause non-visible/off-screen videos to prevent overlapping audio
            if (!video.muted) {
                video.muted = true;
            }
            if (!video.paused) {
                video.pause();
            }
        }
    }

    function attachVideoListeners(video) {
        if (video.dataset.unmuteListenersAttached) return;
        video.dataset.unmuteListenersAttached = 'true';

        const mediaEvents = ['play', 'playing', 'timeupdate', 'seeking', 'seeked', 'volumechange', 'ended'];
        mediaEvents.forEach(eventType => {
            video.addEventListener(eventType, () => handleVideoState(video), { passive: true });
        });

        handleVideoState(video);
    }

    function scanAndManage() {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            attachVideoListeners(video);
            handleVideoState(video);
        });
    }

    // Handle scroll event to update active status when moving down feed/reels
    window.addEventListener('scroll', () => {
        scanAndManage();
    }, { passive: true });

    const observer = new MutationObserver(() => {
        scanAndManage();
    });

    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        scanAndManage();
    });
})();