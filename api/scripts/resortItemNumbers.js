// scripts/resortItemNumbers.js
//
// One-time correction pass: re-sorts each style's ALREADY-NUMBERED
// variants into color-then-size order, WITHOUT changing which range of
// numbers belongs to that style overall — only which variant within
// that range gets which specific number.
//
// This exists because backfillItemNumbers.js (and any insert/
// reactivate) only ever assigns numbers to variants that don't have
// one yet — it was never responsible for correcting the RELATIVE
// ORDER of numbers already assigned before the sort-aware insert logic
// existed. If your store had any variants numbered before that fix
// landed, this is what actually corrects their order to match.
//
// Safe to run more than once — it's a no-op for anything already in
// the correct order, and only ever touches variants within the same
// style, never anything belonging to a different one.
//
//   node scripts/resortItemNumbers.js

require("dotenv").config();
const pool = require("../src/db");
const { compareVariantsByColorThenSize } = require("../src/itemNumbers");

async function main() {
  const { rows: stores } = await pool.query("SELECT id, name FROM stores ORDER BY name");

  for (const store of stores) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Same deferred-check approach used everywhere else in this file
      // — reassigning numbers within the same set can transiently
      // collide with itself mid-transaction even though the final
      // result is always valid, since Postgres doesn't guarantee row
      // order within a batch of updates.
      await client.query("SET CONSTRAINTS variants_item_number_unique DEFERRED");

      const { rows: styles } = await client.query(
        "SELECT id FROM styles WHERE store_id = $1 AND deactivated_at IS NULL",
        [store.id]
      );

      let resortedCount = 0;
      for (const style of styles) {
        const { rows: variants } = await client.query(
          `SELECT id, item_number, size, color FROM variants
           WHERE style_id = $1 AND deactivated_at IS NULL AND item_number IS NOT NULL
           ORDER BY item_number ASC`,
          [style.id]
        );
        if (variants.length < 2) continue; // nothing to reorder with 0 or 1 variant

        // The exact same SET of numbers this style already legitimately
        // owns — only which variant gets which one changes.
        const numbers = variants.map((v) => v.item_number);
        const sorted = [...variants].sort(compareVariantsByColorThenSize);

        const alreadyCorrect = sorted.every((v, i) => v.item_number === numbers[i]);
        if (alreadyCorrect) continue;

        for (let i = 0; i < sorted.length; i++) {
          await client.query("UPDATE variants SET item_number = $1 WHERE id = $2", [numbers[i], sorted[i].id]);
        }
        resortedCount += sorted.length;
      }

      await client.query("COMMIT");
      console.log(`${store.name}: re-sorted ${resortedCount} variant(s) across its styles.`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`${store.name}: failed —`, err.message);
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error running resortItemNumbers:", err);
  process.exit(1);
});
