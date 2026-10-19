// Dedicated disposable database. Never connect test mutations to emir_anki.
import pg from "pg";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
const dbName = "emir_anki_e2e";
const admin = new pg.Client({
  host: process.env.PGHOST || "/tmp",
  database: "postgres",
});
await admin.connect();
await admin.query(`CREATE DATABASE ${dbName}`); // Refuse to overwrite an existing database.
let api,
  vite,
  stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of [vite, api])
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
  await admin.query(`DROP DATABASE ${dbName}`);
  await admin.end();
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => void stop().then(() => process.exit()));
try {
  const client = new pg.Client({
    host: process.env.PGHOST || "/tmp",
    database: dbName,
  });
  await client.connect();
  await client.query(await readFile("server/schema.sql", "utf8"));
  await client.end();
  api = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "",
      PGDATABASE: dbName,
      PORT: "3011",
      APP_ORIGIN: "http://localhost:4174",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await Promise.race([
    once(api.stdout, "data"),
    once(api, "exit").then(() => {
      throw new Error("Test API failed");
    }),
  ]);
  vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4174",
      "--strictPort",
    ],
    {
      env: { ...process.env, API_TARGET: "http://127.0.0.1:3011" },
      stdio: "inherit",
    },
  );
  vite.on("exit", () => void stop());
} catch (error) {
  await stop();
  throw error;
}
