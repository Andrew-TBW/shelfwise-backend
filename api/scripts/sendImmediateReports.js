// scripts/sendImmediateReports.js
//
// Checks for any store whose Immediate Report batch has gone quiet
// (15 minutes since the last Voice Count or Count Sheet submission)
// and hasn't been emailed yet, sends that batch, and marks it emailed.
// Meant to run every minute via cron — see the deployment notes.
//
// Deliberately does NOT clear the batch after sending — the on-screen
// Immediate Report tab keeps showing exactly what was just emailed
// until the next submission starts a fresh cycle. Only marking it
// "emailed" is this script's job; the reset itself happens later, the
// next time addItemsToBatch runs (see immediateReportBatches.js).
//
//   node scripts/sendImmediateReports.js

require("dotenv").config();
const pool = require("../src/db");
const { findDueBatches, getCurrentBatch, markBatchEmailed } = require("../src/immediateReportBatches");
const { getImmediateReportData, formatDisplayDate, toLocalDateStr } = require("../src/reportData");
const { renderImmediateReportEmail } = require("../src/emailTemplates/weeklyReport");
const { sendEmail } = require("../src/emailSender");

async function main() {
  const dueBatches = await findDueBatches();

  if (dueBatches.length === 0) {
    // The overwhelmingly common case, given this runs every minute —
    // deliberately quiet rather than printing a line every single
    // time there's nothing to do.
    await pool.end();
    return;
  }

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const batchRow of dueBatches) {
    try {
      const { rows: recipients } = await pool.query(
        "SELECT email FROM report_recipients WHERE store_id = $1",
        [batchRow.store_id]
      );
      if (recipients.length === 0) {
        console.log(`Skipping "${batchRow.store_name}" — no recipients configured. Leaving batch unemailed in case one gets added before the next submission.`);
        skippedCount++;
        continue;
      }

      const batch = await getCurrentBatch(batchRow.store_id);
      if (!batch || batch.items.length === 0) {
        skippedCount++;
        continue;
      }

      const report = await getImmediateReportData(batchRow.store_id, batch.items);
      const html = renderImmediateReportEmail(batchRow.store_name, report);
      const subject = `${batchRow.store_name} — Immediate Report (${formatDisplayDate(toLocalDateStr(new Date()))})`;

      for (const recipient of recipients) {
        await sendEmail({ to: recipient.email, subject, html });
        console.log(`Sent "${batchRow.store_name}" immediate report to ${recipient.email}`);
        sentCount++;
      }

      await markBatchEmailed(batchRow.id);
    } catch (err) {
      console.error(`Failed to send immediate report for "${batchRow.store_name}":`, err.message);
      errorCount++;
    }
  }

  console.log(`Done. Sent: ${sentCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
  await pool.end();
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error running sendImmediateReports:", err);
  process.exit(1);
});
