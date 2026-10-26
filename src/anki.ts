import JSZip from "jszip";
import { Decompress } from "fzstd";
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { db, type CardsDatabase } from "./db";
import { scopedCards, subtree } from "./domain";
import {
  isImage,
  readLimited,
  type PreparedImport,
  type PackageData,
} from "./backup";
import type { Flashcard, Folder, Media } from "./types";

const MB = 1024 * 1024;
const MODEL_ID = 1_710_000_000_001;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let sqlitePromise: ReturnType<typeof initSqlJs> | undefined;

function sqlite() {
  sqlitePromise ??=
    import.meta.env.MODE === "test"
      ? import("node:fs/promises").then(async ({ readFile }) =>
          initSqlJs({
            wasmBinary: Uint8Array.from(
              await readFile("node_modules/sql.js/dist/sql-wasm.wasm"),
            ).buffer,
          }),
        )
      : initSqlJs({ locateFile: () => wasmUrl });
  return sqlitePromise;
}

// Anki uses numeric SQLite IDs. A stable hash keeps the same note identity on re-export.
function numericId(prefix: string, value: string, used: Set<number>): number {
  let hash = 0xcbf29ce484222325n;
  for (const byte of textEncoder.encode(`${prefix}:${value}`)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  let result = Number(hash & 0x1fffffffffffffn) || 1;
  while (used.has(result))
    result = result === Number.MAX_SAFE_INTEGER ? 1 : result + 1;
  used.add(result);
  return result;
}

function escapeHtml(value: string) {
  return value
    .replace(/\x1f/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n?|\n/g, "<br>");
}

function imageName(media: Media) {
  const ext =
    media.type === "image/png"
      ? "png"
      : media.type === "image/webp"
        ? "webp"
        : "jpg";
  return `emir_${media.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.${ext}`;
}

function ankiField(text: string, ids: string[], mediaById: Map<string, Media>) {
  const images = ids.map((id) => {
    const media = mediaById.get(id);
    if (!media)
      throw new Error(
        "Ein Bild fehlt. Bitte prüfe deine Karten vor dem Export.",
      );
    return `<img src="${imageName(media)}">`;
  });
  return [escapeHtml(text), ...images].filter(Boolean).join("<br>");
}

const schema = `
CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);
CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
CREATE INDEX ix_cards_nid ON cards(nid);
CREATE INDEX ix_revlog_cid ON revlog(cid);
`;

function model(now: number, deckId: number) {
  const field = (name: string, ord: number) => ({
    name,
    ord,
    font: "Arial",
    size: 20,
    rtl: false,
    sticky: false,
    media: [],
  });
  return {
    id: MODEL_ID,
    name: "Emir Cards Basic",
    type: 0,
    mod: now,
    usn: -1,
    did: deckId,
    flds: [field("Front", 0), field("Back", 1)],
    tmpls: [
      {
        name: "Card 1",
        ord: 0,
        qfmt: "{{Front}}",
        afmt: '{{FrontSide}}<hr id="answer">{{Back}}',
        bqfmt: "",
        bafmt: "",
        bfont: "",
        bsize: 0,
        did: null,
      },
    ],
    req: [[0, "all", [0]]],
    css: ".card { font-family: Arial; font-size: 20px; text-align: center; color: black; background-color: white; } img { max-width: 100%; }",
    latexPre: "",
    latexPost: "",
    latexsvg: false,
    sortf: 0,
    tags: [],
    vers: [],
  };
}

function deck(name: string, id: number, now: number) {
  return {
    id,
    name,
    mod: now,
    usn: -1,
    desc: "",
    dyn: 0,
    conf: 1,
    collapsed: false,
    browserCollapsed: false,
    newToday: [0, 0],
    revToday: [0, 0],
    lrnToday: [0, 0],
    timeToday: [0, 0],
  };
}

function exportSchedule(
  card: Flashcard,
  crt: number,
  position: number,
  includeProgress: boolean,
) {
  if (!includeProgress || card.schedule.state === 0)
    return {
      type: 0,
      queue: 0,
      due: position,
      ivl: 0,
      reps: 0,
      lapses: 0,
      left: 0,
    };
  const state = card.schedule.state;
  const due = new Date(card.schedule.due).getTime();
  if (state === 2)
    return {
      type: 2,
      queue: 2,
      due: Math.max(0, Math.floor((due / 1000 - crt) / 86400)),
      ivl: Math.max(1, Math.round(card.schedule.scheduled_days)),
      reps: card.schedule.reps,
      lapses: card.schedule.lapses,
      left: 0,
    };
  return {
    type: state === 3 ? 3 : 1,
    queue: 1,
    due: Math.floor(due / 1000),
    ivl: Math.max(0, Math.round(card.schedule.scheduled_days)),
    reps: card.schedule.reps,
    lapses: card.schedule.lapses,
    left: 1001,
  };
}

export async function exportAnkiPackage(
  folderId: string | null,
  includeProgress: boolean,
  database: CardsDatabase = db,
  scope: "subtree" | "direct" = "subtree",
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
      const folders =
        scope === "direct"
          ? []
          : allFolders.filter((folder) => ids.has(folder.id));
      const allCards = await database.cards.toArray();
      const cards =
        scope === "direct"
          ? allCards.filter((card) => card.folderId === folderId)
          : scopedCards(allCards, allFolders, folderId);
      const mediaIds = [
        ...new Set(
          cards.flatMap((card) => [...card.frontImages, ...card.backImages]),
        ),
      ];
      const media = await database.media.bulkGet(mediaIds);
      if (media.some((item) => !item))
        throw new Error(
          "Ein Bild fehlt. Bitte prüfe deine Karten vor dem Export.",
        );
      const cardIds = new Set(cards.map((card) => card.id));
      const reviews = includeProgress
        ? (await database.reviews.toArray()).filter((review) =>
            cardIds.has(review.cardId),
          )
        : [];
      return { folders, cards, media: media as Media[], reviews };
    },
  );
  if (!snapshot.cards.length)
    throw new Error(
      scope === "direct"
        ? "In diesem Ordner liegen keine direkten Karten."
        : "Für einen Anki-Export sind Karten erforderlich.",
    );
  const Sql = await sqlite();
  const collection = new Sql.Database();
  const zip = new JSZip();
  try {
    collection.run(schema);
    const now = Math.floor(Date.now() / 1000);
    const crt = Math.floor(now / 86400) * 86400;
    const folderMap = new Map(
      snapshot.folders.map((folder) => [folder.id, folder]),
    );
    const deckIds = new Map<string | null, number>();
    const usedIds = new Set<number>([MODEL_ID]);
    const decks: Record<string, ReturnType<typeof deck>> = {};
    const rootId = numericId("deck", "root", usedIds);
    deckIds.set(null, rootId);
    decks[String(rootId)] = deck("Emir Cards", rootId, now);
    function pathFor(folder: Folder): string {
      const segments: string[] = [];
      let current: Folder | undefined = folder;
      const visited = new Set<string>();
      while (current) {
        if (visited.has(current.id))
          throw new Error("Die Ordnerstruktur ist ungültig.");
        visited.add(current.id);
        segments.unshift(current.name.replace(/::/g, " - "));
        if (current.id === folderId) break;
        current = current.parentId
          ? folderMap.get(current.parentId)
          : undefined;
      }
      return segments.join("::");
    }
    for (const folder of snapshot.folders) {
      const did = numericId("deck", folder.id, usedIds);
      deckIds.set(folder.id, did);
      decks[String(did)] = deck(pathFor(folder), did, now);
    }
    const mediaById = new Map(snapshot.media.map((media) => [media.id, media]));
    const mediaMap: Record<string, string> = {};
    let mediaSize = 0;
    snapshot.media.forEach((media, index) => {
      mediaSize += media.data.byteLength;
      if (mediaSize > 200 * MB)
        throw new Error("Die Bilder überschreiten zusammen 200 MB.");
      const name = imageName(media);
      mediaMap[String(index)] = name;
      zip.file(String(index), media.data);
    });
    collection.run("INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [
      1,
      crt,
      now,
      now,
      11,
      0,
      0,
      0,
      JSON.stringify({
        curDeck: rootId,
        curModel: MODEL_ID,
        schedVer: 2,
        // Anki still requires a deck. Emir Cards uses this marker to add the
        // cards to the chosen destination without recreating a source folder.
        ...(scope === "direct"
          ? { emirCards: { version: 1, mode: "direct-cards" } }
          : {}),
      }),
      JSON.stringify({ [String(MODEL_ID)]: model(now, rootId) }),
      JSON.stringify(decks),
      JSON.stringify({}),
      JSON.stringify({}),
    ]);
    const cardIdBySource = new Map<string, number>();
    for (const [index, card] of snapshot.cards.entries()) {
      const noteId = numericId("note", card.id, usedIds);
      const ankiCardId = numericId("card", card.id, usedIds);
      cardIdBySource.set(card.id, ankiCardId);
      const front = ankiField(card.front, card.frontImages, mediaById);
      const back = ankiField(card.back, card.backImages, mediaById);
      const fields = `${front}\x1f${back}`;
      const digest = await crypto.subtle.digest(
        "SHA-1",
        textEncoder.encode(front),
      );
      const checksum = new DataView(digest).getUint32(0);
      collection.run("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
        noteId,
        card.id,
        MODEL_ID,
        Math.floor(card.updatedAt / 1000),
        -1,
        "",
        fields,
        front.replace(/<[^>]*>/g, " ").slice(0, 500),
        checksum,
        0,
        "",
      ]);
      const schedule = exportSchedule(card, crt, index + 1, includeProgress);
      collection.run(
        "INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          ankiCardId,
          noteId,
          deckIds.get(card.folderId) ?? rootId,
          0,
          Math.floor(card.updatedAt / 1000),
          -1,
          schedule.type,
          schedule.queue,
          schedule.due,
          schedule.ivl,
          2500,
          schedule.reps,
          schedule.lapses,
          schedule.left,
          0,
          0,
          0,
          "",
        ],
      );
    }
    for (const review of snapshot.reviews) {
      const cardId = cardIdBySource.get(review.cardId);
      if (!cardId) continue;
      const reviewId = Math.round(new Date(review.log.review).getTime());
      const uniqueId = usedIds.has(reviewId)
        ? numericId("review", review.id, usedIds)
        : reviewId;
      usedIds.add(uniqueId);
      collection.run("INSERT INTO revlog VALUES (?,?,?,?,?,?,?,?,?)", [
        uniqueId,
        cardId,
        -1,
        review.log.rating,
        Math.round(review.log.scheduled_days),
        Math.round(review.log.last_elapsed_days),
        2500,
        0,
        review.before.state === 2 ? 1 : review.before.state === 3 ? 2 : 0,
      ]);
    }
    const bytes = collection.export();
    if (bytes.byteLength > 200 * MB)
      throw new Error("Die Anki-Sammlung überschreitet 200 MB.");
    zip.file("collection.anki2", bytes);
    zip.file("media", JSON.stringify(mediaMap));
    const result = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 3 },
    });
    if (result.size > 200 * MB)
      throw new Error("Das Anki-Paket überschreitet 200 MB.");
    return result;
  } finally {
    collection.close();
  }
}

