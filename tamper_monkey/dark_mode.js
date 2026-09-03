// ==UserScript==
// @name         Universal Dark Mode
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Universal dark mode via CSS filter inversion, with per-site exceptions and a draggable toggle button. Built as a lighter-weight, more predictable replacement for the Dark Reader extension.
// @author       You
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const currentDomain = window.location.hostname;
    const EXCEPTION_KEY = 'darkModeExceptions';
    const POSITION_KEY = 'darkModeBtnPosition';
    const STYLE_ID = 'universal-dark-mode-style';
    const BTN_ID = 'universal-dark-mode-toggle-btn';
    const DARK_MARK_ATTR = 'data-udm-restored';
    const REINVERT_FILTER = 'invert(1) hue-rotate(180deg)';
    // Elements matching this kept getting wrongly flagged as "already dark" and
    // counter-inverted back to their (light) native color, standing out against the
    // rest of the dark page. Skip the heuristic for them entirely so they just fall
    // under the normal page-wide invert like everything else.
    const MANUAL_OVERRIDE_SELECTOR = '#afb-nav-container';

    function getExceptions() { return GM_getValue(EXCEPTION_KEY, []); }
    function saveExceptions(list) { GM_setValue(EXCEPTION_KEY, list); }
    function isExcluded() { return getExceptions().includes(currentDomain); }

    function setExcluded(excluded) {
        const list = getExceptions();
        const idx = list.indexOf(currentDomain);
        if (excluded && idx === -1) list.push(currentDomain);
        if (!excluded && idx !== -1) list.splice(idx, 1);
        saveExceptions(list);
    }

    const DARK_CSS = `
        html {
            background: #fff !important;
            filter: ${REINVERT_FILTER} brightness(0.92) contrast(0.9) !important;
        }

        /* Cancel the inversion on real media so photos/video keep natural colors */
        img, video, picture, canvas, iframe, embed, object {
            filter: ${REINVERT_FILTER} !important;
        }
    `;

    const ICON_MAX_SIZE = 48;

    let styleEl = null;

    function parseRgb(colorStr) {
        const parts = colorStr.match(/[\d.]+/g);
        if (!parts) return null;
        const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
        if (alpha === 0) return null;
        return parts.slice(0, 3).map(Number);
    }

    function luminanceOf([r, g, b]) {
        return 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // An inline background-image (e.g. a magnifying-glass icon) only reads correctly
    // uninverted if the element IS the icon; a wide control (search bar, banner) that
    // merely carries one would have its whole box, text and all, yanked back to light.
    function hasIconSizedBackgroundImage(el) {
        if (!el.style?.backgroundImage || el.style.backgroundImage === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.width <= ICON_MAX_SIZE && rect.height <= ICON_MAX_SIZE;
    }

    // Real icon svgs (logos, glyphs) never contain text and should keep their natural
    // brand colors; chart/data svgs draw text meant to sit on a light background, and
    // that text needs to follow the page-wide invert (dark -> light) to stay legible.
    function isIconSvg(el) {
        return el.tagName === 'svg' && !el.querySelector('text, tspan');
    }

    // An element's own background-color can be dark while a ::before/::after overlay
    // paints a lighter color on top (a common decorative pattern); reading only the
    // element's own layer would misjudge what's actually visible. Whichever layer is
    // opaque and brightest is what the user actually sees, so that one wins.
    function getVisibleBackground(el) {
        const layers = [getComputedStyle(el), getComputedStyle(el, '::before'), getComputedStyle(el, '::after')];
        if (layers.some((style) => style.backgroundImage !== 'none')) return null;
        const rgbs = layers.map((style) => parseRgb(style.backgroundColor)).filter(Boolean);
        if (!rgbs.length) return null;
        return rgbs.reduce((brightest, rgb) => (luminanceOf(rgb) > luminanceOf(brightest) ? rgb : brightest), rgbs[0]);
    }

    // Elements that were already dark in the page's own design (e.g. a black navbar)
    // would get flipped light by the html-level invert; counter-invert those specific
    // elements so their original colors survive, the same trick used for media below.
    function processElementForDarkBackground(el) {
        el.setAttribute(DARK_MARK_ATTR, '1');
        if (el.closest(MANUAL_OVERRIDE_SELECTOR)) return;
        if (hasIconSizedBackgroundImage(el) || isIconSvg(el)) {
            el.style.setProperty('filter', REINVERT_FILTER, 'important');
            return;
        }
        const rgb = getVisibleBackground(el);
        if (rgb && luminanceOf(rgb) < 85) {
            el.style.setProperty('filter', REINVERT_FILTER, 'important');
        }
    }

    function scanForDarkBackgrounds(root) {
        if (!styleEl || !(root instanceof Element)) return;
        if (!root.hasAttribute(DARK_MARK_ATTR)) processElementForDarkBackground(root);
        root.querySelectorAll(`:not([${DARK_MARK_ATTR}])`).forEach(processElementForDarkBackground);
    }

    // Elements scanned at document-start can read a transient/default background (e.g.
    // before the real stylesheet applies) and get wrongly locked in as "already dark".
    // Once fonts/CSS have actually settled, recheck anything we counter-inverted and
    // undo it if its real background turns out to be light after all.
    function revalidateReinvertedElements() {
        if (!styleEl) return;
        document.querySelectorAll(`[${DARK_MARK_ATTR}]`).forEach((el) => {
            if (!el.style.filter || hasIconSizedBackgroundImage(el) || isIconSvg(el)) return;
            const rgb = getVisibleBackground(el);
            if (!rgb || luminanceOf(rgb) >= 85) el.style.removeProperty('filter');
        });
    }

    let scanTimer = null;
    function scheduleScan() {
        if (scanTimer) return;
        scanTimer = setTimeout(() => {
            scanTimer = null;
            scanForDarkBackgrounds(document.body);
        }, 150);
    }

    const bodyObserver = new MutationObserver(scheduleScan);

    function startDarkScanning() {
        if (!styleEl || !document.body) return;
        scanForDarkBackgrounds(document.body);
        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    function enableDarkMode() {
        if (styleEl) return;
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = DARK_CSS;
        (document.head || document.documentElement).appendChild(styleEl);
        startDarkScanning();
    }

    function disableDarkMode() {
        if (!styleEl) return;
        styleEl.remove();
        styleEl = null;
        bodyObserver.disconnect();
        if (scanTimer) {
            clearTimeout(scanTimer);
            scanTimer = null;
        }
        document.querySelectorAll(`[${DARK_MARK_ATTR}]`).forEach((el) => {
            el.style.removeProperty('filter');
            el.removeAttribute(DARK_MARK_ATTR);
        });
    }

    // Sites that are already dark would get inverted into light; back off once real
    // styles are loaded and the page's own background turns out to already be dark.
    function getEffectiveBackground(el) {
        while (el) {
            const rgb = parseRgb(getComputedStyle(el).backgroundColor);
            if (rgb) return rgb;
            el = el === document.body ? document.documentElement : null;
        }
        return null;
    }

    function bailIfAlreadyDark() {
        if (!styleEl) return;
        const rgb = getEffectiveBackground(document.body || document.documentElement);
        if (rgb && luminanceOf(rgb) < 40) disableDarkMode();
    }

    function moveStyleToHead() {
        if (styleEl && document.head && styleEl.parentNode !== document.head) {
            document.head.appendChild(styleEl);
        }
    }

    // Keep our stylesheet last in the cascade if the page appends its own late.
    const headObserver = new MutationObserver(() => {
        if (styleEl && document.head && document.head.lastElementChild !== styleEl) {
            document.head.appendChild(styleEl);
        }
    });

    function syncButtonState(btn) {
        if (!btn) return;
        btn.textContent = styleEl ? '☀️' : '🌙';
        btn.style.filter = styleEl ? REINVERT_FILTER : 'none';
    }

    function createToggleButton() {
        if (document.getElementById(BTN_ID)) return;

        const pos = GM_getValue(POSITION_KEY, { bottom: 20, right: 20 });
        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.title = 'Toggle dark mode for this site';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: `${pos.bottom}px`,
            right: `${pos.right}px`,
            zIndex: 2147483647,
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: 'none',
            background: '#333',
            color: '#fff',
            fontSize: '16px',
            lineHeight: '36px',
            padding: '0',
            cursor: 'grab',
            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        });
        syncButtonState(btn);

        let dragging = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let startBottom = pos.bottom;
        let startRight = pos.right;

        btn.addEventListener('pointerdown', (e) => {
            dragging = true;
            moved = false;
            startX = e.clientX;
            startY = e.clientY;
            startBottom = Number.parseInt(btn.style.bottom, 10);
            startRight = Number.parseInt(btn.style.right, 10);
            btn.setPointerCapture(e.pointerId);
            btn.style.cursor = 'grabbing';
        });

        btn.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
            if (!moved) return;
            btn.style.right = `${startRight - dx}px`;
            btn.style.bottom = `${startBottom - dy}px`;
        });

        btn.addEventListener('pointerup', () => {
            dragging = false;
            btn.style.cursor = 'grab';
            if (moved) {
                GM_setValue(POSITION_KEY, {
                    bottom: Number.parseInt(btn.style.bottom, 10),
                    right: Number.parseInt(btn.style.right, 10),
                });
                return;
            }
            setExcluded(!!styleEl);
            if (styleEl) disableDarkMode(); else enableDarkMode();
            syncButtonState(btn);
        });

        document.body.appendChild(btn);
    }

    if (!isExcluded()) enableDarkMode();

    document.addEventListener('DOMContentLoaded', () => {
        moveStyleToHead();
        bailIfAlreadyDark();
        startDarkScanning();
        createToggleButton();
        if (document.head) headObserver.observe(document.head, { childList: true });
    });

    window.addEventListener('load', () => {
        revalidateReinvertedElements();
        // Third-party widgets (ads, embedded nav bars) sometimes finish styling
        // shortly after the load event; catch those with one more delayed pass.
        setTimeout(revalidateReinvertedElements, 1500);
    });

    GM_registerMenuCommand('Toggle dark mode for this site', () => {
        setExcluded(!!styleEl);
        if (styleEl) disableDarkMode(); else enableDarkMode();
        syncButtonState(document.getElementById(BTN_ID));
    });

    GM_registerMenuCommand('Reset toggle button position', () => {
        GM_setValue(POSITION_KEY, { bottom: 20, right: 20 });
        const btn = document.getElementById(BTN_ID);
        if (btn) {
            btn.style.bottom = '20px';
            btn.style.right = '20px';
        }
    });
})();
