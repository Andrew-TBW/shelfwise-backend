// routes/store.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// GET /api/store — the current session's own store { id, name }. Used by
// StoreHeader to show a real name instead of a hardcoded placeholder.
// Kept as its own small endpoint (rather than folding the name into the
// login response only) so a store rename is reflected on next refresh
// without requiring everyone to log out and back in.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT id, name FROM stores WHERE id = $1", [req.storeId]);
    if (rows.length === 0) return res.status(404).json({ error: "Store not found" });
    res.json(rows[0]);
  })
);

// PATCH /api/store — rename the current store. Matches the Settings
// tab's store name field (only editable while edit mode is on).
router.patch(
  "/",
  asyncHandler(async (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });

    const { rowCount } = await pool.query(
      "UPDATE stores SET name = $1, updated_at = now() WHERE id = $2",
      [name, req.storeId]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Store not found" });
    res.json({ ok: true });
  })
);

module.exports = router;
