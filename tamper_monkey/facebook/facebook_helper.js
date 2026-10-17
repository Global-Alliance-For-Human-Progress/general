// ==UserScript==
// @name         Facebook Helper: Auto Unmute, Background Play & Video/Image Downloader
// @namespace    http://tampermonkey.net/
// @version      2026.10.17.1
// @description  Autoplay on page load, force unmute, allow background play, keep paused until manually unpaused, and download the current video or image on Facebook
// @author       Liam
// @match        https://www.facebook.com/*
// @match        https://web.facebook.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=facebook.com
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Prevent Facebook from tracking tab visibility / switching
    const preventVisibilityTracking = () => {
        try {
            Object.defineProperty(document, 'hidden', {
                get: () => false,
                configurable: true
            });
            Object.defineProperty(document, 'visibilityState', {
                get: () => 'visible',
                configurable: true
            });
        } catch (e) {}

        window.addEventListener('visibilitychange', (e) => {
            e.stopImmediatePropagation();
        }, true);
    };

    preventVisibilityTracking();

    const originalMutedSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted').set;

    // Force unmute at DOM prototype level once initial interaction has occurred
    Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
        set: function (value) {
            // Only block muting if video is visible and HAS unmuted successfully before
            if (value === true && isElementVisible(this) && this.dataset.unmuteAllowed === 'true') {
                originalMutedSetter.call(this, false);
                return;
            }
            originalMutedSetter.call(this, value);
        },
        configurable: true
    });

    // Override HTMLMediaElement.prototype.play to block unwanted auto-resumes
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
        if (this.dataset.userPaused === 'true') {
            return Promise.reject(new DOMException('Blocked by user pause state.', 'NotAllowedError'));
        }
        return originalPlay.apply(this, arguments);
    };

    function isElementVisible(el) {
        const rect = el.getBoundingClientRect();
        const windowHeight = window.innerHeight || document.documentElement.clientHeight;
        const windowWidth = window.innerWidth || document.documentElement.clientWidth;

        const vertInView = (rect.top <= windowHeight) && ((rect.top + rect.height) >= 0);
        const horizInView = (rect.left <= windowWidth) && ((rect.left + rect.width) >= 0);

        return vertInView && horizInView && rect.height > 0 && rect.width > 0;
    }

    // Capture global user gesture to instantly unlock sound across all videos
    const unlockAudioContext = () => {
        document.querySelectorAll('video').forEach(video => {
            if (isElementVisible(video)) {
                video.dataset.unmuteAllowed = 'true';
                originalMutedSetter.call(video, false);
                video.volume = 1.0;
            }
        });
    };
    window.addEventListener('pointerdown', unlockAudioContext, { capture: true, once: false });
    window.addEventListener('keydown', unlockAudioContext, { capture: true, once: false });

    // Intercept pointerdown on capture phase to toggle manual play/pause state
    document.addEventListener('pointerdown', (e) => {
        const target = e.target;

        // Ignore clicks on UI elements (comments, reaction buttons, links, search inputs)
        const isUI = target.closest('button, a, textarea, input, svg, [role="button"], #tm-fb-dl-btn') && !target.closest('video');
        if (isUI) return;

        const videoContainer = target.closest('div[role="article"], div[role="dialog"], div[role="main"]') || target.parentElement;
        if (!videoContainer) return;

        const video = videoContainer.querySelector('video');
        if (!video) return;

        // Toggle userPaused flag explicitly on click
        if (!video.paused) {
            video.dataset.userPaused = 'true';
            video.pause();
        } else {
            delete video.dataset.userPaused;
            video.dataset.unmuteAllowed = 'true';
            originalMutedSetter.call(video, false);
            originalPlay.call(video).catch(() => {});
        }
    }, true);

    function enforceAudio(video) {
        if (!video) return;

        if (isElementVisible(video)) {
            // Attempt to un-mute
            originalMutedSetter.call(video, false);
            video.volume = 1.0;

            // Click Facebook UI mute button if present and state is muted
            const container = video.closest('div[role="article"]') || video.closest('div[role="dialog"]') || video.parentElement?.parentElement;
            if (container) {
                const muteBtn = container.querySelector('div[role="button"][aria-label="Mute"], div[role="button"][aria-label="Unmute"]');
                if (muteBtn && muteBtn.getAttribute('aria-pressed') === 'false') {
                    muteBtn.click();
                }
            }
        }
    }

    function handleVideoState(video) {
        if (!video) return;

        const visible = isElementVisible(video);

        if (visible) {
            // DO NOT auto-play if user explicitly paused it
            if (video.dataset.userPaused === 'true') {
                return;
            }

            // Force play on page load / view entry
            if (video.paused) {
                // Try playing unmuted first
                enforceAudio(video);
                originalPlay.call(video).then(() => {
                    video.dataset.unmuteAllowed = 'true';
                }).catch(() => {
                    // Browser blocked unmuted autoplay: start muted first, then unmute on first gesture
                    originalMutedSetter.call(video, true);
                    originalPlay.call(video).then(() => {
                        // Attempt secondary unmute right after play starts
                        enforceAudio(video);
                    }).catch(() => {});
                });
            } else {
                enforceAudio(video);
            }
        } else {
            // Mute and pause non-visible/off-screen videos
            if (!video.paused) {
                video.pause();
            }
            originalMutedSetter.call(video, true);

            // Reset flags when scrolled completely off-screen
            delete video.dataset.userPaused;
            delete video.dataset.unmuteAllowed;
        }
    }

    function attachVideoListeners(video) {
        if (video.dataset.unmuteListenersAttached) return;
        video.dataset.unmuteListenersAttached = 'true';

        video.addEventListener('volumechange', () => {
            if (video.dataset.unmuteAllowed === 'true') enforceAudio(video);
        }, { passive: true });

        video.addEventListener('ended', () => handleVideoState(video), { passive: true });

        handleVideoState(video);
    }

    function scanAndManage() {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            attachVideoListeners(video);
            handleVideoState(video);
        });
    }

    window.addEventListener('scroll', scanAndManage, { passive: true });

    const observer = new MutationObserver(scanAndManage);

    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        scanAndManage();
    });

    /* --- VIDEO / IMAGE DOWNLOADER SECTION --- */

    // Facebook video blobs are MSE streams, so the real mp4 URLs are scraped from page data
    // and from fetch/XHR responses (progressive urls that include audio).
    const BTN_ID = 'tm-fb-dl-btn';
    const BTN_VIDEO = '💾 Download Video';
    const BTN_IMAGE = '💾 Download Image';
    const URL_RE = /"(browser_native_hd_url|browser_native_sd_url|playable_url_quality_hd|playable_url)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    const ID_RE = /"(?:video_id|videoId|id)"\s*:\s*"(\d{10,})"/g;

    const found = []; // { hd, sd, ids:Set }
    const seenScripts = new WeakSet();

    function decodeUrl(raw) {
        try { return JSON.parse('"' + raw + '"'); } catch (e) { return null; }
    }

    // Newer payloads: progressive_urls entries, or any key holding an mp4 url
    const MP4_RE = /"([A-Za-z_]*(?:url|uri|Url|Uri))"\s*:\s*"(https:(?:[^"\\]|\\.)*?\.mp4(?:[^"\\]|\\.)*)"/g;

    function scanText(text) {
        if (!text || text.indexOf('.mp4') === -1 && text.indexOf('_url') === -1) return;
        [URL_RE, MP4_RE].forEach(re => scanWith(re, text));
    }

    function scanWith(re, text) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
            const url = decodeUrl(m[2]);
            if (!url || !/^https?:/.test(url)) continue;
            // Skip DASH segment urls (video-only or audio-only byte ranges)
            if (/[?&]bytestart=/.test(url)) continue;

            const ctx = text.slice(Math.max(0, m.index - 2500), m.index + 2500);
            const ids = new Set();
            ID_RE.lastIndex = 0;
            let im;
            while ((im = ID_RE.exec(ctx))) ids.add(im[1]);

            let entry = found.find(f => f.hd === url || f.sd === url);
            if (!entry) {
                entry = { hd: null, sd: null, ids: new Set() };
                found.push(entry);
            }
            const isHd = /hd/i.test(m[1]) || /quality=hd|_hd/i.test(url);
            if (isHd) entry.hd = url; else entry.sd = entry.sd || url;
            ids.forEach(i => entry.ids.add(i));
        }
    }

    function scanInlineScripts() {
        document.querySelectorAll('script:not([src])').forEach(sc => {
            if (seenScripts.has(sc)) return;
            seenScripts.add(sc);
            scanText(sc.textContent);
        });
    }

    // Hook fetch / XHR in the page context to catch SPA navigation between reels
    const pageWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    try {
        const origFetch = pageWin.fetch;
        pageWin.fetch = function () {
            const p = origFetch.apply(this, arguments);
            p.then(res => {
                try {
                    const ct = res.headers.get('content-type') || '';
                    if (!ct || /json|text|javascript|html/.test(ct)) {
                        res.clone().text().then(scanText).catch(() => {});
                    }
                } catch (e) {}
            }).catch(() => {});
            return p;
        };

        const origSend = pageWin.XMLHttpRequest.prototype.send;
        pageWin.XMLHttpRequest.prototype.send = function () {
            this.addEventListener('load', () => {
                try {
                    if (this.responseType === '' || this.responseType === 'text') scanText(this.responseText);
                } catch (e) {}
            });
            return origSend.apply(this, arguments);
        };
    } catch (e) {}

    function getCurrentVideoId() {
        const m = location.pathname.match(/\/(?:reel|videos)\/(\d+)/) ||
                  location.search.match(/[?&]v=(\d+)/);
        return m ? m[1] : null;
    }

    function getActiveVideo() {
        const vids = Array.from(document.querySelectorAll('video')).filter(v => {
            if (!isElementVisible(v)) return false;
            const r = v.getBoundingClientRect();
            return r.width > 150 && r.height > 150;
        });
        if (!vids.length) return null;
        // Prefer the video covering the most of the viewport
        const area = v => {
            const r = v.getBoundingClientRect();
            const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
            const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
            return Math.max(0, w) * Math.max(0, h);
        };
        vids.sort((a, b) => area(b) - area(a));
        return vids[0];
    }

    function pickVideoUrl() {
        const id = getCurrentVideoId();
        let entry = id ? found.find(f => f.ids.has(id)) : null;
        // No id match (feed video, or ids not near the url in the payload): use the latest one seen
        if (!entry && found.length) entry = found[found.length - 1];
        if (entry) return entry.hd || entry.sd;
        return pickFromPlayerRequests();
    }

    // Last resort: file urls the player itself requested (DASH track, may be video without audio)
    function pickFromPlayerRequests() {
        const urls = performance.getEntriesByType('resource')
            .map(e => e.name)
            .filter(n => /fbcdn|facebook/.test(n) && /\.mp4/.test(n));
        const isAudio = u => {
            try {
                const efg = new URL(u).searchParams.get('efg');
                return efg ? /audio/i.test(atob(efg)) : false;
            } catch (e) { return false; }
        };
        const video = urls.filter(u => !isAudio(u));
        const last = video[video.length - 1];
        return last ? last.replace(/([?&])bytestart=\d+&?/, '$1').replace(/([?&])byteend=\d+&?/, '$1').replace(/[?&]$/, '') : null;
    }

    function getActiveImageUrl() {
        const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
            const src = img.src || '';
            if (!/scontent|fbcdn/.test(src)) return false;
            if (/emoji|static\.xx|\/rsrc\.php/.test(src)) return false;
            return isElementVisible(img) && img.naturalWidth > 300 && img.offsetWidth > 250 && img.offsetHeight > 250;
        });
        if (!imgs.length) return null;
        imgs.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
        return imgs[0].src;
    }

    function getMode() {
        if (getActiveVideo()) return 'video';
        if (getActiveImageUrl()) return 'image';
        return null;
    }

    function flash(btn, text, label) {
        btn.innerText = text;
        setTimeout(() => { btn.innerText = label; }, 1500);
    }

    function saveUrl(btn, url, filename, label) {
        btn.innerText = '⏳ Downloading...';
        if (typeof GM_download === 'function') {
            GM_download({
                url,
                name: filename,
                onload: () => flash(btn, '✅ Saved!', label),
                onerror: (err) => {
                    console.error('GM_download error:', err);
                    flash(btn, '❌ Failed', label);
                }
            });
        } else {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                onload: (res) => {
                    const blobUrl = URL.createObjectURL(res.response);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(blobUrl);
                    flash(btn, '✅ Saved!', label);
                },
                onerror: () => flash(btn, '❌ Error', label)
            });
        }
    }

    // Fallback: re-fetch the current page HTML and scrape video urls out of it
    function refetchPageForVideo(cb) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: location.href,
            onload: (res) => {
                scanText(res.responseText);
                cb(pickVideoUrl());
            },
            onerror: () => cb(null)
        });
    }

    function handleDownload(btn) {
        if (getMode() === 'image') {
            const imgUrl = getActiveImageUrl();
            if (!imgUrl) return flash(btn, '❌ No Image Found', BTN_IMAGE);
            return saveUrl(btn, imgUrl, `facebook_${Date.now()}.jpg`, BTN_IMAGE);
        }

        scanInlineScripts();
        const filename = `facebook_${getCurrentVideoId() || Date.now()}.mp4`;
        const url = pickVideoUrl();
        if (url) return saveUrl(btn, url, filename, BTN_VIDEO);

        btn.innerText = '⏳ Looking up video...';
        refetchPageForVideo((u) => {
            if (!u) {
                console.warn('[FB helper] no video url found', {
                    id: getCurrentVideoId(),
                    entries: found.length,
                    mp4Requests: performance.getEntriesByType('resource').filter(e => /\.mp4/.test(e.name)).length
                });
                return flash(btn, '❌ No Video Found', BTN_VIDEO);
            }
            saveUrl(btn, u, filename, BTN_VIDEO);
        });
    }

    function createFloatingButton() {
        if (document.getElementById(BTN_ID) || !document.body) return;

        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.innerText = BTN_VIDEO;
        btn.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 2147483647;
            background: #1877f2;
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.2);
            padding: 10px 18px;
            border-radius: 24px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            display: none;
            pointer-events: auto;
            transition: transform 0.1s ease, background 0.2s ease;
        `;

        ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend'].forEach(evt => {
            btn.addEventListener(evt, (e) => {
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
        });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            handleDownload(btn);
        }, true);

        btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
        btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });

        document.body.appendChild(btn);
    }

    function updateButton() {
        createFloatingButton();
        const btn = document.getElementById(BTN_ID);
        if (!btn) return;

        const mode = getMode();
        btn.style.display = mode ? 'block' : 'none';
        // Don't overwrite transient status text (Downloading/Saved/Failed)
        if (btn.innerText === BTN_VIDEO || btn.innerText === BTN_IMAGE) {
            btn.innerText = mode === 'image' ? BTN_IMAGE : BTN_VIDEO;
        }
    }

    setInterval(() => {
        scanInlineScripts();
        updateButton();
    }, 500);

    // Fallback timer to force play immediately on dynamic page load
    setTimeout(scanAndManage, 300);
    setTimeout(scanAndManage, 1000);
})();