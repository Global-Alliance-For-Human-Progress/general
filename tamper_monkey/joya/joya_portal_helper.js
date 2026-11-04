// ==UserScript==
// @name         Joya Portal Helper
// @namespace    https://portal-test.joya.ch/
// @version      2026.11.04.1
// @description  On every Joya portal page: switches the /de/ URL to /en/. On the login page: auto-clicks the "Sign in with Joya" button
// @match        https://portal-test.joya.ch/*
// @match        https://portal.joya.ch/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // Switch the German locale to English before anything else, on every portal page;
  // replace() keeps the German URL out of the back history, and the English page
  // reruns this script
  if (/^\/de(\/|$)/.test(location.pathname)) {
    location.replace(
      location.pathname.replace(/^\/de(?=\/|$)/, '/en') + location.search + location.hash
    );
    return;
  }

  // The auto-click only applies to the login page
  if (!/^\/[a-z]{2}\/login(\/|$)/.test(location.pathname)) {
    return;
  }

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
