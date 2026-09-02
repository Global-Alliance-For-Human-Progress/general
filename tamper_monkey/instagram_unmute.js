// ==UserScript==
// @name         Instagram Auto Unmute & Background Play (Active Only)
// @namespace    http://tampermonkey.net/
// @version      2.9
// @description  Autoplay on page load, force unmute, allow background play, keep paused until manually unpaused
// @author       Liam
// @match        https://www.instagram.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=instagram.com
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Prevent Instagram from tracking tab visibility / switching
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

    const originalMutedSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted').set;

    // Force unmute at DOM prototype level once initial interaction has occurred
    Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
        set: function (value) {
            // Only block muting if video is visible and HAS unmuted successfully before
            if (value === true && isElementVisible(this) && this.dataset.unmuteAllowed === 'true') {
                originalMutedSetter.call(this, false);
                return;
            }
            originalMutedSetter.call(this, value);
        },
        configurable: true
    });

    // Override HTMLMediaElement.prototype.play to block unwanted auto-resumes
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
        if (this.dataset.userPaused === 'true') {
            return Promise.reject(new DOMException('Blocked by user pause state.', 'NotAllowedError'));
        }
        return originalPlay.apply(this, arguments);
    };

    function isElementVisible(el) {
        const rect = el.getBoundingClientRect();
        const windowHeight = window.innerHeight || document.documentElement.clientHeight;
        const windowWidth = window.innerWidth || document.documentElement.clientWidth;

        const vertInView = (rect.top <= windowHeight) && ((rect.top + rect.height) >= 0);
        const horizInView = (rect.left <= windowWidth) && ((rect.left + rect.width) >= 0);

        return vertInView && horizInView && rect.height > 0 && rect.width > 0;
    }

    // Capture global user gesture to instantly unlock sound across all videos
    const unlockAudioContext = () => {
        document.querySelectorAll('video').forEach(video => {
            if (isElementVisible(video)) {
                video.dataset.unmuteAllowed = 'true';
                originalMutedSetter.call(video, false);
                video.volume = 1.0;
            }
        });
    };
    window.addEventListener('pointerdown', unlockAudioContext, { capture: true, once: false });
    window.addEventListener('keydown', unlockAudioContext, { capture: true, once: false });

    // Intercept pointerdown on capture phase to toggle manual play/pause state
    document.addEventListener('pointerdown', (e) => {
        const target = e.target;

        // Ignore clicks on UI elements (comment button, like icon, share, links, text inputs)
        const isUI = target.closest('button, a, textarea, input, svg, [role="button"]') && !target.closest('video');
        if (isUI) return;

        const videoContainer = target.closest('article, div[role="dialog"], div[role="presentation"]') || target.parentElement;
        if (!videoContainer) return;

        const video = videoContainer.querySelector('video');
        if (!video) return;

        // Toggle userPaused flag explicitly on click
        if (!video.paused) {
            video.dataset.userPaused = 'true';
            video.pause();
        } else {
            delete video.dataset.userPaused;
            video.dataset.unmuteAllowed = 'true';
            originalMutedSetter.call(video, false);
            originalPlay.call(video).catch(() => {});
        }
    }, true);

    function enforceAudio(video) {
        if (!video) return;

        if (isElementVisible(video)) {
            // Attempt to un-mute
            originalMutedSetter.call(video, false);
            video.volume = 1.0;

            // Click IG UI mute button if present and state is muted
            const container = video.closest('article') || video.closest('div[role="dialog"]') || video.parentElement;
            if (container) {
                const muteBtn = container.querySelector('button[aria-label="Audio is muted"], [aria-label="Audio is muted"]');
                if (muteBtn) {
                    muteBtn.click();
                }
            }
        }
    }

    function handleVideoState(video) {
        if (!video) return;

        const visible = isElementVisible(video);

        if (visible) {
            // DO NOT auto-play if user explicitly paused it
            if (video.dataset.userPaused === 'true') {
                return;
            }

            // Force play on page load / view entry
            if (video.paused) {
                // Try playing unmuted first
                enforceAudio(video);
                originalPlay.call(video).then(() => {
                    video.dataset.unmuteAllowed = 'true';
                }).catch(() => {
                    // Browser blocked unmuted autoplay: start muted first, then unmute on first gesture
                    originalMutedSetter.call(video, true);
                    originalPlay.call(video).then(() => {
                        // Attempt secondary unmute right after play starts
                        enforceAudio(video);
                    }).catch(() => {});
                });
            } else {
                enforceAudio(video);
            }
        } else {
            // Mute and pause non-visible/off-screen videos
            if (!video.paused) {
                video.pause();
            }
            originalMutedSetter.call(video, true);

            // Reset flags when scrolled completely off-screen
            delete video.dataset.userPaused;
            delete video.dataset.unmuteAllowed;
        }
    }

    function attachVideoListeners(video) {
        if (video.dataset.unmuteListenersAttached) return;
        video.dataset.unmuteListenersAttached = 'true';

        video.addEventListener('volumechange', () => {
            if (video.dataset.unmuteAllowed === 'true') enforceAudio(video);
        }, { passive: true });

        video.addEventListener('ended', () => handleVideoState(video), { passive: true });

        handleVideoState(video);
    }

    function scanAndManage() {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            attachVideoListeners(video);
            handleVideoState(video);
        });
    }

    window.addEventListener('scroll', scanAndManage, { passive: true });

    const observer = new MutationObserver(scanAndManage);

    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        scanAndManage();
    });

    // Fallback timer to force play immediately on dynamic page load
    setTimeout(scanAndManage, 300);
    setTimeout(scanAndManage, 1000);
})();