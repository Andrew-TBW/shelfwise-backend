// routes/logs.js
//
// The new Logs screen — a store-wide, chronological view of every
// stock-changing count that's been submitted (via Voice Count, Count
// Sheet, or the manual Log Sale flow), letting an owner review or
// correct a past mistake. Deliberately framed around "what was
// counted" (resulting_stock), never "units sold" — the inferred sales
// number this app calculates internally is the wrong thing to show
// here and would only confuse what this screen is for.

const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// GET /api/logs — every log across the whole store, most recent
// submission first. Deliberately store-wide, not scoped to one
// variant like Sales History — this is the "look across everything
// that's been counted" view.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT se.id, se.variant_id, se.batch_id, se.start_date, se.end_date, se.units, se.resulting_stock, se.source, se.created_at,
              v.sku, v.size, v.color, s.id AS style_id, s.name AS style_name
       FROM sales_entries se
       JOIN variants v ON v.id = se.variant_id
       JOIN styles s ON s.id = v.style_id
       WHERE se.store_id = $1
       ORDER BY se.created_at DESC`,
      [req.storeId]
    );

    // Combine every row sharing a batch_id into one logical entry —
    // a single Voice Count or Count Sheet session covering several
    // products becomes one item in the list, not one row per product.
    // Anything without a batch_id (a standalone Log Sale submission,
    // or something logged before this column existed) stays its own
    // single-item group. A Map keyed by batch_id finds the right
    // group regardless of row order, rather than assuming same-batch
    // rows land adjacent to each other in the sort.
    const groups = [];
    const groupIndexByBatchId = new Map();
    for (const row of rows) {
      if (row.batch_id && groupIndexByBatchId.has(row.batch_id)) {
        groups[groupIndexByBatchId.get(row.batch_id)].items.push(row);
        continue;
      }
      const group = { batchId: row.batch_id, submittedAt: row.created_at, items: [row] };
      if (row.batch_id) groupIndexByBatchId.set(row.batch_id, groups.length);
      groups.push(group);
    }

    res.json(
      groups.map((g) => ({
        batchId: g.batchId,
        submittedAt: g.submittedAt,
        items: g.items.map((row) => ({
          id: row.id,
          variantId: row.variant_id,
          styleId: row.style_id,
          styleName: row.style_name,
          sku: row.sku,
          size: row.size,
          color: row.color,
          startDate: row.start_date,
          endDate: row.end_date,
          resultingStock: row.resulting_stock,
          source: row.source,
        })),
      }))
    );
  })
);

// PATCH /api/logs/:id — correct "what was counted" for one specific
// log entry. Editing this one value can ripple in two directions:
//   1. THIS entry's own units (sold between the PREVIOUS count and
//      this one) shifts, since it's derived from (previous count -
//      this count).
//   2. The NEXT entry's own units (sold between this count and the
//      next one) also shifts, for the same reason in the other
//      direction.
// If this is the most recent entry for the variant, there is no next
// entry to adjust — the variant's live stock updates directly
// instead, since that's what's actually reflected on the Products
// screen.
router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { resultingStock } = req.body;

    if (!Number.isInteger(Number(resultingStock)) || Number(resultingStock) < 0) {
      return res.status(400).json({ error: "resultingStock must be a whole number, 0 or greater" });
    }
    const newResultingStock = Number(resultingStock);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const entryRes = await client.query(
        "SELECT * FROM sales_entries WHERE id = $1 AND store_id = $2 FOR UPDATE",
        [id, req.storeId]
      );
      if (entryRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Log entry not found" });
      }
      const entry = entryRes.rows[0];

      if (entry.resulting_stock === null) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "This entry was logged before this screen existed, so what was originally counted isn't recoverable — it can't be corrected here.",
        });
      }

      // The immediately-previous and immediately-next entries for THIS
      // variant, by submission time — the only two entries whose own
      // units calculation depends on this one's resulting_stock.
      // Excluding this entry's own id explicitly, rather than relying
      // on the timestamp comparison alone to do it — created_at came
      // back from Postgres as a JS Date object above, which only has
      // millisecond precision versus Postgres's own microsecond
      // TIMESTAMPTZ, so comparing the round-tripped value against the
      // column it came from can silently match the same row.
      const prevRes = await client.query(
        `SELECT id, resulting_stock FROM sales_entries
         WHERE variant_id = $1 AND store_id = $2 AND id != $3 AND created_at <= $4
         ORDER BY created_at DESC LIMIT 1`,
        [entry.variant_id, req.storeId, id, entry.created_at]
      );
      const nextRes = await client.query(
        `SELECT id, resulting_stock FROM sales_entries
         WHERE variant_id = $1 AND store_id = $2 AND id != $3 AND created_at >= $4
         ORDER BY created_at ASC LIMIT 1`,
        [entry.variant_id, req.storeId, id, entry.created_at]
      );
      const prevEntry = prevRes.rows[0] || null;
      const nextEntry = nextRes.rows[0] || null;

      // This entry's own units: how much sold between the previous
      // count and this one. Only recomputable if the previous entry's
      // own resulting_stock is known — otherwise left exactly as it
      // was, since there's nothing reliable to derive a new value from.
      let newUnitsForThisEntry = entry.units;
      if (prevEntry && prevEntry.resulting_stock !== null) {
        newUnitsForThisEntry = prevEntry.resulting_stock - newResultingStock;
        if (newUnitsForThisEntry < 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: `That count is higher than the ${prevEntry.resulting_stock} on record from the count right before it. Stock can't increase between two counts without a purchase order or manual adjustment logged in between.`,
          });
        }
      }

      // The next entry's own units: how much sold between this count
      // and the next one — shifts because this count just changed,
      // even though the next entry itself wasn't touched.
      let newUnitsForNextEntry = null;
      if (nextEntry && nextEntry.resulting_stock !== null) {
        newUnitsForNextEntry = newResultingStock - nextEntry.resulting_stock;
        if (newUnitsForNextEntry < 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: `That count is lower than the ${nextEntry.resulting_stock} recorded on the count right after it. Stock can't decrease from there to a higher number without a purchase order or manual adjustment logged in between.`,
          });
        }
      }

      await client.query(
        "UPDATE sales_entries SET resulting_stock = $1, units = $2 WHERE id = $3",
        [newResultingStock, newUnitsForThisEntry, id]
      );

      if (nextEntry) {
        if (newUnitsForNextEntry !== null) {
          await client.query("UPDATE sales_entries SET units = $1 WHERE id = $2", [newUnitsForNextEntry, nextEntry.id]);
        }
      } else {
        // No later entry exists — this IS the most recent count for
        // this variant, so the variant's live, current stock updates
        // directly, matching what the Products screen actually shows.
        await client.query("UPDATE variants SET stock = $1, updated_at = now() WHERE id = $2", [newResultingStock, entry.variant_id]);
      }

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

module.exports = router;
