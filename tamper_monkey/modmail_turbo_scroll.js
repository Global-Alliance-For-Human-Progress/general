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
  const MAX_FAILURES = 2;

  const overlay = document.createElement('div');
  overlay.style = `position:fixed;top:10px;right:10px;z-index:9999;background:#222;color:#0f0;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #444;`;
  document.body.appendChild(overlay);

  const updateStatus = (msg) => { overlay.innerText = msg; console.log(msg); };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Robust container finder for the actual scrollable thread list window
  const getContainer = () => {
    return document.getElementById('modmail-conversations') ||
           document.querySelector('.modmail-conversations') ||
           document.querySelector('faceplate-batch') ||
           document.querySelector('[role="main"]') ||
           window;
  };

  async function turboScrollStep() {
    if (stopRequested) return false;

    const container = getContainer();
    const isWindow = container === window;

    // Read starting height dynamically based on target type
    const startHeight = isWindow ? document.documentElement.scrollHeight : container.scrollHeight;

    // FORCE scroll execution to the absolute floor
    if (isWindow) {
      window.scrollTo(0, document.documentElement.scrollHeight);
    } else {
      container.scrollTop = container.scrollHeight;
    }

    await sleep(400);

    let waited = 0;
    const timeout = 3000;
    const pollRate = 100;

    while (waited < timeout) {
      if (stopRequested) return false;

      const currentHeight = isWindow ? document.documentElement.scrollHeight : container.scrollHeight;

      if (currentHeight > startHeight + 20) {
        consecutiveFailures = 0;
        updateStatus(`⚡ Loaded (+${currentHeight - startHeight}px)`);
        return true;
      }

      await sleep(pollRate);
      waited += pollRate;
    }

    consecutiveFailures++;
    updateStatus(`⚠️ No load (${consecutiveFailures}/${MAX_FAILURES})`);

    if (consecutiveFailures < MAX_FAILURES) {
        if (isWindow) {
          window.scrollTo(0, document.documentElement.scrollHeight);
        } else {
          container.scrollTop = container.scrollHeight;
        }
        await sleep(1000);
        const retryHeight = isWindow ? document.documentElement.scrollHeight : container.scrollHeight;
        if (retryHeight > startHeight + 20) {
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

    const stopHandler = (e) => {
      // Isolates the specific header dropdown block from your snippet
      const targetZone = document.getElementById('conversation-sort-selector')?.closest('.flex.justify-between.items-center');

      if (targetZone && targetZone.contains(e.target)) {
        stopRequested = true;
        updateStatus('🛑 STOPPED BY USER CLICK');
        window.removeEventListener('click', stopHandler, true);
        setTimeout(() => overlay.remove(), 1000);
      }
    };

    window.addEventListener('click', stopHandler, true);

    while (!stopRequested) {
      const loaded = await turboScrollStep();

      if (!loaded) {
        if (consecutiveFailures >= MAX_FAILURES) {
          updateStatus('🏁 DONE: End of history');
          window.removeEventListener('click', stopHandler, true);
          break;
        }
      }

      if (loaded) await sleep(200);
    }
  }

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