import { createEmptyCard, fsrs, State, type Grade, type Card } from "ts-fsrs";
import type { Flashcard, Folder } from "./types";
import { db, type CardsDatabase } from "./db";

export const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: false,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["1m", "10m"],
});
export const newSchedule = () => createEmptyCard(new Date());
export const id = () => crypto.randomUUID();
export function subtree(
  folders: Folder[],
  root: string | null,
): Set<string | null> {
  const result = new Set<string | null>([root]);
  const queue: (string | null)[] = [root];
  for (let i = 0; i < queue.length; i++) {
    for (const folder of folders) {
      if (folder.parentId === queue[i] && !result.has(folder.id)) {
        result.add(folder.id);
        queue.push(folder.id);
      }
    }
  }
  return result;
}
export function scopedCards(
  cards: Flashcard[],
  folders: Folder[],
  root: string | null,
) {
  const ids = subtree(folders, root);
  return cards.filter((c) => ids.has(c.folderId));
}
export function isDue(card: Flashcard, now = Date.now()) {
  return (
    card.schedule.state === State.New ||
    new Date(card.schedule.due).getTime() <= now
  );
}
export function studyQueue(cards: Flashcard[], now = Date.now()) {
  return cards
    .filter((c) => isDue(c, now))
    .sort((a, b) => {
      const aNew = a.schedule.state === State.New,
        bNew = b.schedule.state === State.New;
      if (aNew !== bNew) return aNew ? 1 : -1;
      return aNew
        ? a.createdAt - b.createdAt
        : +new Date(a.schedule.due) - +new Date(b.schedule.due);
    });
}
export function uniqueName(name: string, used: string[]) {
  const clean = name.trim();
  const lower = new Set(used.map((n) => n.toLocaleLowerCase("de")));
  if (!lower.has(clean.toLocaleLowerCase("de"))) return clean;
  let n = 1;
  while (lower.has(`${clean} (${n})`.toLocaleLowerCase("de"))) n++;
  return `${clean} (${n})`;
}
export async function saveFolder(
  name: string,
  parentId: string | null,
  color: string,
  existingId?: string,
  database = db,
) {
  const clean = name.trim();
  if (!clean || clean.length > 120)
    throw new Error("Bitte gib einen Namen mit 1 bis 120 Zeichen ein.");
  return database.transaction("rw", database.folders, async () => {
    if (parentId && !(await database.folders.get(parentId)))
      throw new Error("Der Zielordner wurde entfernt.");
    const all = await database.folders.toArray();
    const old = existingId ? all.find((f) => f.id === existingId) : undefined;
    if (existingId && !old) throw new Error("Der Ordner wurde entfernt.");
    if (existingId && subtree(all, existingId).has(parentId))
      throw new Error(
        "Ein Ordner kann nicht in sich selbst verschoben werden.",
      );
    const folder: Folder = {
      id: existingId || id(),
      name: uniqueName(
        clean,
        all
          .filter((f) => f.parentId === parentId && f.id !== existingId)
          .map((f) => f.name),
      ),
      parentId,
      color,
      createdAt: old?.createdAt || Date.now(),
    };
    await database.folders.put(folder);
    return folder;
  });
}
export async function moveFolder(
  folderId: string,
  target: string | null,
  database = db,
) {
  const folder = await database.folders.get(folderId);
  if (!folder) throw new Error("Der Ordner wurde entfernt.");
  return saveFolder(folder.name, target, folder.color, folderId, database);
}
export async function moveCard(
  cardId: string,
  target: string | null,
  database = db,
) {
  return database.transaction(
    "rw",
    database.cards,
    database.folders,
    async () => {
      if (target && !(await database.folders.get(target)))
        throw new Error("Der Zielordner wurde entfernt.");
      if (
        !(await database.cards.update(cardId, {
          folderId: target,
          updatedAt: Date.now(),
        }))
      )
        throw new Error("Die Karte wurde entfernt.");
    },
  );
}
export async function deleteContent(
  kind: "folder" | "card",
  itemId: string,
  database = db,
) {
  await database.transaction(
    "rw",
    database.folders,
    database.cards,
    database.media,
    database.reviews,
    async () => {
      const folders = await database.folders.toArray();
      const all = await database.cards.toArray();
      const targets =
        kind === "folder" ? subtree(folders, itemId) : new Set<string>();
      const cards = all.filter((c) =>
        kind === "card" ? c.id === itemId : targets.has(c.folderId),
      );
      const ids = cards.map((c) => c.id);
      await database.reviews.where("cardId").anyOf(ids).delete();
      await database.cards.bulkDelete(ids);
      if (kind === "folder")
        await database.folders.bulkDelete(
          [...targets].filter((v): v is string => v !== null),
        );
      const remaining = all.filter((c) => !ids.includes(c.id));
      const referenced = new Set(
        remaining.flatMap((c) => [...c.frontImages, ...c.backImages]),
      );
      const removed = cards
        .flatMap((c) => [...c.frontImages, ...c.backImages])
        .filter((m) => !referenced.has(m));
      await database.media.bulkDelete(removed);
    },
  );
}
export async function reviewCard(
  cardId: string,
  grade: Grade,
  now: Date,
  database: CardsDatabase = db,
) {
  return database.transaction(
    "rw",
    database.cards,
    database.reviews,
    async () => {
      const card = await database.cards.get(cardId);
      if (!card) throw new Error("Diese Karte wurde entfernt.");
      const result = scheduler.next(card.schedule, now, grade);
      const reviewId = id();
      await database.reviews.add({
        id: reviewId,
        cardId,
        log: result.log,
        before: card.schedule,
        createdAt: +now,
      });
      await database.cards.update(cardId, {
        schedule: result.card,
        updatedAt: +now,
      });
      return { reviewId, cardId };
    },
  );
}
export async function undoReview(reviewId: string, database = db) {
  await database.transaction(
    "rw",
    database.cards,
    database.reviews,
    async () => {
      const review = await database.reviews.get(reviewId);
      if (!review) throw new Error("Diese Bewertung ist nicht mehr verfügbar.");
      const latest = (
        await database.reviews
          .where("cardId")
          .equals(review.cardId)
          .sortBy("createdAt")
      ).at(-1);
      if (latest?.id !== reviewId)
        throw new Error("Die Karte wurde inzwischen erneut bewertet.");
      if (
        !(await database.cards.update(review.cardId, {
          schedule: review.before,
          updatedAt: Date.now(),
        }))
      )
        throw new Error("Die Karte wurde entfernt.");
      await database.reviews.delete(reviewId);
    },
  );
}
export function intervalLabel(due: Date | number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((+new Date(due) - now) / 1000));
  if (seconds < 60) return `${seconds} Sek.`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} Min.`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} Std.`;
  const days = Math.round(seconds / 86400);
  return days === 1 ? "1 Tag" : `${days} Tage`;
}
export function hydrateSchedule(schedule: Card): Card {
  return {
    ...schedule,
    due: new Date(schedule.due),
    last_review: schedule.last_review
      ? new Date(schedule.last_review)
      : undefined,
  };
}
