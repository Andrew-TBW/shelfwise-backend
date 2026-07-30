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
  return resend.emails.send({ from: process.env.REPORT_FROM_EMAIL, to, subject, html });
}

module.exports = { sendEmail };
