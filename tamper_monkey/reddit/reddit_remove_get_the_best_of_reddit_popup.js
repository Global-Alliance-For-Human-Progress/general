// ==UserScript==
// @name         Reddit Remove "Get the best of Reddit" Popup
// @namespace    reddit-remove-best-of-popup
// @version      2026.11.11
// @description  Removes the undismissable "Get the best of Reddit" overlay on desktop web and restores page scrolling. Workaround until Reddit fixes it.
// @match        https://www.reddit.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// Bug report: https://www.reddit.com/r/bugs/comments/1xtdoro/desktop_web_undismissable_get_the_best_of_reddit/

(function () {
  'use strict';

  const TEXT_RE = /get the best of reddit/i;
  const DIALOG_SELECTOR = 'dialog, [role="dialog"], [aria-modal="true"], faceplate-dialog, [part="overlay"], .dialog-overlay';

  // Collect every element in the document, including those inside open shadow roots.
  function* walk(root) {
    for (const el of root.querySelectorAll('*')) {
      yield el;
      if (el.shadowRoot) yield* walk(el.shadowRoot);
    }
  }

  // Find the outermost custom element hosting a shadow root that contains the overlay.
  function removeShadowOverlays() {
    let removed = false;
    for (const el of walk(document)) {
      const sr = el.shadowRoot;
      if (!sr || !sr.querySelector('.dialog-overlay, [part="overlay"]')) continue;
      const text = (el.textContent || '') + ' ' + (sr.textContent || '');
      if (!TEXT_RE.test(text)) continue;
      el.remove();
      removed = true;
    }
    return removed;
  }

  // Fallback: banner text lives in the light DOM.
  function removeLightDomDialogs() {
    let removed = false;
    const candidates = document.querySelectorAll(DIALOG_SELECTOR);
    for (const el of candidates) {
      if (!el.isConnected) continue;
      if (TEXT_RE.test(el.textContent || '')) {
        el.remove();
        removed = true;
      }
    }
    return removed;
  }

  function unlockScroll() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      el.style.removeProperty('overflow');
      el.style.removeProperty('position');
      el.style.removeProperty('pointer-events');
      el.removeAttribute('inert');
      el.removeAttribute('aria-hidden');
    }
  }

  let scheduled = false;
  function run() {
    scheduled = false;
    if (removeShadowOverlays() | removeLightDomDialogs()) unlockScroll();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(run, 100);
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  run();
})();
