import pg from "pg";
import { mkdir, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
if (!process.env.DATABASE_URL || !process.env.BACKUP_DIR)
  throw new Error("DATABASE_URL und BACKUP_DIR sind erforderlich.");
process.umask(0o077);
const params = new pg.Client({ connectionString: process.env.DATABASE_URL })
  .connectionParameters;
// Pass credentials via the environment, never as command-line arguments.
const env = {
  ...process.env,
  PGHOST: params.host,
  PGPORT: String(params.port),
  PGUSER: params.user,
  PGDATABASE: params.database,
  PGPASSWORD: params.password || "",
};
delete env.DATABASE_URL;
const url = new URL(process.env.DATABASE_URL);
for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"])
  if (url.searchParams.has(key))
    env[`PG${key.toUpperCase()}`] = url.searchParams.get(key);
async function command(name, args, quiet = false) {
  await new Promise((resolve, reject) => {
    const child = spawn(name, args, {
      env,
      stdio: ["ignore", quiet ? "ignore" : "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${name} fehlgeschlagen (${code}).`)),
    );
  });
}
await mkdir(process.env.BACKUP_DIR, { recursive: true, mode: 0o700 });
const file = join(
  process.env.BACKUP_DIR,
  `emir-cards-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.dump`,
);
try {
  await command("pg_dump", [
    "--format=custom",
    "--no-owner",
    `--file=${file}.partial`,
  ]);
  await command("pg_restore", ["--list", `${file}.partial`], true);
  await rename(`${file}.partial`, file);
  console.log(`Backup erstellt: ${file}`);
} finally {
  await rm(`${file}.partial`, { force: true });
}
