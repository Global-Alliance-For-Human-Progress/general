// ==UserScript==
// @name         LinkedIn Unfollow All
// @namespace    linkedin-unfollow-all
// @version      2026.09.10.7
// @description  Finds people you follow in the feed and unfollows them, one post's control menu at a time
// @author       Liam
// @match        https://www.linkedin.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=linkedin.com
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let isRunning = false;
  let unfollowCount = 0;
  let scrollContainer = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setStatus(msg) {
    const el = document.getElementById('tm-status');
    if (el) el.textContent = msg;
    console.log(`[Unfollow All] ${msg}`);
  }

  function createUI() {
    if (document.getElementById('tm-unfollow-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tm-unfollow-panel';
    panel.style.position = 'fixed';
    panel.style.bottom = '20px';
    panel.style.right = '20px';
    panel.style.zIndex = '99999';
    panel.style.padding = '12px 16px';
    panel.style.backgroundColor = '#1d2226';
    panel.style.color = '#fff';
    panel.style.borderRadius = '8px';
    panel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    panel.style.fontFamily = 'sans-serif';
    panel.style.fontSize = '14px';
    panel.style.maxWidth = '260px';

    panel.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px;">LinkedIn Unfollow All</div>
      <div style="margin-bottom: 8px;">Unfollowed: <span id="tm-unfollow-count" style="color: #70b5f9; font-weight: bold;">0</span></div>
      <div id="tm-status" style="margin-bottom: 8px; color: #9ddc7f; font-size: 12px; font-family: monospace; min-height: 32px;">Idle</div>
      <button id="tm-start-btn" style="padding: 6px 12px; background-color: #0a66c2; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Start</button>
    `;

    document.body.appendChild(panel);

    document.getElementById('tm-start-btn').addEventListener('click', () => {
      isRunning = !isRunning;
      const btn = document.getElementById('tm-start-btn');
      if (isRunning) {
        btn.textContent = 'Pause';
        btn.style.backgroundColor = '#cc1010';
        runCleanerLoop();
      } else {
        btn.textContent = 'Start';
        btn.style.backgroundColor = '#0a66c2';
        setStatus('Paused');
      }
    });
  }

  function isScrollable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const style = getComputedStyle(el);
    return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10;
  }

  // The main feed usually scrolls the window, but LinkedIn sometimes renders it
  // inside a scrollable panel (narrow viewports, certain layouts) where
  // window.scrollTo is a no-op. Detect the real scrollable ancestor of a post.
  function findScrollContainer(sampleEl) {
    if (scrollContainer && document.body.contains(scrollContainer) && isScrollable(scrollContainer)) {
      return scrollContainer;
    }
    let node = sampleEl ? sampleEl.parentElement : null;
    while (node) {
      if (isScrollable(node)) {
        scrollContainer = node;
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function scrollForMore(sampleEl) {
    const container = findScrollContainer(sampleEl);
    if (container) {
      container.scrollBy({ top: 1200, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: 1200, behavior: 'smooth' });
    }
  }

  async function processPostContainer(container, label) {
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(600);

    // Open the post's control menu to check whether it offers "Unfollow X" -
    // only posts from people you actually follow have that option.
    const controlBtn = container.querySelector('button[aria-label*="Open control menu"]');
    if (!controlBtn) {
      setStatus(`${label}: no control menu found, skipping`);
      return false;
    }

    setStatus(`${label}: opening control menu`);
    controlBtn.click();
    await sleep(1000);

    const allElements = Array.from(document.querySelectorAll('*'));
    const unfollowItem = allElements.find((el) => {
      const text = el.textContent.trim().toLowerCase();
      return text.startsWith('unfollow ') && text.length < 50 && (el.tagName === 'P' || el.children.length === 0);
    });

    if (unfollowItem) {
      // The menu text itself often isn't the clickable target, so walk up to
      // the nearest interactive ancestor (this is what the old double-click on
      // text + parent was trying and failing to do reliably).
      const clickable =
        unfollowItem.closest('div[role="button"], li[role="button"], button, a[role="button"]') || unfollowItem;

      setStatus(`${label}: clicking "${unfollowItem.textContent.trim()}"`);
      clickable.click();

      unfollowCount++;
      const countEl = document.getElementById('tm-unfollow-count');
      if (countEl) countEl.textContent = unfollowCount;
      await sleep(2500);
      return true;
    } else {
      setStatus(`${label}: menu opened but no "Unfollow" item found, closing`);
      document.body.click();
      await sleep(500);
      return false;
    }
  }

  async function runCleanerLoop() {
    while (isRunning) {
      const postContainers = Array.from(document.querySelectorAll('div[componentkey]')).filter((el) =>
        el.querySelector('button[aria-label*="Open control menu"]')
      );

      const unprocessed = postContainers.filter((el) => el.dataset.tmProcessed !== 'true');
      setStatus(`Scanning: ${postContainers.length} posts on screen, ${unprocessed.length} unprocessed`);

      let processedAny = false;
      let sampleEl = postContainers[0] || null;

      for (let i = 0; i < unprocessed.length; i++) {
        const container = unprocessed[i];
        if (!isRunning) break;

        container.dataset.tmProcessed = 'true';
        sampleEl = container;
        const success = await processPostContainer(container, `Post ${i + 1}/${unprocessed.length}`);
        if (success) processedAny = true;
      }

      if (!processedAny && isRunning) {
        setStatus('No new posts to act on, scrolling for more...');
        scrollForMore(sampleEl);
        await sleep(3500);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(createUI, 2000));
  } else {
    setTimeout(createUI, 2000);
  }
})();