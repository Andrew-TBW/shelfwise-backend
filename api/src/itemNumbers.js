// itemNumbers.js
//
// Manages the stable, per-store item numbers used only by the
// count-sheet feature (spoken as "Item ___" for voice recognition) —
// never shown on the Shelf tab, Weekly Report, or anywhere else, and
// never included in the normal GET /api/styles response. See
// migrations/012_add_item_numbers.sql for the column itself.
//
// Numbers are grouped by style, AND ordered within each style to match
// the same color-then-size display order used everywhere else (see
// compareVariantsByColorThenSize below — kept identical to the
// frontend's copy of the same logic, deliberately, since these two
// need to agree on what "the right order" means). A new variant slots
// into wherever it belongs in that order, stealing that position's
// number and shifting everything from there onward (both within the
// style and beyond it) up by one — it is NOT simply appended after
// whatever was already there. Deactivating something removes its
// number and shifts everything above it down, closing the gap.
// Reactivating re-inserts via that same sort-aware placement — it does
// not get its old number back, since the sequence has likely moved on
// since it was deactivated.
//
// Every function here must be called from within a transaction, after
// calling lockStoreVariants — this store's write volume is far too low
// for the coarse-grained locking to matter in practice, but without it,
// two near-simultaneous inserts could compute the same insertion point.

const STARTING_NUMBER = 100;

// --- Kept byte-identical in spirit to the frontend's copy (ShelfWise.jsx) ---
// Recognizes a size as a standard apparel size — XS, S, M, L, XL, 2XL,
// 3XL, 4XL — matched by its leading letters so it catches both
// abbreviated ("XL") and fully spelled-out ("Extra Large") forms.
// Returns null for anything that doesn't look like apparel sizing (e.g.
// drinkware's numeric sizes like "8oz"), so callers know to fall back
// to the plain alphabetical comparison instead.
function classifyApparelSize(rawSize) {
  if (!rawSize) return null;
  const s = rawSize.trim().toLowerCase().replace(/[\s-]/g, "");
  if (!s) return null;
  if (s.startsWith("4x") || s.startsWith("xxxxl") || s.startsWith("4extralarge")) return 7;
  if (s.startsWith("3x") || s.startsWith("xxxl") || s.startsWith("3extralarge")) return 6;
  if (s.startsWith("2x") || s.startsWith("xxl") || s.startsWith("2extralarge")) return 5;
  if (s.startsWith("xs") || s.startsWith("extrasmall")) return 0;
  if (s.startsWith("xl") || s.startsWith("extralarge")) return 4;
  if (s.startsWith("s")) return 1;
  if (s.startsWith("m")) return 2;
  if (s.startsWith("l")) return 3;
  return null;
}

// Sorts by color first (alphabetically), then by size — using the
// standard apparel progression whenever the size looks like an apparel
// size, falling back to a plain alphabetical size comparison otherwise
// (drinkware's numeric sizes, or anything else).
function compareVariantsByColorThenSize(a, b) {
  const colorCompare = (a.color || "").localeCompare(b.color || "");
  if (colorCompare !== 0) return colorCompare;
  const rankA = classifyApparelSize(a.size);
  const rankB = classifyApparelSize(b.size);
  if (rankA !== null && rankB !== null) return rankA - rankB;
  return (a.size || "").localeCompare(b.size || "");
}

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
// styleId, given its own {size, color}. Finds exactly where it belongs
// among that style's EXISTING numbered variants using the same sort
// order the display uses, then steals that slot's number — shifting
// everything from that point onward (within the style, and beyond it,
// store-wide) up by one to make room. If the style has no numbered
// variants yet, this is just an append after the store's current
// highest number, same as before.
async function insertVariantNumber(client, storeId, styleId, newVariantSortKey) {
  const { rows: existing } = await client.query(
    `SELECT item_number, size, color FROM variants
     WHERE style_id = $1 AND item_number IS NOT NULL
     ORDER BY item_number ASC`,
    [styleId]
  );

  let insertAt;
  if (existing.length === 0) {
    const storeMax = await getStoreMax(client, storeId);
    insertAt = storeMax !== null ? storeMax + 1 : STARTING_NUMBER;
  } else {
    // The first existing variant that should come AFTER the new one,
    // by the same color-then-size order the display uses — that's
    // exactly where the new variant needs to slot in.
    const insertBeforeIndex = existing.findIndex(
      (v) => compareVariantsByColorThenSize(newVariantSortKey, v) < 0
    );
    if (insertBeforeIndex === -1) {
      insertAt = existing[existing.length - 1].item_number + 1; // sorts after everything existing
    } else if (insertBeforeIndex === 0) {
      insertAt = existing[0].item_number; // sorts before everything — steal the first slot
    } else {
      insertAt = existing[insertBeforeIndex - 1].item_number + 1; // slots in right after whatever precedes it
    }
  }

  await client.query(
    `UPDATE variants v SET item_number = item_number + 1
     FROM styles s WHERE v.style_id = s.id AND s.store_id = $1 AND v.item_number >= $2`,
    [storeId, insertAt]
  );

  return insertAt;
}

// For a brand-new style's initial variants — no shifting needed, since
// nothing else exists for this style yet, but the numbers assigned to
// THIS batch still need to land in color-then-size order relative to
// EACH OTHER, not just in whatever order they were typed into the
// Add Style form. `variantsInInputOrder` is an array of {size, color}
// in the original input order; returns an array of numbers, ALSO in
// that same original order, so the caller's existing zip-by-index
// logic doesn't need to change — only which number lands on which
// variant does.
async function appendNewStyleNumbers(client, storeId, variantsInInputOrder) {
  const storeMax = await getStoreMax(client, storeId);
  const start = storeMax !== null ? storeMax + 1 : STARTING_NUMBER;

  const indexed = variantsInInputOrder.map((v, originalIndex) => ({ ...v, originalIndex }));
  indexed.sort(compareVariantsByColorThenSize);

  const numberByOriginalIndex = new Array(variantsInInputOrder.length);
  indexed.forEach((v, sortedPosition) => {
    numberByOriginalIndex[v.originalIndex] = start + sortedPosition;
  });
  return numberByOriginalIndex;
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
// style is) needs a fresh number, placed via the same sort-aware
// insertion — it lost its old one when the style was deactivated.
// Anything that WAS also individually deactivated stays numberless
// until it's separately reactivated on its own. Processed in
// color-then-size order itself, so multiple variants coming back
// together land in the right relative order as they're inserted one
// at a time.
async function reclaimStyleNumbers(client, storeId, styleId) {
  const { rows } = await client.query(
    `SELECT id, size, color FROM variants WHERE style_id = $1 AND deactivated_at IS NULL AND item_number IS NULL`,
    [styleId]
  );
  rows.sort(compareVariantsByColorThenSize);
  for (const row of rows) {
    const number = await insertVariantNumber(client, storeId, styleId, { size: row.size, color: row.color });
    await client.query("UPDATE variants SET item_number = $1 WHERE id = $2", [number, row.id]);
  }
}

module.exports = {
  STARTING_NUMBER,
  classifyApparelSize,
  compareVariantsByColorThenSize,
  lockStoreVariants,
  insertVariantNumber,
  appendNewStyleNumbers,
  removeVariantNumber,
  releaseStyleNumbers,
  reclaimStyleNumbers,
};
