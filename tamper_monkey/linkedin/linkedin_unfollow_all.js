// ==UserScript==
// @name         LinkedIn Unfollow All
// @namespace    linkedin-unfollow-all
// @version      2026.09.14.7
// @description  Finds people you follow in the feed and unfollows them (and hides ads), one post's control menu at a time
// @author       Liam
// @match        https://www.linkedin.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=linkedin.com
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let isRunning = false;
  let unfollowCount = 0;
  let adsHiddenCount = 0;
  let scrollContainer = null;
  let speedFactor = 0.5; // 0.5 = fast, 1 = normal, 2 = slow
  let panelRoot = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = (ms) => sleep(ms * speedFactor);
  const previewWait = () => wait(700);

  function setStatus(msg) {
    const el = panelRoot?.getElementById('tm-status');
    if (el) el.textContent = msg;
    console.log(`[Unfollow All] ${msg}`);
  }

  // Draws a highlight box + label over an element and pauses briefly, so the
  // action about to happen is visible before it happens (instead of clicks
  // firing invisibly mid-scroll).
  function highlightElement(el, text) {
    if (!el) return;
    const rect = el.getBoundingClientRect();

    let box = document.getElementById('tm-highlight-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'tm-highlight-box';
      box.style.position = 'fixed';
      box.style.border = '3px solid #ff5c5c';
      box.style.borderRadius = '4px';
      box.style.zIndex = '99998';
      box.style.pointerEvents = 'none';
      box.style.boxShadow = '0 0 0 4px rgba(255,92,92,0.25)';
      document.body.appendChild(box);
    }
    box.style.top = `${rect.top - 4}px`;
    box.style.left = `${rect.left - 4}px`;
    box.style.width = `${rect.width + 8}px`;
    box.style.height = `${rect.height + 8}px`;
    box.style.display = 'block';

    let label = document.getElementById('tm-highlight-label');
    if (!label) {
      label = document.createElement('div');
      label.id = 'tm-highlight-label';
      label.style.position = 'fixed';
      label.style.zIndex = '99999';
      label.style.backgroundColor = '#ff5c5c';
      label.style.color = '#fff';
      label.style.padding = '2px 8px';
      label.style.borderRadius = '4px';
      label.style.fontFamily = 'sans-serif';
      label.style.fontSize = '12px';
      label.style.fontWeight = 'bold';
      label.style.pointerEvents = 'none';
      label.style.maxWidth = '320px';
      document.body.appendChild(label);
    }
    label.textContent = text;
    const labelTop = rect.top - 26 > 0 ? rect.top - 26 : rect.bottom + 6;
    label.style.top = `${labelTop}px`;
    label.style.left = `${rect.left}px`;
    label.style.display = 'block';
  }

  function clearHighlight() {
    const box = document.getElementById('tm-highlight-box');
    const label = document.getElementById('tm-highlight-label');
    if (box) box.style.display = 'none';
    if (label) label.style.display = 'none';
  }

  function hoverElement(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
  }

  // LinkedIn's global stylesheet resets native <select>/<button> appearance
  // (they replace form controls with their own custom components), which was
  // silently stripping our panel's Start button and Speed dropdown of any
  // visible box. A <style> block inside the shadow root wasn't enough to
  // reliably override that, so every element below gets its layout/colors
  // set directly as !important inline styles instead - nothing left for an
  // external (or seemingly-ignored internal) stylesheet to clobber.
  function styleEl(el, styles) {
    for (const [prop, value] of Object.entries(styles)) {
      el.style.setProperty(prop, value, 'important');
    }
  }

  function createUI() {
    const existing = document.querySelectorAll('#tm-unfollow-host');
    if (existing.length > 0) {
      for (let i = 1; i < existing.length; i++) existing[i].remove();
      return;
    }

    const host = document.createElement('div');
    host.id = 'tm-unfollow-host';
    styleEl(host, { all: 'initial', position: 'fixed', top: '20px', right: '20px', 'z-index': '2147483647' });
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    panelRoot = shadow;

    const panel = document.createElement('div');
    styleEl(panel, {
      display: 'block',
      padding: '12px 16px',
      'background-color': '#1d2226',
      color: '#fff',
      'border-radius': '8px',
      'box-shadow': '0 4px 12px rgba(0,0,0,0.3)',
      'font-family': 'sans-serif',
      'font-size': '14px',
      width: '260px',
    });

    const title = document.createElement('div');
    title.textContent = 'LinkedIn Unfollow All';
    styleEl(title, { display: 'block', 'font-weight': 'bold', 'margin-bottom': '8px' });

    const countRow = document.createElement('div');
    styleEl(countRow, { display: 'block', 'margin-bottom': '8px' });
    countRow.appendChild(document.createTextNode('Unfollowed: '));
    const countSpan = document.createElement('span');
    countSpan.id = 'tm-unfollow-count';
    countSpan.textContent = '0';
    styleEl(countSpan, { color: '#70b5f9', 'font-weight': 'bold' });
    countRow.appendChild(countSpan);

    const adsRow = document.createElement('div');
    styleEl(adsRow, { display: 'block', 'margin-bottom': '8px' });
    adsRow.appendChild(document.createTextNode('Ads hidden: '));
    const adsCountSpan = document.createElement('span');
    adsCountSpan.id = 'tm-ads-count';
    adsCountSpan.textContent = '0';
    styleEl(adsCountSpan, { color: '#70b5f9', 'font-weight': 'bold' });
    adsRow.appendChild(adsCountSpan);

    const speedRow = document.createElement('div');
    styleEl(speedRow, { display: 'flex', 'align-items': 'center', gap: '6px', 'margin-bottom': '8px' });
    const speedLabel = document.createElement('label');
    speedLabel.textContent = 'Speed:';
    styleEl(speedLabel, { 'font-size': '12px' });
    const speedSelect = document.createElement('select');
    speedSelect.id = 'tm-speed-select';
    styleEl(speedSelect, {
      flex: '1',
      padding: '2px',
      'border-radius': '4px',
      'background-color': '#fff',
      color: '#000',
      border: '1px solid #555',
      display: 'inline-block',
      appearance: 'auto',
    });
    for (const [value, text, isSelected] of [
      ['2', 'Slow', false],
      ['1', 'Normal', false],
      ['0.5', 'Fast', true],
    ]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      opt.selected = isSelected;
      speedSelect.appendChild(opt);
    }
    speedRow.appendChild(speedLabel);
    speedRow.appendChild(speedSelect);

    const status = document.createElement('div');
    status.id = 'tm-status';
    status.textContent = 'Idle';
    styleEl(status, {
      display: 'block',
      color: '#9ddc7f',
      'font-size': '12px',
      'font-family': 'monospace',
      'min-height': '32px',
      'margin-bottom': '8px',
    });

    const startBtn = document.createElement('button');
    startBtn.id = 'tm-start-btn';
    startBtn.textContent = 'Start';
    styleEl(startBtn, {
      display: 'inline-block',
      padding: '6px 12px',
      'background-color': '#0a66c2',
      color: '#fff',
      border: 'none',
      'border-radius': '4px',
      cursor: 'pointer',
      'font-weight': 'bold',
    });

    panel.appendChild(title);
    panel.appendChild(countRow);
    panel.appendChild(adsRow);
    panel.appendChild(speedRow);
    panel.appendChild(status);
    panel.appendChild(startBtn);
    shadow.appendChild(panel);

    speedSelect.addEventListener('change', (e) => {
      speedFactor = Number.parseFloat(e.target.value);
    });

    startBtn.addEventListener('click', () => {
      isRunning = !isRunning;
      if (isRunning) {
        startBtn.textContent = 'Pause';
        styleEl(startBtn, { 'background-color': '#cc1010' });
        runCleanerLoop();
      } else {
        startBtn.textContent = 'Start';
        styleEl(startBtn, { 'background-color': '#0a66c2' });
        setStatus('Paused');
        clearHighlight();
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

  function closestClickable(el) {
    return (
      el.closest('div[role="button"], li[role="button"], button, a[role="button"], div[role="menuitem"], a[role="menuitem"], [aria-expanded]') ||
      el
    );
  }

  // A post from someone you follow directly offers "Unfollow <name>".
  function findUnfollowNameItem() {
    const candidates = Array.from(document.querySelectorAll('*'));
    return candidates.find((el) => {
      const text = el.textContent.trim().toLowerCase();
      return text.startsWith('unfollow ') && text.length < 60 && (el.tagName === 'P' || el.children.length === 0);
    });
  }

  // A post with multiple people to unfollow (e.g. a repost) instead shows a
  // plain "Unfollow" item with a submenu caret - it has to be expanded first
  // to reveal the per-person "Unfollow <name>" items.
  function findUnfollowSubmenuTrigger() {
    const candidates = Array.from(document.querySelectorAll('*'));
    return candidates.find((el) => {
      const text = el.textContent.trim().toLowerCase();
      return text === 'unfollow' && (el.tagName === 'P' || el.children.length === 0);
    });
  }

  // Sponsored posts show "Hide this ad" instead of an Unfollow option.
  function findHideAdItem() {
    const candidates = Array.from(document.querySelectorAll('*'));
    return candidates.find((el) => {
      const text = el.textContent.trim().toLowerCase();
      return (text === 'hide this ad' || text === 'hide ad') && (el.tagName === 'P' || el.children.length === 0);
    });
  }

  // LinkedIn can re-render a post's whole DOM subtree (not just swap the
  // button) after an unfollow click, which leaves any previously-captured
  // element reference (even an ancestor "card" container) detached and stale.
  // Re-locating by on-screen position instead of by node reference survives
  // that, so a second unfollow in the same post (e.g. a repost with two
  // people to unfollow) can still be found.
  function findNearestControlButton(anchorY) {
    const buttons = Array.from(document.querySelectorAll('button[aria-label*="Open control menu"]'));
    if (buttons.length === 0) return null;
    return buttons.reduce((closest, btn) => {
      const btnDist = Math.abs(btn.getBoundingClientRect().top - anchorY);
      const closestDist = Math.abs(closest.getBoundingClientRect().top - anchorY);
      return btnDist < closestDist ? btn : closest;
    });
  }

  async function clickMenuItem(item, label) {
    const clickable = closestClickable(item);
    const text = item.textContent.trim();
    setStatus(`${label}: clicking "${text}"`);
    highlightElement(clickable, `Clicking: ${text}`);
    await previewWait();
    clickable.click();
    await wait(2500);
    clearHighlight();
  }

  function bumpCounter(spanId, increment) {
    const value = increment();
    const el = panelRoot?.getElementById(spanId);
    if (el) el.textContent = value;
  }

  async function processPostContainer(initialBtn, label) {
    initialBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await wait(600);

    let unfollowedAny = false;
    let anchorY = initialBtn.getBoundingClientRect().top;

    // Loop because a single post can require more than one unfollow action
    // (e.g. a repost with both the original poster and the resharer to unfollow).
    for (let guard = 0; guard < 5; guard++) {
      const controlBtn = findNearestControlButton(anchorY);
      if (!controlBtn) {
        if (guard === 0) setStatus(`${label}: control menu no longer in page, skipping`);
        break;
      }
      anchorY = controlBtn.getBoundingClientRect().top;

      setStatus(`${label}: opening control menu`);
      highlightElement(controlBtn, `${label}: opening control menu`);
      await previewWait();
      controlBtn.click();
      await wait(1000);

      let nameItem = findUnfollowNameItem();

      if (!nameItem) {
        const trigger = findUnfollowSubmenuTrigger();
        if (trigger) {
          const triggerClickable = closestClickable(trigger);
          setStatus(`${label}: expanding "Unfollow" submenu`);
          highlightElement(triggerClickable, `${label}: expanding "Unfollow" submenu`);
          await previewWait();
          hoverElement(triggerClickable);
          triggerClickable.click();
          await wait(1000);
          nameItem = findUnfollowNameItem();
        }
      }

      if (nameItem) {
        await clickMenuItem(nameItem, label);
        bumpCounter('tm-unfollow-count', () => ++unfollowCount);
        unfollowedAny = true;
        continue;
      }

      const hideAdItem = findHideAdItem();
      if (hideAdItem) {
        await clickMenuItem(hideAdItem, label);
        bumpCounter('tm-ads-count', () => ++adsHiddenCount);
        unfollowedAny = true;
        continue;
      }

      setStatus(`${label}: menu opened but no "Unfollow" or "Hide ad" item found, closing`);
      document.body.click();
      await wait(500);
      clearHighlight();
      break;
    }

    return unfollowedAny;
  }

  async function runCleanerLoop() {
    while (isRunning) {
      // Query by the control button itself, not an ancestor div - LinkedIn tags
      // every nesting level of a post card with [componentkey], so scanning for
      // divs produced several duplicate entries per post (found via different
      // ancestors) and made processing jump around instead of going post by
      // post in page order. Buttons are returned by querySelectorAll in
      // document order, so this naturally walks top to bottom.
      const controlButtons = Array.from(document.querySelectorAll('button[aria-label*="Open control menu"]'));

      const unprocessed = controlButtons.filter((btn) => btn.dataset.tmProcessed !== 'true');
      setStatus(`Scanning: ${controlButtons.length} posts on screen, ${unprocessed.length} unprocessed`);

      let processedAny = false;
      let sampleEl = controlButtons[0] || null;

      for (let i = 0; i < unprocessed.length; i++) {
        const btn = unprocessed[i];
        if (!isRunning) break;

        btn.dataset.tmProcessed = 'true';
        sampleEl = btn;
        const success = await processPostContainer(btn, `Post ${i + 1}/${unprocessed.length}`);
        if (success) processedAny = true;
      }

      if (!processedAny && isRunning) {
        setStatus('No new posts to act on, scrolling for more...');
        scrollForMore(sampleEl);
        await wait(3500);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(createUI, 2000));
  } else {
    setTimeout(createUI, 2000);
  }
})();
