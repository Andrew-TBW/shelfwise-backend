// scripts/sendMonthlyReports.js
//
// Sends the Monthly Report to every store's configured recipients.
// Meant to run automatically via a cron job on the 1st of every month
// — see the deployment notes for exactly how to schedule it.
//
// Safe testing: pass --test=you@example.com to send every store's
// report to just that one address instead of the real recipient list,
// so the real Resend integration can be verified without emailing
// anyone else.
//
//   node scripts/sendMonthlyReports.js
//   node scripts/sendMonthlyReports.js --test=you@example.com

require("dotenv").config();
const pool = require("../src/db");
const { getMonthlyReportData } = require("../src/reportData");
const { renderMonthlyReportEmail } = require("../src/emailTemplates/weeklyReport");
const { sendEmail } = require("../src/emailSender");

function parseTestOverride() {
  const arg = process.argv.find((a) => a.startsWith("--test="));
  return arg ? arg.slice("--test=".length).trim() : null;
}

async function main() {
  const testOverride = parseTestOverride();
  if (testOverride) {
    console.log(`TEST MODE — sending every store's report to ${testOverride} only, not real recipients.\n`);
  }

  const { rows: stores } = await pool.query("SELECT id, name FROM stores ORDER BY name");

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const store of stores) {
    try {
      let recipients;
      if (testOverride) {
        recipients = [{ email: testOverride }];
      } else {
        const { rows } = await pool.query("SELECT email FROM report_recipients WHERE store_id = $1", [store.id]);
        recipients = rows;
      }

      if (recipients.length === 0) {
        console.log(`Skipping "${store.name}" — no recipients configured.`);
        skippedCount++;
        continue;
      }

      const report = await getMonthlyReportData(store.id);
      const html = renderMonthlyReportEmail(store.name, report);
      const subject = `${store.name} — Monthly Report (${report.rangeStartDisplay} – ${report.rangeEndDisplay})`;

      for (const recipient of recipients) {
        await sendEmail({ to: recipient.email, subject, html });
        console.log(`Sent "${store.name}" report to ${recipient.email}`);
        sentCount++;
      }
    } catch (err) {
      // One store's failure shouldn't stop the rest from sending —
      // logged and counted, not thrown, so the loop keeps going.
      console.error(`Failed to send report for "${store.name}":`, err.message);
      errorCount++;
    }
  }

  console.log(`\nDone. Sent: ${sentCount}, Skipped (no recipients): ${skippedCount}, Errors: ${errorCount}`);
  await pool.end();
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error running sendMonthlyReports:", err);
  process.exit(1);
});
