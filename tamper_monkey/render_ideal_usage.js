// ==UserScript==
// @name         Render Billing Usage Tracker - Dynamic Colors
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Adds a dynamic target burn-rate progress bar matching Render's header/metrics layout
// @author       You
// @match        https://dashboard.render.com/w/*/billing
// @match        https://dashboard.render.com/billing
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    function getMonthProgress() {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        const totalMonthMs = endOfMonth - startOfMonth;
        const elapsedMs = now - startOfMonth;

        return (elapsedMs / totalMonthMs) * 100;
    }

    function injectRenderBars() {
        // Locate the "Free Instance Hours" section header
        const cardHeaders = Array.from(document.querySelectorAll('div[id^="_r_"]'));
        const targetHeader = cardHeaders.find(el => el.textContent.includes('Free Instance Hours'));

        if (!targetHeader) return;

        // Target the inner container with fixed height class 'h-20' and remove the constraint
        const flexContainer = targetHeader.closest('.flex.flex-col');
        if (flexContainer) {
            flexContainer.classList.remove('h-20');
            flexContainer.style.height = 'auto';
        }

        // Locate Render's progress bar element
        const progressBar = targetHeader.parentElement?.querySelector('[role="progressbar"]');
        if (!progressBar) return;

        const mainContainer = targetHeader.parentElement;
        if (!mainContainer) return;

        const spans = Array.from(mainContainer.querySelectorAll('span'));
        const hoursSpan = spans.find(span => span.textContent.includes('hours') && !span.textContent.includes('/'));
        if (!hoursSpan) return;

        const actualHours = parseFloat(hoursSpan.textContent);
        const maxHours = 750.0;
        const actualPercentage = (actualHours / maxHours) * 100;

        // Target the outer container of the hours display row
        const rowContainer = hoursSpan.parentElement;

        if (rowContainer) {
            rowContainer.style.display = "flex";
            rowContainer.style.justifyContent = "space-between";
            rowContainer.style.alignItems = "baseline";
            rowContainer.style.width = "100%";

            const actualPercentId = 'render-actual-percent-text';
            let actualPercentSpan = document.getElementById(actualPercentId);

            if (!actualPercentSpan) {
                actualPercentSpan = document.createElement('span');
                actualPercentSpan.id = actualPercentId;
                actualPercentSpan.style.cssText = "font-size: 18px; font-weight: 700; line-height: 1; color: inherit; margin-left: auto;";
                rowContainer.appendChild(actualPercentSpan);
            }

            actualPercentSpan.textContent = `${actualPercentage.toFixed(1)}%`;
        }

        // Calculate expected/ideal limit based on current day of month
        const idealPercentage = getMonthProgress();
        const idealHours = (maxHours * (idealPercentage / 100)).toFixed(2);

        // Color coding logic
        let color = "#16a34a"; // Green
        if (actualPercentage > idealPercentage + 5) {
            color = "#dc2626"; // Red
        } else if (actualPercentage > idealPercentage) {
            color = "#ea580c"; // Orange
        }

        const barId = 'render-burn-rate-tracker';
        let container = document.getElementById(barId);

        if (!container) {
            container = document.createElement('div');
            container.id = barId;
            container.style.cssText = "margin-top: 20px; width: 100%; font-family: inherit;";
            progressBar.parentNode.insertBefore(container, progressBar.nextSibling);
        }

        container.innerHTML = `
            <div style="font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.7); margin-bottom: 8px;">
                Ideal Month Pace
            </div>
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
                <div style="display: flex; align-items: baseline; gap: 4px;">
                    <span style="font-size: 20px; font-weight: 700; color: #fff;">${idealHours} hours</span>
                    <span style="font-size: 13px; color: rgba(255, 255, 255, 0.5);">/ 750 hours</span>
                </div>
                <span style="font-size: 18px; font-weight: 700; line-height: 1; color: ${color};">${idealPercentage.toFixed(1)}%</span>
            </div>
            <div style="position: relative; overflow: hidden; border-radius: 2px; background-color: rgba(255, 255, 255, 0.1); height: 4px; width: 100%;">
                <div style="height: 100%; background-color: ${color}; width: ${Math.min(idealPercentage, 100)}%; transition: width 0.5s ease-in-out;"></div>
            </div>
        `;
    }

    setInterval(injectRenderBars, 1000);
})();