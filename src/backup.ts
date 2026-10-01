import JSZip from "jszip";
import { z } from "zod";
import { db } from "./db";
import {
  hydrateSchedule,
  id,
  newSchedule,
  scopedCards,
  subtree,
  uniqueName,
} from "./domain";
import type { Flashcard, Folder, Media, Review } from "./types";

const MB = 1024 * 1024;
const uid = z.string().min(1).max(128);
const finite = z.number().finite().nonnegative();
const scheduleSchema = z.object({
  due: z.coerce.date(),
  stability: finite,
  difficulty: finite.max(10),
  elapsed_days: finite,
  scheduled_days: finite,
  learning_steps: finite.int(),
  reps: finite.int(),
  lapses: finite.int(),
  state: z.number().int().min(0).max(3),
  last_review: z.coerce.date().optional(),
});
const logSchema = z.object({
  rating: z.number().int().min(1).max(4),
  state: z.number().int().min(0).max(3),
  due: z.coerce.date(),
  stability: finite,
  difficulty: finite.max(10),
  elapsed_days: finite,
  last_elapsed_days: finite,
  scheduled_days: finite,
  learning_steps: finite.int(),
  review: z.coerce.date(),
});
const packageSchema = z.object({
  format: z.literal("emir-cards"),
  version: z.literal(1),
  kind: z.enum(["backup", "share"]),
  createdAt: z.string(),
  folders: z
    .array(
      z.object({
        id: uid,
        parentId: uid.nullable(),
        name: z.string().trim().min(1).max(120),
        color: z.enum(["sage", "blue", "amber", "rose", "violet", "stone"]),
        createdAt: finite,
      }),
    )
    .max(10000),
  cards: z
    .array(
      z.object({
        id: uid,
        folderId: uid.nullable(),
        front: z.string().max(50000),
        back: z.string().max(50000),
        frontImages: z.array(uid).max(20),
        backImages: z.array(uid).max(20),
        createdAt: finite,
        updatedAt: finite,
        schedule: scheduleSchema.optional(),
      }),
    )
    .max(50000),
  media: z
    .array(
      z.object({
        id: uid,
        name: z.string().max(255),
        type: z.enum(["image/jpeg", "image/png", "image/webp"]),
        path: z.string().regex(/^media\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/),
      }),
    )
    .max(50000),
  reviews: z
    .array(
      z.object({
        id: uid,
        cardId: uid,
        log: logSchema,
        before: scheduleSchema,
        createdAt: finite,
      }),
    )
    .max(500000),
});
export type PackageData = z.infer<typeof packageSchema>;
export type PreparedImport = { data: PackageData; media: Media[] };

