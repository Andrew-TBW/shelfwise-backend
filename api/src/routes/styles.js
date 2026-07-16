// routes/styles.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");
const { getEnrichedStyles } = require("../enrichedStyles");

const router = express.Router();

// GET /api/styles — every style for this store, with variants, sales,
// incoming quantity, and computed reorder status already attached.
// This is the single call the Shelf tab needs on load.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const styles = await getEnrichedStyles(req.storeId);
    res.json(styles);
  })
);

// POST /api/styles — create a style plus its initial variants in one
// transaction, matching AddStyleModal's "Add to shelf" action.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, category, vendorId, leadTimeDays, targetDays, variants } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
    if (!vendorId) return res.status(400).json({ error: "vendorId is required" });
    if (!Array.isArray(variants) || variants.length === 0) {
      return res.status(400).json({ error: "at least one variant is required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const styleRes = await client.query(
        `INSERT INTO styles (store_id, vendor_id, name, category, lead_time_days, target_days)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.storeId, vendorId, name.trim(), category || "", Number(leadTimeDays) || 7, Number(targetDays) || 14]
      );
      const styleId = styleRes.rows[0].id;

      for (const v of variants) {
        if (!v.sku || !v.sku.trim()) throw Object.assign(new Error("Every variant needs a SKU"), { status: 400 });
        await client.query(
          `INSERT INTO variants (store_id, style_id, sku, size, color, stock)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.storeId, styleId, v.sku.trim(), v.size || "", v.color || "", Number(v.stock) || 0]
        );
      }

      await client.query("COMMIT");
      res.status(201).json({ id: styleId });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// PATCH /api/styles/:id — update style info/settings (name, category,
// vendor, lead time, target days). Matches EditStyleModal's "Save changes".
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const fields = [];
    const values = [];
    let i = 1;

    const map = {
      name: "name",
      category: "category",
      vendorId: "vendor_id",
      leadTimeDays: "lead_time_days",
      targetDays: "target_days",
    };
    for (const [bodyKey, column] of Object.entries(map)) {
      if (req.body[bodyKey] !== undefined) {
        fields.push(`${column} = $${i++}`);
        values.push(req.body[bodyKey]);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: "No updatable fields provided" });

    fields.push(`updated_at = now()`);
    values.push(id, req.storeId);

    const { rowCount } = await pool.query(
      `UPDATE styles SET ${fields.join(", ")} WHERE id = $${i++} AND store_id = $${i}`,
      values
    );
    if (rowCount === 0) return res.status(404).json({ error: "Style not found" });
    res.json({ ok: true });
  })
);

// DELETE /api/styles/:id — matches the "Remove style" action (behind edit
// mode + confirmation in the frontend). Variants cascade automatically
// (styles -> variants is ON DELETE CASCADE); if any variant is referenced
// on a purchase order line, the database blocks the whole delete via
// ON DELETE RESTRICT, and we surface that as a clear 409 rather than a
// raw database error.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await pool.query(
        "DELETE FROM styles WHERE id = $1 AND store_id = $2",
        [id, req.storeId]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Style not found" });
      res.json({ ok: true });
    } catch (err) {
      if (err.code === "23503") {
        return res.status(409).json({
          error: "Can't delete this style — one of its variants appears on a purchase order. Close or remove that PO first.",
        });
      }
      throw err;
    }
  })
);

// POST /api/styles/:styleId/variants — add a variant to an existing
// style. Matches the inline "Add variant" row on the shelf card.
router.post(
  "/:styleId/variants",
  asyncHandler(async (req, res) => {
    const { styleId } = req.params;
    const { sku, size, color, stock } = req.body;
    if (!sku || !sku.trim()) return res.status(400).json({ error: "sku is required" });

    try {
      const { rows } = await pool.query(
        `INSERT INTO variants (store_id, style_id, sku, size, color, stock)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.storeId, styleId, sku.trim(), size || "", color || "", Number(stock) || 0]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "That SKU is already in use at this store" });
      throw err;
    }
  })
);

module.exports = router;
