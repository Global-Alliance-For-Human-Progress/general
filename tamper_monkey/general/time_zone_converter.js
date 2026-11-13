// ==UserScript==
// @name         Universal Time Zone Converter
// @namespace    http://tampermonkey.net/
// @version      2026.11.13.2
// @description  Finds times written with a time zone (e.g. "12:00 PM UTC", "11:04:50 AM EST", "09:30 UTC+2") on any page and rewrites them into your preferred time zone and format, so everyone sees time the way that suits them.
// @author       You
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ---------------------------------------------------------------------
    // Settings (changeable from the Tampermonkey menu, stored per browser)
    // ---------------------------------------------------------------------
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const settings = {
        timeZone: GM_getValue('timeZone', browserTz),   // IANA name, e.g. "Europe/Zurich"
        hour12: GM_getValue('hour12', false),           // false = 13:00, true = 1:00 PM
        seconds: GM_getValue('seconds', true),          // always show seconds
        mode: GM_getValue('mode', 'replace'),           // 'replace' or 'both'
    };

    // Fixed UTC offsets (minutes) for the zone abbreviations we recognise.
    // Ambiguous ones (IST, CST in Asia, BST in Asia...) are deliberately left out.
    const ABBR = {
        UTC: 0, GMT: 0, UT: 0,
        EST: -300, EDT: -240, CST: -360, CDT: -300,
        MST: -420, MDT: -360, PST: -480, PDT: -420,
        AKST: -540, AKDT: -480, HST: -600,
        WET: 0, WEST: 60, BST: 60,
        CET: 60, CEST: 120, EET: 120, EEST: 180, MSK: 180,
        JST: 540, KST: 540, HKT: 480, SGT: 480,
        ACST: 570, ACDT: 630, AEST: 600, AEDT: 660, NZST: 720, NZDT: 780,
    };

    // 12:00 PM UTC | 11:04:50 AM EST | 17:30 CEST | 09:30 UTC+2 | 09:30 GMT-05:30
    const abbrAlt = Object.keys(ABBR).sort((a, b) => b.length - a.length).join('|');
    const TIME_RE = new RegExp(
        '(?<![\\d:.])(\\d{1,2}):(\\d{2})(?::(\\d{2}))?' +      // h:mm[:ss]
        '(?:\\s?([AaPp])\\.?[Mm]\\.?)?' +                       // optional AM/PM
        '\\s?(' + abbrAlt + ')' +                                // zone abbreviation
        '(?:\\s?([+-])(\\d{1,2})(?::?(\\d{2}))?)?' +             // optional UTC+2 style offset
        '(?![A-Za-z0-9])',
        'g'
    );

    // ---------------------------------------------------------------------
    // Conversion
    // ---------------------------------------------------------------------
    function convert(m) {
        let hour = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const sec = m[3] !== undefined ? parseInt(m[3], 10) : 0;
        const mer = m[4] ? m[4].toUpperCase() : null;
        const abbr = m[5];
        const sign = m[6];

        if (min > 59 || sec > 59) return null;
        if (mer) {
            if (hour < 1 || hour > 12) return null;
            hour = (hour % 12) + (mer === 'P' ? 12 : 0);
        } else if (hour > 23) {
            return null;
        }

        // Offsets like "UTC+2" only make sense on the UTC/GMT abbreviations.
        let offset = ABBR[abbr];
        if (sign) {
            if (offset !== 0) return null;
            const oh = parseInt(m[7], 10);
            const om = m[8] ? parseInt(m[8], 10) : 0;
            if (oh > 14 || om > 59) return null;
            offset = (sign === '-' ? -1 : 1) * (oh * 60 + om);
        }

        // Take today's date as the date of the source time.
        const now = new Date();
        const y = now.getUTCFullYear(), mo = now.getUTCMonth(), d = now.getUTCDate();
        const instant = new Date(Date.UTC(y, mo, d, hour, min, sec) - offset * 60000);

        let parts;
        try {
            parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: settings.timeZone,
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
            }).formatToParts(instant);
        } catch (e) {
            return null; // invalid time zone name saved by the user
        }
        const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
        const th = get('hour') % 24, tm = get('minute'), ts = get('second');
        const dayDelta = Math.round(
            (Date.UTC(get('year'), get('month') - 1, get('day')) - Date.UTC(y, mo, d)) / 86400000
        );

        const pad = (n) => String(n).padStart(2, '0');
        const showSec = settings.seconds;
        let text;
        if (settings.hour12) {
            const h12 = th % 12 === 0 ? 12 : th % 12;
            text = h12 + ':' + pad(tm) + (showSec ? ':' + pad(ts) : '') + ' ' + (th >= 12 ? 'PM' : 'AM');
        } else {
            text = pad(th) + ':' + pad(tm) + (showSec ? ':' + pad(ts) : '');
        }
        if (dayDelta !== 0) text += ' (' + (dayDelta > 0 ? '+' : '') + dayDelta + 'd)';
        return text;
    }

    function rewrite(str) {
        let changed = false;
        const out = str.replace(TIME_RE, (...args) => {
            const converted = convert(args);
            if (converted === null) return args[0];
            changed = true;
            return settings.mode === 'both' ? converted + ' (' + args[0] + ')' : converted;
        });
        return changed ? out : null;
    }

    // ---------------------------------------------------------------------
    // DOM walking
    // ---------------------------------------------------------------------
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'SELECT', 'OPTION']);
    const done = new WeakMap(); // text node -> the value we last wrote, to avoid loops

    function skipNode(node) {
        let el = node.parentElement;
        while (el) {
            if (SKIP.has(el.tagName) || el.isContentEditable) return true;
            // Climb out of shadow roots to the host element.
            el = el.parentElement || (el.getRootNode() && el.getRootNode().host) || null;
        }
        return false;
    }

    function processText(node) {
        const value = node.nodeValue;
        if (!value || done.get(node) === value) return;
        if (!/\d:\d\d/.test(value) || skipNode(node)) return;
        const out = rewrite(value);
        if (out === null) return;
        node.nodeValue = out;
        done.set(node, out);
        if (node.parentElement && !node.parentElement.title) {
            node.parentElement.title = 'Converted to ' + settings.timeZone + ' (original: ' + value.trim() + ')';
        }
    }

    const observed = new WeakSet();
    function observe(root) {
        if (observed.has(root)) return;
        observed.add(root);
        observer.observe(root, { childList: true, subtree: true, characterData: true });
    }

    // Collects text nodes, descending into open shadow roots and into same-origin
    // iframes (many apps, e.g. Microsoft status pages, render their text inside
    // script-filled blank iframes, which userscripts are not injected into).
    function collect(root, out) {
        const doc = root.ownerDocument || root;
        const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const n = walker.currentNode;
            if (n.nodeType === Node.TEXT_NODE) out.push(n);
            else if (n.shadowRoot) {
                observe(n.shadowRoot);
                collect(n.shadowRoot, out);
            } else if (n.tagName === 'IFRAME') {
                let inner = null;
                try { inner = n.contentDocument; } catch (e) { /* cross-origin */ }
                if (inner && inner.documentElement) {
                    observe(inner.documentElement);
                    collect(inner.documentElement, out);
                }
            }
        }
    }

    function processTree(root) {
        if (root.nodeType === Node.TEXT_NODE) return processText(root);
        if (root.nodeType !== Node.ELEMENT_NODE) return;
        const nodes = [];
        if (root.shadowRoot) {
            observe(root.shadowRoot);
            collect(root.shadowRoot, nodes);
        }
        collect(root, nodes);
        nodes.forEach(processText);
    }

    let pending = new Set();
    let scheduled = false;
    function flush() {
        scheduled = false;
        const batch = pending;
        pending = new Set();
        batch.forEach(processTree);
    }
    function queue(node) {
        pending.add(node);
        if (!scheduled) {
            scheduled = true;
            setTimeout(flush, 100);
        }
    }

    const observer = new MutationObserver((records) => {
        for (const r of records) {
            if (r.type === 'characterData') queue(r.target);
            else r.addedNodes.forEach(queue);
        }
    });
    observe(document.documentElement);

    processTree(document.body || document.documentElement);

    // Shadow roots attached after our scan raise no mutation on the page, so
    // rescan occasionally to pick them up.
    setInterval(() => {
        if (!document.hidden) processTree(document.body || document.documentElement);
    }, 3000);

    // ---------------------------------------------------------------------
    // Menu commands (top frame only, so they appear once)
    // ---------------------------------------------------------------------
    if (window.top === window) {
        const set = (key, value) => { GM_setValue(key, value); location.reload(); };
        GM_registerMenuCommand('Time zone: ' + settings.timeZone + ' (change)', () => {
            const v = prompt('Preferred time zone (IANA name, e.g. Europe/Zurich, America/New_York, UTC):', settings.timeZone);
            if (!v) return;
            try {
                new Intl.DateTimeFormat('en-GB', { timeZone: v.trim() });
                set('timeZone', v.trim());
            } catch (e) {
                alert('Unknown time zone: ' + v);
            }
        });
        GM_registerMenuCommand('Format: ' + (settings.hour12 ? '12-hour' : '24-hour') + ' (toggle)', () => set('hour12', !settings.hour12));
        GM_registerMenuCommand('Seconds: ' + (settings.seconds ? 'shown' : 'hidden') + ' (toggle)', () => set('seconds', !settings.seconds));
        GM_registerMenuCommand('Display: ' + (settings.mode === 'replace' ? 'replace original' : 'show both') + ' (toggle)', () => set('mode', settings.mode === 'replace' ? 'both' : 'replace'));
    }
})();
