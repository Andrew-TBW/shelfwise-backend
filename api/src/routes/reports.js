// routes/reports.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");
const { getWeeklyReportData, getMonthlyReportData, getImmediateReportData, getMovementReportData, formatDisplayDate, toLocalDateStr } = require("../reportData");
const { renderWeeklyReportEmail, renderMonthlyReportEmail, renderImmediateReportEmail, renderMovementReportEmail } = require("../emailTemplates/weeklyReport");
const { sendEmail } = require("../emailSender");
const { addItemsToBatch, getCurrentBatch, markBatchEmailed } = require("../immediateReportBatches");

const router = express.Router();

async function sendReportNow(req, res, { getReport, renderEmail, subjectLabel, onSuccess }) {
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
  if (onSuccess) await onSuccess();
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
      subjectLabel: (r) => `Monthly Report (${r.monthLabel})`,
    });
  })
);

// GET /api/reports/immediate-report — the current accumulating (or
// already-emailed, still-displaying) batch for this store. What the
// on-screen Immediate Report tab reads, so it always shows exactly
// what the automatic email is about to send, or already sent.
router.get(
  "/immediate-report",
  asyncHandler(async (req, res) => {
    const batch = await getCurrentBatch(req.storeId);
    res.json(batch || { items: [], lastActivityAt: null, emailedAt: null });
  })
);

// POST /api/reports/immediate-report/add-items — called by Voice Count
// and Count Sheet submissions specifically (see logVoiceCounts on the
// frontend), and only those two — never by anything on the Products
// screen. Adds to the store's current batch, or starts a fresh one if
// the existing batch has already been emailed.
router.post(
  "/immediate-report/add-items",
  asyncHandler(async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    await addItemsToBatch(req.storeId, items);
    res.json({ ok: true });
  })
);

router.post(
  "/immediate/send",
  asyncHandler(async (req, res) => {
    const batch = await getCurrentBatch(req.storeId);
    if (!batch || batch.items.length === 0) {
      return res.status(400).json({ error: "Nothing to report — count something first." });
    }
    await sendReportNow(req, res, {
      getReport: () => getImmediateReportData(req.storeId, batch.items),
      renderEmail: renderImmediateReportEmail,
      subjectLabel: () => `Immediate Report (${formatDisplayDate(toLocalDateStr(new Date()))})`,
      // Marking this only on a successful send — matching the
      // scheduled script's own behavior — is what makes the NEXT
      // submission correctly reset instead of continuing to add onto
      // a report that already went out, whether that send happened
      // automatically or was triggered manually here.
      onSuccess: async () => {
        const raw = await pool.query("SELECT id FROM immediate_report_batches WHERE store_id = $1", [req.storeId]);
        if (raw.rows[0]) await markBatchEmailed(raw.rows[0].id);
      },
    });
  })
);

router.post(
  "/movement/:tier/send",
  asyncHandler(async (req, res) => {
    const { tier } = req.params;
    if (!["fast", "slow"].includes(tier)) {
      return res.status(400).json({ error: "tier must be 'fast' or 'slow'" });
    }
    await sendReportNow(req, res, {
      getReport: () => getMovementReportData(req.storeId, tier),
      renderEmail: renderMovementReportEmail,
      subjectLabel: (r) => `${r.reportLabel} (${r.rangeStartDisplay} – ${r.rangeEndDisplay})`,
    });
  })
);

module.exports = router;
