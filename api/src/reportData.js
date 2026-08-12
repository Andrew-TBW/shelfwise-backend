// reportData.js
//
// Computes report data for the app's three report types — Weekly,
// Monthly, and Immediate — all built on the same getEnrichedStyles()
// and reorderLogic.js math the live Shelf tab uses.
//
// Rate is shown as two separate, uniform columns across all three
// report types — "30-day avg." (computeDailyRate, recent-preferring)
// and "All-time avg." (computeAllTimeRate, full history) — both pulled
// straight from the variant's own status, the same numbers regardless
// of which report you're looking at. Only "Sold" stays report-specific
// (each report's own window, or Immediate's captured value).
//
// Immediate is structurally different from the other two: it's not a
// time window at all, but a specific list of variants (whichever ones
// were part of the most recent Voice Count or Count Sheet submission)
// — that list lives only in frontend session memory, so the caller has
// to supply it.

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

function unitsSoldInRange(salesEntries, startStr, endStr) {
  return (salesEntries || [])
    .filter((e) => {
      const endDateStr = toLocalDateStr(new Date(e.end_date));
      return endDateStr >= startStr && endDateStr <= endStr;
    })
    .reduce((sum, e) => sum + Number(e.units || 0), 0);
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

// `rate30Day` and `rateAllTime` come straight from computeVariantStatus
// now — uniform across every report type, rather than each report
// computing its own notion of "rate." Only `sold` stays report-specific
// (each report's own window, or Immediate's captured value).
function buildGroups(enrichedStyles, computeSold) {
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
          rate30Day: v.status.rate30Day,
          rateAllTime: v.status.rate,
          daysRemaining: v.status.daysRemaining,
          tier: physicalTierFromStatus(v.status),
          hasIncoming: Number(v.status.incoming || 0) > 0,
        }));
      return { name: style.name, variants };
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
  const groups = buildGroups(enrichedStyles, (v) => unitsSoldInRange(v.sales, startStr, endStr));
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
    groups,
    totalVariants,
    totalStyles: enrichedStyles.length,
    openPOCount,
    alerts,
  };
}

async function getMonthlyReportData(storeId) {
  const enrichedStyles = await getEnrichedStyles(storeId);
  const { start, end } = getLastCompleteRange(30);
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);

  const { vendorNameById, openPOCount } = await getVendorAndPOInfo(storeId);
  const alerts = buildAlerts(enrichedStyles, vendorNameById);
  const groups = buildGroups(enrichedStyles, (v) => unitsSoldInRange(v.sales, startStr, endStr));
  const totalVariants = groups.reduce((s, g) => s + g.variants.length, 0);

  return {
    reportLabel: "Monthly Report",
    rangeStart: startStr,
    rangeEnd: endStr,
    rangeStartDisplay: formatDisplayDate(startStr),
    rangeEndDisplay: formatDisplayDate(endStr),
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

module.exports = {
  getWeeklyReportData,
  getMonthlyReportData,
  getImmediateReportData,
  getLastCompleteWeekRange,
  getLastCompleteRange,
  toLocalDateStr,
};
