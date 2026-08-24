// enrichedStyles.js
//
// Fetches every style for a store, along with its variants, each
// variant's sales history, and the incoming (on-order) quantity from any
// submitted/partially_received PO — then runs the reorder math over all
// of it. This mirrors the `enrichedStyles` useMemo in ShelfWise.jsx
// exactly, just computed server-side instead of in the browser.
//
// By default, only active styles/variants are returned — matching how
// every existing caller (Shelf, Weekly Report, Voice Count) already
// expects this to behave, unchanged. Pass { includeInactive: true } to
// also get deactivated ones back (used by the Shelf tab's "show
// inactive" toggle) — each tagged with its own deactivatedAt so the
// frontend can tell active from inactive without a second endpoint.
//
// A variant is effectively inactive if EITHER its own deactivated_at is
// set, OR its parent style's is — deactivating a style never needs to
// touch its variant rows individually; this filtering rule handles it.
const pool = require("./db");
const { computeVariantStatus, rollupStyle } = require("./reorderLogic");
const { compareVariantsByColorThenSize } = require("./itemNumbers");

async function getEnrichedStyles(storeId, { includeInactive = false } = {}) {
  const styleFilter = includeInactive ? "" : "AND deactivated_at IS NULL";
  const stylesRes = await pool.query(
    `SELECT * FROM styles WHERE store_id = $1 ${styleFilter} ORDER BY name`,
    [storeId]
  );
  const styles = stylesRes.rows;
  if (styles.length === 0) return [];

  const styleIds = styles.map((s) => s.id);
  // When not including inactive items, a variant must be excluded if
  // EITHER it's individually deactivated, or its style is — even though
  // the style-level filter above already excludes inactive styles'
  // rows entirely, this second check matters for the includeInactive=true
  // case too (it still needs each variant's own status correctly
  // reported, not just "style happened to be in the result set").
  const variantFilter = includeInactive ? "" : "AND deactivated_at IS NULL";
  const variantsRes = await pool.query(
    `SELECT * FROM variants WHERE style_id = ANY($1) ${variantFilter} ORDER BY sku`,
    [styleIds]
  );
  const variants = variantsRes.rows;
  const variantIds = variants.map((v) => v.id);

  let salesRows = [];
  let incomingRows = [];
  if (variantIds.length > 0) {
    const salesRes = await pool.query(
      "SELECT * FROM sales_entries WHERE variant_id = ANY($1)",
      [variantIds]
    );
    salesRows = salesRes.rows;

    const incomingRes = await pool.query(
      `SELECT pol.variant_id, SUM(pol.qty_ordered - pol.qty_received) AS incoming
       FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.id = pol.purchase_order_id
       WHERE po.status IN ('submitted', 'partially_received')
         AND pol.variant_id = ANY($1)
       GROUP BY pol.variant_id`,
      [variantIds]
    );
    incomingRows = incomingRes.rows;
  }

  const salesByVariant = {};
  for (const s of salesRows) {
    (salesByVariant[s.variant_id] ||= []).push(s);
  }
  const incomingByVariant = {};
  for (const row of incomingRows) {
    incomingByVariant[row.variant_id] = Number(row.incoming);
  }
  const variantsByStyle = {};
  for (const v of variants) {
    (variantsByStyle[v.style_id] ||= []).push(v);
  }

  return styles.map((style) => {
    const styleVariants = (variantsByStyle[style.id] || [])
      .map((v) => {
        const sales = salesByVariant[v.id] || [];
        const incoming = incomingByVariant[v.id] || 0;
        const status = computeVariantStatus({ ...v, sales }, style, incoming);
        const isActive = !v.deactivated_at && !style.deactivated_at;
        const { item_number, ...variantWithoutItemNumber } = v;
        return { ...variantWithoutItemNumber, sales, status, isActive };
      })
      .sort(compareVariantsByColorThenSize);
    const rollup = rollupStyle(styleVariants);
    const isActive = !style.deactivated_at;
    return { ...style, variants: styleVariants, rollup, isActive };
  });
}

module.exports = { getEnrichedStyles };
