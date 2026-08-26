// scripts/sendMonthlyReports.js
//
// Sends the Monthly Report to every store's configured recipients.
// Meant to run automatically via a cron job every Tuesday at 11pm,
// but only actually sends on the FIRST Tuesday of the month — see
// isFirstTuesdayOfMonth below for why it's structured this way, and
// the deployment notes for the actual crontab line.
//
// Safe testing: pass --test=you@example.com to send every store's
// report to just that one address instead of the real recipient list,
// so the real Resend integration can be verified without emailing
// anyone else. Test mode also bypasses the first-Tuesday check, so it
// can be run on any day while testing.
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

// Cron can't directly express "the first Tuesday of the month" — a
// day-of-week restriction and a day-of-month restriction combine with
// OR, not AND, so there's no single cron expression for "Tuesday AND
// within the first week." The standard workaround: schedule the cron
// entry for every Tuesday, and have the script itself only actually
// send on the first one, quietly doing nothing the other three or
// four Tuesdays each month. The first occurrence of any weekday in a
// month always falls on or before the 7th, so "is Tuesday and the
// date is 7 or earlier" is both necessary and sufficient.
function isFirstTuesdayOfMonth(date = new Date()) {
  return date.getDay() === 2 && date.getDate() <= 7;
}

async function main() {
  const testOverride = parseTestOverride();
  if (testOverride) {
    console.log(`TEST MODE — sending every store's report to ${testOverride} only, not real recipients.\n`);
  } else if (!isFirstTuesdayOfMonth()) {
    console.log(`Not the first Tuesday of the month (today is day ${new Date().getDate()}, day-of-week ${new Date().getDay()}) — skipping this run.`);
    return;
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
      const subject = `${store.name} — Monthly Report (${report.monthLabel})`;

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
