// ==UserScript==
// @name         YouTube Music Selectable Lyrics
// @namespace    http://tampermonkey.net/
// @version      2026.11.25
// @description  Makes the lyrics on YouTube Music selectable and copyable
// @author       You
// @match        https://music.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=music.youtube.com
// @grant        GM_addStyle
// @run-at       document-start
// @homepageURL  https://github.com/Global-Alliance-For-Human-Progress/general/tree/main/tamper_monkey/youtube
// @supportURL   https://github.com/Global-Alliance-For-Human-Progress/general/issues
// @downloadURL  https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/youtube/youtube_music_selectable_lyrics.user.js
// @updateURL    https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/youtube/youtube_music_selectable_lyrics.user.js
// ==/UserScript==

(function () {
    'use strict';

    const css = `
        ytmusic-description-shelf-renderer,
        ytmusic-description-shelf-renderer yt-formatted-string,
        ytmusic-description-shelf-renderer #description,
        ytmusic-description-shelf-renderer .description {
            -webkit-user-select: text !important;
            user-select: text !important;
            -webkit-touch-callout: default !important;
            cursor: text !important;
            pointer-events: auto !important;
        }
    `;

    if (typeof GM_addStyle === 'function') {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    // YouTube Music's player page swallows mouse/select events for dragging and its own
    // shortcuts, so stop them from reaching those handlers while inside the lyrics
    const stop = (e) => {
        if (e.target && e.target.closest && e.target.closest('ytmusic-description-shelf-renderer')) {
            e.stopPropagation();
        }
    };
    ['mousedown', 'selectstart', 'dragstart', 'contextmenu', 'copy'].forEach((type) => {
        document.addEventListener(type, stop, true);
    });
})();
