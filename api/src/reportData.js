// reportData.js
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
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function variantLabel(v) {
  return [v.size, v.color].filter(Boolean).join(" / ") || v.sku;
}

function physicalTierFromStatus(status) {
  if (status.daysRemaining === null) return "unknown";
  if (status.daysRemaining <= status.leadTime) return "urgent";
  if (status.daysRemaining <= status.leadTime * 1.5) return "low";
  return "healthy";
}

function getLastCompleteRange(days) {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() - (days - 1));
  return { start, end: yesterday };
}

function getLastCompleteWeekRange() {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() - 6);
  return { start, end: yesterday };
}

// The entire previous calendar month, regardless of what day of the
// current month it is — viewed any day in August, this is always
// July 1 through July 31, not a rolling 30-day window. monthLabel is
// just the month name ("July"), for the report's own header.
function getPreviousCalendarMonthRange() {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth() - 1, 1);
  const end = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth(), 0); // day 0 = last day of the prior month
  const monthLabel = start.toLocaleDateString("en-US", { month: "long" });
  return { start, end, monthLabel };
}

function unitsSoldInRange(salesEntries, startStr, endStr) {
  return (salesEntries || [])
    .filter((e) => {
      const endDateStr = toLocalDateStr(new Date(e.end_date));
      return endDateStr >= startStr && endDateStr <= endStr;
    })
    .reduce((sum, e) => sum + Number(e.units || 0), 0);
}

// True if at least one sales entry's end date falls within this range
// — i.e. a real count actually happened for this period, as opposed to
// nobody having counted at all. unitsSoldInRange alone can't tell
// these apart, since it returns 0 either way; this is what lets the
// running averages below skip a genuinely untracked period instead of
// silently treating "nobody counted" the same as "confirmed zero
// sold," which would understate the average the same way counting
// time before tracking began ever did.
function hasSalesRecordInRange(salesEntries, startStr, endStr) {
  return (salesEntries || []).some((e) => {
    const endDateStr = toLocalDateStr(new Date(e.end_date));
    return endDateStr >= startStr && endDateStr <= endStr;
  });
}

// The running average of a variant's own per-calendar-month sales
// totals — not a single month's total, and not the same thing as the
// existing all-time daily rate (which is one continuous average since
// the first count, blind to calendar month boundaries). Walks backward
// one full month at a time from reportMonthStart, summing that
// month's actual sales, stopping once it reaches a month entirely
// before any sales were ever recorded. Deliberately keyed off the
// earliest actual sales entry, not the variant's created_at — a style
// can sit in the catalog for months before anyone starts actively
// counting it, and treating that whole gap as a string of genuine
// "zero-sales months" would badly understate the true average. Any
// individual month with no recorded count at all (a gap between two
// otherwise-tracked months) is skipped the same way, rather than
// counted as a zero — for the same reason. A variant with no sales
// history at all returns null, same convention as an unset rate
// elsewhere ("—" on screen).
function computeRunningMonthlyAverage(sales, reportMonthStart) {
  if (!sales || sales.length === 0) return null;
  const earliestStart = sales.reduce((earliest, e) => {
    const d = new Date(e.start_date);
    return !earliest || d < earliest ? d : earliest;
  }, null);

  const monthlyTotals = [];
  let cursor = new Date(reportMonthStart.getFullYear(), reportMonthStart.getMonth(), 1);

  // Safety cap (10 years of months) — purely defensive, so a bad
  // date value could never cause a runaway loop; a real store's
  // history should never come close to this.
  for (let i = 0; i < 120; i++) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    if (monthEnd < earliestStart) break; // this entire month is before any recorded sales
    const startStr = toLocalDateStr(cursor);
    const endStr = toLocalDateStr(monthEnd);
    if (hasSalesRecordInRange(sales, startStr, endStr)) {
      monthlyTotals.push(unitsSoldInRange(sales, startStr, endStr));
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  }

  if (monthlyTotals.length === 0) return null;
  return monthlyTotals.reduce((sum, n) => sum + n, 0) / monthlyTotals.length;
}

