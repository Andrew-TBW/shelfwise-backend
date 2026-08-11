// routes/reports.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");
const { getWeeklyReportData, getMonthlyReportData, getImmediateReportData } = require("../reportData");
const { renderWeeklyReportEmail, renderMonthlyReportEmail, renderImmediateReportEmail } = require("../emailTemplates/weeklyReport");
const { sendEmail } = require("../emailSender");

const router = express.Router();

async function sendReportNow(req, res, { getReport, renderEmail, subjectLabel }) {
  const { rows: recipients } = await pool.query(
    "SELECT email FROM report_recipients WHERE store_id = $1",
    [req.storeId]
  );
  if (recipients.length === 0) {
    return res.status(400).json({ error: "No recipients configured yet — add one in Settings first." });
  }

  const storeRes = await pool.query("SELECT name FROM stores WHERE id = $1", [req.storeId]);
  const storeName = storeRes.rows[0]?.name || "Your store";

  const report = await getReport();
  const html = renderEmail(storeName, report);
  const subject = `${storeName} — ${subjectLabel(report)}`;

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
}

router.post(
  "/weekly/send",
  asyncHandler(async (req, res) => {
    await sendReportNow(req, res, {
      getReport: () => getWeeklyReportData(req.storeId),
      renderEmail: renderWeeklyReportEmail,
      subjectLabel: (r) => `Weekly Report (${r.weekStartDisplay} – ${r.weekEndDisplay})`,
    });
  })
);

router.post(
  "/monthly/send",
  asyncHandler(async (req, res) => {
    await sendReportNow(req, res, {
      getReport: () => getMonthlyReportData(req.storeId),
      renderEmail: renderMonthlyReportEmail,
      subjectLabel: (r) => `Monthly Report (${r.rangeStartDisplay} – ${r.rangeEndDisplay})`,
    });
  })
);

router.post(
  "/immediate/send",
  asyncHandler(async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ error: "Nothing to report — count something first." });
    }
    await sendReportNow(req, res, {
      getReport: () => getImmediateReportData(req.storeId, items),
      renderEmail: renderImmediateReportEmail,
      subjectLabel: () => "Immediate Report",
    });
  })
);

module.exports = router;
