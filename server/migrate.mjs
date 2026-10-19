import pg from "pg";
import { readFile } from "node:fs/promises";
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DATABASE_URL ? undefined : process.env.PGHOST || "/tmp",
  database: process.env.DATABASE_URL
    ? undefined
    : process.env.PGDATABASE || "emir_anki",
});
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(174692810)");
  await client.query(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  await client.query("COMMIT");
  console.log("Datenbankschema aktualisiert.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Migration fehlgeschlagen:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
