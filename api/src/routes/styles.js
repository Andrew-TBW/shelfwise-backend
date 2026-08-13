// routes/styles.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");
const { getEnrichedStyles } = require("../enrichedStyles");
const itemNumbers = require("../itemNumbers");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === "true";
    const styles = await getEnrichedStyles(req.storeId, { includeInactive });
    res.json(styles);
  })
);

// POST /api/styles — create a style plus its initial variants in one
// transaction, matching AddStyleModal's "Add to shelf" action.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, category, vendorId, leadTimeDays, targetDays, marginTier, movementTier, variants } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
    if (!vendorId) return res.status(400).json({ error: "vendorId is required" });
    if (!Array.isArray(variants) || variants.length === 0) {
      return res.status(400).json({ error: "at least one variant is required" });
    }
    if (marginTier !== undefined && marginTier !== null && !["high", "mid", "low"].includes(marginTier)) {
      return res.status(400).json({ error: "marginTier must be high, mid, low, or omitted" });
    }
    if (movementTier !== undefined && movementTier !== null && !["fast", "slow"].includes(movementTier)) {
      return res.status(400).json({ error: "movementTier must be fast, slow, or omitted" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await itemNumbers.lockStoreVariants(client, req.storeId);

      const styleRes = await client.query(
        `INSERT INTO styles (store_id, vendor_id, name, category, lead_time_days, target_days, margin_tier, movement_tier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [req.storeId, vendorId, name.trim(), category || "", Number(leadTimeDays) || 7, Number(targetDays) || 14, marginTier || null, movementTier || null]
      );
      const styleId = styleRes.rows[0].id;

      const assignedNumbers = await itemNumbers.appendNewStyleNumbers(
        client,
        req.storeId,
        variants.map((v) => ({ size: v.size || "", color: v.color || "" }))
      );

      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (!v.sku || !v.sku.trim()) throw Object.assign(new Error("Every variant needs a SKU"), { status: 400 });
        await client.query(
          `INSERT INTO variants (store_id, style_id, sku, size, color, stock, item_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.storeId, styleId, v.sku.trim(), v.size || "", v.color || "", Number(v.stock) || 0, assignedNumbers[i]]
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
// vendor, lead time, target days, margin tier, movement tier). Matches
// EditStyleModal's "Save changes".
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (req.body.marginTier !== undefined && req.body.marginTier !== null && !["high", "mid", "low"].includes(req.body.marginTier)) {
      return res.status(400).json({ error: "marginTier must be high, mid, low, or null" });
    }
    if (req.body.movementTier !== undefined && req.body.movementTier !== null && !["fast", "slow"].includes(req.body.movementTier)) {
      return res.status(400).json({ error: "movementTier must be fast, slow, or null" });
    }
    const fields = [];
    const values = [];
    let i = 1;

    const map = {
      name: "name",
      category: "category",
      vendorId: "vendor_id",
      leadTimeDays: "lead_time_days",
      targetDays: "target_days",
      marginTier: "margin_tier",
      movementTier: "movement_tier",
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

// DELETE /api/styles/:id — deactivates the style.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await itemNumbers.lockStoreVariants(client, req.storeId);

      const { rowCount } = await client.query(
        "UPDATE styles SET deactivated_at = now() WHERE id = $1 AND store_id = $2 AND deactivated_at IS NULL",
        [id, req.storeId]
      );
      if (rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Style not found, or already inactive" });
      }

      await itemNumbers.releaseStyleNumbers(client, req.storeId, id);

      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// POST /api/styles/:id/reactivate — brings a deactivated style back.
router.post(
  "/:id/reactivate",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await itemNumbers.lockStoreVariants(client, req.storeId);

      const { rowCount } = await client.query(
        "UPDATE styles SET deactivated_at = NULL WHERE id = $1 AND store_id = $2 AND deactivated_at IS NOT NULL",
        [id, req.storeId]
      );
      if (rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Style not found, or already active" });
      }

      await itemNumbers.reclaimStyleNumbers(client, req.storeId, id);

      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// POST /api/styles/:styleId/variants — add a variant to an existing style.
router.post(
  "/:styleId/variants",
  asyncHandler(async (req, res) => {
    const { styleId } = req.params;
    const { sku, size, color, stock } = req.body;
    if (!sku || !sku.trim()) return res.status(400).json({ error: "sku is required" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await itemNumbers.lockStoreVariants(client, req.storeId);

      const styleRes = await client.query(
        "SELECT deactivated_at FROM styles WHERE id = $1 AND store_id = $2",
        [styleId, req.storeId]
      );
      if (styleRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Style not found" });
      }
      if (styleRes.rows[0].deactivated_at) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This style is inactive — reactivate it before adding new variants." });
      }

      const itemNumber = await itemNumbers.insertVariantNumber(client, req.storeId, styleId, {
        size: size || "",
        color: color || "",
      });

      const { rows } = await client.query(
        `INSERT INTO variants (store_id, style_id, sku, size, color, stock, item_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.storeId, styleId, sku.trim(), size || "", color || "", Number(stock) || 0, itemNumber]
      );

      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23505") return res.status(409).json({ error: "That SKU is already in use at this store" });
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