export async function exportPackage(
  kind: "backup" | "share",
  folderId: string | null,
  database = db,
) {
  const snapshot = await database.transaction(
    "r",
    database.folders,
    database.cards,
    database.media,
    database.reviews,
    async () => {
      const allFolders = await database.folders.toArray();
      const ids = subtree(allFolders, folderId);
      const folders = allFolders
        .filter((f) => ids.has(f.id))
        .map((f) => ({
          ...f,
          parentId: f.id === folderId ? null : f.parentId,
        }));
      const cards = scopedCards(
        await database.cards.toArray(),
        allFolders,
        folderId,
      );
      const cardIds = new Set(cards.map((c) => c.id));
      const mediaIds = [
        ...new Set(cards.flatMap((c) => [...c.frontImages, ...c.backImages])),
      ];
      const media = await database.media.bulkGet(mediaIds);
      if (media.some((m) => !m))
        throw new Error(
          "Ein Bild fehlt. Bitte prüfe deine Karten vor dem Export.",
        );
      const reviews =
        kind === "backup"
          ? (await database.reviews.toArray()).filter((r) =>
              cardIds.has(r.cardId),
            )
          : [];
      return { folders, cards, media: media as Media[], reviews };
    },
  );
  const zip = new JSZip();
  const media = snapshot.media.map((m, i) => {
    const ext =
      m.type === "image/png" ? "png" : m.type === "image/webp" ? "webp" : "jpg";
    const path = `media/image_${i}.${ext}`;
    return { id: m.id, name: m.name, type: m.type, path };
  });
  let totalSize = 0;
  for (let i = 0; i < snapshot.media.length; i++) {
    const m = snapshot.media[i];
    totalSize += m.data.byteLength;
    if (totalSize > 100 * MB)
      throw new Error(
        "Version 1 unterstützt Sicherungen bis 100 MB. Bitte exportiere einzelne Themen.",
      );
    zip.file(media[i].path, m.data);
  }
  const data = {
    format: "emir-cards",
    version: 1,
    kind,
    createdAt: new Date().toISOString(),
    folders: snapshot.folders,
    cards: snapshot.cards.map((c) =>
      kind === "backup" ? c : { ...c, schedule: undefined },
    ),
    media,
    reviews: snapshot.reviews,
  };
  const manifest = JSON.stringify(data);
  if (new TextEncoder().encode(manifest).length > 12 * MB)
    throw new Error(
      "Diese Sammlung ist für einen einzelnen Export zu groß. Bitte exportiere einzelne Themen.",
    );
  zip.file("collection.json", manifest);
  const result = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
  if (result.size > 100 * MB)
    throw new Error(
      "Die Sicherung ist größer als 100 MB. Bitte exportiere einzelne Themen.",
    );
  return result;
}
function readLimited(
  entry: JSZip.JSZipObject,
  limit: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Uint8Array[] = [];
    let failed = false;
    // JSZip exposes this streaming reader at runtime; its bundled types omit it.
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      if (failed) return;
      size += chunk.byteLength;
      if (size > limit) {
        failed = true;
        stream.pause();
        reject(new Error("Die Datei ist nach dem Entpacken zu groß."));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (failed) return;
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(result);
    });
    stream.resume();
  });
}
export function isImage(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (mime === "image/webp")
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  return false;
}
export async function prepareImport(file: Blob): Promise<PreparedImport> {
  if (file.size > 100 * MB)
    throw new Error("Bitte wähle eine Sicherung unter 100 MB.");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error("Die Datei ist keine lesbare ZIP-Sicherung.");
  }
  if (Object.keys(zip.files).length > 50002)
    throw new Error("Die Sicherung enthält zu viele Dateien.");
  const entry = zip.file("collection.json");
  if (!entry)
    throw new Error(
      "Keine Emir-Cards-Sicherung gefunden. Anki-Dateien (.apkg) werden in Version 1 noch nicht unterstützt.",
    );
  let data: PackageData;
  try {
    data = packageSchema.parse(
      JSON.parse(new TextDecoder().decode(await readLimited(entry, 12 * MB))),
    );
  } catch {
    throw new Error(
      "Die Sicherung ist beschädigt oder verwendet ein nicht unterstütztes Format.",
    );
  }
  for (const items of [data.folders, data.cards, data.media, data.reviews]) {
    if (new Set(items.map((v) => v.id)).size !== items.length)
      throw new Error("Die Sicherung enthält doppelte Kennungen.");
  }
  const folderMap = new Map(data.folders.map((f) => [f.id, f]));
  for (const folder of data.folders) {
    let current: string | null = folder.id;
    const visited = new Set<string>();
    while (current !== null) {
      if (visited.has(current))
        throw new Error("Die Sicherung enthält eine ungültige Ordnerstruktur.");
      visited.add(current);
      const parent = folderMap.get(current);
      if (!parent) throw new Error("Ein übergeordneter Ordner fehlt.");
      current = parent.parentId;
    }
  }
  const mediaSet = new Set(data.media.map((m) => m.id));
  const cardSet = new Set(data.cards.map((c) => c.id));
  for (const card of data.cards) {
    if (card.folderId !== null && !folderMap.has(card.folderId))
      throw new Error("Ein Ordner für eine Karte fehlt.");
    if (
      (!card.front.trim() && !card.frontImages.length) ||
      (!card.back.trim() && !card.backImages.length)
    )
      throw new Error("Eine Karte hat eine leere Vorder- oder Rückseite.");
    if ([...card.frontImages, ...card.backImages].some((m) => !mediaSet.has(m)))
      throw new Error("Ein Bildverweis ist ungültig.");
    if (data.kind === "backup" && !card.schedule)
      throw new Error("Ein Lernstand fehlt in der Sicherung.");
  }
  if (data.reviews.some((r) => !cardSet.has(r.cardId)))
    throw new Error("Eine Bewertung verweist auf eine fehlende Karte.");
  if (!data.folders.length && !data.cards.length)
    throw new Error("Diese Sicherung ist leer.");
  const media: Media[] = [];
  let total = 0;
  for (const m of data.media) {
    const image = zip.file(m.path);
    if (!image) throw new Error(`Das Bild „${m.name}“ fehlt.`);
    const bytes = await readLimited(image, 12 * MB);
    total += bytes.length;
    if (total > 100 * MB)
      throw new Error("Die entpackten Bilder sind zusammen zu groß.");
    if (!isImage(bytes, m.type))
      throw new Error(`Das Bild „${m.name}“ hat ein ungültiges Format.`);
    media.push({
      id: m.id,
      name: m.name,
      type: m.type,
      data: bytes.buffer as ArrayBuffer,
    });
  }
  return { data, media };
}
export async function commitImport(
  prepared: PreparedImport,
  target: string | null,
  database = db,
) {
  const { data } = prepared;
  await database.transaction(
    "rw",
    database.folders,
    database.cards,
    database.media,
    database.reviews,
    async () => {
      if (target && !(await database.folders.get(target)))
        throw new Error("Der Zielordner wurde entfernt.");
      const folderIds = new Map(data.folders.map((f) => [f.id, id()]));
      const cardIds = new Map(data.cards.map((c) => [c.id, id()]));
      const mediaIds = new Map(data.media.map((m) => [m.id, id()]));
      const existing = await database.folders.toArray();
      const folders: Folder[] = [];
      for (const folder of data.folders) {
        const parentId =
          folder.parentId === null ? target : folderIds.get(folder.parentId)!;
        const names = [...existing, ...folders]
          .filter((f) => f.parentId === parentId)
          .map((f) => f.name);
        folders.push({
          ...folder,
          id: folderIds.get(folder.id)!,
          parentId,
          name: uniqueName(folder.name, names),
        });
      }
      const cards: Flashcard[] = data.cards.map((c) => ({
        ...c,
        id: cardIds.get(c.id)!,
        folderId: c.folderId === null ? target : folderIds.get(c.folderId)!,
        frontImages: c.frontImages.map((m) => mediaIds.get(m)!),
        backImages: c.backImages.map((m) => mediaIds.get(m)!),
        schedule:
          data.kind === "backup" ? hydrateSchedule(c.schedule!) : newSchedule(),
      }));
      const media = prepared.media.map((m) => ({
        ...m,
        id: mediaIds.get(m.id)!,
      }));
      const reviews: Review[] =
        data.kind === "backup"
          ? data.reviews.map((r) => ({
              ...r,
              id: id(),
              cardId: cardIds.get(r.cardId)!,
              before: hydrateSchedule(r.before),
              log: {
                ...r.log,
                due: new Date(r.log.due),
                review: new Date(r.log.review),
              },
            }))
          : [];
      await database.folders.bulkAdd(folders);
      await database.media.bulkAdd(media);
      await database.cards.bulkAdd(cards);
      await database.reviews.bulkAdd(reviews);
    },
  );
  return { folders: data.folders.length, cards: data.cards.length };
}
