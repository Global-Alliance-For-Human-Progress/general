// ==UserScript==
// @name         TikTok Disable Photo Carousel Autoplay + Image & Video Downloader
// @namespace    tiktok-no-autoplay
// @version      2026.11.01
// @description  Disables TikTok photo auto-scrolling and provides reliable GM_download buttons for slide images and videos
// @match        https://www.tiktok.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
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

  function getActiveVideoUrl() {
    const v = getVisibleVideo();
    if (v) {
      const direct = [v.currentSrc, v.src].find(u => u && u.startsWith('http'));
      if (direct) return direct;
      const source = Array.from(v.querySelectorAll('source')).find(x => x.src && x.src.startsWith('http'));
      if (source) return source.src;
    }
    // blob: sources can't be downloaded, fall back to the page's embedded data
    return getRehydrationVideoUrl();
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

  function handleVideoDownload(btn) {
    const videoUrl = getActiveVideoUrl();
    if (!videoUrl) {
      btn.innerText = '❌ No Video Found';
      setTimeout(() => { btn.innerText = VIDEO_LABEL; }, 1500);
      return;
    }
    const idMatch = location.pathname.match(/\/video\/(\d+)/);
    downloadUrl(btn, videoUrl, `tiktok_video_${idMatch ? idMatch[1] : Date.now()}.mp4`, VIDEO_LABEL);
  }

  // 6. Create Standalone Floating Overlay Buttons
  const IMAGE_LABEL = '💾 Download Image';
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

    const videoBtn = document.getElementById('tm-global-dl-video-btn');
    if (videoBtn) {
      videoBtn.style.display = getVisibleVideo() ? 'block' : 'none';
    }
  }

  function scanAndApply() {
    const swipers = document.querySelectorAll('.swiper, [class*="swiper"]');
    swipers.forEach(el => disableAutoplayOnInstance(el));
    createFloatingButton('tm-global-dl-btn', IMAGE_LABEL, 80, handleImageDownload);
    createFloatingButton('tm-global-dl-video-btn', VIDEO_LABEL, 130, handleVideoDownload);
    updateButtonVisibility();
  }

  setInterval(scanAndApply, 250);

  const observer = new MutationObserver(() => scanAndApply());

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scanAndApply();
  });
})();