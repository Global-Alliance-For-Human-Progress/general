// ==UserScript==
// @name         ChatGPT Enter to Send, Shift+Enter for Newline
// @namespace    https://chatgpt.com/
// @version      3.0
// @description  Enter sends, Shift+Enter inserts newline
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  window.addEventListener(
    'keydown',
    function (e) {
      // Only intercept if inside composer
      const isComposer =
        document.activeElement?.classList.contains('ProseMirror') ||
        document.activeElement?.closest('.group/composer');

      if (!isComposer) return;

      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // Shift+Enter → let it through (newline)
          return;
        } else {
          // Plain Enter → send
          e.preventDefault();
          e.stopPropagation();

          const sendBtn = document.querySelector('#composer-submit-button');
          if (sendBtn) {
            sendBtn.click();
            console.log('Enter pressed → clicked send button');
          } else {
            console.warn('Send button not found');
          }
        }
      }
    },
    true // capture so it runs before site handlers
  );
})();
