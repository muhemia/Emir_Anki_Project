import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { readFile } from "node:fs/promises";
import { CardsDatabase } from "./db";
import { id, newSchedule, reviewCard, saveFolder } from "./domain";
import { exportAnkiPackage, prepareAnkiImport } from "./anki";
import { commitImport } from "./backup";
import type { Flashcard } from "./types";

const database = new CardsDatabase("test-anki");
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

beforeEach(async () => {
  await database.open();
  await Promise.all([
    database.folders.clear(),
    database.cards.clear(),
    database.media.clear(),
    database.reviews.clear(),
  ]);
});
afterAll(() => database.delete());

describe("Anki-Pakete", () => {
  it("importiert Lücken als getrennte Karten, versteckt Bilder und erhält Zusatztexte beim Export", async () => {
    const prepared = await prepareAnkiImport(
      new Blob([await readFile("tests/fixtures/cloze.apkg")]),
    );
    expect(prepared.data.cards).toHaveLength(2);
    const [first, second] = prepared.data.cards;
    expect(first.front).toBe("Das [Organ] pumpt Blut. […]");
    expect(first.frontImages).toHaveLength(0);
    expect(second.front).toBe("Das Herz pumpt […].");
    expect(second.frontImages).toHaveLength(1);
    expect(first.back).toContain("Das Herz pumpt Blut.");
    expect(first.back).toContain("Zusatzwissen zur Karte.");
    expect(first.backImages).toHaveLength(1);
    await commitImport(prepared, null, database);
    const roundtrip = await prepareAnkiImport(
      await exportAnkiPackage(null, false, database),
    );
    expect(roundtrip.data.cards.map((c) => c.front).sort()).toEqual(
      prepared.data.cards.map((c) => c.front).sort(),
    );
    expect(
      roundtrip.data.cards.every((c) =>
        c.back.includes("Zusatzwissen zur Karte."),
      ),
    ).toBe(true);
  });
  it("akzeptiert am Datei-Größengate 200 MB und lehnt ein weiteres Byte ab", async () => {
    const source = await saveFolder(
      "Größentest",
      null,
      "sage",
      undefined,
      database,
    );
    await database.cards.add({
      id: id(),
      folderId: source.id,
      front: "Frage",
      back: "Antwort",
      frontImages: [],
      backImages: [],
      schedule: newSchedule(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const file = await exportAnkiPackage(source.id, false, database);
    // Test the file-size boundary with a valid small APKG to avoid allocating 200 MB.
    Object.defineProperty(file, "size", {
      value: 200 * 1024 * 1024,
      configurable: true,
    });
    await expect(prepareAnkiImport(file)).resolves.toBeDefined();
    Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 + 1 });
    await expect(prepareAnkiImport(file)).rejects.toThrow("höchstens 200 MB");
  });
  it("trennt Ordnerexport und direkte Karten und fügt direkte Karten ohne neuen Ordner hinzu", async () => {
    const parent = await saveFolder(
      "Medizin",
      null,
      "sage",
      undefined,
      database,
    );
    const anatomy = await saveFolder(
      "Anatomie",
      parent.id,
      "sage",
      undefined,
      database,
    );
    const histology = await saveFolder(
      "Histologie",
      anatomy.id,
      "sage",
      undefined,
      database,
    );
    const target = await saveFolder("Ziel", null, "sage", undefined, database);
    const directImage = id();
    const childImage = id();
    await database.media.bulkAdd(
      [directImage, childImage].map((mediaId) => ({
        id: mediaId,
        name: `${mediaId}.png`,
        type: "image/png",
        data: png.buffer,
      })),
    );
    const makeCard = (
      folderId: string | null,
      front: string,
      imageId?: string,
    ): Flashcard => ({
      id: id(),
      folderId,
      front,
      back: "Antwort",
      frontImages: imageId ? [imageId] : [],
      backImages: [],
      schedule: newSchedule(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const direct = makeCard(anatomy.id, "Anatomie-Karte", directImage);
    await database.cards.bulkAdd([
      direct,
      makeCard(histology.id, "Histologie-Karte", childImage),
      makeCard(parent.id, "Medizin-Karte"),
      makeCard(null, "Karte in der Sammlung"),
      makeCard(target.id, "Vorhandene Zielkarte"),
    ]);
    await reviewCard(direct.id, Rating.Easy, new Date(), database);

    const subtree = await prepareAnkiImport(
      await exportAnkiPackage(anatomy.id, false, database),
    );
    expect(subtree.data.folders.map((folder) => folder.name).sort()).toEqual([
      "Anatomie",
      "Histologie",
    ]);
    expect(
      subtree.data.folders.find((folder) => folder.name === "Anatomie")
        ?.parentId,
    ).toBeNull();
    expect(subtree.data.cards.map((card) => card.front).sort()).toEqual([
      "Anatomie-Karte",
      "Histologie-Karte",
    ]);

    const directFile = await exportAnkiPackage(
      anatomy.id,
      false,
      database,
      "direct",
    );
    const prepared = await prepareAnkiImport(directFile);
    expect(prepared.data.folders).toEqual([]);
    expect(prepared.data.cards).toHaveLength(1);
    expect(prepared.data.cards[0]).toMatchObject({
      front: "Anatomie-Karte",
      folderId: null,
    });
    expect(prepared.media).toHaveLength(1);
    expect(prepared.data.cards[0].frontImages).toEqual([prepared.media[0].id]);
    expect(prepared.media[0].name).toContain(directImage);
    const folderCount = await database.folders.count();
    const result = await commitImport(prepared, target.id, database);
    expect(result).toMatchObject({ folders: 0, cards: 1 });
    expect(await database.folders.count()).toBe(folderCount);
    const added = (await database.cards.toArray()).find(
      (card) => card.folderId === target.id && card.front === "Anatomie-Karte",
    )!;
    expect(added.schedule.state).toBe(0);
    expect(added.frontImages).toHaveLength(1);
    expect((await database.media.get(added.frontImages[0]))?.data).toEqual(
      png.buffer,
    );
    expect(await database.cards.get(direct.id)).toMatchObject({
      folderId: anatomy.id,
    });

    const rootCards = await prepareAnkiImport(
      await exportAnkiPackage(null, false, database, "direct"),
    );
    expect(rootCards.data.folders).toEqual([]);
    expect(rootCards.data.cards.map((card) => card.front)).toEqual([
      "Karte in der Sammlung",
    ]);
  });

  it("exportiert bei einem leeren Ordner keine Karten aus Unterordnern als direkte Karten", async () => {
    const parent = await saveFolder(
      "Anatomie",
      null,
      "sage",
      undefined,
      database,
    );
    const child = await saveFolder(
      "Histologie",
      parent.id,
      "sage",
      undefined,
      database,
    );
    await database.cards.add({
      id: id(),
      folderId: child.id,
      front: "Nur im Unterordner",
      back: "Antwort",
      frontImages: [],
      backImages: [],
      schedule: newSchedule(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await expect(
      exportAnkiPackage(parent.id, false, database, "direct"),
    ).rejects.toThrow("keine direkten Karten");
  });

  it("liest ein aktuelles, von Anki exportiertes .apkg mit zstd-Datenbank und Bild", async () => {
    // Fixture generated by Anki 26.9.3 with one Basic card and one PNG.
    const file = new Blob([
      Uint8Array.from(await readFile("tests/fixtures/anki-modern.apkg")),
    ]);
    const prepared = await prepareAnkiImport(file);
    expect(prepared.data.folders.map((folder) => folder.name)).toEqual([
      "German",
      "Words",
    ]);
    expect(prepared.data.cards).toHaveLength(1);
    expect(prepared.data.cards[0].front).toBe("Haus");
    expect(prepared.data.cards[0].back).toBe("house");
    expect(prepared.media).toHaveLength(1);
    expect(prepared.data.cards[0].frontImages).toEqual([prepared.media[0].id]);
  });
  it("exportiert ein echtes SQLite-Deck mit verschachtelten Ordnern und Medien und importiert es wieder", async () => {
    const parent = await saveFolder(
      "Biologie",
      null,
      "sage",
      undefined,
      database,
    );
    const child = await saveFolder(
      "Anatomie",
      parent.id,
      "blue",
      undefined,
      database,
    );
    const mediaId = id();
    await database.media.add({
      id: mediaId,
      name: "bild.png",
      type: "image/png",
      data: png.buffer,
    });
    const card: Flashcard = {
      id: id(),
      folderId: child.id,
      front: "Was ist das?",
      back: "Ein Bild",
      frontImages: [mediaId],
      backImages: [],
      schedule: newSchedule(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await database.cards.add(card);
    const file = await exportAnkiPackage(null, false, database);
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    expect(zip.file("collection.anki2")).toBeTruthy();
    expect(zip.file("collection.json")).toBeNull();
    expect(zip.file("media")).toBeTruthy();
    const mediaIndex = JSON.parse(await zip.file("media")!.async("string"));
    expect(mediaIndex["0"]).toMatch(/\.png$/);
    expect(await zip.file("0")!.async("uint8array")).toEqual(png);
    const Sql = await initSqlJs({
      wasmBinary: Uint8Array.from(
        await readFile("node_modules/sql.js/dist/sql-wasm.wasm"),
      ).buffer,
    });
    const collection = new Sql.Database(
      await zip.file("collection.anki2")!.async("uint8array"),
    );
    expect(collection.exec("PRAGMA integrity_check")[0].values[0][0]).toBe(
      "ok",
    );
    expect(collection.exec("SELECT COUNT(*) FROM cards")[0].values[0][0]).toBe(
      1,
    );
    const decks = JSON.parse(
      String(collection.exec("SELECT decks FROM col")[0].values[0][0]),
    );
    expect(
      Object.values(decks).some(
        (entry) => (entry as { name: string }).name === "Biologie::Anatomie",
      ),
    ).toBe(true);
    collection.close();
    const prepared = await prepareAnkiImport(file);
    expect(prepared.data.cards).toHaveLength(1);
    expect(prepared.data.cards[0].front).toBe("Was ist das?");
    expect(prepared.media).toHaveLength(1);
    await commitImport(prepared, null, database);
    expect(await database.cards.count()).toBe(2);
  });
  it("schreibt den Lernstand und Bewertungen in Ankis Karten- und Revlog-Tabellen", async () => {
    const card: Flashcard = {
      id: id(),
      folderId: null,
      front: "Frage",
      back: "Antwort",
      frontImages: [],
      backImages: [],
      schedule: newSchedule(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await database.cards.add(card);
    await reviewCard(card.id, Rating.Easy, new Date(), database);
    const file = await exportAnkiPackage(null, true, database);
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const Sql = await initSqlJs({
      wasmBinary: Uint8Array.from(
        await readFile("node_modules/sql.js/dist/sql-wasm.wasm"),
      ).buffer,
    });
    const collection = new Sql.Database(
      await zip.file("collection.anki2")!.async("uint8array"),
    );
    expect(
      collection.exec("SELECT type, queue, reps FROM cards")[0].values[0],
    ).toEqual([2, 2, 1]);
    expect(collection.exec("SELECT COUNT(*) FROM revlog")[0].values[0][0]).toBe(
      1,
    );
    collection.close();
  });
});

it.skipIf(!process.env.ANKI_IMPORT_TEST_FILE)(
  "importiert das bereitgestellte Ankiphil-Paket vollständig",
  async () => {
    const file = new Blob([await readFile(process.env.ANKI_IMPORT_TEST_FILE!)]);
    const prepared = await prepareAnkiImport(file);
    expect(prepared.data.cards).toHaveLength(6984);
    expect(
      prepared.data.cards.every((c) => !/{{c\d+::/.test(c.front + c.back)),
    ).toBe(true);
    expect(
      prepared.data.cards.filter((c) => c.front.includes("[…]")).length,
    ).toBeGreaterThan(4000);
    expect(prepared.media.length).toBeGreaterThan(600);
    expect(
      prepared.warnings?.some((warning) => warning.includes("Ankiphil")),
    ).toBe(true);
    console.info(
      `Ankiphil: ${prepared.data.folders.length} Ordner, ${prepared.data.cards.length} Karten, ${prepared.media.length} Bilder`,
    );
  },
  60000,
);
