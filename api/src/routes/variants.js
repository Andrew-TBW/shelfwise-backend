// routes/variants.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// PATCH /api/variants/:id — edit size/color/sku. Matches EditVariantModal.
// Deliberately does not touch stock or sales history — those only ever
// change through the endpoints below, so there's always an auditable
// event (a sale, an adjustment, a PO receipt) behind a stock change.
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of ["sku", "size", "color"]) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${i++}`);
        values.push(req.body[key]);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: "No updatable fields provided" });

    fields.push("updated_at = now()");
    values.push(id, req.storeId);

    try {
      const { rowCount } = await pool.query(
        `UPDATE variants SET ${fields.join(", ")} WHERE id = $${i++} AND store_id = $${i}`,
        values
      );
      if (rowCount === 0) return res.status(404).json({ error: "Variant not found" });
      res.json({ ok: true });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "That SKU is already in use at this store" });
      throw err;
    }
  })
);

// DELETE /api/variants/:id — matches "Remove variant" (edit mode + confirm).
// Blocked with a clear 409 if the variant appears on any purchase order
// line, same reasoning as deleting a style.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await pool.query(
        "DELETE FROM variants WHERE id = $1 AND store_id = $2",
        [id, req.storeId]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Variant not found" });
      res.json({ ok: true });
    } catch (err) {
      if (err.code === "23503") {
        return res.status(409).json({
          error: "Can't delete this variant — it appears on a purchase order. Close or remove that PO first.",
        });
      }
      throw err;
    }
  })
);

// POST /api/variants/:id/sales — log a sale over a period. Matches
// LogSaleModal: records the sales_entry and decrements stock (floored at
// zero) in one transaction, exactly like the frontend's logSale callback.
//
// `source` defaults to 'manual' but accepts 'voice' — used by the voice
// stock count feature, whose confirmed counts get logged through this
// same endpoint rather than a separate one, since the underlying action
// (record a sales period, adjust stock) is identical either way.
router.post(
  "/:id/sales",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { startDate, endDate, units, source } = req.body;
    const finalSource = source === "voice" ? "voice" : "manual";

    if (!startDate || !endDate) return res.status(400).json({ error: "startDate and endDate are required" });
    if (!(Number(units) >= 0)) return res.status(400).json({ error: "units must be 0 or greater" });
    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: "endDate must be on or after startDate" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const variantRes = await client.query(
        "SELECT stock FROM variants WHERE id = $1 AND store_id = $2 FOR UPDATE",
        [id, req.storeId]
      );
      if (variantRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Variant not found" });
      }

      // Same overlap check as the correction endpoint below — a brand-new
      // entry needs this just as much as an edited one. There's no
      // existing entry to exclude here (unlike the PATCH case), since
      // this is always a fresh insert.
      const overlapRes = await client.query(
        `SELECT id, start_date, end_date, units FROM sales_entries
         WHERE variant_id = $1 AND store_id = $2
           AND start_date <= $4 AND $3 <= end_date`,
        [id, req.storeId, startDate, endDate]
      );
      if (overlapRes.rows.length > 0) {
        await client.query("ROLLBACK");
        const c = overlapRes.rows[0];
        return res.status(409).json({
          error: `Overlaps with an existing period (${toDateStr(c.start_date)} → ${toDateStr(c.end_date)}, ${c.units} units). Adjust the dates, or correct that entry instead via Sales History.`,
        });
      }

      const currentStock = Number(variantRes.rows[0].stock);
      const newStock = Math.max(0, currentStock - Number(units));

      await client.query(
        `INSERT INTO sales_entries (store_id, variant_id, start_date, end_date, units, source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.storeId, id, startDate, endDate, Number(units), finalSource]
      );
      await client.query("UPDATE variants SET stock = $1, updated_at = now() WHERE id = $2", [newStock, id]);

      await client.query("COMMIT");
      res.status(201).json({ newStock });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// PATCH /api/variants/:variantId/sales/:salesEntryId — correct a
// previously logged sale. Matches SalesEntryEditRow's "Save correction."
//
// Two things this does that the frontend's own client-side check
// doesn't guarantee on its own:
//   1. Re-validates the new date range doesn't overlap any of the
//      variant's OTHER sales entries, server-side — the frontend already
//      checks this against whatever data it has loaded, but only the
//      server can guarantee it against the true current state.
//   2. Reconciles stock by the *change* in units (delta), not by
//      re-deriving it from scratch — e.g. correcting a logged sale from
//      5 units to 3 adds 2 units back to stock, exactly mirroring the
//      frontend's original updateSaleEntry logic.
router.patch(
  "/:variantId/sales/:salesEntryId",
  asyncHandler(async (req, res) => {
    const { variantId, salesEntryId } = req.params;
    const { startDate, endDate, units } = req.body;

    if (!startDate || !endDate) return res.status(400).json({ error: "startDate and endDate are required" });
    if (!(Number(units) >= 0)) return res.status(400).json({ error: "units must be 0 or greater" });
    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: "endDate must be on or after startDate" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const variantRes = await client.query(
        "SELECT stock FROM variants WHERE id = $1 AND store_id = $2 FOR UPDATE",
        [variantId, req.storeId]
      );
      if (variantRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Variant not found" });
      }

      const entryRes = await client.query(
        "SELECT * FROM sales_entries WHERE id = $1 AND variant_id = $2 AND store_id = $3 FOR UPDATE",
        [salesEntryId, variantId, req.storeId]
      );
      if (entryRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Sales entry not found" });
      }
      const oldEntry = entryRes.rows[0];

      // Overlap check: any other entry (excluding this one) whose range
      // shares a day with the new range is a conflict — a shared day
      // would double-count toward both periods' rate calculations.
      const overlapRes = await client.query(
        `SELECT id, start_date, end_date, units FROM sales_entries
         WHERE variant_id = $1 AND store_id = $2 AND id != $3
           AND start_date <= $5 AND $4 <= end_date`,
        [variantId, req.storeId, salesEntryId, startDate, endDate]
      );
      if (overlapRes.rows.length > 0) {
        await client.query("ROLLBACK");
        const c = overlapRes.rows[0];
        return res.status(409).json({
          error: `Overlaps with an existing period (${toDateStr(c.start_date)} → ${toDateStr(c.end_date)}, ${c.units} units). Adjust the dates so periods don't overlap.`,
        });
      }

      const newUnits = Number(units);
      const delta = newUnits - Number(oldEntry.units);
      const currentStock = Number(variantRes.rows[0].stock);
      const newStock = Math.max(0, currentStock - delta);

      await client.query(
        "UPDATE sales_entries SET start_date = $1, end_date = $2, units = $3 WHERE id = $4",
        [startDate, endDate, newUnits, salesEntryId]
      );
      await client.query("UPDATE variants SET stock = $1, updated_at = now() WHERE id = $2", [newStock, variantId]);

      await client.query("COMMIT");
      res.json({ newStock });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// POST /api/variants/:id/adjust-stock — manual stock correction/receipt
// outside a PO. Matches AdjustStockModal's "Add to stock".
router.post(
  "/:id/adjust-stock",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { units } = req.body;
    if (!(Number(units) > 0)) return res.status(400).json({ error: "units must be greater than 0" });

    const { rows, rowCount } = await pool.query(
      `UPDATE variants SET stock = stock + $1, updated_at = now()
       WHERE id = $2 AND store_id = $3 RETURNING stock`,
      [Number(units), id, req.storeId]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Variant not found" });
    res.json({ newStock: rows[0].stock });
  })
);

function toDateStr(v) {
  if (!v) return v;
  return typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10);
}

module.exports = router;
