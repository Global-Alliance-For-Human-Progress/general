// ==UserScript==
// @name         Instagram Auto Unmute, Background Play & Media Downloader
// @namespace    http://tampermonkey.net/
// @version      2026.11.15.1
// @description  Autoplay on page load, force unmute, allow background play, and download current image or video
// @author       Liam
// @match        https://www.instagram.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=instagram.com
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @homepageURL  https://github.com/Global-Alliance-For-Human-Progress/general/tree/main/tamper_monkey/instagram
// @supportURL   https://github.com/Global-Alliance-For-Human-Progress/general/issues
// @downloadURL  https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/instagram/instagram_helper.user.js
// @updateURL    https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/instagram/instagram_helper.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Prevent Instagram from tracking tab visibility / switching
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
        if (!el) return false;
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

        // Ignore clicks on UI elements (comment button, like icon, share, links, text inputs, download button)
        const isUI = target.closest('button, a, textarea, input, svg, [role="button"], #tm-ig-dl-btn') && !target.closest('video');
        if (isUI) return;

        const videoContainer = target.closest('article, div[role="dialog"], div[role="presentation"]') || target.parentElement;
        if (!videoContainer) return;

        const video = videoContainer.querySelector('video');
        if (!video) return;

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
            originalMutedSetter.call(video, false);
            video.volume = 1.0;

            const container = video.closest('article') || video.closest('div[role="dialog"]') || video.parentElement;
            if (container) {
                const muteBtn = container.querySelector('button[aria-label="Audio is muted"], [aria-label="Audio is muted"]');
                if (muteBtn) {
                    muteBtn.click();
                }
            }
        }
    }

    function handleVideoState(video) {
        if (!video) return;

        const visible = isElementVisible(video);

        if (visible) {
            if (video.dataset.userPaused === 'true') return;

            if (video.paused) {
                enforceAudio(video);
                originalPlay.call(video).then(() => {
                    video.dataset.unmuteAllowed = 'true';
                }).catch(() => {
                    originalMutedSetter.call(video, true);
                    originalPlay.call(video).then(() => {
                        enforceAudio(video);
                    }).catch(() => {});
                });
            } else {
                enforceAudio(video);
            }
        } else {
            if (!video.paused) {
                video.pause();
            }
            originalMutedSetter.call(video, true);

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

    /* --- IMAGE DOWNLOADER SECTION --- */

    function getActiveVideo() {
        const videos = Array.from(document.querySelectorAll('video')).filter(v => isElementVisible(v) && v.offsetWidth > 180 && v.offsetHeight > 180);
        if (!videos.length) return null;
        videos.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
        return videos[0];
    }

    function getActiveImage() {
        const images = Array.from(document.querySelectorAll('article img, main img, div[role="dialog"] img, div[role="presentation"] img'));
        const visibleImgs = images.filter(img => {
            const src = img.src || '';
            const isMedia = src.includes('cdninstagram') || src.includes('fbcdn') || src.startsWith('http');
            return isMedia && isElementVisible(img) && img.offsetWidth > 180 && img.offsetHeight > 180;
        });
        if (!visibleImgs.length) return null;
        visibleImgs.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
        return visibleImgs[0];
    }

    // Returns { type: 'video'|'image', el } for the main visible media, or null
    function getActiveMedia() {
        const video = getActiveVideo();
        const img = getActiveImage();
        if (video && img) {
            const va = video.offsetWidth * video.offsetHeight;
            const ia = img.offsetWidth * img.offsetHeight;
            return va >= ia ? { type: 'video', el: video } : { type: 'image', el: img };
        }
        if (video) return { type: 'video', el: video };
        if (img) return { type: 'image', el: img };
        return null;
    }

    function shortcodeToMediaId(shortcode) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        let id = 0n;
        for (const c of shortcode) id = id * 64n + BigInt(alphabet.indexOf(c));
        return id.toString();
    }

    function getMediaIdForVideo(video) {
        const scope = video.closest('article') || video.closest('div[role="dialog"]') || document;
        const link = scope.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
        const re = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/;
        const m = (link && link.getAttribute('href').match(re)) || location.pathname.match(re);
        if (m) return shortcodeToMediaId(m[1]);
        const st = location.pathname.match(/\/stories\/[^/]+\/(\d+)/);
        return st ? st[1] : null;
    }

    function gmFetchJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'json',
                headers: { 'X-IG-App-ID': '936619743392459', 'Accept': '*/*' },
                anonymous: false,
                onload: (res) => {
                    try { resolve(typeof res.response === 'object' && res.response ? res.response : JSON.parse(res.responseText)); }
                    catch (e) { reject(e); }
                },
                onerror: reject
            });
        });
    }

    async function resolveVideoUrl(video) {
        if (video.src && /^https?:/.test(video.src)) return video.src;
        const mediaId = getMediaIdForVideo(video);
        if (!mediaId) throw new Error('No media id found');
        const data = await gmFetchJson(`https://www.instagram.com/api/v1/media/${mediaId}/info/`);
        const item = data && data.items && data.items[0];
        if (!item) throw new Error('No media info');
        let node = item;
        if (item.carousel_media) {
            const vids = item.carousel_media.filter(c => c.video_versions);
            node = vids.find(c => Math.abs((c.video_duration || 0) - video.duration) < 0.5) || vids[0];
        }
        if (!node || !node.video_versions || !node.video_versions.length) throw new Error('No video url');
        return node.video_versions[0].url;
    }

    function labelFor(media) {
        return media && media.type === 'video' ? '💾 Download Video' : '💾 Download Image';
    }

    function saveUrl(url, filename, btn) {
        const reset = () => setTimeout(() => { btn.dataset.busy = '0'; btn.innerText = labelFor(getActiveMedia()); }, 1500);
        if (typeof GM_download === 'function') {
            GM_download({
                url,
                name: filename,
                onload: () => { btn.innerText = '✅ Saved!'; reset(); },
                onerror: (err) => {
                    btn.innerText = '❌ Failed';
                    console.error('GM_download error:', err);
                    reset();
                }
            });
        } else if (typeof GM_xmlhttpRequest === 'function') {
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
                    btn.innerText = '✅ Saved!';
                    reset();
                },
                onerror: () => { btn.innerText = '❌ Error'; reset(); }
            });
        }
    }

    async function handleDownload(btn) {
        const media = getActiveMedia();
        const reset = () => setTimeout(() => { btn.dataset.busy = '0'; btn.innerText = labelFor(getActiveMedia()); }, 1500);

        if (!media) {
            btn.innerText = '❌ No Media Found';
            reset();
            return;
        }

        btn.dataset.busy = '1'; btn.innerText = '⏳ Downloading...';
        if (media.type === 'video') {
            try {
                const url = await resolveVideoUrl(media.el);
                saveUrl(url, `instagram_${Date.now()}.mp4`, btn);
            } catch (e) {
                console.error('Video download error:', e);
                btn.innerText = '❌ Video Failed';
                reset();
            }
        } else {
            saveUrl(media.el.src, `instagram_${Date.now()}.jpg`, btn);
        }
    }

    function createFloatingButton() {
        if (document.getElementById('tm-ig-dl-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'tm-ig-dl-btn';
        btn.innerText = '💾 Download Image';
        btn.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 2147483647;
            background: #e1306c;
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

        const events = ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend'];
        events.forEach(evt => {
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

    function updateButtonVisibility() {
        const btn = document.getElementById('tm-ig-dl-btn');
        if (!btn) return;

        const media = getActiveMedia();
        btn.style.display = media ? 'block' : 'none';
        if (media && btn.dataset.busy !== '1') {
            const label = labelFor(media);
            if (btn.textContent !== label) btn.textContent = label;
        }
    }

    function scanAndManage() {
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            attachVideoListeners(video);
            handleVideoState(video);
        });

        createFloatingButton();
        updateButtonVisibility();
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

    setInterval(scanAndManage, 500);
})();