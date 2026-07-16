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

module.exports = router;
