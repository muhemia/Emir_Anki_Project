import { createHash } from "node:crypto";
import { parseBatch } from "./validation.mjs";
const fields = {
  folders: {
    id: "id",
    parentId: "parent_id",
    name: "name",
    color: "color",
    createdAt: "created_at",
    sortOrder: "sort_order",
  },
  media: { id: "id", name: "name", type: "type", data: "data" },
  cards: {
    id: "id",
    folderId: "folder_id",
    front: "front",
    back: "back",
    frontImages: "front_images",
    backImages: "back_images",
    schedule: "schedule",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  reviews: {
    id: "id",
    cardId: "card_id",
    log: "log",
    before: "before",
    createdAt: "created_at",
  },
};
function wire(kind, row) {
  if (!row) return null;
  const result = {};
  for (const [key, column] of Object.entries(fields[kind])) {
    if (key === "sortOrder" && row[column] === null) continue;
    result[key] =
      key === "data"
        ? row[column].toString("base64")
        : key === "createdAt" || key === "updatedAt"
          ? Number(row[column])
          : row[column];
  }
  return result;
}
async function record(client, user, kind, id) {
  const version = (
    await client.query(
      "SELECT version,deleted FROM sync_versions WHERE user_id=$1 AND kind=$2 AND id=$3",
      [user, kind, id],
    )
  ).rows[0];
  const row =
    version && !version.deleted
      ? (
          await client.query(
            `SELECT * FROM ${kind} WHERE user_id=$1 AND id=$2`,
            [user, id],
          )
        ).rows[0]
      : null;
  return {
    kind,
    id,
    version: Number(version?.version || 0),
    value: wire(kind, row),
  };
}
async function delta(client, user, cursor) {
  const versions = (
    await client.query(
      "SELECT kind,id,version,deleted FROM sync_versions WHERE user_id=$1 AND version>$2 ORDER BY version,kind,id",
      [user, cursor],
    )
  ).rows;
  const changes = [];
  for (const kind of Object.keys(fields)) {
    const entries = versions.filter((v) => v.kind === kind);
    const ids = entries.filter((v) => !v.deleted).map((v) => v.id);
    const rows = ids.length
      ? (
          await client.query(
            `SELECT * FROM ${kind} WHERE user_id=$1 AND id=ANY($2::uuid[])`,
            [user, ids],
          )
        ).rows
      : [];
    const map = new Map(rows.map((r) => [r.id, r]));
    for (const v of entries)
      changes.push({
        kind,
        id: v.id,
        version: Number(v.version),
        value: wire(kind, map.get(v.id)),
      });
  }
  const current = (
    await client.query("SELECT data_revision FROM users WHERE id=$1", [user])
  ).rows[0];
  return { cursor: Number(current.data_revision), changes };
}
async function checkStructure(client, user) {
  const folders = (
    await client.query("SELECT id,parent_id FROM folders WHERE user_id=$1", [
      user,
    ])
  ).rows;
  const map = new Map(folders.map((f) => [f.id, f]));
  const counts = new Map();
  for (const f of folders) {
    counts.set(f.parent_id, (counts.get(f.parent_id) || 0) + 1);
    if (counts.get(f.parent_id) > 10)
      throw new Error("Maximal 10 Ordner pro Ebene.");
    const seen = new Set();
    let at = f.id;
    while (at !== null) {
      if (seen.has(at) || !map.has(at))
        throw new Error("Ungültige Ordnerstruktur.");
      seen.add(at);
      if (seen.size > 4) throw new Error("Maximal vier Ordnerebenen.");
      at = map.get(at).parent_id;
    }
  }
  const excess = await client.query(
    "SELECT folder_id FROM cards WHERE user_id=$1 GROUP BY folder_id HAVING count(*)>1500 LIMIT 1",
    [user],
  );
  if (excess.rowCount) throw new Error("Maximal 1.500 Karten pro Ordner.");
  const missing = await client.query(
    `SELECT c.id FROM cards c CROSS JOIN LATERAL unnest(c.front_images || c.back_images) m(id)
    LEFT JOIN media i ON i.user_id=c.user_id AND i.id=m.id WHERE c.user_id=$1 AND i.id IS NULL LIMIT 1`,
    [user],
  );
  if (missing.rowCount) throw new Error("Ein Bild einer Karte fehlt.");
  const size = await client.query(
    "SELECT coalesce(sum(octet_length(data)),0) AS bytes FROM media WHERE user_id=$1",
    [user],
  );
  if (Number(size.rows[0].bytes) > 100 * 1024 * 1024)
    throw new Error("Maximal 100 MB Bilder pro Sammlung.");
}
export function registerSync(app, pool, requireUser) {
  app.get("/api/sync/status", requireUser, async (req, res) => {
    const row = (
      await pool.query("SELECT data_revision FROM users WHERE id=$1", [
        req.user.id,
      ])
    ).rows[0];
    res.json({ cursor: Number(row.data_revision) });
  });
  app.post("/api/sync", requireUser, async (req, res) => {
    let batch;
    try {
      batch = parseBatch(req.body);
    } catch {
      return res
        .status(400)
        .json({
          error:
            "Die Änderungen enthalten ungültige Daten oder überschreiten die Grenzen.",
        });
    }
    const client = await pool.connect();
    const user = req.user.id;
    try {
      await client.query("BEGIN");
      const lock = (
        await client.query(
          "SELECT data_revision FROM users WHERE id=$1 FOR UPDATE",
          [user],
        )
      ).rows[0];
      if (batch.cursor > Number(lock.data_revision)) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({
            error:
              "Der Serverstand ist älter als diese Gerätekopie. Bitte eine Sicherung exportieren und die Wiederherstellung prüfen.",
          });
      }
      const hash = createHash("sha256")
        .update(JSON.stringify(batch))
        .digest("hex");
      const seen = (
        await client.query(
          "SELECT request_hash FROM sync_batches WHERE user_id=$1 AND id=$2",
          [user, batch.batchId],
        )
      ).rows[0];
      if (seen && seen.request_hash !== hash) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Ungültige Wiederholung eines Abgleichs." });
      }
      if (!seen) {
        const conflicts = new Map();
        const upcoming = new Map(
          batch.changes.map((c) => [`${c.kind}:${c.id}`, c]),
        );
        for (const change of batch.changes) {
          const old = await record(client, user, change.kind, change.id);
          if (
            old.version !== change.baseVersion &&
            !(old.value === null && change.value === null)
          )
            conflicts.set(`${change.kind}:${change.id}`, old);
          if (change.value) {
            const v = change.value;
            const refs =
              change.kind === "folders"
                ? v.parentId
                  ? [["folders", v.parentId]]
                  : []
                : change.kind === "cards"
                  ? [
                      ...(v.folderId ? [["folders", v.folderId]] : []),
                      ...[...v.frontImages, ...v.backImages].map((id) => [
                        "media",
                        id,
                      ]),
                    ]
                  : change.kind === "reviews"
                    ? [["cards", v.cardId]]
                    : [];
            for (const [kind, id] of refs) {
              const next = upcoming.get(`${kind}:${id}`);
              if (next?.value) continue;
              const ref = await record(client, user, kind, id);
              if (!ref.value || (next && next.value === null))
                conflicts.set(`${kind}:${id}`, ref);
            }
          }
          if (change.kind === "media" && change.value === null) {
            const users = await client.query(
              "SELECT * FROM cards WHERE user_id=$1 AND ($2=ANY(front_images) OR $2=ANY(back_images))",
              [user, change.id],
            );
            for (const card of users.rows) {
              const edited = upcoming.get(`cards:${card.id}`);
              if (
                edited &&
                (!edited.value ||
                  ![
                    ...edited.value.frontImages,
                    ...edited.value.backImages,
                  ].includes(change.id))
              )
                continue;
              conflicts.set(`media:${change.id}`, old);
              conflicts.set(
                `cards:${card.id}`,
                await record(client, user, "cards", card.id),
              );
            }
          }
          // A stale folder/card delete must not erase a newer descendant or review.
          if (
            change.value === null &&
            (change.kind === "folders" || change.kind === "cards")
          ) {
            const descendants =
              change.kind === "folders"
                ? await client.query(
                    `WITH RECURSIVE tree AS (SELECT id FROM folders WHERE user_id=$1 AND id=$2 UNION ALL SELECT f.id FROM folders f JOIN tree t ON f.parent_id=t.id WHERE f.user_id=$1),
                cs AS (SELECT id FROM cards WHERE user_id=$1 AND folder_id IN (SELECT id FROM tree))
                SELECT 'folders' AS kind,id FROM tree UNION ALL SELECT 'cards',id FROM cs UNION ALL SELECT 'reviews',id FROM reviews WHERE user_id=$1 AND card_id IN (SELECT id FROM cs)`,
                    [user, change.id],
                  )
                : await client.query(
                    "SELECT 'reviews' AS kind,id FROM reviews WHERE user_id=$1 AND card_id=$2",
                    [user, change.id],
                  );
            for (const d of descendants.rows) {
              const current = await record(client, user, d.kind, d.id);
              const local = upcoming.get(`${d.kind}:${d.id}`);
              if (
                current.version > batch.cursor &&
                local?.baseVersion !== current.version
              ) {
                conflicts.set(`${change.kind}:${change.id}`, old);
                conflicts.set(`${d.kind}:${d.id}`, current);
              }
            }
          }
        }
        if (conflicts.size) {
          await client.query("ROLLBACK");
          return res
            .status(409)
            .json({
              error: "Änderungen auf mehreren Geräten überschneiden sich.",
              conflicts: [...conflicts.values()],
            });
        }
        for (const kind of ["folders", "media", "cards", "reviews"]) {
          for (const c of batch.changes.filter(
            (c) => c.kind === kind && c.value !== null,
          )) {
            const entries = Object.entries(fields[kind]);
            const columns = entries.map(([, col]) => col);
            const values = entries.map(([key]) =>
              key === "data"
                ? Buffer.from(c.value.data, "base64")
                : ["schedule", "log", "before"].includes(key)
                  ? JSON.stringify(c.value[key])
                  : (c.value[key] ?? null),
            );
            await client.query(
              `INSERT INTO ${kind} (user_id,${columns.join(",")}) VALUES ($1,${values.map((_, i) => "$" + (i + 2)).join(",")}) ON CONFLICT (user_id,id) DO UPDATE SET ${columns
                .filter((c) => c !== "id")
                .map((c) => `${c}=EXCLUDED.${c}`)
                .join(",")}`,
              [user, ...values],
            );
          }
        }
        // Move surviving children before cascaded deletes, preserving their unchanged cards.
        for (const kind of ["reviews", "cards", "folders", "media"]) {
          for (const c of batch.changes.filter(
            (c) => c.kind === kind && c.value === null,
          ))
            await client.query(
              `DELETE FROM ${kind} WHERE user_id=$1 AND id=$2`,
              [user, c.id],
            );
        }
        await checkStructure(client, user);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        // Empty pulls do not accumulate idempotency rows.
        if (batch.changes.length)
          await client.query(
            "INSERT INTO sync_batches (user_id,id,request_hash) VALUES ($1,$2,$3)",
            [user, batch.batchId, hash],
          );
      }
      const response = await delta(client, user, batch.cursor);
      await client.query("COMMIT");
      res.json(response);
    } catch (error) {
      await client.query("ROLLBACK");
      if (["23503", "23514", "22P02"].includes(error.code))
        res
          .status(409)
          .json({
            error:
              "Ordner oder Karten wurden inzwischen geändert. Die lokalen Änderungen bleiben erhalten.",
          });
      else if (!error.code && !error.status)
        res.status(400).json({ error: error.message });
      else throw error;
    } finally {
      client.release();
    }
  });
}
