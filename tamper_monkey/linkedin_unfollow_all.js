// ==UserScript==
// @name         LinkedIn Unfollow All
// @namespace    linkedin-unfollow-all
// @version      2026.09.10
// @description  Auto-scroll and unfollow everyone on a LinkedIn following list, with a start/stop button
// @author       Liam
// @match        https://www.linkedin.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=linkedin.com
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let isRunning = false;
  let consecutiveEmptyScrolls = 0;
  const MAX_EMPTY_SCROLLS = 5;

  // Create UI
  const overlay = document.createElement('div');
  overlay.style = `position:fixed;top:10px;right:10px;z-index:9999;background:#222;padding:10px;border-radius:4px;border:1px solid #444;display:flex;flex-direction:column;gap:5px;`;

  const statusText = document.createElement('div');
  statusText.style = `color:#0f0;font-family:monospace;font-size:11px;`;
  statusText.innerText = 'Ready';

  const btn = document.createElement('button');
  btn.innerText = 'START UNFOLLOW';
  btn.style = `cursor:pointer;background:#444;color:#fff;border:none;padding:5px;font-size:12px;border-radius:2px;`;

  overlay.appendChild(statusText);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);

  const updateStatus = (msg) => { statusText.innerText = msg; console.log(msg); };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function unfollowStep() {
    if (!isRunning) return;

    const followBtns = [...document.querySelectorAll('span.artdeco-button__text')]
      .filter(el => el.innerText.trim() === 'Following');

    if (followBtns.length === 0) {
      window.scrollBy(0, 800);
      await sleep(1000);
      consecutiveEmptyScrolls++;
      updateStatus(`Scrolling for more (${consecutiveEmptyScrolls}/${MAX_EMPTY_SCROLLS})`);

      if (consecutiveEmptyScrolls >= MAX_EMPTY_SCROLLS) {
        updateStatus('🏁 DONE');
        stopLoop();
      }
      return;
    }

    consecutiveEmptyScrolls = 0;

    for (const span of followBtns) {
      if (!isRunning) return;

      const btnEl = span.closest('button');
      if (!btnEl) continue;

      btnEl.click(); // open unfollow dialog
      await sleep(500);

      const confirm = [...document.querySelectorAll('span.artdeco-button__text')]
        .find(el => el.innerText.trim() === 'Unfollow');

      if (confirm) {
        confirm.closest('button').click();
        updateStatus('Unfollowed 1');
      }

      await sleep(500);
    }

    await sleep(1000);
  }

  async function startLoop() {
    isRunning = true;
    consecutiveEmptyScrolls = 0;
    btn.innerText = 'STOP UNFOLLOW';
    btn.style.background = '#800';
    updateStatus('🚀 RUNNING');

    while (isRunning) {
      await unfollowStep();
    }
  }

  function stopLoop() {
    isRunning = false;
    btn.innerText = 'START UNFOLLOW';
    btn.style.background = '#444';
    updateStatus('🛑 STOPPED');
  }

  btn.onclick = () => {
    if (isRunning) stopLoop();
    else startLoop();
  };
})();
