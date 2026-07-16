// routes/auth.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");
const authMiddleware = require("../authMiddleware");
const { verifyPassword, hashPassword, generateSessionToken, SESSION_DURATION_MS } = require("../auth");

const router = express.Router();

// POST /api/auth/login — { email, password } -> { token, storeId, role, mustChangePassword }
// Deliberately returns the same generic error whether the email doesn't
// exist or the password is wrong — never reveal which one it was, since
// that itself is information an attacker could use.
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "email and password are required" });

    const { rows } = await pool.query(
      "SELECT id, store_id, password_hash, role, must_change_password FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    const genericError = () => res.status(401).json({ error: "Invalid email or password" });

    if (rows.length === 0) return genericError();
    const user = rows[0];

    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) return genericError();

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await pool.query(
      "INSERT INTO sessions (token, user_id, store_id, expires_at) VALUES ($1, $2, $3, $4)",
      [token, user.id, user.store_id, expiresAt]
    );

    res.json({
      token,
      storeId: user.store_id,
      role: user.role,
      mustChangePassword: user.must_change_password,
    });
  })
);

// POST /api/auth/logout — deletes the current session. Requires a valid
// token (you can only log yourself out, not guess someone else's token
// and delete it).
router.post(
  "/logout",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const header = req.header("Authorization") || "";
    const token = header.replace(/^Bearer /, "");
    await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    res.json({ ok: true });
  })
);

// POST /api/auth/change-password — { currentPassword, newPassword }
// Requires a valid session either way (first-time forced change after a
// temporary password, or a later voluntary change) — currentPassword is
// always required, since a still-valid session alone shouldn't be enough
// to silently take over an account someone left logged in.
router.post(
  "/change-password",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters" });
    }

    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.userId]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });

    const currentOk = await verifyPassword(currentPassword, rows[0].password_hash);
    if (!currentOk) return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await hashPassword(newPassword);
    await pool.query(
      "UPDATE users SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2",
      [newHash, req.userId]
    );

    // Changing a password invalidates every existing session, not just
    // "going forward" — this is exactly the scenario where someone
    // changes their password because they suspect a token was
    // compromised, so the old session(s) need to actually die, not
    // linger until their normal expiry. A fresh token is issued so the
    // device making this request doesn't get logged out by its own
    // password-change request.
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [req.userId]);

    const newToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await pool.query(
      "INSERT INTO sessions (token, user_id, store_id, expires_at) VALUES ($1, $2, $3, $4)",
      [newToken, req.userId, req.storeId, expiresAt]
    );

    res.json({ ok: true, token: newToken });
  })
);

module.exports = router;
