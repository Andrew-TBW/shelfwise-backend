// reorderLogic.js
//
// This is a direct port of the pure calculation functions from
// ShelfWise.jsx (computeDailyRate, tierFromDays, computeVariantStatus,
// rollupStyle). Moving this server-side means every device gets the same
// trusted number instead of computing it independently — the whole
// point of Phase 2.
//
// Field names here use snake_case (start_date, lead_time_days, etc.)
// to match the database columns directly, rather than the frontend's
// camelCase — the API layer (below) is what translates between the two.

// Length of a logged sales period, counted inclusively of both the start
// and end date — e.g. Monday through Sunday is 7 days of sales, not the
// 6-day gap between the two dates. A same-day entry is 1 day, not 0.
function periodLengthDays(entry) {
  const rawDiff = Math.round((new Date(entry.end_date) - new Date(entry.start_date)) / 86400000);
  return Math.max(1, rawDiff + 1);
}

// Average daily sell-through, weighted toward periods that ended in the
// last 30 days. As of the two-rate-column change, this is used ONLY
// for the "30-day avg." display column on the report screens — it no
// longer drives daysRemaining, tier, or recommendedOrder anywhere in
// the app. See computeAllTimeRate below for the rate that actually does.
function computeDailyRate(salesEntries) {
  if (!salesEntries || salesEntries.length === 0) return 0;
  const sorted = [...salesEntries].sort((a, b) => new Date(a.end_date) - new Date(b.end_date));
  const now = new Date();
  const windowStart = new Date(now.getTime() - 30 * 86400000);
  const recent = sorted.filter((e) => new Date(e.end_date) >= windowStart);
  const pool = recent.length > 0 ? recent : sorted;
  const totalUnits = pool.reduce((s, e) => s + Number(e.units || 0), 0);
  const totalDays = pool.reduce((s, e) => s + periodLengthDays(e), 0);
  return totalDays > 0 ? totalUnits / totalDays : 0;
}

// Average daily sell-through across a variant's ENTIRE sales history —
// no 30-day cutoff, no recent-period preference, every logged period
// counted equally regardless of age. This is the rate that actually
// drives daysRemaining, tier, and recommendedOrder everywhere in the
// app — the 30-day-preferring calculation above is kept only as its
// own separate, explicitly-labeled display column on the report
// screens, not as a hidden influence on reorder decisions.
function computeAllTimeRate(salesEntries) {
  if (!salesEntries || salesEntries.length === 0) return 0;
  const totalUnits = salesEntries.reduce((s, e) => s + Number(e.units || 0), 0);
  const totalDays = salesEntries.reduce((s, e) => s + periodLengthDays(e), 0);
  return totalDays > 0 ? totalUnits / totalDays : 0;
}

function tierFromDays(daysRemaining, leadTime) {
  if (daysRemaining <= leadTime) return "urgent";
  if (daysRemaining <= leadTime * 1.5) return "low";
  return "healthy";
}

// Single reorder formula, applied uniformly to every variant. `incomingQty`
// is the quantity already on a submitted (or partially received) purchase
// order; it doesn't change the physical daysRemaining shown on the shelf,
// but it does suppress a tier/recommendedOrder that would otherwise
// invite a duplicate PO.
function computeVariantStatus(variant, style, incomingQty = 0) {
  // rate: all-time average, drives every actual reorder decision below
  // (daysRemaining, tier, recommendedOrder). rate30Day: the older
  // recent-preferring calculation, kept ONLY for the report screens'
  // explicit "30-day avg." column — it has no influence on anything
  // else anymore.
  const rate = computeAllTimeRate(variant.sales || []);
  const rate30Day = computeDailyRate(variant.sales || []);
  const leadTime = Number(style.lead_time_days);
  const targetDays = Number(style.target_days);
  const stock = Number(variant.stock || 0);
  const incoming = Number(incomingQty || 0);
  const effectiveStock = stock + incoming;

  if (rate <= 0) {
    return { rate, rate30Day, daysRemaining: null, tier: "unknown", recommendedOrder: 0, leadTime, targetDays, incoming };
  }

  const daysRemaining = stock / rate;
  const effectiveDaysRemaining = effectiveStock / rate;

  const physicalTier = tierFromDays(daysRemaining, leadTime);
  const effectiveTier = tierFromDays(effectiveDaysRemaining, leadTime);
  const tier = effectiveTier === "healthy" && physicalTier !== "healthy" ? "incoming" : effectiveTier;

  const target = rate * (targetDays + leadTime);
  const recommendedOrder = Math.max(0, Math.round(target - effectiveStock));

  return { rate, rate30Day, daysRemaining, tier, recommendedOrder, leadTime, targetDays, incoming };
}

const TIER_PRIORITY = { urgent: 4, low: 3, incoming: 2, healthy: 1, unknown: 0 };

function rollupStyle(variantsWithStatus) {
  let totalStock = 0;
  let totalRecommended = 0;
  let totalIncoming = 0;
  let worstTier = "unknown";
  for (const v of variantsWithStatus) {
    totalStock += Number(v.stock || 0);
    totalRecommended += v.status.recommendedOrder;
    totalIncoming += Number(v.status.incoming || 0);
    if (TIER_PRIORITY[v.status.tier] > TIER_PRIORITY[worstTier]) worstTier = v.status.tier;
  }
  return { totalStock, totalRecommended, totalIncoming, worstTier };
}

// Two inclusive date ranges overlap if either range's start falls on or
// before the other's end.
function periodsOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) <= new Date(bEnd) && new Date(bStart) <= new Date(aEnd);
}

module.exports = { computeDailyRate, computeAllTimeRate, tierFromDays, computeVariantStatus, rollupStyle, TIER_PRIORITY, periodsOverlap };
