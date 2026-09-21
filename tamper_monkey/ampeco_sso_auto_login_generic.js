// ==UserScript==
// @name         SSO Auto-Login
// @namespace    https://example-admin-instance.example.com/
// @version      2026.09.21
// @description  Auto-clicks the SSO login button on an admin login page
// @match        https://example-admin-instance.example.com/*
// @grant        none
// ==/UserScript==

// PUT HERE THE URL AND BUTTON LABEL YOU WANT: replace example-admin-instance.example.com
// above (both @namespace and @match) with your own admin hostname, and replace the
// SSO_BUTTON_LABEL value below with the exact (lowercased) text of your SSO button,
// before installing this script.

(function () {
  'use strict';

  const SSO_BUTTON_LABEL = 'sso login';

  function findSsoButton() {
    const buttons = document.querySelectorAll('form button[type="button"]');
    for (const button of buttons) {
      const label = button.textContent.trim().toLowerCase();
      if (label === SSO_BUTTON_LABEL) return button;
    }
    return null;
  }

  function clickIfPresent() {
    const button = findSsoButton();
    if (button) {
      button.click();
      console.log('SSO Auto-Login: clicked SSO login button');
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
