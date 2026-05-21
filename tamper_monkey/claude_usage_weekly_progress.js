// ==UserScript==
// @name         Claude Usage Tracker - Weekly Section Only
// @namespace    http://tampermonkey.net/
// @version      2026-05-21
// @description  Adds a weekly cycle elapsed progress bar to the Claude Usage Tracker to see if you're above or under your usage
// @author       You
// @match        https://claude.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function getProgress(resetText) {
        const now = new Date();
        const totalWeekMs = 604800000;

        // Condition 1: Relative breakdown (e.g., "Resets in 18 hr 13 min" or "Resets in 45 min")
        if (resetText.toLowerCase().includes('resets in')) {
            let totalRemainingMs = 0;

            const hrMatch = resetText.match(/(\d+)\s*hr/i);
            const minMatch = resetText.match(/(\d+)\s*min/i);

            if (hrMatch) totalRemainingMs += parseInt(hrMatch[1]) * 3600000;
            if (minMatch) totalRemainingMs += parseInt(minMatch[1]) * 60000;

            if (totalRemainingMs === 0) return null;

            let elapsedMs = totalWeekMs - totalRemainingMs;
            if (elapsedMs < 0) elapsedMs = 0;

            return (elapsedMs / totalWeekMs) * 100;
        }

        // Condition 2: Original absolute timestamp (e.g., "Resets Mon 12:00 AM")
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const match = resetText.match(/Resets\s+([a-zA-Z]+)\s+(\d+):(\d+)\s*(AM|PM)/i);
        if (!match) return null;

        const [_, dayName, hourStr, minStr, ampm] = match;
        const resetDay = days.findIndex(d => dayName.toLowerCase().startsWith(d.toLowerCase()));
        let resetHour = parseInt(hourStr);
        if (ampm.toUpperCase() === "PM" && resetHour < 12) resetHour += 12;
        if (ampm.toUpperCase() === "AM" && resetHour === 12) resetHour = 0;

        const currentDay = now.getDay();
        let daysSinceReset = currentDay - resetDay;
        if (daysSinceReset < 0) daysSinceReset += 7;

        const msSinceResetDay = daysSinceReset * 86400000;
        const msIntoCurrentDay = (now.getHours() * 3600000) + (now.getMinutes() * 60000) + (now.getSeconds() * 1000);
        const msIntoResetDayOffset = (resetHour * 3600000) + (parseInt(minStr) * 60000);

        let totalMsSinceReset = (msSinceResetDay + msIntoCurrentDay) - msIntoResetDayOffset;
        if (totalMsSinceReset < 0) totalMsSinceReset += totalWeekMs;

        return (totalMsSinceReset / totalWeekMs) * 100;
    }

    function injectBar() {
        if (document.getElementById('burn-rate-container-weekly')) return;

        // Locate sections within the DOM
        const sections = Array.from(document.querySelectorAll('section'));
        const weeklySection = sections.find(s => {
            const heading = s.querySelector('h3');
            return heading && heading.textContent.includes('Weekly limits');
        });

        if (!weeklySection) return;

        // Based on the new DOM structure, look for the reset text inside the description spans
        const spans = Array.from(weeklySection.querySelectorAll('span.text-footnote'));
        const resetSpan = spans.find(s => s.textContent.includes('Resets'));

        // Locate the progress bar component
        const progressBar = weeklySection.querySelector('div[role="progressbar"]');

        if (!resetSpan || !progressBar) return;

        const timePercent = getProgress(resetSpan.textContent);
        if (timePercent === null) return;

        const container = document.createElement('div');
        container.id = 'burn-rate-container-weekly';
        container.style = "margin-bottom: 12px; width: 100%; border-left: 3px solid #d97706; padding-left: 10px;";

        container.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; color: #d97706; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
                <span>Weekly Cycle Elapsed</span>
                <span>${timePercent.toFixed(1)}%</span>
            </div>
            <div style="position: relative; overflow: hidden; border-radius: 4px; background-color: rgba(217, 119, 6, 0.1); height: 6px; width: 100%;">
                <div style="height: 100%; background-color: #d97706; width: ${timePercent}%; transition: width 1s ease-in-out;"></div>
            </div>
        `;

        // The layout nests the progress bar inside a flex container next to the percentage text
        // Navigating up to the outer flex container puts the injection above the bar block safely
        const targetWrapper = progressBar.closest('.flex-1');
        if (targetWrapper) {
            targetWrapper.insertBefore(container, targetWrapper.firstChild);
        }
    }

    // Runs continuously to catch the popup elements whenever the modal opens
    setInterval(injectBar, 1000);
})();