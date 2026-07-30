// app.js
const express = require("express");
const cors = require("cors");
const authMiddleware = require("./authMiddleware");

const authRouter = require("./routes/auth");
const storeRouter = require("./routes/store");
const vendorsRouter = require("./routes/vendors");
const stylesRouter = require("./routes/styles");
const variantsRouter = require("./routes/variants");
const purchaseOrdersRouter = require("./routes/purchaseOrders");
const reportRecipientsRouter = require("./routes/reportRecipients");
const reportsRouter = require("./routes/reports");

const app = express();

app.use(cors());
app.use(express.json());

// Health check — deliberately placed before authMiddleware, since it
// shouldn't require a login to answer "is the server up."
app.get("/health", (req, res) => res.json({ ok: true }));

// Login/logout/change-password don't require a token to reach them (you
// don't have one yet when logging in) — authMiddleware is applied inside
// routes/auth.js only to the routes that need an existing session
// (logout, change-password), not to login itself.
app.use("/api/auth", authRouter);

app.use(authMiddleware); // Real authentication — replaces Phase 2's temporary X-Store-Id header.

app.use("/api/store", storeRouter);
app.use("/api/vendors", vendorsRouter);
app.use("/api/styles", stylesRouter);
app.use("/api/variants", variantsRouter);
app.use("/api/purchase-orders", purchaseOrdersRouter);
app.use("/api/report-recipients", reportRecipientsRouter);
app.use("/api/reports", reportsRouter);

// Central error handler. Translates well-known Postgres error codes into
// clean, specific API responses instead of a generic 500 wherever
// possible; anything unrecognized still becomes a 500 rather than
// leaking a raw database error to the client.
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });

  if (err.code === "23505") return res.status(409).json({ error: "That value is already in use" });
  if (err.code === "23514") return res.status(400).json({ error: "That value violates a data rule (e.g. negative stock, invalid date range)" });
  if (err.code === "23503") return res.status(409).json({ error: "That action would break a reference to another record" });

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;

