// ==UserScript==
// @name         TikTok Loop Fix
// @namespace    http://tampermonkey.net/
// @version      2025-07-30
// @description  Ensures TikTok videos loop
// @author       You
// @match        https://www.tiktok.com/@philosophy.pulse/video/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tiktok.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function enableLoop() {
        const videos = document.querySelectorAll('video');
        videos.forEach((vid) => {
            if (!vid.loop) {
                vid.loop = true;
                console.log('[TikTok Loop] Enabled loop on a video');
            }
        });
    }

    // Run immediately in case the video is already loaded
    enableLoop();

    // Watch for DOM changes and re-apply loop
    const observer = new MutationObserver(() => {
        enableLoop();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
