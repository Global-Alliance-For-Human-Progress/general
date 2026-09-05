// ==UserScript==
// @name         Universal Dark Mode
// @namespace    http://tampermonkey.net/
// @version      2026-09-05.12
// @description  Dynamic-theme dark mode: rewrites each element's actual background/text/border colors (HSL lightness remap, like Dark Reader's Dynamic Theme) instead of a blanket CSS filter, with per-site exceptions and a draggable toggle button.
// @author       You
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Injected into every frame (embedded workloads often style their own iframe,
    // e.g. Fabric's Data Factory panel), but the toggle button and menu commands
    // should only exist once per tab, not once per frame.
    const isTopFrame = window.top === window;
    // The exception list is keyed by "the site" as the user perceives it, not by
    // each frame's own (possibly different) hostname - otherwise toggling on the
    // top frame would never reach an embedded workload iframe hosted elsewhere.
    // Cross-origin top frames throw on access; fall back to this frame's own host.
    function getSiteDomain() {
        try {
            return window.top.location.hostname;
        } catch {
            return window.location.hostname;
        }
    }
    const siteDomain = getSiteDomain();

    const EXCEPTION_KEY = 'darkModeExceptions';
    const POSITION_KEY = 'darkModeBtnPosition';
    const STYLE_ID = 'universal-dark-mode-style';
    const BTN_ID = 'universal-dark-mode-toggle-btn';
    const MARK_ATTR = 'data-udm-marked';
    // General escape hatch: elements matching this (and their descendants) are left
    // completely untouched. Useful for a site-specific widget that this engine keeps
    // misjudging and that isn't worth teaching the heuristics about individually.
    const MANUAL_OVERRIDE_SELECTOR = '#afb-nav-container';
    const ICON_MAX_SIZE = 48;
    const ROOT_BG = 'rgb(24, 26, 27)';
    const BORDER_SIDES = ['top', 'right', 'bottom', 'left'];
    const REVALIDATE_INTERVAL_MS = 2000;

    function getExceptions() { return GM_getValue(EXCEPTION_KEY, []); }
    function saveExceptions(list) { GM_setValue(EXCEPTION_KEY, list); }
    function isExcluded() { return getExceptions().includes(siteDomain); }

    function setExcluded(excluded) {
        const list = getExceptions();
        const idx = list.indexOf(siteDomain);
        if (excluded && idx === -1) list.push(siteDomain);
        if (!excluded && idx !== -1) list.splice(idx, 1);
        saveExceptions(list);
    }

    // ---- Color math -----------------------------------------------------------

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                default: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h * 360, s * 100, l * 100];
    }

    function hslToRgb(h, s, l) {
        h = ((h % 360) + 360) % 360 / 360;
        s /= 100; l /= 100;
        if (s === 0) {
            const v = Math.round(l * 255);
            return [v, v, v];
        }
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return [
            Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
            Math.round(hue2rgb(p, q, h) * 255),
            Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
        ];
    }

    function parseColor(str) {
        const m = str?.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
        if (!m) return null;
        const a = m[4] === undefined ? 1 : Number(m[4]);
        if (a === 0) return null;
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
    }

    function toColorString(r, g, b, a) {
        return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`;
    }

    // HSL chroma is most visible at mid lightness and compresses toward black/white,
    // so preserving a source's raw saturation while remapping its lightness across
    // most of the scale makes even a barely-tinted gray (a couple percent S) read as
    // a visibly colored (e.g. tan/olive) result - far stronger than the original tint
    // ever looked. Snap near-gray sources hard toward neutral; let clearly colorful
    // sources (warning text, badges) keep most of their punch.
    function scaleSaturation(s) {
        return s < 20 ? s * 0.15 : s * 0.7;
    }

    // Light surfaces get pushed down into a dark range while keeping hue (so brand
    // colors stay recognizable instead of hue-rotating into something arbitrary).
    // Already-dark surfaces are left alone - assumed intentional.
    function modifyBackgroundHsl([h, s, l]) {
        if (l < 50) return null;
        const t = (l - 50) / 50;
        return [h, scaleSaturation(s), 24 - t * 16];
    }

    // Dark text gets pushed up into a light range; already-light text (intentional
    // light-on-dark in the page's own design) is left alone.
    function modifyForegroundHsl([h, s, l]) {
        if (l >= 50) return null;
        const t = (50 - l) / 50;
        return [h, scaleSaturation(s), 78 + t * 14];
    }

    function modifyBorderHsl(hsl) {
        const bg = modifyBackgroundHsl(hsl);
        return bg ? [bg[0], bg[1], Math.min(bg[2] + 12, 45)] : null;
    }

    function computeReplacement(colorStr, modifyFn) {
        const c = parseColor(colorStr);
        if (!c) return null;
        const newHsl = modifyFn(rgbToHsl(c.r, c.g, c.b));
        if (!newHsl) return null;
        const [nr, ng, nb] = hslToRgb(...newHsl);
        return toColorString(nr, ng, nb, c.a);
    }

    const GRADIENT_RE = /^(repeating-)?(linear|radial|conic)-gradient\(/;

    function computeGradientReplacement(bgImage) {
        if (!GRADIENT_RE.test(bgImage)) return null;
        return bgImage.replace(/rgba?\([^)]*\)/g, (m) => computeReplacement(m, modifyBackgroundHsl) || m);
    }

    // ---- Icon/logo detection (never recolor these) -----------------------------

    // An inline background-image (e.g. a magnifying-glass icon) only reads correctly
    // uninverted if the element IS the icon; a wide control (search bar, banner) that
    // merely carries one would have its whole box, text and all, wrongly recolored.
    function hasIconSizedBackgroundImage(el) {
        if (!el.style?.backgroundImage || el.style.backgroundImage === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.width <= ICON_MAX_SIZE && rect.height <= ICON_MAX_SIZE;
    }

    // Real icon svgs (logos, glyphs) never contain text and should keep their native
    // brand colors.
    function isIconSvg(el) {
        return el.tagName === 'svg' && !el.querySelector('text, tspan');
    }

    // ---- Generated stylesheet rules (instead of inline styles) ----------------

    // Frameworks that reactively manage an element's own inline style (e.g.
    // Angular's Renderer2.setStyle / [ngStyle]) call el.style.setProperty() for
    // THEIR properties without importance. setProperty() doesn't merge with an
    // existing declaration for the same property - it replaces the value AND the
    // importance flag outright. So a later, unrelated framework write to
    // `background-color` (even a plain, non-important one, reasserted on every
    // change-detection cycle) would silently wipe out an inline `!important`
    // override we set earlier, snapping the element back to its native color
    // until our own observer notices and reapplies it - a stable, self-sustaining
    // flip-flop driven by however often the framework re-renders. A generated
    // stylesheet rule lives in a completely separate place from el.style, so
    // nothing that only touches the element's inline style can ever clobber it.
    const PSEUDO_SIDES = ['before', 'after'];
    let rulesStyleEl = null;
    let pidCounter = 0;
    const ruleIndex = new Map(); // key -> index into rulesStyleEl.sheet.cssRules

    function ensureRulesStyleEl() {
        if (rulesStyleEl) return rulesStyleEl;
        rulesStyleEl = document.createElement('style');
        rulesStyleEl.id = 'universal-dark-mode-rules-style';
        (document.head || document.documentElement).appendChild(rulesStyleEl);
        return rulesStyleEl;
    }

    function upsertRule(key, ruleText) {
        const sheet = ensureRulesStyleEl().sheet;
        const idx = ruleIndex.get(key);
        if (idx !== undefined) {
            sheet.deleteRule(idx);
            sheet.insertRule(ruleText, idx);
        } else {
            ruleIndex.set(key, sheet.cssRules.length);
            sheet.insertRule(ruleText, sheet.cssRules.length);
        }
    }

    function deleteRuleForKey(key) {
        const idx = ruleIndex.get(key);
        if (idx === undefined) return;
        rulesStyleEl.sheet.deleteRule(idx);
        ruleIndex.delete(key);
        ruleIndex.forEach((v, k) => { if (v > idx) ruleIndex.set(k, v - 1); });
    }

    function resetRules() {
        rulesStyleEl?.remove();
        rulesStyleEl = null;
        ruleIndex.clear();
    }

    // ---- Per-element processing -------------------------------------------------

    let enabled = false;
    // Caches, per element, the computed value we last observed AFTER our own
    // decision was applied (whether that decision was "rewrite" or "leave native").
    // On the next pass we compare a fresh read against this: identical means
    // nothing has changed since (our override is still standing, or the native
    // value we left alone is still the same), so there is nothing to redo. A
    // mismatch means the page itself changed the color (or clobbered our inline
    // override with its own re-render), so we recompute from that fresh value.
    // This avoids needing to track "did we write this property" separately.
    const lastSeen = new WeakMap();

    function process(el) {
        // Our own toggle button drags by mutating its own inline style.right/bottom
        // on every pointermove, which the attribute-mutation observer below would
        // otherwise treat as a page style change worth reprocessing - adding real
        // computed-style work on every drag tick and risking enough main-thread
        // churn to throw off the click-vs-drag movement threshold. It's our UI, not
        // page content, and already gets its colors set directly - never touch it.
        if (el.id === BTN_ID) return;
        if (el.closest(MANUAL_OVERRIDE_SELECTOR)) return;
        if (hasIconSizedBackgroundImage(el) || isIconSvg(el)) {
            el.setAttribute(MARK_ATTR, '1');
            return;
        }

        const cache = lastSeen.get(el);

        // getComputedStyle() returns a LIVE object: property reads reflect the
        // element's CURRENT state at the moment of access, not a frozen snapshot
        // from when getComputedStyle() was called. If any of these properties are
        // CSS-authored to depend on each other (e.g. `border-color: currentColor`
        // depending on `color`), reading one after writing an earlier one in this
        // same pass would silently read our OWN just-applied value instead of the
        // page's true native one - so every value has to be captured as a plain
        // string up front, before any writes happen.
        const cs = getComputedStyle(el);
        const nativeBg = cs.backgroundColor;
        const nativeFg = cs.color;
        const nativeBorder = {
            top: cs.borderTopColor,
            right: cs.borderRightColor,
            bottom: cs.borderBottomColor,
            left: cs.borderLeftColor,
        };
        const nativeBgImage = cs.backgroundImage;
        const nativePseudo = PSEUDO_SIDES.map((which) => {
            const pseudo = getComputedStyle(el, `::${which}`);
            return { bg: pseudo.backgroundColor, hasImage: pseudo.backgroundImage !== 'none' };
        });

        const unchanged = cache?.bg === nativeBg && cache?.fg === nativeFg && cache?.bgImage === nativeBgImage
            && BORDER_SIDES.every((side) => cache?.[side] === nativeBorder[side])
            && PSEUDO_SIDES.every((which, i) => cache?.[`${which}Bg`] === nativePseudo[i].bg);
        if (unchanged) return;

        let pid = el.dataset.udmPid;
        if (!pid) {
            pid = String(++pidCounter);
            el.dataset.udmPid = pid;
        }

        const decls = [];
        const bgRepl = computeReplacement(nativeBg, modifyBackgroundHsl);
        if (bgRepl) decls.push(`background-color: ${bgRepl} !important;`);

        const fgRepl = computeReplacement(nativeFg, modifyForegroundHsl);
        if (fgRepl) decls.push(`color: ${fgRepl} !important;`);

        BORDER_SIDES.forEach((side) => {
            const repl = computeReplacement(nativeBorder[side], modifyBorderHsl);
            if (repl) decls.push(`border-${side}-color: ${repl} !important;`);
        });

        const bgImageRepl = computeGradientReplacement(nativeBgImage);
        if (bgImageRepl) decls.push(`background-image: ${bgImageRepl} !important;`);

        if (decls.length) {
            // An active CSS transition briefly outranks even !important author rules
            // (per the cascade spec, transitions sit above importance entirely). Most
            // component libraries declare `transition: background-color ...` etc. for
            // hover/focus feedback, so the FIRST time we change a color, the browser
            // animates toward it instead of snapping instantly - and if a revalidation
            // pass reads getComputedStyle mid-animation, it sees a blended in-between
            // color, mistakes it for a real native change, and reapplies a new rule -
            // which restarts the transition again, never settling. Suppressing
            // transitions on anything we override makes the change land instantly.
            decls.push('transition: none !important;');
            upsertRule(`${pid}-self`, `[data-udm-pid="${pid}"] { ${decls.join(' ')} }`);
        } else {
            deleteRuleForKey(`${pid}-self`);
        }

        PSEUDO_SIDES.forEach((which, i) => {
            const { bg, hasImage } = nativePseudo[i];
            if (hasImage) return; // icon/gradient overlay, leave native
            const repl = computeReplacement(bg, modifyBackgroundHsl);
            if (repl) upsertRule(`${pid}-${which}`, `[data-udm-pid="${pid}"]::${which} { background-color: ${repl} !important; transition: none !important; }`);
            else deleteRuleForKey(`${pid}-${which}`);
        });

        const after = getComputedStyle(el);
        const afterPseudo = PSEUDO_SIDES.map((which) => getComputedStyle(el, `::${which}`).backgroundColor);
        lastSeen.set(el, {
            bg: after.backgroundColor,
            fg: after.color,
            top: after.borderTopColor,
            right: after.borderRightColor,
            bottom: after.borderBottomColor,
            left: after.borderLeftColor,
            bgImage: after.backgroundImage,
            beforeBg: afterPseudo[0],
            afterBg: afterPseudo[1],
        });
        el.setAttribute(MARK_ATTR, '1');
    }

    // Component libraries commonly isolate their internal markup behind an open
    // Shadow DOM (e.g. a design-system button), which querySelectorAll cannot see
    // past at all - those elements would otherwise stay completely untouched.
    let observedRoots = new WeakSet();

    function findShadowHosts(root) {
        return Array.from(root.querySelectorAll('*')).filter((el) => el.shadowRoot);
    }

    function attachShadowRoot(sr) {
        observedRoots.add(sr);
        walkAndProcess(sr);
        bodyObserver.observe(sr, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    }

    function walkAndProcess(root) {
        if (root instanceof Element) {
            if (!root.hasAttribute(MARK_ATTR)) process(root);
            if (root.shadowRoot && !observedRoots.has(root.shadowRoot)) attachShadowRoot(root.shadowRoot);
        } else if (!(root instanceof ShadowRoot) && !(root instanceof Document)) {
            return;
        }
        root.querySelectorAll(`:not([${MARK_ATTR}])`).forEach(process);
        findShadowHosts(root).forEach((host) => {
            if (host.shadowRoot && !observedRoots.has(host.shadowRoot)) attachShadowRoot(host.shadowRoot);
        });
    }

    // process() does several getComputedStyle reads (each a potential forced style
    // recalc) per element. Running it over an entire large DOM tree synchronously -
    // once on the first enable, and again every REVALIDATE_INTERVAL_MS afterward -
    // blocks the main thread for as long as that takes, which on a page the size of
    // Fabric's is long enough to freeze the tab: exactly the "extension slows down
    // the site" experience this was supposed to avoid. Spreading the same work
    // across idle-time batches keeps every individual chunk short enough for the
    // browser to keep painting/responding in between, at the cost of dark mode
    // visibly finishing a little after the toggle instead of snapping instantly.
    function scheduleIdle(fn) {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(fn);
        else setTimeout(() => fn(null), 16);
    }

    let chunkQueue = null; // { elements, index } while a chunked pass is in flight

    function chunkStep(deadline) {
        if (!chunkQueue) return;
        const { elements } = chunkQueue;
        const hasDeadline = deadline && typeof deadline.timeRemaining === 'function';
        const budgetEnd = hasDeadline ? null : Date.now() + 8;
        while (chunkQueue.index < elements.length) {
            if (hasDeadline ? deadline.timeRemaining() <= 0 : Date.now() >= budgetEnd) break;
            process(elements[chunkQueue.index]);
            chunkQueue.index++;
        }
        if (chunkQueue.index < elements.length) scheduleIdle(chunkStep);
        else chunkQueue = null;
    }

    function processInChunks(elements) {
        if (!elements.length) return;
        chunkQueue = { elements, index: 0 };
        scheduleIdle(chunkStep);
    }

    // Cheap traversal (no getComputedStyle) to gather every unprocessed element
    // across the light DOM and any nested shadow roots into ONE flat list, then
    // hand it to processInChunks a single time. Calling processInChunks once per
    // root instead would each REPLACE the shared chunkQueue, silently abandoning
    // whatever an earlier call had queued the moment a second shadow root turned up.
    function initialScan(root) {
        const elements = [];
        (function collect(r) {
            if (r instanceof Element && !r.hasAttribute(MARK_ATTR)) elements.push(r);
            r.querySelectorAll(`:not([${MARK_ATTR}])`).forEach((el) => elements.push(el));
            findShadowHosts(r).forEach((host) => {
                if (host.shadowRoot && !observedRoots.has(host.shadowRoot)) {
                    observedRoots.add(host.shadowRoot);
                    bodyObserver.observe(host.shadowRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
                    collect(host.shadowRoot);
                }
            });
        })(root);
        processInChunks(elements);
    }

    // Bounded, independent of mutation frequency: re-checks every already-marked
    // element (across the light DOM and any discovered shadow roots) so class-driven
    // (non-inline) color changes and late-settling styles eventually get picked up,
    // without re-scanning the whole tree on every mutation. Skips starting a new
    // pass while a previous one is still chunking through, rather than piling up
    // overlapping full-tree walks.
    function fullRevalidate() {
        if (!enabled || chunkQueue) return;
        const elements = [];
        (function collect(root) {
            root.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => elements.push(el));
            findShadowHosts(root).forEach((host) => collect(host.shadowRoot));
        })(document);
        processInChunks(elements);
    }

    // Watching childList alone only catches brand-new elements. A page that updates
    // an EXISTING element's own class/style (e.g. a status badge re-rendering on a
    // polling refresh, without replacing any DOM nodes) would otherwise go unnoticed
    // until the next fullRevalidate tick, sitting in its native colors for up to
    // REVALIDATE_INTERVAL_MS - visible as the theme periodically "flashing" back to
    // native and self-correcting. Also observing style/class lets us react instantly.
    //
    // BUT: reacting synchronously to every single attribute mutation is dangerous -
    // drag-and-drop (Angular CDK and friends update transform/style on every pointer
    // move) and hover-reveal UI can fire dozens of style/class mutations per second
    // on the same element. Calling process() (multiple getComputedStyle reads, a
    // forced style recalc) inline for each one injects real synchronous work into
    // the middle of an active drag or hover interaction, which is exactly what made
    // both our own toggle button's drag and Fabric's own workspace-icon drag/click
    // feel unresponsive. Debounce instead: batch affected elements and only actually
    // reprocess them once mutations go quiet for a moment, so an in-progress
    // interaction finishes uninterrupted.
    let pendingAttrEls = new Set();
    let attrDebounceTimer = null;
    function scheduleAttrProcessing(el) {
        pendingAttrEls.add(el);
        if (attrDebounceTimer) return;
        attrDebounceTimer = setTimeout(() => {
            attrDebounceTimer = null;
            const batch = pendingAttrEls;
            pendingAttrEls = new Set();
            if (enabled) batch.forEach(process);
        }, 200);
    }

    const bodyObserver = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
            if (m.type === 'childList') m.addedNodes.forEach(walkAndProcess);
            else if (m.type === 'attributes' && m.target instanceof Element) scheduleAttrProcessing(m.target);
        });
    });

    let revalidateTimer = null;

    function startDarkScanning() {
        if (!document.body) return;
        initialScan(document.body);
        bodyObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        if (!revalidateTimer) revalidateTimer = setInterval(fullRevalidate, REVALIDATE_INTERVAL_MS);
    }

    function stopDarkScanning() {
        bodyObserver.disconnect();
        observedRoots = new WeakSet();
        chunkQueue = null;
        if (revalidateTimer) {
            clearInterval(revalidateTimer);
            revalidateTimer = null;
        }
        if (attrDebounceTimer) {
            clearTimeout(attrDebounceTimer);
            attrDebounceTimer = null;
        }
        pendingAttrEls = new Set();
    }

    // ---- Root background + color-scheme ----------------------------------------

    function getEffectiveBackground(el) {
        while (el) {
            const c = parseColor(getComputedStyle(el).backgroundColor);
            if (c) return c;
            el = el === document.body ? document.documentElement : null;
        }
        return null;
    }

    function applyRootBackground() {
        const c = getEffectiveBackground(document.body || document.documentElement);
        if (c && rgbToHsl(c.r, c.g, c.b)[2] < 25) return; // already dark, leave native
        document.documentElement.style.setProperty('background-color', ROOT_BG, 'important');
        if (document.body) document.body.style.setProperty('background-color', ROOT_BG, 'important');
    }

    function clearRootBackground() {
        document.documentElement.style.removeProperty('background-color');
        if (document.body) document.body.style.removeProperty('background-color');
    }

    let styleEl = null;

    const SCHEME_CSS = `
        :root { color-scheme: dark; }
        ::-webkit-scrollbar { background: ${ROOT_BG}; }
        ::-webkit-scrollbar-thumb { background: #4a4d4f; border-radius: 6px; }
    `;

    function moveStyleToHead() {
        if (styleEl && document.head && styleEl.parentNode !== document.head) {
            document.head.appendChild(styleEl);
        }
    }

    const headObserver = new MutationObserver(() => {
        if (styleEl && document.head && document.head.lastElementChild !== styleEl) {
            document.head.appendChild(styleEl);
        }
    });

    // ---- Enable/disable ---------------------------------------------------------

    function enableDarkMode() {
        if (enabled) return;
        enabled = true;
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = SCHEME_CSS;
        (document.head || document.documentElement).appendChild(styleEl);
        applyRootBackground();
        startDarkScanning();
    }

    function disableDarkMode() {
        if (!enabled) return;
        enabled = false;
        stopDarkScanning();
        styleEl?.remove();
        styleEl = null;
        resetRules(); // removes the whole generated stylesheet, i.e. every element's rule at once
        clearRootBackground();
        (function cleanup(root) {
            root.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => {
                el.removeAttribute(MARK_ATTR);
                delete el.dataset.udmPid;
            });
            findShadowHosts(root).forEach((host) => cleanup(host.shadowRoot));
        })(document);
    }

    function syncButtonState(btn) {
        if (!btn) return;
        btn.textContent = enabled ? '☀️' : '🌙';
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
            setExcluded(enabled);
        });

        document.body.appendChild(btn);
    }

    // The toggle button only exists in the top frame, but each frame runs its own
    // independent copy of this script with its own `enabled` state. Without this,
    // clicking the button only flips the top frame (usually just a thin shell) while
    // whatever embedded workload iframe holds the actual visible content never hears
    // about it. GM's value-change listener fires across frames/tabs sharing this
    // script, so one click reconciles every frame keyed to the same siteDomain.
    function reconcileExclusionState() {
        const excluded = isExcluded();
        if (excluded && enabled) disableDarkMode();
        if (!excluded && !enabled) enableDarkMode();
        syncButtonState(document.getElementById(BTN_ID));
    }
    GM_addValueChangeListener(EXCEPTION_KEY, reconcileExclusionState);

    if (!isExcluded()) enableDarkMode();

    // Listening for DOMContentLoaded only works if it hasn't fired yet; if the
    // document-start injection loses the race against page parsing (slow device,
    // instant/cached navigation), the event has already passed and this would
    // silently never run, leaving the toggle button missing for that load.
    function initAfterDom() {
        moveStyleToHead();
        if (enabled) {
            applyRootBackground();
            startDarkScanning();
        }
        if (isTopFrame) createToggleButton();
        if (document.head) headObserver.observe(document.head, { childList: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAfterDom);
    } else {
        initAfterDom();
    }

    window.addEventListener('load', fullRevalidate);

    if (isTopFrame) {
        GM_registerMenuCommand('Toggle dark mode for this site', () => {
            setExcluded(enabled);
        });

        GM_registerMenuCommand('Reset toggle button position', () => {
            GM_setValue(POSITION_KEY, { bottom: 20, right: 20 });
            const btn = document.getElementById(BTN_ID);
            if (btn) {
                btn.style.bottom = '20px';
                btn.style.right = '20px';
            }
        });
    }
})();
