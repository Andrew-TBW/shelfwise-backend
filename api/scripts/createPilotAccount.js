// scripts/createPilotAccount.js
//
// Creates a new store + owner account directly — for manually onboarding
// a pilot store tester, since there's no self-serve signup or payment
// flow yet (deliberately deferred, per the Backend Build Plan).
//
// This is a command-line script, not an HTTP endpoint — it's meant to be
// run by someone on the ShelfWise team with direct database access, not
// exposed to the internet.
//
// Usage:
//   node scripts/createPilotAccount.js "Store Name" owner@example.com
//
// Prints a temporary password to the console. Relay that to the pilot
// store owner over a channel you already trust (phone call, text) —
// never over email or chat where it might sit around in plain text
// indefinitely. They'll be forced to set their own real password on
// first login (must_change_password defaults to true).

require("dotenv").config();
const pool = require("../src/db");
const { hashPassword, generateTemporaryPassword } = require("../src/auth");

async function main() {
  const [storeName, email] = process.argv.slice(2);
  if (!storeName || !email) {
    console.error("Usage: node scripts/createPilotAccount.js \"Store Name\" owner@example.com");
    process.exit(1);
  }

  const tempPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(tempPassword);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const storeRes = await client.query(
      "INSERT INTO stores (name) VALUES ($1) RETURNING id",
      [storeName]
    );
    const storeId = storeRes.rows[0].id;

    await client.query(
      `INSERT INTO users (store_id, email, password_hash, role, must_change_password)
       VALUES ($1, $2, $3, 'owner', true)`,
      [storeId, email.trim().toLowerCase(), passwordHash]
    );

    await client.query("COMMIT");

    console.log("Pilot account created successfully.");
    console.log("---------------------------------------");
    console.log("Store:            ", storeName);
    console.log("Store ID:         ", storeId);
    console.log("Login email:      ", email.trim().toLowerCase());
    console.log("Temporary password:", tempPassword);
    console.log("---------------------------------------");
    console.log("Relay the temporary password via phone/text, not email.");
    console.log("They will be required to set a real password on first login.");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      console.error("That email is already registered to an account.");
      process.exit(1);
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
