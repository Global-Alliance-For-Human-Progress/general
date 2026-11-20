// ==UserScript==
// @name         Console Log Forwarder
// @namespace    http://tampermonkey.net/
// @version      2026.11.20
// @description  Forwards page console output, uncaught errors, rejected promises, CSP violations and failed resource loads to a local listener (console_log_listener.ps1) so they can be read from a file.
// @match        *://*/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function () {
    'use strict';

    const LOG_URL = 'http://localhost:8766/';
    const FLUSH_MS = 500;
    const MAX_QUEUE = 500;
    const MAX_LEN = 2000;
    const w = unsafeWindow;

    const queue = [];

    const fmt = (v) => {
        try {
            if (typeof v === 'string') return v;
            if (v instanceof Error) return v.stack || (v.name + ': ' + v.message);
            if (typeof v === 'function') return '[function ' + (v.name || 'anonymous') + ']';
            if (v && v.nodeType === 1) return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + '>';
            const seen = new WeakSet();
            return JSON.stringify(v, (k, x) => {
                if (typeof x === 'object' && x !== null) {
                    if (seen.has(x)) return '[circular]';
                    seen.add(x);
                }
                return typeof x === 'function' ? '[function]' : x;
            });
        } catch (e) {
            return String(v);
        }
    };

    const push = (level, parts) => {
        if (queue.length >= MAX_QUEUE) queue.shift();
        let text = parts.join(' ');
        if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN) + '...[truncated]';
        queue.push(level.toUpperCase().padEnd(5) + ' ' + location.host + ' ' + text.replace(/\n/g, '\n      '));
    };

    const flush = () => {
        if (!queue.length) return;
        const body = queue.splice(0, queue.length).join('\n');
        try {
            GM_xmlhttpRequest({
                method: 'POST',
                url: LOG_URL,
                data: body,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                onerror: () => {},
                ontimeout: () => {},
                timeout: 3000,
            });
        } catch (e) { /* listener not reachable, drop */ }
    };

    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const orig = w.console[level];
        w.console[level] = function (...args) {
            try { push(level, args.map(fmt)); } catch (e) { /* never break the page */ }
            return orig.apply(this, args);
        };
    }

    w.addEventListener('error', (e) => {
        if (e.target && e.target !== w && e.target.tagName) {
            push('error', ['resource failed to load:', fmt(e.target), e.target.src || e.target.href || '']);
        } else {
            push('error', ['uncaught:', e.message, '(' + e.filename + ':' + e.lineno + ':' + e.colno + ')', e.error && e.error.stack ? '\n' + e.error.stack : '']);
        }
    }, true);

    w.addEventListener('unhandledrejection', (e) => {
        push('error', ['unhandled rejection:', fmt(e.reason)]);
    });

    w.addEventListener('securitypolicyviolation', (e) => {
        push('warn', ['CSP violation:', e.violatedDirective, 'blocked', e.blockedURI, 'on', e.sourceFile || location.href]);
    });

    push('info', ['page loaded', location.href]);
    setInterval(flush, FLUSH_MS);
    w.addEventListener('pagehide', flush);
})();
