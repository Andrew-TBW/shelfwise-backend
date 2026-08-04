// reportData.js
//
// Computes the exact same Weekly Report data the app's live tab already
// shows — grouped by style (worst-tier-first), each variant sorted the
// same way, with stock, last-week sold total, rate, days left, and
// status. Called directly by the email-sending script, in the same
// process, reusing getEnrichedStyles() and reorderLogic.js exactly as
// the API route does — no duplicated math, no HTTP round trip to itself.

const pool = require("./db");
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

// Same distinction drawn on the app's Weekly Report tab: the ticker
// treats "enough is already on order" as effectively healthy (so it
// doesn't nag about something already handled), but the report itself
// shows the real, physical urgency of what's actually on the shelf,
// with "already on order" as a separate annotation rather than
// something that can hide the real status. Recomputed here from
// daysRemaining (physical stock only, never includes incoming) — the
// same value the ticker's own tier is built from, just not letting
// incoming override it for reporting purposes.
function physicalTierFromStatus(status) {
  if (status.daysRemaining === null) return "unknown";
  if (status.daysRemaining <= status.leadTime) return "urgent";
  if (status.daysRemaining <= status.leadTime * 1.5) return "low";
  return "healthy";
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

  const [vendorsRes, openPOsRes] = await Promise.all([
    pool.query("SELECT id, name FROM vendors WHERE store_id = $1", [storeId]),
    pool.query("SELECT count(*) FROM purchase_orders WHERE store_id = $1 AND status != 'closed'", [storeId]),
  ]);
  const vendorNameById = new Map(vendorsRes.rows.map((v) => [v.id, v.name]));
  const openPOCount = Number(openPOsRes.rows[0].count);

  // The reorder-slip alerts — same "needs attention" list the app's
  // ticker shows at the top of every screen, worst first. Kept as its
  // own list (using the real merged tier, matching the ticker exactly)
  // so the email's top section is a faithful copy of what's already at
  // the top of the app, not a re-derived approximation of it.
  const alerts = [];
  for (const style of enrichedStyles) {
    for (const variant of style.variants) {
      if (variant.status.tier === "urgent" || variant.status.tier === "low") {
        alerts.push({
          styleName: style.name,
          variantLabel: variantLabel(variant),
          vendorName: vendorNameById.get(style.vendor_id) || "Unknown vendor",
          recommendedOrder: variant.status.recommendedOrder,
          tier: variant.status.tier,
        });
      }
    }
  }
  alerts.sort((a, b) => TIER_PRIORITY[b.tier] - TIER_PRIORITY[a.tier]);

  // The table body itself, further down, uses the real physical tier
  // instead — see physicalTierFromStatus above for why these two
  // sections of the same email deliberately use different tier
  // definitions, matching the app's own Weekly Report tab exactly.
  const groups = [...enrichedStyles]
    .sort((a, b) => {
      const worstA = a.variants.reduce((worst, v) => Math.max(worst, TIER_PRIORITY[physicalTierFromStatus(v.status)]), 0);
      const worstB = b.variants.reduce((worst, v) => Math.max(worst, TIER_PRIORITY[physicalTierFromStatus(v.status)]), 0);
      if (worstB !== worstA) return worstB - worstA;
      return a.name.localeCompare(b.name);
    })
    .map((style) => {
      const variants = [...style.variants]
        .sort((a, b) => {
          const tierDiff = TIER_PRIORITY[physicalTierFromStatus(b.status)] - TIER_PRIORITY[physicalTierFromStatus(a.status)];
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
          tier: physicalTierFromStatus(v.status),
          hasIncoming: Number(v.status.incoming || 0) > 0,
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
    totalStyles: enrichedStyles.length,
    openPOCount,
    alerts,
  };
}

module.exports = { getWeeklyReportData, getLastCompleteWeekRange, toLocalDateStr };
