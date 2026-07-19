// ==UserScript==
// @name         Modmail Turbo Scroll (Speed Run)
// @namespace    reddit-modmail-turbo
// @match        https://www.reddit.com/mail/all
// @match        https://old.reddit.com/mail/all
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let isRunning = false;
  let consecutiveFailures = 0;
  const MAX_FAILURES = 2;

  // Create UI
  const overlay = document.createElement('div');
  overlay.style = `position:fixed;top:10px;right:10px;z-index:9999;background:#222;padding:10px;border-radius:4px;border:1px solid #444;display:flex;flex-direction:column;gap:5px;`;

  const statusText = document.createElement('div');
  statusText.style = `color:#0f0;font-family:monospace;font-size:11px;`;
  statusText.innerText = 'Ready';

  const btn = document.createElement('button');
  btn.innerText = 'START TURBO';
  btn.style = `cursor:pointer;background:#444;color:#fff;border:none;padding:5px;font-size:12px;border-radius:2px;`;

  overlay.appendChild(statusText);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);

  const updateStatus = (msg) => { statusText.innerText = msg; console.log(msg); };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const getContainer = () => {
    return document.getElementById('modmail-conversations') ||
           document.querySelector('.modmail-conversations') ||
           document.querySelector('faceplate-batch') ||
           document.querySelector('[role="main"]') ||
           window;
  };

  async function turboScrollStep() {
    if (!isRunning) return false;

    const container = getContainer();
    const isWindow = container === window;
    const startHeight = isWindow ? document.documentElement.scrollHeight : container.scrollHeight;

    if (isWindow) {
      window.scrollTo(0, document.documentElement.scrollHeight);
    } else {
      container.scrollTop = container.scrollHeight;
    }

    await sleep(400);

    let waited = 0;
    while (waited < 3000) {
      if (!isRunning) return false;
      const currentHeight = isWindow ? document.documentElement.scrollHeight : container.scrollHeight;
      if (currentHeight > startHeight + 20) {
        consecutiveFailures = 0;
        updateStatus(`⚡ Loaded (+${currentHeight - startHeight}px)`);
        return true;
      }
      await sleep(100);
      waited += 100;
    }

    consecutiveFailures++;
    updateStatus(`⚠️ No load (${consecutiveFailures}/${MAX_FAILURES})`);
    return false;
  }

  async function startLoop() {
    isRunning = true;
    consecutiveFailures = 0;
    btn.innerText = 'STOP TURBO';
    btn.style.background = '#800';
    updateStatus('🚀 RUNNING');

    while (isRunning) {
      const loaded = await turboScrollStep();
      if (!loaded && consecutiveFailures >= MAX_FAILURES) {
        updateStatus('🏁 DONE');
        stopLoop();
        break;
      }
      if (isRunning) await sleep(200);
    }
  }

  function stopLoop() {
    isRunning = false;
    btn.innerText = 'START TURBO';
    btn.style.background = '#444';
    updateStatus('🛑 STOPPED');
  }

  btn.onclick = () => {
    if (isRunning) stopLoop();
    else startLoop();
  };
})();