type Row = Record<string, string | number | Uint8Array | null>;
function rows(database: import("sql.js").Database, query: string): Row[] {
  const statement = database.prepare(query);
  try {
    const output: Row[] = [];
    while (statement.step()) output.push(statement.getAsObject() as Row);
    return output;
  } finally {
    statement.free();
  }
}

function unpackZstd(input: Uint8Array, limit: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const decoder = new Decompress((chunk) => {
    size += chunk.byteLength;
    if (size > limit) throw new Error("Das entpackte Anki-Paket ist zu groß.");
    chunks.push(chunk);
  });
  decoder.push(input, true);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

// Read only the fields needed from Anki's protobuf metadata and schema-18 templates.
function protobufFields(
  bytes: Uint8Array,
): Map<number, (number | Uint8Array)[]> {
  const result = new Map<number, (number | Uint8Array)[]>();
  let offset = 0;
  function varint() {
    let value = 0;
    let scale = 1;
    for (let index = 0; index < 10; index++) {
      if (offset >= bytes.length) throw new Error("Ungültige Anki-Metadaten.");
      const byte = bytes[offset++];
      value += (byte & 127) * scale;
      if (!(byte & 128)) return value;
      scale *= 128;
    }
    throw new Error("Ungültige Anki-Metadaten.");
  }
  while (offset < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    let value: number | Uint8Array;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const length = varint();
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        offset + length > bytes.length
      )
        throw new Error("Ungültige Anki-Metadaten.");
      value = bytes.subarray(offset, offset + length);
      offset += length;
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
      if (offset > bytes.length) throw new Error("Ungültige Anki-Metadaten.");
      continue;
    } else throw new Error("Ungültige Anki-Metadaten.");
    const values = result.get(field) ?? [];
    values.push(value);
    result.set(field, values);
  }
  return result;
}

