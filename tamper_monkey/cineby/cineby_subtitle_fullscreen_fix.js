// ==UserScript==
// @name         Cineby: Subtitle Fullscreen Fix
// @namespace    http://tampermonkey.net/
// @version      2026.10.17
// @description  Keeps subtitles visible in fullscreen on cineby.xyz (they otherwise only show while the player controls are visible)
// @author       Liam
// @match        https://cineby.xyz/*
// @match        https://*.cineby.xyz/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cineby.xyz
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // In fullscreen only the fullscreen element's subtree is rendered, so subtitles living
    // outside it (or tied to the auto-hiding controls layer) vanish. We mirror the site's
    // subtitle text into our own overlay attached inside the fullscreen element, and only
    // show it while the site's own subtitle is not actually visible, to avoid duplicates.

    const SUBTITLE_SELECTOR = [
        '[class*="subtitle" i]',
        '[class*="caption" i]',
        '[id*="subtitle" i]',
        '[id*="caption" i]',
        '[class*="cue" i]'
    ].join(',');

    const OVERLAY_ID = 'tm-cineby-subtitle-overlay';

    const style = document.createElement('style');
    style.textContent = `
        #${OVERLAY_ID} {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 9%;
            padding: 0 8%;
            text-align: center;
            pointer-events: none;
            z-index: 2147483647;
            font-family: Arial, Helvetica, sans-serif;
            font-size: clamp(18px, 2.4vw, 42px);
            line-height: 1.3;
            color: #fff;
            text-shadow: 0 0 4px #000, 0 0 4px #000, 2px 2px 3px #000;
            white-space: pre-line;
            display: none;
        }
        #${OVERLAY_ID}.tm-on { display: block; }
    `;
    document.documentElement.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;

    const isRendered = (el, fsEl) => {
        if (!el.isConnected || !fsEl.contains(el)) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    };

    const findSubtitle = () => {
        const nodes = [...document.querySelectorAll(SUBTITLE_SELECTOR)].filter(el => {
            if (el === overlay || overlay.contains(el)) return false;
            const text = (el.innerText || el.textContent || '').trim();
            if (!text || text.length > 400) return false;
            // skip menus / language pickers
            return !el.querySelector('button, li, input, select, a');
        });
        // keep innermost matches only
        const leaves = nodes.filter(el => !nodes.some(o => o !== el && el.contains(o)));
        return leaves[0] || null;
    };

    const tick = () => {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (!fsEl || fsEl.tagName === 'VIDEO') {
            overlay.classList.remove('tm-on');
            return;
        }
        if (overlay.parentElement !== fsEl) fsEl.appendChild(overlay);

        const sub = findSubtitle();
        if (!sub || isRendered(sub, fsEl)) {
            overlay.classList.remove('tm-on');
            return;
        }
        const text = (sub.innerText || sub.textContent || '').trim();
        if (overlay.textContent !== text) overlay.textContent = text;
        overlay.classList.add('tm-on');
    };

    setInterval(tick, 200);
    document.addEventListener('fullscreenchange', tick);
    document.addEventListener('webkitfullscreenchange', tick);
})();
