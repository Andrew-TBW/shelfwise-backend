// routes/reportRecipients.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// Deliberately simple validation — just "looks like an email," not a
// full RFC-5322 parser. Good enough to catch obvious typos without
// rejecting anything a real store owner would actually type.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/report-recipients — list this store's report recipients.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, email FROM report_recipients WHERE store_id = $1 ORDER BY created_at",
      [req.storeId]
    );
    res.json(rows);
  })
);

// POST /api/report-recipients — add a recipient. Matches the Settings
// tab's "Add email" flow.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "email is required" });
    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: "That doesn't look like a valid email address" });

    try {
      const { rows } = await pool.query(
        "INSERT INTO report_recipients (store_id, email) VALUES ($1, $2) RETURNING id, email",
        [req.storeId, email]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "That email is already on the list" });
      throw err;
    }
  })
);

// DELETE /api/report-recipients/:id — remove a recipient.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      "DELETE FROM report_recipients WHERE id = $1 AND store_id = $2",
      [req.params.id, req.storeId]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Recipient not found" });
    res.json({ ok: true });
  })
);

module.exports = router;
