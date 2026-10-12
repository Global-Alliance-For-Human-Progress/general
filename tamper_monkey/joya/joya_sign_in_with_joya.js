// ==UserScript==
// @name         Joya Portal Auto Sign in with Joya
// @namespace    https://portal-test.joya.ch/
// @version      2026.10.12
// @description  Auto-clicks the "Sign in with Joya" button on the Joya portal login page
// @match        https://portal-test.joya.ch/*/login*
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

  if (clickIfPresent()) return;

  const observer = new MutationObserver(() => {
    if (clickIfPresent()) {
      observer.disconnect();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
