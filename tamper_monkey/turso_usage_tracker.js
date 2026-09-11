// ==UserScript==
// @name         Turso Database Usage Percentage
// @namespace    http://tampermonkey.net/
// @version      2026.09.11
// @description  Shows exact color-coded usage percentages for Turso database reads, writes, and syncs
// @author       You
// @match        https://app.turso.tech/*/analytics*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // shadcn's Progress component renders the fill as translateX(-(100 - value)%),
    // so the real percentage can be read straight off that transform instead of
    // reparsing the abbreviated "1.21M / 500M" text.
    function getPercentageFromBar(indicator) {
        const match = indicator.style.transform.match(/translateX\(-([\d.]+)%\)/);
        if (!match) return null;
        return 100 - parseFloat(match[1]);
    }

    function formatPercentage(pct) {
        if (pct < 1) return pct.toFixed(3);
        if (pct < 10) return pct.toFixed(2);
        return pct.toFixed(1);
    }

    function getCardLabel(card) {
        const labelDiv = card.querySelector('.text-sm.text-muted-foreground');
        if (!labelDiv) return null;
        const span = labelDiv.querySelector('span');
        return (span ? span.textContent : labelDiv.textContent).trim();
    }

    function colorFor(pct) {
        if (pct >= 90) return "#dc2626"; // Red
        if (pct >= 75) return "#ea580c"; // Orange
        return "#16a34a"; // Green
    }

    function injectTursoUsage() {
        const indicators = document.querySelectorAll('[data-slot="progress-indicator"]');

        indicators.forEach((indicator) => {
            const track = indicator.closest('[role="progressbar"]');
            const card = track?.closest('.rounded-xl');
            if (!track || !card) return;

            const label = getCardLabel(card);
            if (!label) return;

            const pct = getPercentageFromBar(indicator);
            if (pct === null) return;

            const color = colorFor(pct);

            // Recolor the actual bar so it visually matches the badge
            indicator.style.backgroundColor = color;
            track.style.backgroundColor = `${color}33`;

            const badgeId = `turso-usage-pct-${label.replace(/\s+/g, '-').toLowerCase()}`;
            const valueDiv = card.querySelector('.text-2xl');
            if (!valueDiv) return;

            let badge = valueDiv.querySelector(`#${badgeId}`);
            if (!badge) {
                badge = document.createElement('span');
                badge.id = badgeId;
                badge.style.cssText = "font-size: 14px; font-weight: 700; margin-left: 8px;";
                valueDiv.appendChild(badge);
            }

            badge.style.color = color;
            badge.textContent = `(${formatPercentage(pct)}%)`;
        });
    }

    setInterval(injectTursoUsage, 1000);
})();
