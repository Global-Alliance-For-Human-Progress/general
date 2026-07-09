// ==UserScript==
// @name         Claude Usage Tracker - Dynamic Colors
// @namespace    http://tampermonkey.net/
// @version      2026-07-09
// @description  Adds a color-coded ideal usage limit progress bar to Claude usage meters.
// @author       You
// @match        https://claude.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function getProgress(resetText) {
        const now = new Date();

        // Case 1: Short Relative Session Reset (e.g., "Resets in 27 min")
        if (resetText.toLowerCase().includes('resets in')) {
            let totalRemainingMs = 0;

            const hrMatch = resetText.match(/(\d+)\s*hr/i);
            const minMatch = resetText.match(/(\d+)\s*min/i);

            if (hrMatch) totalRemainingMs += parseInt(hrMatch[1], 10) * 3600000;
            if (minMatch) totalRemainingMs += parseInt(minMatch[1], 10) * 60000;

            if (totalRemainingMs === 0) return null;

            const sessionWindowMs = 5 * 3600000; // Standard 5-hour rolling session
            let elapsedMs = sessionWindowMs - totalRemainingMs;
            if (elapsedMs < 0) elapsedMs = 0;

            return (elapsedMs / sessionWindowMs) * 100;
        }

        // Case 2: Weekly Absolute Timestamp (e.g., "Resets Tue 12:00 AM")
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const match = resetText.match(/Resets\s+([a-zA-Z]+)\s+(\d+):(\d+)\s*(AM|PM)/i);
        if (!match) return null;

        const totalWeekMs = 604800000;
        const [_, dayName, hourStr, minStr, ampm] = match;
        const resetDay = days.findIndex(d => dayName.toLowerCase().startsWith(d.toLowerCase()));
        
        let resetHour = parseInt(hourStr, 10);
        if (ampm.toUpperCase() === "PM" && resetHour < 12) resetHour += 12;
        if (ampm.toUpperCase() === "AM" && resetHour === 12) resetHour = 0;

        const currentDay = now.getDay();
        let daysSinceReset = currentDay - resetDay;
        if (daysSinceReset < 0) daysSinceReset += 7;

        const msSinceResetDay = daysSinceReset * 86400000;
        const msIntoCurrentDay = (now.getHours() * 3600000) + (now.getMinutes() * 60000) + (now.getSeconds() * 1000);
        const msIntoResetDayOffset = (resetHour * 3600000) + (parseInt(minStr, 10) * 60000);

        let totalMsSinceReset = (msSinceResetDay + msIntoCurrentDay) - msIntoResetDayOffset;
        if (totalMsSinceReset < 0) totalMsSinceReset += totalWeekMs;

        return (totalMsSinceReset / totalWeekMs) * 100;
    }

    function injectBars() {
        const rows = document.querySelectorAll('.flex.w-full.flex-row.flex-wrap.items-center.justify-between');

        rows.forEach((row, index) => {
            const barId = `burn-rate-tracker-${index}`;
            
            // Look for the reset text and the meter element
            const textSpans = Array.from(row.querySelectorAll('span'));
            const resetSpan = textSpans.find(s => s.textContent.includes('Resets'));
            const meter = row.querySelector('[role="meter"]');

            if (!resetSpan || !meter) return;

            // Extract actual usage percentage from the meter element attribute 'aria-valuenow'
            const actualUsageAttr = meter.getAttribute('aria-valuenow');
            const actualUsage = actualUsageAttr ? parseFloat(actualUsageAttr) : 0;

            const idealLimit = getProgress(resetSpan.textContent);
            if (idealLimit === null) return;

            // Determine status color based on relationship between actual usage and ideal limit
            let color = "#16a34a"; // Green (Safe/Below)
            if (actualUsage > idealLimit) {
                color = "#dc2626"; // Red (Over Budget)
            } else if (idealLimit - actualUsage <= 5) {
                color = "#ea580c"; // Orange/Yellow (On track but close)
            }

            // If the bar already exists, just update its contents and color instead of recreating it
            let container = row.querySelector(`#${barId}`);
            if (!container) {
                container = document.createElement('div');
                container.id = barId;
                container.style = "margin-bottom: 8px; width: 100%; padding-left: 10px;";
                
                const targetWrapper = meter.closest('.flex-1');
                if (targetWrapper) {
                    targetWrapper.insertBefore(container, targetWrapper.firstChild);
                }
            }

            // Grab the row's specific title (e.g. "Current session", "All models")
            const titleSpan = row.querySelector('span.text-body') || row.querySelector('span[id^="_r_"]');
            const titleText = titleSpan ? titleSpan.textContent.trim() : "Cycle";

            container.style.borderLeft = `3px solid ${color}`;
            container.innerHTML = `
                <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; color: ${color}; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <span>${titleText} Ideal Usage Limit</span>
                    <span>${idealLimit.toFixed(1)}%</span>
                </div>
                <div style="position: relative; overflow: hidden; border-radius: 4px; background-color: ${color}1a; height: 6px; width: 100%;">
                    <div style="height: 100%; background-color: ${color}; width: ${idealLimit}%; transition: width 1s ease-in-out;"></div>
                </div>
            `;
        });
    }

    setInterval(injectBars, 1000);
})();