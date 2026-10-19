import { db, selectAccountDatabase } from "./db";
import type { Flashcard, Media, Review } from "./types";
export interface Account {
  id: string;
  username: string;
}
type Kind = "folders" | "cards" | "media" | "reviews";
const kinds: Kind[] = ["folders", "cards", "media", "reviews"];
type Wire = Record<string, any>;
interface RemoteChange {
  kind: Kind;
  id: string;
  version: number;
  value: Wire | null;
}
interface Base {
  version: number;
  hash: string | null;
}
interface Change {
  kind: Kind;
  id: string;
  baseVersion: number;
  value: Wire | null;
}
interface Flight {
  batch: { batchId: string; cursor: number; changes: Change[] };
  expected: Record<string, string>;
}
interface SyncView {
  busy: boolean;
  pending: number;
  available: boolean;
  offline: boolean;
  error: string;
  lastSynced?: number;
  conflicts: RemoteChange[];
}
let state: SyncView = {
  busy: false,
  pending: 0,
  available: false,
  offline: false,
  error: "",
  conflicts: [],
};
const listeners = new Set<() => void>();
export const subscribeSync = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const getSyncState = () => state;
function update(value: Partial<SyncView>) {
  state = { ...state, ...value };
  listeners.forEach((fn) => fn());
}
let active: Account | null = null;
let running: Promise<void> | undefined;
const accountKey = "emir-last-account";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public conflicts?: RemoteChange[],
  ) {
    super(message);
  }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(url.startsWith("/api/sync") && active
        ? { "X-Account-ID": active.id }
        : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.error || `Serverfehler (${response.status})`,
      response.status,
      body.conflicts,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const currentAccount = () => request<Account>("/api/auth/me");
export const signIn = (username: string, password: string) =>
  request<Account>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
export const signUp = (username: string, password: string) =>
  request<Account>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
export const signOut = () =>
  request<void>("/api/auth/logout", { method: "POST", body: "{}" });
export function cachedAccount(): Account | null {
  try {
    const user = JSON.parse(localStorage.getItem(accountKey) || "null");
    return user?.id && user?.username ? user : null;
  } catch {
    return null;
  }
}
function encode(data: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function decode(data: string) {
  const binary = atob(data);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
}
function wire(kind: Kind, value: any): Wire {
  return JSON.parse(
    JSON.stringify(
      kind === "media" ? { ...value, data: encode(value.data) } : value,
    ),
  );
}
function hydrate(kind: Kind, value: Wire): any {
  const schedule = (s: any) => ({
    ...s,
    due: new Date(s.due),
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  });
  if (kind === "media") return { ...value, data: decode(value.data) } as Media;
  if (kind === "cards")
    return { ...value, schedule: schedule(value.schedule) } as Flashcard;
  if (kind === "reviews")
    return {
      ...value,
      before: schedule(value.before),
      log: {
        ...value.log,
        due: new Date(value.log.due),
        review: new Date(value.log.review),
      },
    } as Review;
  return value;
}
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",") +
    "}"
  );
}
async function fingerprint(value: Wire | null) {
  if (value === null) return null;
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function meta<T>(id: string, fallback: T): Promise<T> {
  return (await db.syncState.get(id))?.value ?? fallback;
}
async function capture() {
  const records: Record<string, Wire> = {};
  let base: Record<string, Base> = {},
    cursor = 0;
  await db.transaction(
    "r",
    db.folders,
    db.cards,
    db.media,
    db.reviews,
    db.syncState,
    async () => {
      base = await meta("base", {});
      cursor = await meta("cursor", 0);
      for (const kind of kinds)
        for (const row of await db[kind].toArray())
          records[`${kind}:${row.id}`] = wire(kind, row);
    },
  );
  const hashes: Record<string, string> = {};
  for (const [key, value] of Object.entries(records))
    hashes[key] = (await fingerprint(value))!;
  const changes: Change[] = [];
  for (const key of new Set([...Object.keys(records), ...Object.keys(base)])) {
    if ((hashes[key] ?? null) === (base[key]?.hash ?? null)) continue;
    const [kind, id] = key.split(":") as [Kind, string];
    changes.push({
      kind,
      id,
      baseVersion: base[key]?.version ?? 0,
      value: records[key] ?? null,
    });
  }
  return { records, hashes, changes, cursor, base };
}
export async function refreshPending() {
  if (!active) return;
  const snapshot = await capture();
  update({
    pending: snapshot.changes.length,
    conflicts: await meta("conflicts", []),
    lastSynced: await meta("lastSynced", undefined),
  });
}
export async function initializeRemote(account: Account, offline = false) {
  active = account;
  await selectAccountDatabase(account.id);
  localStorage.setItem(accountKey, JSON.stringify(account));
  update({
    busy: false,
    pending: 0,
    available: false,
    offline,
    error: "",
    conflicts: [],
  });
  if (!(await meta("initialized", false))) {
    if (offline)
      throw new Error(
        "Dieses Konto hat auf diesem Gerät noch keine lokale Sammlung. Bitte einmal online anmelden.",
      );
    await synchronize();
  } else {
    await refreshPending();
    if (!offline) void checkRemote();
  }
}
export async function canSignOut() {
  await refreshPending();
  return (
    !state.busy &&
    state.pending === 0 &&
    !(await meta("inflight", null)) &&
    state.conflicts.length === 0
  );
}
export async function releaseRemote() {
  if (running) await running;
  active = null;
  localStorage.removeItem(accountKey);
  db.close();
  update({ pending: 0, conflicts: [], error: "", available: false });
}
export async function checkRemote() {
  if (!active || state.busy) return;
  try {
    const remote = await request<{ cursor: number }>("/api/sync/status");
    update({
      available: remote.cursor > (await meta("cursor", 0)),
      offline: false,
    });
    await refreshPending();
  } catch (error) {
    update({
      offline: !(error instanceof ApiError) || error.status >= 500,
      ...(error instanceof ApiError && error.status === 401
        ? {
            error:
              "Bitte erneut anmelden, um zu synchronisieren. Lokale Änderungen bleiben gespeichert.",
          }
        : {}),
    });
  }
}
async function applyResponse(
  response: { cursor: number; changes: RemoteChange[] },
  flight: Flight,
) {
  const before = await capture();
  const remoteHashes = new Map<string, string | null>();
  for (const c of response.changes)
    remoteHashes.set(`${c.kind}:${c.id}`, await fingerprint(c.value));
  await db.transaction(
    "rw",
    db.folders,
    db.cards,
    db.media,
    db.reviews,
    db.syncState,
    async () => {
      const base = await meta<Record<string, Base>>("base", {});
      const conflicts: RemoteChange[] = [];
      // Keep whole deleted branches if another tab created/edited a descendant
      // while this request was in flight. The conflict choice includes the branch.
      const currentFolders = await db.folders.toArray();
      const currentCards = await db.cards.toArray();
      const currentReviews = await db.reviews.toArray();
      const protectedKeys = new Set<string>();
      for (const deletion of response.changes.filter(
        (c) => !c.value && ["folders", "cards"].includes(c.kind),
      )) {
        const folders = new Set(
          deletion.kind === "folders" ? [deletion.id] : [],
        );
        for (let more = true; more;) {
          more = false;
          for (const f of currentFolders)
            if (f.parentId && folders.has(f.parentId) && !folders.has(f.id)) {
              folders.add(f.id);
              more = true;
            }
        }
        const cards = new Set(
          deletion.kind === "cards"
            ? [deletion.id]
            : currentCards
                .filter((c) => c.folderId && folders.has(c.folderId))
                .map((c) => c.id),
        );
        const related = [
          ...currentFolders
            .filter((f) => folders.has(f.id))
            .map((v) => ({ kind: "folders" as Kind, v })),
          ...currentCards
            .filter((c) => cards.has(c.id))
            .map((v) => ({ kind: "cards" as Kind, v })),
          ...currentReviews
            .filter((r) => cards.has(r.cardId))
            .map((v) => ({ kind: "reviews" as Kind, v })),
        ];
        if (
          related.some(
            ({ kind, v }) =>
              canonical(wire(kind, v)) !==
                canonical(before.records[`${kind}:${v.id}`] ?? null) ||
              (before.hashes[`${kind}:${v.id}`] ?? null) !==
                (flight.expected[`${kind}:${v.id}`] ?? null),
          )
        ) {
          protectedKeys.add(`${deletion.kind}:${deletion.id}`);
          for (const { kind, v } of related)
            protectedKeys.add(`${kind}:${v.id}`);
        }
      }
      for (const c of response.changes) {
        const key = `${c.kind}:${c.id}`,
          remoteHash = remoteHashes.get(key)!;
        if (protectedKeys.has(key)) {
          conflicts.push(c);
          continue;
        }
        const current = await db[c.kind].get(c.id);
        // Writes made during the network request stay local. Compare inside the
        // transaction too, so a late editor commit cannot be overwritten.
        const localChanged =
          (before.hashes[key] ?? null) !== (flight.expected[key] ?? null) ||
          canonical(current ? wire(c.kind, current) : null) !==
            canonical(before.records[key] ?? null);
        if (localChanged) {
          if (
            remoteHash !== (flight.expected[key] ?? null) &&
            canonical(current ? wire(c.kind, current) : null) !==
              canonical(c.value)
          ) {
            conflicts.push(c);
            continue;
          }
        } else if (c.value === null) await db[c.kind].delete(c.id);
        else await db[c.kind].put(hydrate(c.kind, c.value));
        base[key] = { version: c.version, hash: remoteHash };
      }
      await db.syncState.bulkPut([
        { id: "base", value: base },
        { id: "cursor", value: response.cursor },
        { id: "initialized", value: true },
        { id: "lastSynced", value: Date.now() },
        { id: "conflicts", value: conflicts },
      ]);
      await db.syncState.delete("inflight");
    },
  );
  update({ available: false, offline: false, error: "" });
  await refreshPending();
}
async function performSync() {
  if (!active) throw new Error("Bitte anmelden.");
  update({ busy: true, error: "" });
  try {
    if ((await meta<RemoteChange[]>("conflicts", [])).length)
      throw new Error("Bitte zuerst die Versionskonflikte auflösen.");
    // Retry the exact persisted request after a lost connection or page reload.
    let flight = await meta<Flight | null>("inflight", null);
    if (!flight) {
      const snapshot = await capture();
      flight = {
        batch: {
          batchId: crypto.randomUUID(),
          cursor: snapshot.cursor,
          changes: snapshot.changes,
        },
        expected: snapshot.hashes,
      };
      await db.syncState.put({ id: "inflight", value: flight });
    }
    const response = await request<{ cursor: number; changes: RemoteChange[] }>(
      "/api/sync",
      { method: "POST", body: JSON.stringify(flight.batch) },
    );
    await applyResponse(response, flight);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status < 500 &&
      ![408, 429].includes(error.status)
    ) {
      await db.syncState.delete("inflight");
      if (error.conflicts)
        await db.syncState.put({ id: "conflicts", value: error.conflicts });
    }
    update({
      error:
        error instanceof Error ? error.message : "Abgleich fehlgeschlagen.",
      offline:
        error instanceof ApiError
          ? error.status >= 500
          : error instanceof TypeError || !navigator.onLine,
    });
    await refreshPending();
    throw error;
  } finally {
    update({ busy: false });
  }
}
export function synchronize(): Promise<void> {
  if (running) return running;
  const run = () => performSync();
  running = (
    navigator.locks
      ? navigator.locks.request(`emir-sync-${active?.id}`, run)
      : run()
  ).finally(() => {
    running = undefined;
  });
  return running;
}
async function applyConflictChoice(choice: "local" | "server") {
  const conflicts = await meta<RemoteChange[]>("conflicts", []);
  const hashes = new Map<string, string | null>();
  for (const c of conflicts)
    hashes.set(`${c.kind}:${c.id}`, await fingerprint(c.value));
  await db.transaction(
    "rw",
    db.folders,
    db.cards,
    db.media,
    db.reviews,
    db.syncState,
    async () => {
      const base = await meta<Record<string, Base>>("base", {});
      for (const c of conflicts) {
        if (choice === "server") {
          if (c.value) {
            if (c.kind === "cards") {
              // A chosen server schedule supersedes reviews not yet acknowledged.
              for (const review of await db.reviews
                .where("cardId")
                .equals(c.id)
                .toArray())
                if (!base[`reviews:${review.id}`]?.hash)
                  await db.reviews.delete(review.id);
            }
            await db[c.kind].put(hydrate(c.kind, c.value));
          } else {
            // Accepting a server deletion includes the dependent local contents.
            if (c.kind === "folders") {
              const folders = await db.folders.toArray();
              const deleted = new Set([c.id]);
              for (let more = true; more;) {
                more = false;
                for (const f of folders)
                  if (
                    f.parentId &&
                    deleted.has(f.parentId) &&
                    !deleted.has(f.id)
                  ) {
                    deleted.add(f.id);
                    more = true;
                  }
              }
              const cards = (await db.cards.toArray()).filter(
                (card) => card.folderId && deleted.has(card.folderId),
              );
              await db.reviews
                .where("cardId")
                .anyOf(cards.map((c) => c.id))
                .delete();
              await db.cards.bulkDelete(cards.map((c) => c.id));
              await db.folders.bulkDelete([...deleted]);
            } else {
              if (c.kind === "cards")
                await db.reviews.where("cardId").equals(c.id).delete();
              await db[c.kind].delete(c.id);
            }
          }
        }
        base[`${c.kind}:${c.id}`] = {
          version: c.version,
          hash: hashes.get(`${c.kind}:${c.id}`)!,
        };
      }
      await db.syncState.put({ id: "base", value: base });
      await db.syncState.put({ id: "conflicts", value: [] });
    },
  );
  update({ conflicts: [], error: "" });
  await refreshPending();
}
export async function resolveConflicts(choice: "local" | "server") {
  const run = () => applyConflictChoice(choice);
  return navigator.locks
    ? navigator.locks.request(`emir-sync-${active?.id}`, run)
    : run();
}
// Local data and the last acknowledged server versions are durable. Their diff
// is the outbox, including changes committed immediately before a page closes.
export async function persistRemote() {
  await refreshPending();
}
