// ==UserScript==
// @name         TikTok Favorites Click Fixer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Bypasses broken JavaScript click handlers on TikTok favorites page PC
// @author       You
// @match        https://www.tiktok.com/*
// @icon         https://www.google.com/s2/favicons?bb=1&domain=tiktok.com
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Intercept clicks at the document level to handle dynamically loaded items
    document.addEventListener('click', function(event) {
        // Find if the click or any of its parent bubbles up from a favorites item card
        const favoriteItem = event.target.closest('[data-e2e="favorites-item"]');
        
        if (favoriteItem) {
            // Find the actual anchor tag link inside this specific card
            const videoLink = favoriteItem.querySelector('a[href*="/video/"], a[href*="/photo/"]');
            
            if (videoLink && videoLink.href) {
                // Prevent the broken TikTok script from blocking actions or bubbling
                event.preventDefault();
                event.stopPropagation();
                
                // Open the link destination naturally in the same window
                window.location.href = videoLink.href;
            }
        }
    }, true); // Use capturing phase to get ahead of native scripts
})();