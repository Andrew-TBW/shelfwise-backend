// enrichedStyles.js
//
// Fetches every style for a store, along with its variants, each
// variant's sales history, and the incoming (on-order) quantity from any
// submitted/partially_received PO — then runs the reorder math over all
// of it. This mirrors the `enrichedStyles` useMemo in ShelfWise.jsx
// exactly, just computed server-side instead of in the browser.
const pool = require("./db");
const { computeVariantStatus, rollupStyle } = require("./reorderLogic");

async function getEnrichedStyles(storeId) {
  const stylesRes = await pool.query(
    "SELECT * FROM styles WHERE store_id = $1 ORDER BY name",
    [storeId]
  );
  const styles = stylesRes.rows;
  if (styles.length === 0) return [];

  const styleIds = styles.map((s) => s.id);
  const variantsRes = await pool.query(
    "SELECT * FROM variants WHERE style_id = ANY($1) ORDER BY sku",
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
    const styleVariants = (variantsByStyle[style.id] || []).map((v) => {
      const sales = salesByVariant[v.id] || [];
      const incoming = incomingByVariant[v.id] || 0;
      const status = computeVariantStatus({ ...v, sales }, style, incoming);
      return { ...v, sales, status };
    });
    const rollup = rollupStyle(styleVariants);
    return { ...style, variants: styleVariants, rollup };
  });
}

module.exports = { getEnrichedStyles };
