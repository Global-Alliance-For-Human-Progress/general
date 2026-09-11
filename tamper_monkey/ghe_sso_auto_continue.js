// ==UserScript==
// @name         GHE SSO Auto-Continue
// @namespace    https://example-ghe-instance.example.com/
// @version      2026.09.11
// @description  Auto-clicks the "Continue" button on a GitHub Enterprise single sign-on panel
// @match        https://example-ghe-instance.example.com/*
// @grant        none
// ==/UserScript==

// PUT HERE THE URL YOU WANT: replace example-ghe-instance.example.com above (both
// @namespace and @match) with your own GHE hostname before installing this script.

(function () {
  'use strict';

  function findContinueButton() {
    const panel = document.querySelector('.business-sso-panel');
    if (!panel) return null;

    const button = panel.querySelector('form button[type="submit"]');
    if (!button) return null;

    const label = button.textContent.trim().toLowerCase();
    return label.includes('continue') ? button : null;
  }

  function clickIfPresent() {
    const button = findContinueButton();
    if (button) {
      button.click();
      console.log('GHE SSO Auto-Continue: clicked Continue button');
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
