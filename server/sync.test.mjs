import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import pg from "pg";
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";

const database = `emir_sync_test_${process.pid}`;
const admin = new pg.Client({
  host: process.env.PGHOST || "/tmp",
  database: "postgres",
});
let pool, server;
const origin = "http://127.0.0.1:5173",
  base = "http://127.0.0.1:3012";
let cookie, user;
async function request(path, body, session = cookie, headers = {}) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(session ? { Cookie: session } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}
const folder = (name = "Anatomie", parentId = null) => ({
  id: randomUUID(),
  parentId,
  name,
  color: "sage",
  createdAt: Date.now(),
});
const card = (folderId) => ({
  id: randomUUID(),
  folderId,
  front: "Frage",
  back: "Antwort",
  frontImages: [],
  backImages: [],
  schedule: JSON.parse(JSON.stringify(createEmptyCard())),
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
const change = (kind, value, baseVersion = 0) => ({
  kind,
  id: value.id,
  value,
  baseVersion,
});
const batch = (changes = [], cursor = 0) => ({
  batchId: randomUUID(),
  cursor,
  changes,
});
const version = (result, kind, id) =>
  result.changes.find((c) => c.kind === kind && c.id === id).version;
async function sync(changes = [], cursor = 0, session = cookie) {
  const r = await request("/api/sync", batch(changes, cursor), session);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  pool = new pg.Pool({ host: process.env.PGHOST || "/tmp", database });
  await pool.query(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "",
      PGDATABASE: database,
      PORT: "3012",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => {
      throw new Error("Testserver konnte nicht starten");
    }),
  ]);
  const r = await request(
    "/api/auth/register",
    { username: "sync_test", password: "only-test-password" },
    null,
  );
  assert.equal(r.status, 201);
  cookie = r.cookie;
  user = r.body;
});
after(async () => {
  if (server && !server.killed) {
    server.kill();
    await once(server, "exit");
  }
  await pool?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${database}`);
  await admin.end();
});

test("Anmeldung, Session-Cookie, Herkunftsprüfung und Trennung der Konten", async () => {
  const login = await request(
    "/api/auth/login",
    { username: "SYNC_TEST", password: "only-test-password" },
    null,
  );
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(
    (
      await request(
        "/api/auth/login",
        { username: "sync_test", password: "wrong" },
        null,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/sync", batch(), cookie, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await request("/api/sync", batch(), null)).status, 401);
  assert.equal(
    (
      await request("/api/sync", batch(), cookie, {
        "X-Account-ID": randomUUID(),
      })
    ).status,
    401,
  );
  const other = await request(
    "/api/auth/register",
    { username: "other_test", password: "only-test-password" },
    null,
  );
  const f = folder();
  await sync([change("folders", f)]);
  assert.equal((await sync([], 0, other.cookie)).changes.length, 0);
  const foreignCard = card(f.id);
  assert.equal(
    (
      await request(
        "/api/sync",
        batch([change("cards", foreignCard)]),
        other.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("/api/auth/logout", {}, other.cookie)).status,
    204,
  );
  assert.equal(
    (await request("/api/auth/me", undefined, other.cookie)).status,
    401,
  );
});

test("Delta, Lernfortschritt, idempotente Wiederholung und echte Konflikte", async () => {
  const f = folder(),
    c = card(f.id);
  const first = await sync([change("folders", f), change("cards", c)]);
  assert.equal((await sync([], first.cursor)).changes.length, 0);
  const reviewed = fsrs().repeat(createEmptyCard(), new Date())[Rating.Good];
  const review = {
    id: randomUUID(),
    cardId: c.id,
    log: JSON.parse(JSON.stringify(reviewed.log)),
    before: c.schedule,
    createdAt: Date.now(),
  };
  const updated = {
    ...c,
    schedule: JSON.parse(JSON.stringify(reviewed.card)),
    front: "Vom Laptop",
  };
  const sent = batch(
    [
      change("cards", updated, version(first, "cards", c.id)),
      change("reviews", review),
    ],
    first.cursor,
  );
  const pushed = await request("/api/sync", sent);
  assert.equal(pushed.status, 200, JSON.stringify(pushed.body));
  const repeated = await request("/api/sync", sent);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.cursor, pushed.body.cursor);
  assert.equal(
    (await pool.query("SELECT count(*) FROM reviews WHERE id=$1", [review.id]))
      .rows[0].count,
    "1",
  );
  const conflict = await request(
    "/api/sync",
    batch(
      [
        change(
          "cards",
          { ...c, front: "Vom Handy" },
          version(first, "cards", c.id),
        ),
      ],
      first.cursor,
    ),
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.conflicts[0].value.front, "Vom Laptop");
  const delta = await sync([], first.cursor);
  assert.equal(delta.changes.length, 2);
});

test("Verschobener Unterordner behält unveränderte Karten beim Löschen des alten Elternordners", async () => {
  const f = folder(),
    child = folder("Unterordner", f.id),
    c = card(child.id);
  const initial = await sync([
    change("folders", f),
    change("folders", child),
    change("cards", c),
  ]);
  const result = await sync(
    [
      {
        kind: "folders",
        id: f.id,
        value: null,
        baseVersion: version(initial, "folders", f.id),
      },
      change(
        "folders",
        { ...child, parentId: null },
        version(initial, "folders", child.id),
      ),
    ],
    initial.cursor,
  );
  assert.equal(
    (await pool.query("SELECT count(*) FROM cards WHERE id=$1", [c.id])).rows[0]
      .count,
    "1",
  );
  assert.equal(result.changes.find((x) => x.id === f.id).value, null);
});

test("Veraltetes Löschen darf neue Karten eines anderen Geräts nicht entfernen", async () => {
  const f = folder();
  const initial = await sync([change("folders", f)]);
  const c = card(f.id);
  const newer = await sync([change("cards", c)], initial.cursor);
  const deletion = {
    kind: "folders",
    id: f.id,
    value: null,
    baseVersion: version(initial, "folders", f.id),
  };
  const conflict = await request(
    "/api/sync",
    batch([deletion], initial.cursor),
  );
  assert.equal(conflict.status, 409);
  assert.ok(conflict.body.conflicts.some((x) => x.id === c.id));
  const deleted = await sync([deletion], newer.cursor);
  assert.equal(deleted.changes.find((x) => x.id === c.id).value, null);
  // Another device also deleted the already removed folder: successful no-op.
  await sync([deletion], newer.cursor);
});

test("Ungültige Struktur und fremde Felder werden atomar abgelehnt", async () => {
  const f = folder();
  f.parentId = f.id;
  assert.equal(
    (await request("/api/sync", batch([change("folders", f)]))).status,
    400,
  );
  assert.equal(
    (await pool.query("SELECT count(*) FROM folders WHERE id=$1", [f.id]))
      .rows[0].count,
    "0",
  );
  const invalid = card(null);
  invalid.schedule.state = 99;
  assert.equal(
    (await request("/api/sync", batch([change("cards", invalid)]))).status,
    400,
  );
  const owned = { ...folder(), user_id: randomUUID() };
  assert.equal(
    (await request("/api/sync", batch([change("folders", owned)]))).status,
    400,
  );
});

test("Registrierungsversuche sind begrenzt", async () => {
  for (let i = 0; i < 8; i++)
    await request(
      "/api/auth/register",
      { username: "!", password: "short" },
      null,
    );
  const result = await request(
    "/api/auth/register",
    { username: "rate_test", password: "only-test-password" },
    null,
  );
  assert.equal(result.status, 429);
  assert.equal(result.headers.get("retry-after"), "900");
});

test("Bilder bleiben erhalten, wenn eine neue Karte auf einem anderen Gerät sie noch verwendet", async () => {
  const media = {
    id: randomUUID(),
    name: "test.png",
    type: "image/png",
    data: (await readFile("public/icon-192.png")).toString("base64"),
  };
  const c = card(null);
  c.frontImages = [media.id];
  const initial = await sync([change("media", media), change("cards", c)]);
  const another = card(null);
  another.frontImages = [media.id];
  await sync([change("cards", another)], initial.cursor);
  const result = await request(
    "/api/sync",
    batch(
      [
        {
          kind: "cards",
          id: c.id,
          value: null,
          baseVersion: version(initial, "cards", c.id),
        },
        {
          kind: "media",
          id: media.id,
          value: null,
          baseVersion: version(initial, "media", media.id),
        },
      ],
      initial.cursor,
    ),
  );
  assert.equal(result.status, 409);
  assert.ok(result.body.conflicts.some((c) => c.id === another.id));
  assert.equal(
    (await pool.query("SELECT count(*) FROM media WHERE id=$1", [media.id]))
      .rows[0].count,
    "1",
  );
});

test("Synchronisiert große und tiefe Sammlungen ohne Anzahl- oder Tiefenlimit", async () => {
  const roots = Array.from({ length: 12 }, (_, i) =>
    folder(`Großes Fach ${i}`),
  );
  const children = Array.from({ length: 12 }, (_, i) =>
    folder(`Thema ${i}`, roots[0].id),
  );
  const nested = [];
  let parent = children[0];
  for (let level = 3; level <= 8; level++) {
    parent = folder(`Ebene ${level}`, parent.id);
    nested.push(parent);
  }
  const cards = Array.from({ length: 1501 }, () => card(parent.id));
  const initial = await sync([
    ...[...roots, ...children, ...nested].map((f) => change("folders", f)),
    ...cards.map((c) => change("cards", c)),
  ]);
  assert.equal(
    initial.changes.filter(
      (c) => c.kind === "cards" && c.value?.folderId === parent.id,
    ).length,
    1501,
  );
  const extra = card(parent.id);
  const updated = await sync([change("cards", extra)], initial.cursor);
  assert.ok(
    updated.changes.some(
      (c) => c.id === extra.id && c.value?.folderId === parent.id,
    ),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM cards WHERE user_id=$1 AND folder_id=$2",
        [user.id, parent.id],
      )
    ).rows[0].count,
    "1502",
  );
});