// Same idea as computeRunningMonthlyAverage above, one level down —
// fixed, non-overlapping 7-day buckets instead of calendar months.
// Weekly's own date range was already a fixed period each time the
// report runs (the last complete 7 days), unlike Monthly's old rolling
// 30-day window, so only this average needed the accumulate-over-time
// treatment — the "Sold" window itself didn't need to change.
function computeRunningWeeklyAverage(sales, reportWeekStart) {
  if (!sales || sales.length === 0) return null;
  const earliestStart = sales.reduce((earliest, e) => {
    const d = new Date(e.start_date);
    return !earliest || d < earliest ? d : earliest;
  }, null);

  const weeklyTotals = [];
  let cursorStart = new Date(reportWeekStart.getFullYear(), reportWeekStart.getMonth(), reportWeekStart.getDate());

  // Safety cap (10 years of weeks) — same purely defensive purpose as
  // the monthly version's cap.
  for (let i = 0; i < 520; i++) {
    const cursorEnd = new Date(cursorStart.getFullYear(), cursorStart.getMonth(), cursorStart.getDate() + 6);
    if (cursorEnd < earliestStart) break; // this entire week is before any recorded sales
    const startStr = toLocalDateStr(cursorStart);
    const endStr = toLocalDateStr(cursorEnd);
    if (hasSalesRecordInRange(sales, startStr, endStr)) {
      weeklyTotals.push(unitsSoldInRange(sales, startStr, endStr));
    }
    cursorStart = new Date(cursorStart.getFullYear(), cursorStart.getMonth(), cursorStart.getDate() - 7);
  }

  if (weeklyTotals.length === 0) return null;
  return weeklyTotals.reduce((sum, n) => sum + n, 0) / weeklyTotals.length;
}

function buildAlerts(enrichedStyles, vendorNameById) {
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
  return alerts;
}

function buildGroups(enrichedStyles, computeSold, computeSecondaryRate) {
  return [...enrichedStyles]
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
          sold: computeSold(v),
          rate30Day: computeSecondaryRate ? computeSecondaryRate(v) : v.status.rate30Day,
          rateAllTime: v.status.rate,
          daysRemaining: v.status.daysRemaining,
          tier: physicalTierFromStatus(v.status),
          hasIncoming: Number(v.status.incoming || 0) > 0,
        }));
      return { name: style.name, marginTier: style.margin_tier, movementTier: style.movement_tier, variants };
    });
}

async function getVendorAndPOInfo(storeId) {
  const [vendorsRes, openPOsRes] = await Promise.all([
    pool.query("SELECT id, name FROM vendors WHERE store_id = $1", [storeId]),
    pool.query("SELECT count(*) FROM purchase_orders WHERE store_id = $1 AND status != 'closed'", [storeId]),
  ]);
  return {
    vendorNameById: new Map(vendorsRes.rows.map((v) => [v.id, v.name])),
    openPOCount: Number(openPOsRes.rows[0].count),
  };
}

async function getWeeklyReportData(storeId) {
  const enrichedStyles = await getEnrichedStyles(storeId);
  const { start, end } = getLastCompleteWeekRange();
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);

  const { vendorNameById, openPOCount } = await getVendorAndPOInfo(storeId);
  const alerts = buildAlerts(enrichedStyles, vendorNameById);
  const groups = buildGroups(
    enrichedStyles,
    (v) => unitsSoldInRange(v.sales, startStr, endStr),
    (v) => computeRunningWeeklyAverage(v.sales, start)
  );
  const totalVariants = groups.reduce((s, g) => s + g.variants.length, 0);

  return {
    reportLabel: "Weekly Report",
    rangeStart: startStr,
    rangeEnd: endStr,
    rangeStartDisplay: formatDisplayDate(startStr),
    rangeEndDisplay: formatDisplayDate(endStr),
    weekStart: startStr,
    weekEnd: endStr,
    weekStartDisplay: formatDisplayDate(startStr),
    weekEndDisplay: formatDisplayDate(endStr),
    secondaryRateLabel: "Weekly Average",
    secondaryRateUnit: "week",
    groups,
    totalVariants,
    totalStyles: enrichedStyles.length,
    openPOCount,
    alerts,
  };
}

