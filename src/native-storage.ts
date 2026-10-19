import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import { Preferences } from "@capacitor/preferences";
import { db } from "./db";
import { persistRemote } from "./remote";
import { hydrateSchedule } from "./domain";
import type { Flashcard, Folder, Media, Review } from "./types";

type Kind = "folders" | "cards" | "media" | "reviews";
type RecordValue = Folder | Flashcard | Media | Review;
const kinds: Kind[] = ["folders", "cards", "media", "reviews"];
let connection: SQLiteDBConnection | undefined;
let stored = new Map<string, string>();
let pending: Promise<void> = Promise.resolve();

export const isNative = Capacitor.isNativePlatform();

function base64(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function serialize(kind: Kind, value: RecordValue) {
  return JSON.stringify(
    kind === "media"
      ? { ...value, data: base64((value as Media).data) }
      : value,
  );
}

function deserialize(kind: Kind, payload: string): RecordValue {
  const value = JSON.parse(payload);
  if (kind === "media") return { ...value, data: fromBase64(value.data) };
  if (kind === "cards")
    return { ...value, schedule: hydrateSchedule(value.schedule) };
  if (kind === "reviews")
    return {
      ...value,
      before: hydrateSchedule(value.before),
      log: {
        ...value.log,
        due: new Date(value.log.due),
        review: new Date(value.log.review),
      },
    };
  return value;
}

async function snapshot() {
  return db.transaction(
    "r",
    db.folders,
    db.cards,
    db.media,
    db.reviews,
    async () => ({
      folders: await db.folders.toArray(),
      cards: await db.cards.toArray(),
      media: await db.media.toArray(),
      reviews: await db.reviews.toArray(),
    }),
  );
}

async function writeSnapshot(changedKinds: Kind[]) {
  if (!connection) throw new Error("Der iPhone-Speicher ist nicht bereit.");
  const next = new Map(stored);
  const changes: { statement: string; values: unknown[] }[] = [];
  for (const kind of changedKinds) {
    const values = await db[kind].toArray();
    const present = new Set<string>();
    for (const value of values) {
      const key = `${kind}:${value.id}`;
      present.add(key);
      const payload = serialize(kind, value);
      next.set(key, payload);
      if (stored.get(key) !== payload)
        changes.push({
          statement:
            "INSERT OR REPLACE INTO records (kind, id, payload) VALUES (?, ?, ?)",
          values: [kind, value.id, payload],
        });
    }
    for (const key of stored.keys()) {
      if (!key.startsWith(`${kind}:`) || present.has(key)) continue;
      next.delete(key);
      changes.push({
        statement: "DELETE FROM records WHERE kind = ? AND id = ?",
        values: [kind, key.slice(kind.length + 1)],
      });
    }
  }
  if (changes.length) await connection.executeSet(changes, true);
  stored = next;
}

// Every successful user action waits for this SQLite commit before reporting success.
// If iOS terminates between the Dexie commit and this commit, the Dexie copy is
// still present and is reconciled into SQLite on the next launch.
export function persistNative(changedKinds: Kind[] = kinds) {
  if (!isNative)
    return import.meta.env.MODE === "test"
      ? Promise.resolve()
      : persistRemote();
  const operation = pending
    .catch(() => undefined)
    .then(() => writeSnapshot(changedKinds));
  pending = operation;
  return operation;
}

export async function initializeNativeStorage() {
  if (!isNative) return;
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  connection = await sqlite.createConnection(
    "emir-cards",
    false,
    "no-encryption",
    1,
    false,
  );
  await connection.open();
  await connection.execute(
    "CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (kind, id));",
  );
  const rows = await connection.query("SELECT kind, id, payload FROM records");
  stored = new Map(
    (rows.values || []).map((row) => [
      `${row.kind}:${row.id}`,
      String(row.payload),
    ]),
  );
  await db.open();
  const data = await snapshot();
  const hasWebData = kinds.some((kind) => data[kind].length > 0);
  if (!hasWebData && stored.size) {
    const restored: Record<Kind, RecordValue[]> = {
      folders: [],
      cards: [],
      media: [],
      reviews: [],
    };
    for (const [key, payload] of stored) {
      const kind = key.slice(0, key.indexOf(":")) as Kind;
      if (!kinds.includes(kind))
        throw new Error(
          "Die iPhone-Datenbank enthält einen unbekannten Datentyp.",
        );
      restored[kind].push(deserialize(kind, payload));
    }
    await db.transaction(
      "rw",
      db.folders,
      db.cards,
      db.media,
      db.reviews,
      async () => {
        await db.folders.bulkPut(restored.folders as Folder[]);
        await db.cards.bulkPut(restored.cards as Flashcard[]);
        await db.media.bulkPut(restored.media as Media[]);
        await db.reviews.bulkPut(restored.reviews as Review[]);
      },
    );
  }
  // An existing IndexedDB collection is imported without removing or rewriting it.
  await persistNative();
  const theme = await Preferences.get({ key: "emir-theme" });
  if (theme.value === "dark" || theme.value === "light")
    document.documentElement.dataset.theme = theme.value;
}

export async function saveNativeTheme(theme: string) {
  if (isNative) await Preferences.set({ key: "emir-theme", value: theme });
}

export async function saveNativeExportDate(value: string) {
  if (isNative) await Preferences.set({ key: "emir-last-export", value });
}
