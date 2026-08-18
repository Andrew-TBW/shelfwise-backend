// emailSender.js
//
// Thin wrapper around Resend's API. The API key and "from" address live
// only in .env on the server — never in git, same discipline already
// used for the database credentials.
const { Resend } = require("resend");

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set — add it to .env before sending real email.");
  }
  if (!process.env.REPORT_FROM_EMAIL) {
    throw new Error("REPORT_FROM_EMAIL is not set — add it to .env before sending real email.");
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({ from: process.env.REPORT_FROM_EMAIL, to, subject, html });
  // The Resend SDK doesn't reject the promise for an API-level failure
  // (a bad key, a rate limit, a rejected recipient, etc.) — it resolves
  // normally with { data: null, error: {...} } and just logs to
  // stderr on its own. Left unchecked, every caller of this function
  // — both the scheduled scripts and the "Send report now" buttons —
  // would treat that as a successful send. Checking here and throwing
  // a real error is what makes their existing try/catch logic (and
  // the sent/failed counts they report) actually trustworthy.
  if (result?.error) {
    throw new Error(result.error.message || "Resend rejected this email.");
  }
  return result;
}

module.exports = { sendEmail };
