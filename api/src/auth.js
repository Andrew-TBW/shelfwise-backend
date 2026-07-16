// auth.js — shared helpers used by the auth routes and the auth middleware.
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const BCRYPT_ROUNDS = 12;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — reasonable for a
// small pilot of trusted testers; revisit once this handles real customers
// at real scale (shorter-lived tokens + refresh is the standard next step).

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

async function verifyPassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

// A long, cryptographically random session token — not a JWT. See the
// comment in migrations/009_create_sessions.sql for why a stored session
// row was chosen over a self-contained signed token at this stage.
function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

// A temporary password for pilot accounts created directly by us — never
// the customer's real, long-term password. Random and human-typeable
// (avoids ambiguous characters like 0/O, 1/l/I) since it needs to be
// read aloud or texted to a pilot store owner, not just pasted.
function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  generateTemporaryPassword,
  SESSION_DURATION_MS,
};
