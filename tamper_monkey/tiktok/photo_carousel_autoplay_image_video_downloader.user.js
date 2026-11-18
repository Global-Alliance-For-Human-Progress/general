// ==UserScript==
// @name         TikTok Disable Photo Carousel Autoplay + Image & Video Downloader
// @namespace    tiktok-no-autoplay
// @version      2026.11.18.3
// @description  Disables TikTok photo auto-scrolling and provides reliable GM_download buttons for slide images and videos
// @match        https://www.tiktok.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
// @homepageURL  https://github.com/Global-Alliance-For-Human-Progress/general/tree/main/tamper_monkey/tiktok
// @supportURL   https://github.com/Global-Alliance-For-Human-Progress/general/issues
// @downloadURL  https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/tiktok/photo_carousel_autoplay_image_video_downloader.user.js
// @updateURL    https://raw.githubusercontent.com/Global-Alliance-For-Human-Progress/general/main/tamper_monkey/tiktok/photo_carousel_autoplay_image_video_downloader.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 1. Block TikTok's programmatic video/slide end triggers that cause auto-advancement
  window.addEventListener('ended', (e) => {
    if (e.target && e.target.tagName === 'VIDEO') {
      const container = e.target.closest('[class*="swiper"], .swiper');
      if (container) {
        e.stopImmediatePropagation();
      }
    }
  }, true);

  // 2. Disable internal Swiper autoplay engine
  function disableAutoplayOnInstance(swiperEl) {
    const s = swiperEl.swiper;
    if (!s) return;

    try {
      if (s.autoplay) {
        s.autoplay.stop();
        s.autoplay.pause();
        s.params.autoplay = false;
        if (typeof s.autoplay.destroy === 'function') {
          s.autoplay.destroy();
        }
      }

      if (!s.params.autoplay || typeof s.params.autoplay !== 'object') {
        s.params.autoplay = {};
      }
      s.params.autoplay.delay = 99999999;
      s.params.autoplay.disableOnInteraction = false;

      if (s.autoplay?.timeout) {
        clearTimeout(s.autoplay.timeout);
      }

      if (s.on) {
        s.on('autoplayStart', () => s.autoplay?.stop());
        s.on('autoplay', () => s.autoplay?.stop());
      }
    } catch (e) {}
  }

  // 3. Robust Image Source Collector
  function getActiveSlideImageUrl() {
    // Strategy A: Check active swiper slide
    const activeSlide = document.querySelector('.swiper-slide-active, [class*="slide-active"]');
    if (activeSlide) {
      const img = activeSlide.querySelector('img');
      if (img && img.src) return img.src;
    }

    // Strategy B: Search for visible high-res images in carousel containers
    const allImgs = Array.from(document.querySelectorAll('img'));
    const candidate = allImgs.find(img => {
      const isTikTokCdn = img.src.includes('tiktok') || img.src.includes('byteoversea');
      const isVisible = img.offsetWidth > 200 && img.offsetHeight > 200;
      return isTikTokCdn && isVisible;
    });

    return candidate ? candidate.src : null;
  }

  // Image URLs from a post's embedded data (TikTok only renders some slides in the DOM)
  function imageUrlsFromItem(item, id) {
    if (!item || (id && item.id !== id)) return null;
    const images = item.imagePost && item.imagePost.images;
    if (!images || !images.length) return null;
    const urls = images
      .map(i => i.imageURL && i.imageURL.urlList && (i.imageURL.urlList.find(u => /\.jpe?g|\.webp|\.heic/i.test(u.split('?')[0])) || i.imageURL.urlList[0]))
      .filter(Boolean);
    return urls.length ? urls : null;
  }

  function getRehydrationImageUrls(id) {
    try {
      const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!el) return null;
      const data = JSON.parse(el.textContent);
      const item = data.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct;
      return imageUrlsFromItem(item, id);
    } catch (e) {
      return null;
    }
  }

  function fetchImageUrlsById(id) {
    const tryUrl = (path) => new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://www.tiktok.com/@_/${path}/${id}`,
        headers: { Referer: 'https://www.tiktok.com/' },
        onload: res => {
          try {
            const m = (res.responseText || '').match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
            const data = m && JSON.parse(m[1]);
            const item = data.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct;
            resolve(imageUrlsFromItem(item, id));
          } catch (e) {
            resolve(null);
          }
        },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null)
      });
    });
    return tryUrl('photo').then(r => r || tryUrl('video'));
  }

  // Fallback: every distinct TikTok CDN image inside the carousel's container
  function getDomCarouselImageUrls() {
    const active = document.querySelector('.swiper-slide-active, [class*="slide-active"]');
    const root = (active && active.closest('.swiper, [class*="swiper"]')) || document;
    const urls = [];
    const seen = new Set();
    root.querySelectorAll('img').forEach(img => {
      const src = img.currentSrc || img.src;
      if (!src || !src.startsWith('http') || !/tiktok|byteoversea|ibyteimg/.test(src)) return;
      if (img.closest('[class*="duplicate"]')) return;
      if (img.naturalWidth && img.naturalWidth < 200) return;
      const key = src.split('?')[0];
      if (seen.has(key)) return;
      seen.add(key);
      urls.push(src);
    });
    return urls;
  }

  // All unique slide images of the current photo post
  async function getAllCarouselImageUrls() {
    const active = document.querySelector('.swiper-slide-active, [class*="slide-active"]');
    const id = getVideoId(active || document.querySelector('.swiper'));
    const embedded = getRehydrationImageUrls(id);
    if (embedded) return embedded;
    if (id) {
      const fetched = await fetchImageUrlsById(id);
      if (fetched) return fetched;
    }
    const dom = getDomCarouselImageUrls();
    if (dom.length) return dom;
    const single = getActiveSlideImageUrl();
    return single ? [single] : [];
  }

  // 4. Video source finder
  function getVisibleVideo() {
    let best = null;
    let bestArea = 0;
    document.querySelectorAll('video').forEach(v => {
      const r = v.getBoundingClientRect();
      const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      const area = w > 0 && h > 0 ? w * h : 0;
      if (area > bestArea && r.width > 200 && r.height > 200) {
        best = v;
        bestArea = area;
      }
    });
    return best;
  }

  function getRehydrationVideoUrl() {
    try {
      const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!el) return null;
      const data = JSON.parse(el.textContent);
      const item = data.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct;
      const idMatch = location.pathname.match(/\/video\/(\d+)/);
      if (idMatch && item.id !== idMatch[1]) return null;
      return item.video.downloadAddr || item.video.playAddr || null;
    } catch (e) {
      return null;
    }
  }

  function getVideoId(v) {
    const m = location.pathname.match(/\/(?:video|photo)\/(\d+)/);
    if (m) return m[1];
    // Feed / profile: look for a permalink near the playing video
    let el = v;
    for (let i = 0; el && i < 12; i++, el = el.parentElement) {
      const a = el.querySelector && el.querySelector('a[href*="/video/"], a[href*="/photo/"]');
      if (a) {
        const mm = a.getAttribute('href').match(/\/(?:video|photo)\/(\d+)/);
        if (mm) return mm[1];
      }
    }
    return null;
  }

  function extractVideoUrlFromHtml(html, id) {
    const m = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    try {
      const data = JSON.parse(m[1]);
      const item = data.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct;
      if (id && item.id !== id) return null;
      const vid = item.video;
      return vid.downloadAddr || vid.playAddr ||
        (vid.bitrateInfo && vid.bitrateInfo[0] && vid.bitrateInfo[0].PlayAddr && vid.bitrateInfo[0].PlayAddr.UrlList[0]) || null;
    } catch (e) {
      return null;
    }
  }

  // Fetch the video's own page (with the user's cookies) and read its embedded data
  function fetchVideoUrlById(id) {
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://www.tiktok.com/@_/video/${id}`,
        headers: { Referer: 'https://www.tiktok.com/' },
        onload: res => resolve(extractVideoUrlFromHtml(res.responseText || '', id)),
        onerror: () => resolve(null),
        ontimeout: () => resolve(null)
      });
    });
  }

  async function getActiveVideoUrl() {
    const v = getVisibleVideo();
    if (v) {
      const direct = [v.currentSrc, v.src].find(u => u && u.startsWith('http'));
      if (direct) return direct;
      const source = Array.from(v.querySelectorAll('source')).find(x => x.src && x.src.startsWith('http'));
      if (source) return source.src;
    }
    // blob: sources can't be downloaded. Try the page's embedded data, then fetch by video id
    const embedded = getRehydrationVideoUrl();
    if (embedded) return embedded;
    const id = getVideoId(v);
    return id ? await fetchVideoUrlById(id) : null;
  }

  // 5. Download Execution via Tampermonkey GM privileges
  function downloadUrl(btn, url, filename, idleLabel) {
    const reset = () => setTimeout(() => { btn.innerText = idleLabel; }, 1500);
    const headers = { Referer: 'https://www.tiktok.com/' };

    btn.innerText = '⏳ Downloading...';

    // GM_download bypasses page-level CORS and CSP blocks completely
    if (typeof GM_download === 'function') {
      GM_download({
        url,
        name: filename,
        headers,
        onload: () => {
          btn.innerText = '✅ Saved!';
          reset();
        },
        onerror: (err) => {
          btn.innerText = '❌ Failed';
          console.error('GM_download error:', err);
          reset();
        }
      });
    } else {
      // Fallback using GM_xmlhttpRequest if GM_download isn't granted
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
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
        onerror: () => {
          btn.innerText = '❌ Error';
          reset();
        }
      });
    }
  }

  function handleImageDownload(btn) {
    const imgUrl = getActiveSlideImageUrl();
    if (!imgUrl) {
      btn.innerText = '❌ No Image Found';
      setTimeout(() => { btn.innerText = IMAGE_LABEL; }, 1500);
      return;
    }
    downloadUrl(btn, imgUrl, `tiktok_photo_${Date.now()}.jpeg`, IMAGE_LABEL);
  }

  // Remembered download folder (File System Access API, handle kept in IndexedDB)
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('tm-tiktok-downloader', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    try {
      const db = await idbOpen();
      return await new Promise(resolve => {
        const r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  async function idbSet(key, value) {
    try {
      const db = await idbOpen();
      await new Promise(resolve => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (e) {}
  }

  // Returns a writable folder handle, asking for the location only the first time.
  // Must be called straight from the click so the browser allows the prompt.
  async function getDownloadDir() {
    if (typeof window.showDirectoryPicker !== 'function') return null;
    const saved = await idbGet('dir');
    if (saved) {
      try {
        let perm = await saved.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await saved.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') return saved;
      } catch (e) {}
    }
    const dir = await window.showDirectoryPicker({ id: 'tiktok-dl', mode: 'readwrite' });
    await idbSet('dir', dir);
    return dir;
  }

  function fetchBlob(url) {
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Referer: 'https://www.tiktok.com/' },
        responseType: 'blob',
        onload: res => resolve(res.status >= 200 && res.status < 300 ? res.response : null),
        onerror: () => resolve(null),
        ontimeout: () => resolve(null)
      });
    });
  }

  function downloadFileAsync(url, filename) {
    return new Promise(resolve => {
      GM_download({
        url,
        name: filename,
        headers: { Referer: 'https://www.tiktok.com/' },
        onload: () => resolve(true),
        onerror: (err) => { console.error('GM_download error:', err); resolve(false); },
        ontimeout: () => resolve(false)
      });
    });
  }

  async function handleAllImagesDownload(btn) {
    const finish = (text, ms) => {
      btn.innerText = text;
      setTimeout(() => { btn.innerText = ALL_IMAGES_LABEL; }, ms);
    };

    // Ask for the folder first, while the click still counts as a user gesture
    let dir = null;
    try {
      dir = await getDownloadDir();
    } catch (e) {
      if (e && e.name === 'AbortError') return finish('Cancelled', 1500);
      console.error('Folder access failed, using normal downloads:', e);
    }

    btn.innerText = '⏳ Looking up...';
    const urls = await getAllCarouselImageUrls();
    if (!urls.length) return finish('❌ No Images Found', 1500);

    btn.innerText = `⏳ Downloading ${urls.length}...`;
    let ok = 0;

    if (dir) {
      // One subfolder per post so 1.jpeg, 2.jpeg... never overwrite another post
      const active = document.querySelector('.swiper-slide-active, [class*="slide-active"]');
      const postId = getVideoId(active || document.querySelector('.swiper')) || String(Date.now());
      const sub = await dir.getDirectoryHandle(postId, { create: true });
      const results = await Promise.all(urls.map(async (url, i) => {
        try {
          const blob = await fetchBlob(url);
          if (!blob) return false;
          const fh = await sub.getFileHandle(`${i + 1}.jpeg`, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
          return true;
        } catch (e) {
          console.error('Write failed:', e);
          return false;
        }
      }));
      ok = results.filter(Boolean).length;
    } else {
      const results = await Promise.all(urls.map((url, i) => downloadFileAsync(url, `${i + 1}.jpeg`)));
      ok = results.filter(Boolean).length;
    }

    finish(ok === urls.length ? `✅ Saved ${ok}` : `⚠️ Saved ${ok}/${urls.length}`, 2000);
  }

  async function handleVideoDownload(btn) {
    btn.innerText = '⏳ Looking up...';
    const videoUrl = await getActiveVideoUrl();
    if (!videoUrl) {
      btn.innerText = '❌ No Video Found';
      setTimeout(() => { btn.innerText = VIDEO_LABEL; }, 1500);
      return;
    }
    const id = getVideoId(getVisibleVideo());
    downloadUrl(btn, videoUrl, `tiktok_video_${id || Date.now()}.mp4`, VIDEO_LABEL);
  }

  // 6. Create Standalone Floating Overlay Buttons
  const IMAGE_LABEL = '💾 Download Current Image';
  const ALL_IMAGES_LABEL = '🖼️ Download All Images';
  const VIDEO_LABEL = '🎬 Download Video';

  function createFloatingButton(id, label, top, onClick) {
    if (document.getElementById(id)) return;

    const btn = document.createElement('button');
    btn.id = id;
    btn.innerText = label;
    btn.style.cssText = `
      position: fixed;
      top: ${top}px;
      right: 20px;
      z-index: 2147483647;
      background: #fe2c55;
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 10px 20px;
      border-radius: 24px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      display: none;
      pointer-events: auto;
      transition: transform 0.1s ease, background 0.2s ease;
    `;

    // Isolate event capture
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
      onClick(btn);
    }, true);

    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });

    document.body.appendChild(btn);
  }

  function updateButtonVisibility() {
    const imgBtn = document.getElementById('tm-global-dl-btn');
    if (imgBtn) {
      const hasCarousel = document.querySelector('.swiper, [class*="swiper"] img, [class*="Photo"] img');
      imgBtn.style.display = hasCarousel ? 'block' : 'none';
    }

    const allBtn = document.getElementById('tm-global-dl-all-btn');
    if (allBtn) {
      const hasCarousel = document.querySelector('.swiper, [class*="swiper"] img, [class*="Photo"] img');
      allBtn.style.display = hasCarousel ? 'block' : 'none';
    }

    const videoBtn = document.getElementById('tm-global-dl-video-btn');
    if (videoBtn) {
      videoBtn.style.display = getVisibleVideo() ? 'block' : 'none';
    }
  }

  function scanAndApply() {
    const swipers = document.querySelectorAll('.swiper, [class*="swiper"]');
    swipers.forEach(el => disableAutoplayOnInstance(el));
    createFloatingButton('tm-global-dl-btn', IMAGE_LABEL, 80, handleImageDownload);
    createFloatingButton('tm-global-dl-all-btn', ALL_IMAGES_LABEL, 130, handleAllImagesDownload);
    createFloatingButton('tm-global-dl-video-btn', VIDEO_LABEL, 180, handleVideoDownload);
    updateButtonVisibility();
  }

  setInterval(scanAndApply, 250);

  const observer = new MutationObserver(() => scanAndApply());

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scanAndApply();
  });
})();