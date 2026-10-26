import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { Rating, State } from "ts-fsrs";
import { CardsDatabase } from "./db";
import {
  deleteContent,
  id,
  moveCard,
  moveFolder,
  reorderFolder,
  compareFolders,
  newSchedule,
  reviewCard,
  saveFolder,
  scopedCards,
  studyQueue,
  undoReview,
} from "./domain";
import { exportPackage, prepareImport, commitImport } from "./backup";
import JSZip from "jszip";
import type { Flashcard } from "./types";
const db = new CardsDatabase("test-cards");
const card = (folderId: string | null, front = "Frage"): Flashcard => ({
  id: id(),
  folderId,
  front,
  back: "Antwort",
  frontImages: [],
  backImages: [],
  schedule: newSchedule(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.folders.clear(),
    db.cards.clear(),
    db.media.clear(),
    db.reviews.clear(),
  ]);
});
afterAll(() => db.delete());
describe("Ordner und Lernbereich", () => {
  it("sortiert über mehrere Positionen und erhält Unterordner samt Karten", async () => {
    const a = await saveFolder("A", null, "sage", undefined, db);
    const b = await saveFolder("B", null, "sage", undefined, db);
    const c = await saveFolder("C", null, "sage", undefined, db);
    const child = await saveFolder("Kind", c.id, "sage", undefined, db);
    const original = card(child.id);
    await db.cards.add(original);
    const roots = async () =>
      (await db.folders.toArray())
        .filter((f) => f.parentId === null)
        .sort(compareFolders)
        .map((f) => f.id);
    await reorderFolder(c.id, a.id, "before", db);
    expect(await roots()).toEqual([c.id, a.id, b.id]);
    await reorderFolder(c.id, b.id, "after", db);
    expect(await roots()).toEqual([a.id, b.id, c.id]);
    expect(await db.folders.get(child.id)).toEqual(child);
    expect(await db.cards.get(original.id)).toEqual(original);
  });
  it("sortiert nur Geschwister und lehnt andere Ebenen oder Eltern ohne Änderungen ab", async () => {
    const a = await saveFolder("A", null, "sage", undefined, db);
    const b = await saveFolder("B", null, "sage", undefined, db);
    const one = await saveFolder("Eins", a.id, "sage", undefined, db);
    const two = await saveFolder("Zwei", a.id, "sage", undefined, db);
    const foreign = await saveFolder("Fremd", b.id, "sage", undefined, db);
    await reorderFolder(two.id, one.id, "before", db);
    expect(
      (await db.folders.toArray())
        .filter((f) => f.parentId === a.id)
        .sort(compareFolders)
        .map((f) => f.id),
    ).toEqual([two.id, one.id]);
    const before = await db.folders.toArray();
    for (const target of [a.id, foreign.id]) {
      await expect(reorderFolder(one.id, target, "after", db)).rejects.toThrow(
        "desselben übergeordneten Ordners",
      );
      expect(await db.folders.toArray()).toEqual(before);
    }
    await expect(reorderFolder(one.id, "removed", "after", db)).rejects.toThrow(
      "entfernt",
    );
    expect(await db.folders.toArray()).toEqual(before);
  });
  it("sammelt nur Karten im ausgewählten Teilbaum, einschließlich direkter Karten", async () => {
    const bio = await saveFolder("Biologie", null, "sage", undefined, db);
    const anatomy = await saveFolder("Anatomie", bio.id, "blue", undefined, db);
    const head = await saveFolder("Kopf", anatomy.id, "rose", undefined, db);
    const cards = [card(null), card(bio.id), card(anatomy.id), card(head.id)];
    const folders = await db.folders.toArray();
    expect(scopedCards(cards, folders, bio.id)).toHaveLength(3);
    expect(scopedCards(cards, folders, anatomy.id)).toHaveLength(2);
    expect(scopedCards(cards, folders, null)).toHaveLength(4);
  });
  it("verschiebt ganze Teilbäume und schützt gegen Zyklen", async () => {
    const bio = await saveFolder("Biologie", null, "sage", undefined, db);
    const sub = await saveFolder("Anatomie", bio.id, "blue", undefined, db);
    const c = card(sub.id);
    await db.cards.add(c);
    await expect(moveFolder(bio.id, sub.id, db)).rejects.toThrow("sich selbst");
    await moveFolder(sub.id, null, db);
    expect((await db.folders.get(sub.id))?.parentId).toBe(null);
    expect((await db.cards.get(c.id))?.schedule).toEqual(c.schedule);
    await moveFolder(bio.id, sub.id, db);
    expect((await db.folders.get(bio.id))?.parentId).toBe(sub.id);
    await moveCard(c.id, bio.id, db);
    expect((await db.cards.get(c.id))?.folderId).toBe(bio.id);
  });
  it("löscht nur den gewählten Teilbaum und entfernt zugehörige Bewertungen", async () => {
    const f = await saveFolder("Thema", null, "sage", undefined, db);
    const sub = await saveFolder("Unterthema", f.id, "blue", undefined, db);
    const c = card(sub.id);
    const other = card(null);
    await db.cards.bulkAdd([c, other]);
    await reviewCard(c.id, Rating.Good, new Date(), db);
    await deleteContent("folder", f.id, db);
    expect(await db.folders.count()).toBe(0);
    expect(await db.cards.toArray()).toEqual([other]);
    expect(await db.reviews.count()).toBe(0);
  });
});
describe("Sammlungen ohne feste Anzahl- und Tiefenlimits", () => {
  it("akzeptiert am Datei-Größengate 200 MB und lehnt ein weiteres Byte ab", async () => {
    const source = await saveFolder("Größentest", null, "sage", undefined, db);
    const file = await exportPackage("share", source.id, db);
    // Test the file-size boundary with a valid small ZIP to avoid allocating 200 MB.
    Object.defineProperty(file, "size", {
      value: 200 * 1024 * 1024,
      configurable: true,
    });
    await expect(prepareImport(file)).resolves.toBeDefined();
    Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 + 1 });
    await expect(prepareImport(file)).rejects.toThrow("höchstens 200 MB");
  });
  it("erstellt mehr als zehn Hauptordner, Unterordner und vier Ebenen", async () => {
    const roots = [];
    for (let i = 0; i < 12; i++)
      roots.push(await saveFolder(`Fach ${i}`, null, "sage", undefined, db));
    const children = [];
    for (let i = 0; i < 12; i++)
      children.push(
        await saveFolder(`Thema ${i}`, roots[0].id, "sage", undefined, db),
      );
    let parent = children[0];
    for (let level = 3; level <= 8; level++)
      parent = await saveFolder(
        `Ebene ${level}`,
        parent.id,
        "sage",
        undefined,
        db,
      );
    expect(await db.folders.count()).toBe(30);
    await saveFolder("Umbenannt", null, "sage", roots[0].id, db);
    expect((await db.folders.get(roots[0].id))?.name).toBe("Umbenannt");
  });
  it("verschiebt einen Teilbaum in tiefe Ziele und verhindert weiterhin Zyklen", async () => {
    const source = await saveFolder("Quelle", null, "sage", undefined, db);
    const child = await saveFolder("Kind", source.id, "sage", undefined, db);
    let target = await saveFolder("Ziel", null, "sage", undefined, db);
    for (let level = 2; level <= 6; level++)
      target = await saveFolder(
        `Ebene ${level}`,
        target.id,
        "sage",
        undefined,
        db,
      );
    await moveFolder(source.id, target.id, db);
    expect((await db.folders.get(source.id))?.parentId).toBe(target.id);
    expect((await db.folders.get(child.id))?.parentId).toBe(source.id);
    await expect(moveFolder(target.id, child.id, db)).rejects.toThrow(
      "sich selbst",
    );
  });
  it("verschiebt weitere Karten in Ordner mit bereits 1.500 Karten", async () => {
    const target = await saveFolder("Groß", null, "sage", undefined, db);
    const filled = Array.from({ length: 1500 }, (_, i) =>
      card(target.id, `Frage ${i}`),
    );
    await db.cards.bulkAdd(filled);
    const extra = card(null);
    await db.cards.add(extra);
    await moveCard(extra.id, target.id, db);
    expect(await db.cards.where("folderId").equals(target.id).count()).toBe(
      1501,
    );
    expect((await db.cards.get(extra.id))?.schedule).toEqual(extra.schedule);
  });
  it("importiert mehr als 1.500 Karten unterhalb der vierten Ebene", async () => {
    const source = await saveFolder("Quelle", null, "sage", undefined, db);
    await db.cards.bulkAdd(Array.from({ length: 1501 }, () => card(source.id)));
    let target = await saveFolder("Ziel", null, "sage", undefined, db);
    for (let level = 2; level <= 6; level++)
      target = await saveFolder(
        `Ebene ${level}`,
        target.id,
        "sage",
        undefined,
        db,
      );
    const prepared = await prepareImport(
      await exportPackage("share", source.id, db),
    );
    const result = await commitImport(prepared, target.id, db);
    expect(result).toEqual({ folders: 1, cards: 1501 });
    const imported = await db.folders
      .where("parentId")
      .equals(target.id)
      .first();
    expect(await db.cards.where("folderId").equals(imported!.id).count()).toBe(
      1501,
    );
    expect(await db.cards.count()).toBe(3002);
  });
});
describe("Wiederholungen", () => {
  it("nimmt neue und fällige Karten auf, lässt zukünftige Termine aus und bietet ein exaktes Undo", async () => {
    const c = card(null);
    await db.cards.add(c);
    const before = await db.cards.get(c.id);
    const time = new Date();
    const result = await reviewCard(c.id, Rating.Again, time, db);
    const reviewed = (await db.cards.get(c.id))!;
    expect(reviewed.schedule.state).toBe(State.Learning);
    expect(+reviewed.schedule.due).toBeGreaterThan(+time);
    expect(studyQueue([reviewed], +time)).toHaveLength(0);
    expect(studyQueue([reviewed], +reviewed.schedule.due)).toHaveLength(1);
    await undoReview(result.reviewId, db);
    expect((await db.cards.get(c.id))?.schedule).toEqual(before?.schedule);
    expect(await db.reviews.count()).toBe(0);
    await reviewCard(c.id, Rating.Easy, time, db);
    expect((await db.cards.get(c.id))?.schedule.state).toBe(State.Review);
  });
});
describe("Portable Sicherungen", () => {
  it("erhält Bilder und Lernfortschritt und importiert wiederholt ohne Überschreiben", async () => {
    const folder = await saveFolder("Biologie", null, "sage", undefined, db);
    const mediaId = id();
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await db.media.add({
      id: mediaId,
      name: "bild.png",
      type: "image/png",
      data: png.buffer,
    });
    const c = { ...card(folder.id), frontImages: [mediaId] };
    await db.cards.add(c);
    await reviewCard(c.id, Rating.Easy, new Date(), db);
    const original = (await db.cards.get(c.id))!;
    const file = await exportPackage("backup", null, db);
    const prepared = await prepareImport(file);
    await commitImport(prepared, null, db);
    await commitImport(prepared, null, db);
    expect((await db.folders.toArray()).map((f) => f.name).sort()).toEqual([
      "Biologie",
      "Biologie (1)",
      "Biologie (2)",
    ]);
    expect(await db.cards.count()).toBe(3);
    expect(await db.reviews.count()).toBe(3);
    const all = await db.cards.toArray();
    expect(all.every((c) => c.schedule.reps === original.schedule.reps)).toBe(
      true,
    );
    expect(new Set(all.flatMap((c) => c.frontImages)).size).toBe(3);
    const restored = (await db.media.toArray())[0];
    expect(restored.data.byteLength).toBe(png.length);
    expect(await db.cards.get(c.id)).toEqual(original);
  });
  it("exportiert Teilbäume als eigenständige Ordner und setzt geteilte Karten auf neu", async () => {
    const bio = await saveFolder("Biologie", null, "sage", undefined, db);
    const anatomy = await saveFolder("Anatomie", bio.id, "blue", undefined, db);
    const c = card(anatomy.id);
    await db.cards.add(c);
    await reviewCard(c.id, Rating.Easy, new Date(), db);
    const prepared = await prepareImport(
      await exportPackage("share", anatomy.id, db),
    );
    expect(prepared.data.folders).toHaveLength(1);
    expect(prepared.data.folders[0].parentId).toBe(null);
    await commitImport(prepared, null, db);
    const copy = (await db.cards.toArray()).find((v) => v.id !== c.id)!;
    expect(copy.schedule.state).toBe(State.New);
    expect(copy.schedule.reps).toBe(0);
    expect(await db.reviews.count()).toBe(1);
  });
  it("weist beschädigte Daten vor dem ersten Schreibvorgang ab", async () => {
    const f = await saveFolder("Bestehend", null, "sage", undefined, db);
    const file = await exportPackage("backup", null, db);
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const data = JSON.parse(await zip.file("collection.json")!.async("string"));
    data.folders[0].parentId = f.id;
    zip.file("collection.json", JSON.stringify(data));
    const broken = await zip.generateAsync({ type: "blob" });
    await expect(prepareImport(broken)).rejects.toThrow("Ordnerstruktur");
    expect(await db.folders.count()).toBe(1);
  });
  it("erkennt fehlende Bilder, bevor importiert wird", async () => {
    const c = { ...card(null), frontImages: ["missing"] };
    await db.cards.add(c);
    await expect(exportPackage("backup", null, db)).rejects.toThrow(
      "Bild fehlt",
    );
  });
});
