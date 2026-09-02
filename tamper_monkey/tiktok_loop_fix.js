// ==UserScript==
// @name         TikTok Disable Photo Carousel Autoplay + Image Downloader
// @namespace    tiktok-no-autoplay
// @version      19.0
// @description  Disables TikTok photo auto-scrolling and provides a reliable GM_download button for slide images
// @match        https://www.tiktok.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
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

  // 4. Download Execution via Tampermonkey GM privileges
  function handleDownload(btn) {
    const imgUrl = getActiveSlideImageUrl();

    if (!imgUrl) {
      btn.innerText = '❌ No Image Found';
      setTimeout(() => { btn.innerText = '💾 Download Image'; }, 1500);
      return;
    }

    btn.innerText = '⏳ Downloading...';

    const filename = `tiktok_photo_${Date.now()}.jpeg`;

    // GM_download bypasses page-level CORS and CSP blocks completely
    if (typeof GM_download === 'function') {
      GM_download({
        url: imgUrl,
        name: filename,
        onload: () => {
          btn.innerText = '✅ Saved!';
          setTimeout(() => { btn.innerText = '💾 Download Image'; }, 1500);
        },
        onerror: (err) => {
          btn.innerText = '❌ Failed';
          console.error('GM_download error:', err);
          setTimeout(() => { btn.innerText = '💾 Download Image'; }, 1500);
        }
      });
    } else {
      // Fallback using GM_xmlhttpRequest if GM_download isn't granted
      GM_xmlhttpRequest({
        method: 'GET',
        url: imgUrl,
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
          setTimeout(() => { btn.innerText = '💾 Download Image'; }, 1500);
        },
        onerror: () => {
          btn.innerText = '❌ Error';
          setTimeout(() => { btn.innerText = '💾 Download Image'; }, 1500);
        }
      });
    }
  }

  // 5. Create Standalone Floating Overlay Button
  function createFloatingButton() {
    if (document.getElementById('tm-global-dl-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'tm-global-dl-btn';
    btn.innerText = '💾 Download Image';
    btn.style.cssText = `
      position: fixed;
      top: 80px;
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
      handleDownload(btn);
    }, true);

    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });

    document.body.appendChild(btn);
  }

  function updateButtonVisibility() {
    const btn = document.getElementById('tm-global-dl-btn');
    if (!btn) return;

    const hasCarousel = document.querySelector('.swiper, [class*="swiper"] img, [class*="Photo"] img');
    btn.style.display = hasCarousel ? 'block' : 'none';
  }

  function scanAndApply() {
    const swipers = document.querySelectorAll('.swiper, [class*="swiper"]');
    swipers.forEach(el => disableAutoplayOnInstance(el));
    createFloatingButton();
    updateButtonVisibility();
  }

  setInterval(scanAndApply, 250);

  const observer = new MutationObserver(() => scanAndApply());

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scanAndApply();
  });
})();