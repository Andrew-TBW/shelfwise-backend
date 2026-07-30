// routes/reports.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");
const { getWeeklyReportData } = require("../reportData");
const { renderWeeklyReportEmail } = require("../emailTemplates/weeklyReport");
const { sendEmail } = require("../emailSender");

const router = express.Router();

// POST /api/reports/weekly/send — sends the Weekly Report right now to
// this store's configured recipients. This is the on-demand path behind
// the "Send report now" button — the same computation and template the
// scheduled script (scripts/sendWeeklyReports.js) uses, just triggered
// manually and scoped to the current store rather than looping every one.
router.post(
  "/weekly/send",
  asyncHandler(async (req, res) => {
    const { rows: recipients } = await pool.query(
      "SELECT email FROM report_recipients WHERE store_id = $1",
      [req.storeId]
    );
    if (recipients.length === 0) {
      return res.status(400).json({ error: "No recipients configured yet — add one in Settings first." });
    }

    const storeRes = await pool.query("SELECT name FROM stores WHERE id = $1", [req.storeId]);
    const storeName = storeRes.rows[0]?.name || "Your store";

    const report = await getWeeklyReportData(req.storeId);
    const html = renderWeeklyReportEmail(storeName, report);
    const subject = `${storeName} — Weekly Report (${report.weekStartDisplay} – ${report.weekEndDisplay})`;

    const sentTo = [];
    const failed = [];
    for (const r of recipients) {
      try {
        await sendEmail({ to: r.email, subject, html });
        sentTo.push(r.email);
      } catch (err) {
        failed.push({ email: r.email, error: err.message });
      }
    }

    if (sentTo.length === 0) {
      return res.status(502).json({ error: "Failed to send to any recipient.", failed });
    }
    res.json({ sentTo, failed });
  })
);

module.exports = router;