function protoText(value: number | Uint8Array | undefined) {
  return value instanceof Uint8Array ? textDecoder.decode(value) : "";
}

type AnkiModel = {
  type?: number;
  flds?: { name: string }[];
  tmpls?: { qfmt: string; afmt: string }[];
};
function definitions(collection: import("sql.js").Database, modern: boolean) {
  if (!modern) {
    const header = rows(
      collection,
      "SELECT crt, decks, models FROM col LIMIT 1",
    )[0];
    if (!header) throw new Error("Die Anki-Datenbank enthält keine Sammlung.");
    return {
      decks: JSON.parse(String(header.decks)) as Record<
        string,
        { name?: string }
      >,
      models: JSON.parse(String(header.models)) as Record<string, AnkiModel>,
    };
  }
  // Anki registers its own "unicase" collation. sql.js does not expose that
  // registration hook, so replace the collation name in this in-memory copy.
  // No package bytes or user data are written back.
  const schemaVersion = Number(
    rows(collection, "PRAGMA schema_version")[0]?.schema_version ?? 0,
  );
  collection.run("PRAGMA writable_schema=ON");
  collection.run(
    "UPDATE sqlite_master SET sql=replace(sql, 'COLLATE unicase', 'COLLATE NOCASE ') WHERE sql LIKE '%COLLATE unicase%'",
  );
  collection.run("PRAGMA writable_schema=OFF");
  collection.run(`PRAGMA schema_version=${schemaVersion + 1}`);
  const decks: Record<string, { name: string }> = {};
  for (const row of rows(collection, "SELECT id, name FROM decks"))
    decks[String(row.id)] = { name: String(row.name).replace(/\x1f/g, "::") };
  const models: Record<string, AnkiModel> = {};
  for (const row of rows(collection, "SELECT id, config FROM notetypes")) {
    const config = protobufFields(row.config as Uint8Array);
    models[String(row.id)] = {
      type: Number(config.get(1)?.[0] ?? 0),
      flds: [],
      tmpls: [],
    };
  }
  for (const row of rows(collection, "SELECT ntid, ord, name FROM fields")) {
    const model = models[String(row.ntid)];
    if (model?.flds) model.flds[Number(row.ord)] = { name: String(row.name) };
  }
  for (const row of rows(
    collection,
    "SELECT ntid, ord, config FROM templates",
  )) {
    const model = models[String(row.ntid)];
    if (!model?.tmpls) continue;
    const config = protobufFields(row.config as Uint8Array);
    model.tmpls[Number(row.ord)] = {
      qfmt: protoText(config.get(1)?.[0]),
      afmt: protoText(config.get(2)?.[0]),
    };
  }
  return { decks, models };
}