async function getMonthlyReportData(storeId) {
  const enrichedStyles = await getEnrichedStyles(storeId);
  const { start, end, monthLabel } = getPreviousCalendarMonthRange();
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);

  const { vendorNameById, openPOCount } = await getVendorAndPOInfo(storeId);
  const alerts = buildAlerts(enrichedStyles, vendorNameById);
  const groups = buildGroups(
    enrichedStyles,
    (v) => unitsSoldInRange(v.sales, startStr, endStr),
    (v) => computeRunningMonthlyAverage(v.sales, start)
  );
  const totalVariants = groups.reduce((s, g) => s + g.variants.length, 0);

  return {
    reportLabel: "Monthly Report",
    monthLabel,
    rangeStart: startStr,
    rangeEnd: endStr,
    rangeStartDisplay: formatDisplayDate(startStr),
    rangeEndDisplay: formatDisplayDate(endStr),
    secondaryRateLabel: "Monthly Average",
    secondaryRateUnit: "month",
    groups,
    totalVariants,
    totalStyles: enrichedStyles.length,
    openPOCount,
    alerts,
  };
}

async function getImmediateReportData(storeId, items) {
  const enrichedStyles = await getEnrichedStyles(storeId);
  const soldByVariantId = new Map(items.map((it) => [it.variantId, it]));

  const filteredStyles = enrichedStyles
    .map((style) => ({ ...style, variants: style.variants.filter((v) => soldByVariantId.has(v.id)) }))
    .filter((style) => style.variants.length > 0);

  const { vendorNameById, openPOCount } = await getVendorAndPOInfo(storeId);
  const alerts = buildAlerts(enrichedStyles, vendorNameById);
  const groups = buildGroups(filteredStyles, (v) => soldByVariantId.get(v.id)?.sold ?? 0);
  const totalVariants = groups.reduce((s, g) => s + g.variants.length, 0);

  return {
    reportLabel: "Immediate Report",
    groups,
    totalVariants,
    totalStyles: filteredStyles.length,
    openPOCount,
    alerts,
  };
}

async function getMovementReportData(storeId, tier) {
  const enrichedStyles = await getEnrichedStyles(storeId);
  const filteredStyles = enrichedStyles.filter((s) => s.movement_tier === tier);

  const { start, end } = getLastCompleteRange(30);
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);

  const { vendorNameById, openPOCount } = await getVendorAndPOInfo(storeId);
  const alerts = buildAlerts(enrichedStyles, vendorNameById);
  const groups = buildGroups(filteredStyles, (v) => unitsSoldInRange(v.sales, startStr, endStr));
  const totalVariants = groups.reduce((s, g) => s + g.variants.length, 0);

  return {
    reportLabel: tier === "fast" ? "Fast Movers" : "Slow Movers",
    rangeStart: startStr,
    rangeEnd: endStr,
    rangeStartDisplay: formatDisplayDate(startStr),
    rangeEndDisplay: formatDisplayDate(endStr),
    groups,
    totalVariants,
    totalStyles: filteredStyles.length,
    openPOCount,
    alerts,
  };
}

module.exports = {
  getWeeklyReportData,
  getMonthlyReportData,
  getImmediateReportData,
  getMovementReportData,
  getLastCompleteWeekRange,
  getLastCompleteRange,
  getPreviousCalendarMonthRange,
  toLocalDateStr,
};
