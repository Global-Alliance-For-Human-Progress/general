// ==UserScript==
// @name         Cineby: Subtitle Fullscreen Fix
// @namespace    http://tampermonkey.net/
// @version      2026.10.17.1
// @description  Keeps subtitles visible in fullscreen on cineby.xyz (the embedded player otherwise hides them once its controls auto-hide)
// @author       Liam
// @match        https://cineby.xyz/*
// @match        https://*.cineby.xyz/*
// @match        https://*/embed/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cineby.xyz
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // The actual player lives in a cross-origin iframe (vidsrc style embed, domain rotates),
    // so this script has to run inside that frame. It only does anything if the frame
    // contains the player markup (#player, #subText).
    //
    // In fullscreen the player's own #subs layer gets hidden together with the controls.
    // We hide it while fullscreen and render the same text in our own overlay, attached
    // inside the fullscreen element, which stays visible regardless of the controls.

    const OVERLAY_ID = 'tm-cineby-sub-overlay';

    const style = document.createElement('style');
    style.textContent = `
        html.tm-fs #subs { visibility: hidden !important; }
        #${OVERLAY_ID} {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 8%;
            padding: 0 8%;
            text-align: center;
            pointer-events: none;
            z-index: 2147483647;
            display: none;
            font-family: var(--sub-family, inherit);
            font-size: calc(clamp(18px, 2.4vw, 42px) * var(--sub-scale, 1));
            line-height: 1.35;
        }
        #${OVERLAY_ID}.tm-on { display: block; }
        #${OVERLAY_ID} span {
            display: inline;
            white-space: pre-line;
            padding: 0.05em 0.35em;
            color: var(--sub-color, #fff);
            background: var(--sub-bg, rgba(0, 0, 0, 0.75));
            text-shadow: var(--sub-edge, none);
            -webkit-box-decoration-break: clone;
            box-decoration-break: clone;
        }
    `;
    document.documentElement.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    const overlayText = document.createElement('span');
    overlay.appendChild(overlayText);

    // true fullscreen of an element in this document, or this frame filling the screen
    // because the parent page fullscreened the iframe
    const getFullscreenHost = player => {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl && fsEl.tagName !== 'VIDEO') return fsEl;
        if (innerWidth >= screen.width - 2 && innerHeight >= screen.height - 2) return player;
        return null;
    };

    const tick = () => {
        const player = document.getElementById('player');
        const subText = document.getElementById('subText');
        if (!player || !subText) return;

        const host = getFullscreenHost(player);
        document.documentElement.classList.toggle('tm-fs', !!host);
        if (!host) {
            overlay.classList.remove('tm-on');
            return;
        }

        if (overlay.parentElement !== host) host.appendChild(overlay);

        // data-cur holds the cue text with real line breaks; fall back to rendered text
        const text = (subText.dataset.cur || subText.innerText || '').trim();
        if (overlayText.textContent !== text) overlayText.textContent = text;
        overlay.classList.toggle('tm-on', !!text);

        // inherit the user's caption style variables (set inline on #player)
        for (const v of ['--sub-scale', '--sub-family', '--sub-color', '--sub-bg', '--sub-edge']) {
            const val = player.style.getPropertyValue(v);
            if (val && overlay.style.getPropertyValue(v) !== val) overlay.style.setProperty(v, val);
        }
    };

    setInterval(tick, 150);
    document.addEventListener('fullscreenchange', tick);
    document.addEventListener('webkitfullscreenchange', tick);
})();
