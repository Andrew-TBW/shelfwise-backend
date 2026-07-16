// routes/purchaseOrders.js
const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// GET /api/purchase-orders — every PO for this store, with its lines
// and enough style/variant info to render "Style Name — Variant Label"
// without a second round trip per line.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const posRes = await pool.query(
      "SELECT * FROM purchase_orders WHERE store_id = $1 ORDER BY created_at DESC",
      [req.storeId]
    );
    const pos = posRes.rows;
    if (pos.length === 0) return res.json([]);

    const poIds = pos.map((po) => po.id);
    const linesRes = await pool.query(
      `SELECT pol.*, s.name AS style_name, v.sku, v.size, v.color
       FROM purchase_order_lines pol
       JOIN styles s ON s.id = pol.style_id
       JOIN variants v ON v.id = pol.variant_id
       WHERE pol.purchase_order_id = ANY($1)`,
      [poIds]
    );
    const linesByPO = {};
    for (const line of linesRes.rows) {
      (linesByPO[line.purchase_order_id] ||= []).push(line);
    }
    res.json(pos.map((po) => ({ ...po, lines: linesByPO[po.id] || [] })));
  })
);

// POST /api/purchase-orders — create a draft PO with lines. Matches
// CreatePOModal's "Save as draft" (whether prefilled from recommended
// reorders or built manually).
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { vendorId, lines, notes } = req.body;
    if (!vendorId) return res.status(400).json({ error: "vendorId is required" });
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: "At least one line is required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const poRes = await client.query(
        `INSERT INTO purchase_orders (store_id, vendor_id, status, notes)
         VALUES ($1, $2, 'draft', $3) RETURNING id`,
        [req.storeId, vendorId, notes || ""]
      );
      const poId = poRes.rows[0].id;

      for (const line of lines) {
        if (!(Number(line.qty) > 0)) throw Object.assign(new Error("Each line needs a quantity > 0"), { status: 400 });
        await client.query(
          `INSERT INTO purchase_order_lines (store_id, purchase_order_id, style_id, variant_id, qty_ordered, qty_received)
           VALUES ($1, $2, $3, $4, $5, 0)`,
          [req.storeId, poId, line.styleId, line.variantId, Number(line.qty)]
        );
      }

      await client.query("COMMIT");
      res.status(201).json({ id: poId });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// POST /api/purchase-orders/:id/submit — draft -> submitted. From this
// moment on, the PO's lines count as "incoming" in the reorder math.
router.post(
  "/:id/submit",
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE purchase_orders SET status = 'submitted', updated_at = now()
       WHERE id = $1 AND store_id = $2 AND status = 'draft'`,
      [req.params.id, req.storeId]
    );
    if (rowCount === 0) {
      return res.status(409).json({ error: "PO not found, or not in draft status" });
    }
    res.json({ status: "submitted" });
  })
);

// DELETE /api/purchase-orders/:id — only allowed while still a draft,
// matching the frontend's deletePO guard.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      "DELETE FROM purchase_orders WHERE id = $1 AND store_id = $2 AND status = 'draft'",
      [req.params.id, req.storeId]
    );
    if (rowCount === 0) {
      return res.status(409).json({ error: "PO not found, or not in draft status" });
    }
    res.json({ ok: true });
  })
);

// POST /api/purchase-orders/:id/close — available once received or
// partially_received; the store decided not to expect the rest.
router.post(
  "/:id/close",
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE purchase_orders SET status = 'closed', updated_at = now()
       WHERE id = $1 AND store_id = $2 AND status IN ('received', 'partially_received')`,
      [req.params.id, req.storeId]
    );
    if (rowCount === 0) {
      return res.status(409).json({ error: "PO not found, or not in a receivable/closable status" });
    }
    res.json({ status: "closed" });
  })
);

// POST /api/purchase-orders/:id/receive — apply a shipment. Body:
// { lines: { [lineId]: qtyReceivedNow } }. This is a direct port of the
// frontend's receiveAgainstPO: each line's received-now amount is capped
// at what's actually still remaining on that line, stock is incremented
// per line, and the PO's overall status is recomputed from the result —
// never trusting the client's idea of "how much is left."
router.post(
  "/:id/receive",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const receivedMap = req.body.lines || {};

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const poRes = await client.query(
        "SELECT * FROM purchase_orders WHERE id = $1 AND store_id = $2 FOR UPDATE",
        [id, req.storeId]
      );
      if (poRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "PO not found" });
      }
      const po = poRes.rows[0];
      if (!["submitted", "partially_received"].includes(po.status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `Cannot receive against a PO with status '${po.status}'` });
      }

      const linesRes = await client.query(
        "SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 FOR UPDATE",
        [id]
      );

      let allFull = true;
      let anyReceived = false;

      for (const line of linesRes.rows) {
        const requested = Math.max(0, Number(receivedMap[line.id] || 0));
        const remaining = line.qty_ordered - line.qty_received;
        const cappedNow = Math.min(requested, remaining);

        if (cappedNow > 0) {
          await client.query(
            "UPDATE purchase_order_lines SET qty_received = qty_received + $1 WHERE id = $2",
            [cappedNow, line.id]
          );
          await client.query(
            "UPDATE variants SET stock = stock + $1, updated_at = now() WHERE id = $2",
            [cappedNow, line.variant_id]
          );
          anyReceived = true;
        }
        const newQtyReceived = line.qty_received + cappedNow;
        if (newQtyReceived < line.qty_ordered) allFull = false;
      }

      const newStatus = allFull ? "received" : anyReceived ? "partially_received" : po.status;
      await client.query(
        "UPDATE purchase_orders SET status = $1, updated_at = now() WHERE id = $2",
        [newStatus, id]
      );

      await client.query("COMMIT");
      res.json({ status: newStatus });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
