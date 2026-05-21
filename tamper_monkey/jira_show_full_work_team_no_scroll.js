// ==UserScript==
// @name         Jira Team Workload Height Fixer
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Forces height to auto on Team Workload gadget
// @author       Gemini
// @match        *://*.atlassian.net/*
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // 1. STYLESHEET OVERRIDE (The primary weapon)
    // We target the data-testid because those hashed classes (css-70war4) change.
    // We target the parent of the gadget.
    GM_addStyle(`
        div:has(> [data-testid="contextual-summary.ui.gadgets.team-workload.ui"]) {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
        }

        /* Fallback for the specific class you found, just in case */
        .css-70war4 {
            height: auto !important;
            max-height: none !important;
        }
    `);

    // 2. DOM OBSERVER (The reinforcement)
    // If Jira re-renders the component, this forces the height back to auto.
    const fixHeight = () => {
        const workloadGadget = document.querySelector('[data-testid="contextual-summary.ui.gadgets.team-workload.ui"]');
        if (workloadGadget && workloadGadget.parentElement) {
            const container = workloadGadget.parentElement;
            if (container.style.height !== 'auto') {
                container.style.setProperty('height', 'auto', 'important');
                container.style.setProperty('max-height', 'none', 'important');
            }
        }
    };

    const observer = new MutationObserver((mutations) => {
        fixHeight();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();