// reportData.js
//
// Computes the exact same Weekly Report data the app's live tab already
// shows — grouped by style (worst-tier-first), each variant sorted the
// same way, with stock, last-week sold total, rate, days left, and
// status. Called directly by the email-sending script, in the same
// process, reusing getEnrichedStyles() and reorderLogic.js exactly as
// the API route does — no duplicated math, no HTTP round trip to itself.

const { getEnrichedStyles } = require("./enrichedStyles");
const { TIER_PRIORITY } = require("./reorderLogic");

function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(dateStr) {
  // Midday avoids any midnight/DST edge case when just formatting a
  // plain calendar date for display.
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function variantLabel(v) {
  return [v.size, v.color].filter(Boolean).join(" / ") || v.sku;
}

// Identical to the frontend's getLastCompleteWeekRange — a rolling 7
// days ending yesterday. Run on a Monday (as the scheduled send is),
// this lines up exactly with "the previous complete Monday-through-
// Sunday week" — see the conversation notes on why these two didn't
// need to be separate calculations after all.
//
// Uses the server's own local time. Fine while pilot stores are all in
// roughly the same region; if that changes, this becomes a real design
// question (which store's "yesterday" wins?) worth revisiting deliberately
// rather than left as an accidental default.
function getLastCompleteWeekRange() {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() - 6);
  return { start, end: yesterday };
}

// Sum of units from sales entries whose *end date* falls within
// [startStr, endStr] (inclusive) — same "attributed to the day it
// ended" convention already used everywhere else. Comparing as plain
// "YYYY-MM-DD" strings sidesteps timezone/precision boundary issues.
function unitsSoldInRange(salesEntries, startStr, endStr) {
  return (salesEntries || [])
    .filter((e) => {
      const endDateStr = toLocalDateStr(new Date(e.end_date));
      return endDateStr >= startStr && endDateStr <= endStr;
    })
    .reduce((sum, e) => sum + Number(e.units || 0), 0);
}

// The main entry point: everything the email template needs for one
// store, already computed and shaped.
async function getWeeklyReportData(storeId) {
  const enrichedStyles = await getEnrichedStyles(storeId);
  const { start, end } = getLastCompleteWeekRange();
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);

  const groups = [...enrichedStyles]
    .sort((a, b) => {
      const tierDiff = TIER_PRIORITY[b.rollup.worstTier] - TIER_PRIORITY[a.rollup.worstTier];
      if (tierDiff !== 0) return tierDiff;
      return a.name.localeCompare(b.name);
    })
    .map((style) => {
      const variants = [...style.variants]
        .sort((a, b) => {
          const tierDiff = TIER_PRIORITY[b.status.tier] - TIER_PRIORITY[a.status.tier];
          if (tierDiff !== 0) return tierDiff;
          return variantLabel(a).localeCompare(variantLabel(b));
        })
        .map((v) => ({
          label: variantLabel(v),
          sku: v.sku,
          stock: Number(v.stock),
          soldLastWeek: unitsSoldInRange(v.sales, startStr, endStr),
          rate: v.status.rate,
          daysRemaining: v.status.daysRemaining,
          tier: v.status.tier,
        }));
      return { name: style.name, variants };
    });

  const totalVariants = groups.reduce((s, g) => s + g.variants.length, 0);

  return {
    weekStart: startStr,
    weekEnd: endStr,
    weekStartDisplay: formatDisplayDate(startStr),
    weekEndDisplay: formatDisplayDate(endStr),
    groups,
    totalVariants,
  };
}

module.exports = { getWeeklyReportData, getLastCompleteWeekRange, toLocalDateStr };
