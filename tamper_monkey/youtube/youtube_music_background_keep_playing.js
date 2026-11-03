// ==UserScript==
// @name         YouTube Music Background Playback Fixer
// @namespace    http://tampermonkey.net/
// @version      2026.11.03
// @description  Keeps YouTube Music playing in background tabs: resumes after track-change stalls, advances when the queue stops after a song, dismisses idle prompts
// @author       You
// @match        https://music.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=music.youtube.com
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Open DevTools console on music.youtube.com and filter by "[YTM-fix]" to see what the script does
    const DEBUG = true;
    const log = (...a) => { if (DEBUG) console.log('[YTM-fix]', ...a); };

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

    // 2. Track user intent: once the user pauses, stay paused until they play or change track
    let userPaused = false;
    const PLAYPAUSE_SEL = '#play-pause-button, .play-pause-button';
    const NEXT_SEL = '.next-button, ytmusic-player-bar [aria-label="Next"], [aria-label="Next song"], tp-yt-paper-icon-button.next-button';

    const getVideo = () => document.querySelector('video');

    document.addEventListener('click', e => {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest(PLAYPAUSE_SEL)) {
            const v = getVideo();
            // Clicking while playing means the user pauses; clicking while paused means they resume
            userPaused = !!(v && !v.paused);
            log('user click play/pause, userPaused =', userPaused);
        } else if (t.closest(NEXT_SEL) || t.closest('.previous-button')) {
            userPaused = false;
        }
    }, true);
    document.addEventListener('keydown', e => {
        if ((e.key === ' ' || e.key === 'k') && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
            const v = getVideo();
            userPaused = !!(v && !v.paused);
            log('user key play/pause, userPaused =', userPaused);
        }
    }, true);
    try {
        // Media keys / OS media controls go through the Media Session actions
        const origSet = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
        navigator.mediaSession.setActionHandler = (action, handler) => {
            if (handler && action === 'pause') {
                return origSet(action, (...args) => { userPaused = true; log('media key pause'); return handler(...args); });
            }
            if (handler && (action === 'play' || action === 'nexttrack' || action === 'previoustrack')) {
                return origSet(action, (...args) => { userPaused = false; return handler(...args); });
            }
            return origSet(action, handler);
        };
    } catch (e) {}

    // 3. Prevent the "Are you still listening?" idle timeout by faking user activity
    setInterval(() => { window._lact = Date.now(); }, 30000);

    function dismissPrompt() {
        const dialog = document.querySelector('ytmusic-you-there-renderer');
        if (!dialog) return false;
        const btn = dialog.querySelector('button, #button, paper-button, yt-button-renderer');
        if (btn && btn.offsetWidth > 0) {
            log('dismissing idle prompt');
            btn.click();
            return true;
        }
        return false;
    }

    // 4. Resume when the player pauses or stops without the user asking for it
    let lastEndedSrc = null;

    function resumeIfStalled(reason) {
        const video = getVideo();
        if (!video) return;
        if (dismissPrompt()) return;
        if (userPaused) return;

        if (video.ended) {
            // YouTube Music normally advances by itself; only step in if it did not
            const src = video.currentSrc || video.src;
            if (lastEndedSrc === src) return;
            lastEndedSrc = src;
            setTimeout(() => {
                const v = getVideo();
                if (!v || userPaused || !v.ended) return;
                const next = document.querySelector(NEXT_SEL);
                log('track ended and player did not advance, clicking next', !!next);
                if (next) next.click();
            }, 2000);
            return;
        }

        if (video.paused) {
            log('paused without user intent (' + reason + '), playing');
            video.play().catch(() => {
                // Autoplay was refused: click the player bar button instead
                const pp = document.querySelector('#play-pause-button');
                if (pp && video.paused) pp.click();
            });
        }
    }

    // Media events do not bubble, but capture-phase listeners on document still see them,
    // and keep working if YouTube Music replaces the <video> element
    ['ended', 'pause', 'stalled', 'waiting', 'suspend', 'emptied'].forEach(t => {
        document.addEventListener(t, e => {
            if (!(e.target instanceof HTMLVideoElement)) return;
            log('video event:', t);
            setTimeout(() => resumeIfStalled(t), 1000);
        }, true);
    });
    document.addEventListener('loadstart', e => {
        if (e.target instanceof HTMLVideoElement) { lastEndedSrc = null; log('new track loading'); }
    }, true);

    // Backup loop in case an event is missed
    setInterval(() => resumeIfStalled('timer'), 3000);

    log('loaded');
})();
