// immediateReportBatches.js
//
// Backs the Immediate Report's "accumulate for 15 quiet minutes, then
// email, then keep displaying until the next submission" behavior.
// Used by both the API routes (so Voice Count / Count Sheet
// submissions and the on-screen tab share the same persisted state)
// and the scheduled script that actually sends the email once a batch
// has gone quiet.

const pool = require("./db");

const QUIET_MINUTES = 15;

// Adds (or updates) items in a store's current batch. If the existing
// batch has already been emailed, this is the moment it resets — the
// old batch and its items are discarded entirely and a fresh one
// starts here, rather than tacking new items onto an already-sent
// report. If the existing batch hasn't been emailed yet, items are
// merged into it and its clock restarts, exactly like re-triggering a
// 15-minute countdown. A variant already in the batch has its
// sold/days values updated in place, not duplicated — matching how
// recounting the same item within one submission already worked.
async function addItemsToBatch(storeId, items) {
  if (!items || items.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT id, emailed_at FROM immediate_report_batches WHERE store_id = $1 FOR UPDATE",
      [storeId]
    );

    let batchId;
    if (existing.rows.length > 0 && existing.rows[0].emailed_at !== null) {
      // Already emailed — this submission starts a new cycle. Deleting
      // the batch row cascades to its items automatically.
      await client.query("DELETE FROM immediate_report_batches WHERE id = $1", [existing.rows[0].id]);
      const created = await client.query(
        "INSERT INTO immediate_report_batches (store_id) VALUES ($1) RETURNING id",
        [storeId]
      );
      batchId = created.rows[0].id;
    } else if (existing.rows.length > 0) {
      // Still accumulating — same batch, just extend its clock below.
      batchId = existing.rows[0].id;
    } else {
      // No batch yet at all for this store.
      const created = await client.query(
        "INSERT INTO immediate_report_batches (store_id) VALUES ($1) RETURNING id",
        [storeId]
      );
      batchId = created.rows[0].id;
    }

    for (const item of items) {
      await client.query(
        `INSERT INTO immediate_report_batch_items (batch_id, variant_id, sold, days)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (batch_id, variant_id) DO UPDATE SET sold = EXCLUDED.sold, days = EXCLUDED.days`,
        [batchId, item.variantId, item.sold, item.days]
      );
    }

    await client.query(
      "UPDATE immediate_report_batches SET last_activity_at = now() WHERE id = $1",
      [batchId]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Returns the store's current batch — whatever's accumulated so far,
// whether or not it's been emailed yet — or null if nothing has been
// submitted since the last reset. This is what the on-screen Immediate
// Report tab reads, so it always reflects exactly what the automatic
// email is about to send (or already sent, while still displaying it).
async function getCurrentBatch(storeId) {
  const batchRes = await pool.query(
    "SELECT id, last_activity_at, emailed_at FROM immediate_report_batches WHERE store_id = $1",
    [storeId]
  );
  if (batchRes.rows.length === 0) return null;

  const batch = batchRes.rows[0];
  const itemsRes = await pool.query(
    "SELECT variant_id, sold, days FROM immediate_report_batch_items WHERE batch_id = $1",
    [batch.id]
  );

  return {
    lastActivityAt: batch.last_activity_at,
    emailedAt: batch.emailed_at,
    items: itemsRes.rows.map((r) => ({ variantId: r.variant_id, sold: r.sold, days: r.days })),
  };
}

// For the scheduled script: every store whose batch is still
// unemailed and has gone quiet for QUIET_MINUTES or more. Deliberately
// keyed off "hasn't been emailed yet", not off elapsed time alone — if
// the script were ever down for a stretch, a still-pending batch keeps
// accumulating normally on the next submission rather than being
// treated as overdue for a reset it never actually got emailed for.
async function findDueBatches() {
  const { rows } = await pool.query(
    `SELECT b.id, b.store_id, s.name AS store_name
     FROM immediate_report_batches b
     JOIN stores s ON s.id = b.store_id
     WHERE b.emailed_at IS NULL
       AND b.last_activity_at <= now() - INTERVAL '${QUIET_MINUTES} minutes'`
  );
  return rows;
}

async function markBatchEmailed(batchId) {
  await pool.query("UPDATE immediate_report_batches SET emailed_at = now() WHERE id = $1", [batchId]);
}

module.exports = { addItemsToBatch, getCurrentBatch, findDueBatches, markBatchEmailed, QUIET_MINUTES };
