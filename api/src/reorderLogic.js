// reorderLogic.js
//
// This is a direct port of the pure calculation functions from
// ArthurIQ.jsx (computeDailyRate, tierFromDays, computeVariantStatus,
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
// counted equally regardless of age. This is the rate shown as
// "All-time avg." on the report screens. It no longer drives
// daysRemaining, tier, or recommendedOrder — see compute90DayRate below
// for the rate that actually does. Kept computing and returning this
// unchanged specifically so that display stays exactly as it was.
function computeAllTimeRate(salesEntries) {
  if (!salesEntries || salesEntries.length === 0) return 0;
  const totalUnits = salesEntries.reduce((s, e) => s + Number(e.units || 0), 0);
  const totalDays = salesEntries.reduce((s, e) => s + periodLengthDays(e), 0);
  return totalDays > 0 ? totalUnits / totalDays : 0;
}

// Average daily sell-through over the most recent 90 days — this is
// the rate that actually drives daysRemaining, tier, and
// recommendedOrder now. Deliberately NOT surfaced in any report
// column; it exists purely to make the internal reorder math reflect
// recent selling behavior rather than a variant's entire history,
// which can span months or years of very different conditions.
//
// A period whose dates fall entirely within the last 90 days counts
// in full. A period entirely before the cutoff is excluded outright.
// A period straddling the boundary is prorated by the same logic used
// for the Weekly/Monthly running averages: only the fraction of its
// units proportional to how many of its days actually fall inside the
// 90-day window counts, rather than crediting the whole period to
// whichever side its dates happen to land on. The denominator is the
// sum of each period's own tracked days within the window (not a flat
// 90) for the same reason the running averages skip untracked gaps
// instead of counting them as zero-sales days — a store that counts
// sparsely shouldn't have its rate diluted by days nobody logged
// anything for.
function compute90DayRate(salesEntries) {
  if (!salesEntries || salesEntries.length === 0) return 0;
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);

  let totalUnits = 0;
  let totalDays = 0;
  for (const e of salesEntries) {
    const entryStart = new Date(e.start_date);
    const entryEnd = new Date(e.end_date);
    if (entryEnd < windowStart) continue; // entirely before the window

    const fullDays = periodLengthDays(e);
    const fullUnits = Number(e.units || 0);

    if (entryStart >= windowStart) {
      // Entirely within the window — counts in full.
      totalUnits += fullUnits;
      totalDays += fullDays;
    } else {
      // Straddles the boundary — only the overlapping portion counts,
      // proportional to what fraction of the period's own days that
      // overlap represents.
      const overlapDays = Math.round((entryEnd - windowStart) / 86400000) + 1;
      const fraction = overlapDays / fullDays;
      totalUnits += fullUnits * fraction;
      totalDays += overlapDays;
    }
  }

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
  // rate / rate30Day: computed and returned exactly as before, purely
  // for the report screens' "All-time avg." and "30-day avg." columns
  // — neither one influences anything below anymore. rate90Day is the
  // one hidden number that actually drives daysRemaining, tier, and
  // recommendedOrder now; it isn't returned to any display, only used
  // internally in this function.
  const rate = computeAllTimeRate(variant.sales || []);
  const rate30Day = computeDailyRate(variant.sales || []);
  const rate90Day = compute90DayRate(variant.sales || []);
  const leadTime = Number(style.lead_time_days);
  const targetDays = Number(style.target_days);
  const stock = Number(variant.stock || 0);
  const incoming = Number(incomingQty || 0);
  const effectiveStock = stock + incoming;

  if (rate90Day <= 0) {
    return { rate, rate30Day, daysRemaining: null, tier: "unknown", recommendedOrder: 0, leadTime, targetDays, incoming };
  }

  const daysRemaining = stock / rate90Day;
  const effectiveDaysRemaining = effectiveStock / rate90Day;

  const physicalTier = tierFromDays(daysRemaining, leadTime);
  const effectiveTier = tierFromDays(effectiveDaysRemaining, leadTime);
  const tier = effectiveTier === "healthy" && physicalTier !== "healthy" ? "incoming" : effectiveTier;

  const target = rate90Day * (targetDays + leadTime);
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

module.exports = { computeDailyRate, computeAllTimeRate, compute90DayRate, tierFromDays, computeVariantStatus, rollupStyle, TIER_PRIORITY, periodsOverlap };
