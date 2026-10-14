// ==UserScript==
// @name         Joya Portal Auto Sign in with Joya
// @namespace    https://portal-test.joya.ch/
// @version      2026.10.14.1
// @description  Auto-clicks the "Sign in with Joya" button on the Joya portal login page
// @match        https://portal-test.joya.ch/*/login*
// @match        https://portal.joya.ch/*/login*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function findJoyaButton() {
    const buttons = document.querySelectorAll('button[data-slot="button"]');
    for (const button of buttons) {
      const label = button.textContent.trim().toLowerCase();
      if (label === 'sign in with nova' || label === 'sign in with joya') {
        return button;
      }
    }
    return null;
  }

  function clickIfPresent() {
    const button = findJoyaButton();
    if (button && !button.disabled) {
      button.click();
      console.log('Joya Auto Sign in: clicked "Sign in with Joya" button');
      return true;
    }
    return false;
  }

  // The page is server-rendered, so the button can exist before its click handler
  // is attached (hydration). Wait for load, then retry the click a few times in case
  // the first one is ignored. Stops on its own once the page navigates away.
  const MAX_ATTEMPTS = 10;
  const RETRY_MS = 500;

  function start() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      clickIfPresent();
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(timer);
      }
    }, RETRY_MS);
  }

  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start, { once: true });
  }
})();
