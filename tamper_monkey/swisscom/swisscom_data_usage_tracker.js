// ==UserScript==
// @name         Swisscom Data Usage Tracker - Dynamic Colors
// @namespace    http://tampermonkey.net/
// @version      2026.11.08
// @description  Colors the Swisscom cockpit data bar by burn rate and adds an ideal billing-period pace bar plus exact percentage
// @author       You
// @match        https://cockpit.swisscom.ch/cockpit/device/Postpaid/ServiceDetails*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const PACE_ID = 'swisscom-pace-tracker';

    function parseCard(card) {
        const text = card.textContent.replace(/\s+/g, ' ');

        // "55.4 GB left of 60 GB"
        const left = text.match(/([\d.,']+)\s*GB left of\s*([\d.,']+)\s*GB/i);
        if (!left) return null;
        const remainingGb = parseFloat(left[1].replace(/[',]/g, ''));
        const totalGb = parseFloat(left[2].replace(/[',]/g, ''));
        if (!totalGb) return null;

        // "Will be renewed on 01.12.26 (CET)"
        const renew = text.match(/renewed on\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i);
        if (!renew) return null;
        const year = renew[3].length === 2 ? 2000 + parseInt(renew[3], 10) : parseInt(renew[3], 10);
        const renewal = new Date(year, parseInt(renew[2], 10) - 1, parseInt(renew[1], 10));
        const start = new Date(renewal);
        start.setMonth(start.getMonth() - 1);

        return { remainingGb, totalGb, usedGb: totalGb - remainingGb, start, renewal };
    }

    function colorFor(actual, ideal) {
        if (actual > ideal + 5) return '#dc2626'; // Red
        if (actual > ideal) return '#ea580c';     // Orange
        return '#16a34a';                         // Green
    }

    function injectSwisscomBars() {
        const cards = document.querySelectorAll('.cp-card');

        cards.forEach((card) => {
            const heading = card.querySelector('h4');
            if (!heading || !/allowance/i.test(heading.textContent)) return;

            const bar = card.querySelector('.bar-chart-horizontal');
            const indicator = card.querySelector('.bar-chart__progress .indicator');
            if (!bar || !indicator) return;

            const data = parseCard(card);
            if (!data) return;

            const now = new Date();
            const idealPct = Math.min(Math.max((now - data.start) / (data.renewal - data.start) * 100, 0), 100);
            const actualPct = Math.min(Math.max(data.usedGb / data.totalGb * 100, 0), 100);
            const idealGb = data.totalGb * idealPct / 100;
            const color = colorFor(actualPct, idealPct);

            // Recolor Swisscom's own bar (it shows remaining, we color by burn rate)
            indicator.style.backgroundColor = color;

            if (!card.dataset.scId) card.dataset.scId = String(Math.random()).slice(2, 8);
            const id = `${PACE_ID}-${card.dataset.scId}`;
            let container = document.getElementById(id);

            if (!container) {
                container = document.createElement('div');
                container.id = id;
                container.style.cssText = 'margin: 12px 0 8px; width: 100%; font-family: inherit;';
                bar.parentNode.insertBefore(container, bar.nextSibling);
            }

            container.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; margin-bottom: 4px;">
                    <span style="font-weight: 600;">Used: ${data.usedGb.toFixed(1)} GB</span>
                    <span style="font-weight: 700; font-size: 16px; color: ${color};">${actualPct.toFixed(1)}%</span>
                </div>
                <div style="position: relative; overflow: hidden; border-radius: 3px; background-color: ${color}33; height: 6px; width: 100%;">
                    <div style="height: 100%; background-color: ${color}; width: ${actualPct}%; transition: width 0.5s ease-in-out;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; margin: 10px 0 4px; opacity: 0.8;">
                    <span>Ideal pace: ${idealGb.toFixed(1)} GB / ${data.totalGb} GB</span>
                    <span style="font-weight: 700;">${idealPct.toFixed(1)}%</span>
                </div>
                <div style="position: relative; overflow: hidden; border-radius: 3px; background-color: rgba(128, 128, 128, 0.25); height: 4px; width: 100%;">
                    <div style="height: 100%; background-color: #1781e3; width: ${idealPct}%; transition: width 0.5s ease-in-out;"></div>
                </div>
            `;
        });
    }

    setInterval(injectSwisscomBars, 1000);
})();
