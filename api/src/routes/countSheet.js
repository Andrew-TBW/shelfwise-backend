// routes/countSheet.js
//
// The ONLY place item_number is ever exposed through the API — the
// normal GET /api/styles deliberately strips it out (see
// enrichedStyles.js). This endpoint powers the count-sheet screen:
// pick a filter (all / one category / one vendor), get back every
// matching active variant's stable number plus enough info to identify
// it on a printed sheet.
//
// Sorting by item_number naturally groups the results by style too,
// since numbers are assigned in contiguous per-style blocks — no
// separate ORDER BY style is needed to get that grouping for free.
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { category, vendorId } = req.query;

    const conditions = [
      "v.store_id = $1",
      "v.deactivated_at IS NULL",
      "s.deactivated_at IS NULL",
      "v.item_number IS NOT NULL",
    ];
    const values = [req.storeId];

    if (category) {
      values.push(category);
      conditions.push(`s.category = $${values.length}`);
    }
    if (vendorId) {
      values.push(vendorId);
      conditions.push(`s.vendor_id = $${values.length}`);
    }

    const { rows } = await pool.query(
      `SELECT v.item_number, v.sku, v.size, v.color, s.name AS style_name, s.category, ven.name AS vendor_name
       FROM variants v
       JOIN styles s ON s.id = v.style_id
       JOIN vendors ven ON ven.id = s.vendor_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY v.item_number ASC`,
      values
    );

    res.json(
      rows.map((r) => ({
        itemNumber: r.item_number,
        styleName: r.style_name,
        size: r.size,
        color: r.color,
        sku: r.sku,
        category: r.category,
        vendorName: r.vendor_name,
      }))
    );
  })
);

module.exports = router;
