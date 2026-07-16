// routes/vendors.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// GET /api/vendors — list vendors for the current store.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, name FROM vendors WHERE store_id = $1 ORDER BY name",
      [req.storeId]
    );
    res.json(rows);
  })
);

// POST /api/vendors — create a vendor. Matches AddStyleModal/CreatePOModal's
// "+ New vendor" inline flow in the frontend.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });

    const { rows } = await pool.query(
      "INSERT INTO vendors (store_id, name) VALUES ($1, $2) RETURNING id, name",
      [req.storeId, name]
    );
    res.status(201).json(rows[0]);
  })
);

module.exports = router;
