// itemNumbers.js
//
// Manages the stable, per-store item numbers used only by the
// count-sheet feature (spoken as "Item ___" for voice recognition) —
// never shown on the Shelf tab, Weekly Report, or anywhere else, and
// never included in the normal GET /api/styles response. See
// migrations/012_add_item_numbers.sql for the column itself.
//
// Numbers are grouped by style: adding a variant to an existing style
// inserts it right after that style's current numbers, shifting
// everything after up by one. A brand-new style's initial variants are
// just appended after the store's current highest number. Deactivating
// something removes its number and shifts everything above it down,
// closing the gap. Reactivating re-inserts via the same "new variant"
// logic — it does not get its old number back, since the sequence has
// likely moved on since it was deactivated.
//
// Every function here must be called from within a transaction, after
// calling lockStoreVariants — this store's write volume is far too low
// for the coarse-grained locking to matter in practice, but without it,
// two near-simultaneous inserts could compute the same insertion point.

const STARTING_NUMBER = 100;

async function lockStoreVariants(client, storeId) {
  // Explicit, even though INITIALLY DEFERRED already defaults to this —
  // makes the expectation unambiguous right where every item-number
  // transaction begins, rather than relying on a constraint definition
  // elsewhere being remembered correctly.
  await client.query("SET CONSTRAINTS variants_item_number_unique DEFERRED");
  await client.query(
    `SELECT v.id FROM variants v JOIN styles s ON s.id = v.style_id
     WHERE s.store_id = $1 FOR UPDATE OF v`,
    [storeId]
  );
}

async function getStoreMax(client, storeId) {
  const res = await client.query(
    `SELECT MAX(v.item_number) AS max FROM variants v JOIN styles s ON s.id = v.style_id
     WHERE s.store_id = $1`,
    [storeId]
  );
  return res.rows[0].max;
}

// Returns the item_number to assign to ONE new variant being added to
// styleId (whether that style already has numbered variants or not),
// shifting everything from that point onward up by one to make room.
async function insertVariantNumber(client, storeId, styleId) {
  const styleMaxRes = await client.query(
    `SELECT MAX(item_number) AS max FROM variants WHERE style_id = $1 AND item_number IS NOT NULL`,
    [styleId]
  );
  const styleMax = styleMaxRes.rows[0].max;

  let insertAt;
  if (styleMax !== null) {
    insertAt = styleMax + 1;
  } else {
    const storeMax = await getStoreMax(client, storeId);
    insertAt = storeMax !== null ? storeMax + 1 : STARTING_NUMBER;
  }

  await client.query(
    `UPDATE variants v SET item_number = item_number + 1
     FROM styles s WHERE v.style_id = s.id AND s.store_id = $1 AND v.item_number >= $2`,
    [storeId, insertAt]
  );

  return insertAt;
}

// For a brand-new style's initial variants — no shifting needed, just
// `count` sequential numbers appended after the store's current highest.
async function appendNewStyleNumbers(client, storeId, count) {
  const storeMax = await getStoreMax(client, storeId);
  const start = storeMax !== null ? storeMax + 1 : STARTING_NUMBER;
  return Array.from({ length: count }, (_, i) => start + i);
}

// Removes ONE occupied number from the sequence, shifting everything
// above it down by one to close the gap. No-op if itemNumber is null
// (nothing to remove — already outside the active sequence).
async function removeVariantNumber(client, storeId, itemNumber) {
  if (itemNumber === null || itemNumber === undefined) return;
  await client.query(
    `UPDATE variants v SET item_number = item_number - 1
     FROM styles s WHERE v.style_id = s.id AND s.store_id = $1 AND v.item_number > $2`,
    [storeId, itemNumber]
  );
}

// Called when a whole style is deactivated. Removes the number from
// every one of its currently-numbered variants — processed in
// DESCENDING order, one removal at a time, which is what makes
// repeated single-slot removals correctly close every gap without
// needing a more complex bulk-shift calculation.
async function releaseStyleNumbers(client, storeId, styleId) {
  const { rows } = await client.query(
    `SELECT id, item_number FROM variants
     WHERE style_id = $1 AND deactivated_at IS NULL AND item_number IS NOT NULL
     ORDER BY item_number DESC`,
    [styleId]
  );
  for (const row of rows) {
    // Clear this row's own number FIRST — otherwise the shift below
    // briefly collides with the slot this same row is still occupying,
    // even though the final state would have been valid either way.
    await client.query("UPDATE variants SET item_number = NULL WHERE id = $1", [row.id]);
    await removeVariantNumber(client, storeId, row.item_number);
  }
}

// Called when a whole style is reactivated. Any variant that was never
// individually deactivated (so it's coming back purely because its
// style is) needs a fresh number — it lost its old one when the style
// was deactivated. Anything that WAS also individually deactivated
// stays numberless until it's separately reactivated on its own.
async function reclaimStyleNumbers(client, storeId, styleId) {
  const { rows } = await client.query(
    `SELECT id FROM variants WHERE style_id = $1 AND deactivated_at IS NULL AND item_number IS NULL ORDER BY sku`,
    [styleId]
  );
  for (const row of rows) {
    const number = await insertVariantNumber(client, storeId, styleId);
    await client.query("UPDATE variants SET item_number = $1 WHERE id = $2", [number, row.id]);
  }
}

module.exports = {
  STARTING_NUMBER,
  lockStoreVariants,
  insertVariantNumber,
  appendNewStyleNumbers,
  removeVariantNumber,
  releaseStyleNumbers,
  reclaimStyleNumbers,
};