function plainText(html: string) {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(?:div|p|li)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (_, entity: string) => {
        if (entity[0] === "#") {
          const point =
            entity[1]?.toLowerCase() === "x"
              ? parseInt(entity.slice(2), 16)
              : parseInt(entity.slice(1), 10);
          return point > 0 && point <= 0x10ffff
            ? String.fromCodePoint(point)
            : "";
        }
        return (
          {
            amp: "&",
            lt: "<",
            gt: ">",
            quot: '"',
            apos: "'",
            nbsp: " ",
          } as Record<string, string>
        )[entity.toLowerCase()];
      },
    )
    .trim();
}

function templateFields(template: { qfmt: string; afmt: string }) {
  const tokens = (source: string) =>
    [...source.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) =>
      match[1].trim(),
    );
  const question = tokens(template.qfmt);
  const answer = tokens(template.afmt).filter((token) => token !== "FrontSide");
  const plain = (source: string) =>
    source
      .replace(/{{[^{}]*}}/g, "")
      .replace(/<[^>]*>/g, "")
      .trim();
  if (
    question.length !== 1 ||
    answer.length !== 1 ||
    question.some((token) => /[:#^/]/.test(token)) ||
    answer.some((token) => /[:#^/]/.test(token)) ||
    /<\s*(?:img|audio|video|script|iframe)\b/i.test(
      template.qfmt + template.afmt,
    ) ||
    plain(template.qfmt) ||
    plain(template.afmt)
  )
    throw new Error(
      "Eine Anki-Kartenvorlage verwendet zusätzliche Inhalte oder Spezialfunktionen und kann noch nicht verlustfrei importiert werden.",
    );
  return { front: question[0], back: answer[0] };
}

export async function prepareAnkiImport(file: Blob): Promise<PreparedImport> {
  if (file.size > 200 * MB)
    throw new Error("Bitte wähle ein Anki-Paket mit höchstens 200 MB.");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error("Die Datei ist kein lesbares Anki-Paket.");
  }
  if (Object.keys(zip.files).length > 50002)
    throw new Error("Das Anki-Paket enthält zu viele Dateien.");
  const modern = Boolean(zip.file("collection.anki21b"));
  const collectionEntry =
    zip.file("collection.anki21b") ??
    zip.file("collection.anki21") ??
    zip.file("collection.anki2");
  if (!collectionEntry) throw new Error("Im Paket fehlt die Anki-Sammlung.");
  const packedCollection = await readLimited(collectionEntry, 200 * MB);
  const collectionBytes = modern
    ? unpackZstd(packedCollection, 200 * MB)
    : packedCollection;
  const Sql = await sqlite();
  let collection: import("sql.js").Database;
  try {
    collection = new Sql.Database(collectionBytes);
  } catch {
    throw new Error("Die Anki-Datenbank ist beschädigt.");
  }
  try {
    const { decks: deckDefs, models: modelDefs } = definitions(
      collection,
      modern,
    );
    const config = JSON.parse(
      String(rows(collection, "SELECT conf FROM col LIMIT 1")[0]?.conf || "{}"),
    );
    const directCards =
      config?.emirCards?.version === 1 &&
      config?.emirCards?.mode === "direct-cards";
    const sourceCards = rows(
      collection,
      "SELECT c.id AS cid, c.did, c.ord, n.mid, n.flds, n.guid, n.mod FROM cards c JOIN notes n ON n.id = c.nid ORDER BY c.id",
    );
    if (!sourceCards.length)
      throw new Error("Das Anki-Paket enthält keine Karten.");
    const mediaEntry = zip.file("media");
    let mediaIndex: Record<string, string> = {};
    if (mediaEntry) {
      const packedMedia = await readLimited(mediaEntry, 12 * MB);
      if (modern) {
        const entries =
          protobufFields(unpackZstd(packedMedia, 12 * MB)).get(1) ?? [];
        mediaIndex = Object.fromEntries(
          entries.map((entry, index) => [
            String(index),
            protoText(protobufFields(entry as Uint8Array).get(1)?.[0]),
          ]),
        );
      } else
        mediaIndex = JSON.parse(textDecoder.decode(packedMedia)) as Record<
          string,
          string
        >;
    }
    const mediaFiles = new Map(
      Object.entries(mediaIndex).map(([key, name]) => [name, key]),
    );
    const folderByName = new Map<string, PackageData["folders"][number]>();
    const folders: PackageData["folders"] = [];
    const cards: PackageData["cards"] = [];
    const mediaByName = new Map<string, Media>();
    const usedMedia = new Map<string, PackageData["media"][number]>();
    let totalMediaBytes = 0;
    const now = Date.now();
    for (const source of sourceCards) {
      const deckName = deckDefs[String(source.did)]?.name;
      if (!deckName)
        throw new Error("Eine Karte verweist auf ein fehlendes Anki-Deck.");
      const segments = directCards ? [] : deckName.split("::");
      if (segments.some((segment) => !segment.trim()))
        throw new Error("Ein Anki-Deckname ist ungültig.");
      if (segments.some((segment) => segment.length > 120))
        throw new Error("Ein Anki-Deckname ist für diese App zu lang.");
      let parent: PackageData["folders"][number] | undefined;
      let path = "";
      for (const segment of segments) {
        path = path ? `${path}::${segment}` : segment;
        let folder = folderByName.get(path);
        if (!folder) {
          folder = {
            id: crypto.randomUUID(),
            parentId: parent?.id ?? null,
            name: segment,
            color: "sage",
            createdAt: now,
          };
          folderByName.set(path, folder);
          folders.push(folder);
        }
        parent = folder;
      }
      const model = modelDefs[String(source.mid)];
      if (!model || model.type !== 0 || !model.flds || !model.tmpls)
        throw new Error(
          "Das Anki-Paket enthält einen Kartentyp, den diese App noch nicht darstellen kann (z. B. Lückentext).",
        );
      const template = model.tmpls[Number(source.ord)];
      if (!template) throw new Error("Eine Anki-Kartenvorlage fehlt.");
      const templateNames = templateFields(template);
      const fields = String(source.flds).split("\x1f");
      const frontIndex = model.flds.findIndex(
        (field) => field?.name === templateNames.front,
      );
      const backIndex = model.flds.findIndex(
        (field) => field?.name === templateNames.back,
      );
      if (frontIndex < 0 || backIndex < 0)
        throw new Error("Die Felder einer Anki-Kartenvorlage fehlen.");
      const parseSide = async (html: string) => {
        if (/\[sound:|<\s*(?:audio|video|script|iframe)\b/i.test(html))
          throw new Error(
            "Audio, Video und aktive Inhalte aus Anki können noch nicht importiert werden.",
          );
        const imageIds: string[] = [];
        const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)];
        if (imageTags.length > 20)
          throw new Error("Eine Anki-Kartenseite enthält zu viele Bilder.");
        for (const tag of imageTags) {
          const match = tag[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
          if (!match) throw new Error("Ein Anki-Bildverweis ist ungültig.");
          let name = match[1];
          try {
            name = decodeURIComponent(name);
          } catch {}
          const index = mediaFiles.get(name);
          if (index === undefined)
            throw new Error(`Das Anki-Bild „${name}“ fehlt.`);
          let media = mediaByName.get(name);
          if (!media) {
            const ext = name.toLowerCase().split(".").pop();
            const type =
              ext === "png"
                ? "image/png"
                : ext === "webp"
                  ? "image/webp"
                  : ext === "jpg" || ext === "jpeg"
                    ? "image/jpeg"
                    : "";
            if (!type)
              throw new Error(
                `Das Bildformat von „${name}“ wird nicht unterstützt.`,
              );
            const entry = zip.file(index);
            if (!entry) throw new Error(`Das Anki-Bild „${name}“ fehlt.`);
            const packedImage = await readLimited(entry, 12 * MB);
            const bytes = modern
              ? unpackZstd(packedImage, 12 * MB)
              : packedImage;
            if (bytes.byteLength > 12 * MB || !isImage(bytes, type))
              throw new Error(
                `Das Anki-Bild „${name}“ ist ungültig oder zu groß.`,
              );
            totalMediaBytes += bytes.byteLength;
            if (totalMediaBytes > 200 * MB)
              throw new Error("Die entpackten Bilder sind zusammen zu groß.");
            media = {
              id: crypto.randomUUID(),
              name,
              type,
              data: bytes.buffer as ArrayBuffer,
            };
            mediaByName.set(name, media);
            usedMedia.set(name, {
              id: media.id,
              name,
              type: type as "image/png" | "image/webp" | "image/jpeg",
              path: `media/${media.id}.${ext === "jpeg" ? "jpg" : ext}`,
            });
          }
          imageIds.push(media.id);
        }
        const text = plainText(html.replace(/<img\b[^>]*>/gi, ""));
        if (
          text.length > 50000 ||
          imageIds.length > 20 ||
          (!text && !imageIds.length)
        )
          throw new Error("Eine Anki-Kartenseite ist leer oder zu groß.");
        return { text, imageIds };
      };
      const front = await parseSide(fields[frontIndex] ?? "");
      const back = await parseSide(fields[backIndex] ?? "");
      cards.push({
        id: crypto.randomUUID(),
        folderId: parent?.id ?? null,
        front: front.text,
        back: back.text,
        frontImages: front.imageIds,
        backImages: back.imageIds,
        createdAt: now,
        updatedAt:
          Number.isFinite(Number(source.mod)) && Number(source.mod) >= 0
            ? Number(source.mod) * 1000
            : now,
      });
    }
    if (mediaByName.size > 50000)
      throw new Error("Das Anki-Paket enthält zu viele Bilder.");
    const media = [...mediaByName.values()];
    return {
      data: {
        format: "emir-cards",
        version: 1,
        kind: "share",
        createdAt: new Date().toISOString(),
        folders,
        cards,
        media: [...usedMedia.values()],
        reviews: [],
      },
      media,
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Das Anki-Paket konnte nicht gelesen werden.");
  } finally {
    collection.close();
  }
}
