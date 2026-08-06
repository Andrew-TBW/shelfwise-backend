// scripts/backfillItemNumbers.js
//
// One-time script: assigns item numbers to every currently-active
// variant that existed before the item-number feature was built.
// Grouped by style (in style creation order), then sorted by
// color-then-size WITHIN each style — matching exactly how a brand-new
// store's variants get numbered going forward, just applied
// retroactively to what's already there.
//
// Safe to run more than once — any variant that already has a number
// is left untouched; only variants with item_number IS NULL (and whose
// style is active) get assigned one. If you need to fix the ORDER of
// variants that already have numbers (e.g. anything numbered before
// this script's sort-aware fix existed), use resortItemNumbers.js
// instead — that's a separate, one-time correction pass.
//
//   node scripts/backfillItemNumbers.js

require("dotenv").config();
const pool = require("../src/db");
const itemNumbers = require("../src/itemNumbers");

async function main() {
  const { rows: stores } = await pool.query("SELECT id, name FROM stores ORDER BY name");

  for (const store of stores) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await itemNumbers.lockStoreVariants(client, store.id);

      const { rows: styles } = await client.query(
        "SELECT id FROM styles WHERE store_id = $1 AND deactivated_at IS NULL ORDER BY created_at",
        [store.id]
      );

      let assignedCount = 0;
      for (const style of styles) {
        const { rows: variants } = await client.query(
          "SELECT id, size, color FROM variants WHERE style_id = $1 AND deactivated_at IS NULL AND item_number IS NULL",
          [style.id]
        );
        // Sorted before inserting, same as reclaimStyleNumbers — so
        // multiple variants being backfilled together land in the
        // right relative order as they're inserted one at a time.
        variants.sort(itemNumbers.compareVariantsByColorThenSize);
        for (const variant of variants) {
          const number = await itemNumbers.insertVariantNumber(client, store.id, style.id, {
            size: variant.size,
            color: variant.color,
          });
          await client.query("UPDATE variants SET item_number = $1 WHERE id = $2", [number, variant.id]);
          assignedCount++;
        }
      }

      await client.query("COMMIT");
      console.log(`${store.name}: assigned item numbers to ${assignedCount} variant(s).`);
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
  console.error("Fatal error running backfillItemNumbers:", err);
  process.exit(1);
});
