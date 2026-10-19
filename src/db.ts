import Dexie, { type EntityTable } from "dexie";
import type { Folder, Flashcard, Media, Review } from "./types";

export class CardsDatabase extends Dexie {
  folders!: EntityTable<Folder, "id">;
  cards!: EntityTable<Flashcard, "id">;
  media!: EntityTable<Media, "id">;
  reviews!: EntityTable<Review, "id">;
  syncState!: EntityTable<{ id: string; value: any }, "id">;
  constructor(name = "emir-cards-v1") {
    super(name);
    this.version(1).stores({
      folders: "id, parentId",
      cards: "id, folderId, schedule.due",
      media: "id",
      reviews: "id, cardId, createdAt",
    });
    this.version(2).stores({ syncState: "id" });
  }
}
export let db = new CardsDatabase();
export async function selectAccountDatabase(userId: string) {
  const name = `emir-cards-account-${userId}`;
  if (db.name !== name) {
    db.close();
    db = new CardsDatabase(name);
  }
  await db.open();
}
