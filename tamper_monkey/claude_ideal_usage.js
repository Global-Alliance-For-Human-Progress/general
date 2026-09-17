// ==UserScript==
// @name         Claude Usage Tracker - Dynamic Colors
// @namespace    http://tampermonkey.net/
// @version      2026.09.17.1
// @description  Adds a color-coded ideal usage limit progress bar to Claude usage meters.
// @author       You
// @match        https://claude.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Absolute reset timestamps, anchored per row, so relative "Resets in N min" rows can advance
    // against the live clock instead of only moving when Claude re-renders that coarse text.
    const idealAnchors = new Map();

    function getProgress(resetText, isWeekly, anchorKey) {
        const now = new Date();

        // Case 1: Relative Session/Weekly Reset (e.g., "Resets in 27 min", "Resets in 16 hr 4 min")
        if (resetText.toLowerCase().includes('resets in')) {
            let totalRemainingMs = 0;

            const hrMatch = resetText.match(/(\d+)\s*hr/i);
            const minMatch = resetText.match(/(\d+)\s*min/i);

            if (hrMatch) totalRemainingMs += parseInt(hrMatch[1], 10) * 3600000;
            if (minMatch) totalRemainingMs += parseInt(minMatch[1], 10) * 60000;

            if (totalRemainingMs === 0) return null;

            // Differentiate max window size: Weekly limit reset cycles are usually 7 days (or use remaining time if it exceeds 7 days)
            // standard session is 5 hours.
            const sessionWindowMs = isWeekly ? (7 * 24 * 3600000) : (5 * 3600000);

            // Anchor an absolute reset moment (now + remaining) and drive progress off the live clock.
            // Re-anchor only when we have none or the DOM text jumped (window actually reset / big change),
            // so the countdown text ticking down by a minute doesn't reset our smooth interpolation.
            const nowMs = now.getTime();
            const candidateResetTs = nowMs + totalRemainingMs;
            let resetTs = idealAnchors.get(anchorKey);
            if (resetTs == null || Math.abs(candidateResetTs - resetTs) > 90000) {
                resetTs = candidateResetTs;
                idealAnchors.set(anchorKey, resetTs);
            }

            let remainingMs = resetTs - nowMs;
            if (remainingMs < 0) remainingMs = 0;

            let elapsedMs = sessionWindowMs - remainingMs;
            if (elapsedMs < 0) elapsedMs = 0;

            return (elapsedMs / sessionWindowMs) * 100;
        }

        // Case 2: Monthly/Billing-cycle Absolute Timestamp (e.g., "Resets Thu, Oct 1, 2:00 AM GMT+2")
        // Enterprise spend-limit rows use this format: "Resets <Weekday>, <Month> <Day>, <H>:<MM> <AM/PM> GMT±N"
        const monthMatch = resetText.match(/Resets\s+[a-zA-Z]+,\s*([a-zA-Z]{3,})\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (monthMatch) {
            const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
            const [, monthName, dayStr, hourStr, minStr, ampm] = monthMatch;
            const monthIdx = months.findIndex(m => monthName.toLowerCase().startsWith(m));
            if (monthIdx === -1) return null;

            let hour = parseInt(hourStr, 10);
            if (ampm.toUpperCase() === "PM" && hour < 12) hour += 12;
            if (ampm.toUpperCase() === "AM" && hour === 12) hour = 0;

            const day = parseInt(dayStr, 10);
            const min = parseInt(minStr, 10);

            let resetDate = new Date(now.getFullYear(), monthIdx, day, hour, min, 0, 0);
            // Reset should always be in the future; if not, it belongs to next year (e.g. Dec -> Jan rollover).
            if (resetDate <= now) {
                resetDate = new Date(now.getFullYear() + 1, monthIdx, day, hour, min, 0, 0);
            }

            // Billing cycle is monthly, so the cycle started exactly one month before the reset date.
            const cycleStart = new Date(resetDate.getFullYear(), resetDate.getMonth() - 1, resetDate.getDate(), resetDate.getHours(), resetDate.getMinutes(), 0, 0);
            const totalCycleMs = resetDate - cycleStart;
            if (totalCycleMs <= 0) return null;

            let elapsedMs = now - cycleStart;
            if (elapsedMs < 0) elapsedMs = 0;

            return (elapsedMs / totalCycleMs) * 100;
        }

        // Case 3: Weekly Absolute Timestamp (e.g., "Resets Tue 12:00 AM")
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

    // Tailwind class strings on claude.ai get reshuffled between plans/releases (e.g. Pro vs Enterprise
    // usage pages), so rows are found structurally instead: walk up from each meter until an ancestor
    // that also contains a leaf element whose text starts with "Resets" is found.
    function findRow(meter) {
        let row = meter.parentElement;
        for (let depth = 0; depth < 8 && row; depth++) {
            const resetEl = Array.from(row.querySelectorAll('span, div')).find(el =>
                el.children.length === 0 && /^Resets\b/i.test(el.textContent.trim())
            );
            if (resetEl) return { row, resetEl };
            row = row.parentElement;
        }
        return null;
    }

    // Prefer the label that sits next to the reset text (e.g. "Spend limit · Resets ...").
    // Fall back to any other standalone text in the row that isn't the meter or the reset text itself.
    function findTitle(row, resetEl, meter) {
        const resetContainer = resetEl.parentElement;
        if (resetContainer?.textContent.includes('·')) {
            return resetContainer.textContent.split('·')[0].trim();
        }

        const candidate = Array.from(row.querySelectorAll('span, div')).find(el =>
            el.children.length === 0 && el !== resetEl && !meter.contains(el) &&
            !el.id.startsWith('burn-rate-tracker') && el.textContent.trim().length > 0
        );
        return candidate ? candidate.textContent.trim() : "Cycle";
    }

    function injectBars() {
        const meters = document.querySelectorAll('[role="meter"]');

        meters.forEach((meter, index) => {
            const barId = `burn-rate-tracker-${index}`;

            const found = findRow(meter);
            if (!found) return;
            const { row, resetEl: resetSpan } = found;

            const titleText = findTitle(row, resetSpan, meter);

            // Determine if this row falls under a "Weekly limits" section
            // We traverse up to see if it is a sibling or child under the weekly header
            const isWeekly = titleText.toLowerCase().includes('all models') ||
                             titleText.toLowerCase().includes('fable') ||
                             !!row.closest('div')?.textContent.includes('Weekly limits');

            // Extract actual usage percentage from the meter element attribute 'aria-valuenow'
            const actualUsageAttr = meter.getAttribute('aria-valuenow');
            const actualUsage = actualUsageAttr ? parseFloat(actualUsageAttr) : 0;

            // Key the reset-timestamp anchor by row label so it survives Claude re-rendering the meter DOM.
            const idealLimit = getProgress(resetSpan.textContent, isWeekly, `${titleText}|${isWeekly}`);
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

    // Claude's usage page fetches its meter values once and doesn't re-poll, so the actual
    // usage % lags behind reality until a manual refresh. Data-fetching libraries (React Query /
    // SWR, used by the app) refetch stale queries when the window regains focus. We synthesize
    // that "focus" signal on an interval so Claude re-pulls fresh usage numbers on its own and
    // repaints its real meters; injectBars() (running every second) then reflects the new values.
    function triggerUsageRefetch() {
        // Only nudge when the tab is actually visible, to avoid pointless background fetches.
        if (document.visibilityState !== 'visible') return;

        // React Query / SWR only refetch on the not-focused -> focused EDGE, not on every focus
        // event. Firing 'visibilitychange'/'focus' while the tab is already visible is a no-op after
        // the first time (state never actually transitions), which is why usage updates once and then
        // stops until a manual refresh. So we fake a full hidden -> visible round-trip each cycle to
        // recreate that edge every time. The property overrides are own-props on `document` that shadow
        // the native getters, then deleted in `finally` to restore the real ones immediately.
        const define = (state, hidden) => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
        };

        try {
            // Phase 1: pretend the tab went hidden (drops the libraries' focused flag to false).
            define('hidden', true);
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('blur'));

            // Phase 2: pretend it became visible again -> the false->true edge the libraries refetch on.
            define('visible', false);
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new Event('focus'));
        } finally {
            // Restore the genuine native getters so nothing is left shadowed.
            delete document.visibilityState;
            delete document.hidden;
        }
    }

    setInterval(injectBars, 1000);
    setInterval(triggerUsageRefetch, 15000); // re-pull real usage numbers every 15s
})();