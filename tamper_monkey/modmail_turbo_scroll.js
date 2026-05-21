// ==UserScript==
// @name         Modmail Turbo Scroll (Speed Run)
// @namespace    reddit-modmail-turbo
// @match        https://www.reddit.com/mail/all
// @match        https://old.reddit.com/mail/all
// @grant        none
// @description  Goes to the bottom of modmail automatically
// ==/UserScript==

(function () {
  'use strict';

  let stopRequested = false;
  let consecutiveFailures = 0;
  const MAX_FAILURES = 2; // Fail fast: 2 strikes and you're out

  // Minimal UI for status
  const overlay = document.createElement('div');
  overlay.style = `position:fixed;top:10px;right:10px;z-index:9999;background:#222;color:#0f0;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #444;`;
  document.body.appendChild(overlay);

  const updateStatus = (msg) => { overlay.innerText = msg; console.log(msg); };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const getContainer = () => {
    return document.getElementById('modmail-conversations') ||
           document.querySelector('.modmail-conversations') ||
           document.documentElement;
  };

  async function turboScrollStep() {
    if (stopRequested) return false;

    const container = getContainer();
    const startHeight = container.scrollHeight;

    // 1. SNAP to bottom immediately
    container.scrollTop = container.scrollHeight;

    // 2. Short pause to let the browser trigger the network request
    // 400ms is usually enough for Reddit to register the scroll event and fire the API call
    await sleep(400);

    // 3. Wait for height to change (Dynamic Wait)
    // Instead of waiting a fixed time, we poll until height changes OR timeout hits
    let waited = 0;
    const timeout = 3000; // Max 3 seconds wait per page
    const pollRate = 100; // Check every 100ms

    while (waited < timeout) {
      if (stopRequested) return false;

      // If user scrolls up, abort
      if (container.scrollTop < container.scrollHeight - 200) {
        updateStatus('🛑 User intervened');
        return false;
      }

      const currentHeight = container.scrollHeight;

      // Did content load? (Allow 20px buffer for rendering quirks)
      if (currentHeight > startHeight + 20) {
        consecutiveFailures = 0;
        updateStatus(`⚡ Loaded (+${currentHeight - startHeight}px)`);
        return true;
      }

      await sleep(pollRate);
      waited += pollRate;
    }

    // 4. Timeout reached with no height change
    consecutiveFailures++;
    updateStatus(`⚠️ No load (${consecutiveFailures}/${MAX_FAILURES})`);

    // Quick retry: Scroll again immediately in case it missed the trigger
    if (consecutiveFailures < MAX_FAILURES) {
        container.scrollTop = container.scrollHeight;
        await sleep(1000);
        if (container.scrollHeight > startHeight + 20) {
            consecutiveFailures = 0;
            return true;
        }
    }

    return false;
  }

  async function runTurboScroll() {
    stopRequested = false;
    consecutiveFailures = 0;
    updateStatus('🚀 TURBO MODE STARTED');

    const stopHandler = () => {
      stopRequested = true;
      updateStatus('🛑 STOPPED');
      setTimeout(() => overlay.remove(), 1000);
    };

    // Listen for ANY interaction to stop
    ['mousemove', 'wheel', 'keydown', 'touchstart'].forEach(evt =>
      window.addEventListener(evt, stopHandler, { once: true, passive: true })
    );

    while (!stopRequested) {
      const loaded = await turboScrollStep();

      if (!loaded) {
        if (consecutiveFailures >= MAX_FAILURES) {
          updateStatus('🏁 DONE: End of history');
          // Optional: Remove alert to be even faster, or keep it for confirmation
          // alert('✅ Reached the bottom!');
          break;
        }
      }

      // Minimal pause between successful loads to prevent rate limiting
      // If we just failed, we don't pause (retry logic handles it)
      if (loaded) await sleep(200);
    }
  }

  // Init
  const init = () => {
    const container = getContainer();
    if (!container) {
      setTimeout(init, 200);
      return;
    }
    setTimeout(runTurboScroll, 500);
  };

  init();
})();