// ==UserScript==
// @name         Odoo Tweaks (debug mode + search focus fix)
// @namespace    http://tampermonkey.net/
// @version      2026.10.01
// @description  Adds ?debug=1 to odoo.com URLs and forces focus/deselects text in the Odoo Command Palette
// @author       Liam
// @match        *://odoo.com/*
// @match        *://*.odoo.com/*
// @match        *://*/odoo*
// @match        *://*/web*
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/odoo.user.js
// @downloadURL  https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/odoo.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ---------------------------------------------------------------
    // 1. Debug mode: add ?debug=1 on odoo.com (and subdomains)
    // ---------------------------------------------------------------
    const host = window.location.hostname;
    if (host === 'odoo.com' || host.endsWith('.odoo.com')) {
        const url = new URL(window.location.href);

        // Respect an existing debug param (e.g. debug=assets, or debug=0 on purpose).
        if (!url.searchParams.has('debug')) {
            url.searchParams.set('debug', '1');
            // replace() so the debug-less URL doesn't stay in history and break Back.
            window.location.replace(url.toString());
            return;
        }
    }

    // ---------------------------------------------------------------
    // 2. Search focus fix
    // ---------------------------------------------------------------
    const SEARCH_SELECTOR = 'input.o_searchview_input, .o_command_palette_search input';

    const fixFocus = (el) => {
        if (!el) return;

        // Force the cursor to the end of the line
        const val = el.value;
        el.focus();
        el.setSelectionRange(val.length, val.length);

        // This is the nuclear option:
        // We temporarily disable the 'select' method so Odoo can't call it.
        const originalSelect = el.select;
        el.select = function() {};

        // Restore it after a moment so we don't break the browser entirely
        setTimeout(() => {
            el.select = originalSelect;
        }, 100);
    };

    // Watch the document for the search box appearing in the DOM.
    // Observe documentElement: at document-start, document.body doesn't exist yet.
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) { // Element node
                    // Check if the added node is the search input or contains it
                    const input = node.querySelector?.(SEARCH_SELECTOR);
                    if (input) {
                        // Small delay to let Odoo's internal 'onOpen' scripts finish
                        setTimeout(() => fixFocus(input), 10);
                        setTimeout(() => fixFocus(input), 50); // Double-tap for safety
                    }
                }
            }
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // Also catch existing focus changes
    document.addEventListener('focusin', (e) => {
        if (e.target.matches(SEARCH_SELECTOR)) {
            setTimeout(() => fixFocus(e.target), 10);
        }
    }, true);

})();
