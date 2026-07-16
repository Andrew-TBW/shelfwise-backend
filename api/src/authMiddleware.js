// authMiddleware.js
//
// Replaces storeContext.js from Phase 2. Every request now needs a real,
// verified session token — read from a standard
// `Authorization: Bearer <token>` header — rather than a self-declared
// X-Store-Id header that anyone could set to anything.
//
// This is exactly the swap the Phase 2 comments promised: route handlers
// downstream are completely unchanged, since they only ever read
// req.storeId — they never knew or cared how it got set.

const pool = require("./db");

async function authMiddleware(req, res, next) {
  const header = req.header("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const token = match[1];

  const { rows } = await pool.query(
    `SELECT s.store_id, s.user_id, s.expires_at, u.role, u.must_change_password
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token]
  );

  if (rows.length === 0) {
    return res.status(401).json({ error: "Invalid session" });
  }

  const session = rows[0];
  if (new Date(session.expires_at) < new Date()) {
    // Don't leave expired sessions lying around indefinitely.
    await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    return res.status(401).json({ error: "Session expired, please log in again" });
  }

  req.storeId = session.store_id;
  req.userId = session.user_id;
  req.userRole = session.role;
  req.mustChangePassword = session.must_change_password;
  next();
}

module.exports = authMiddleware;
