import Dexie, { type EntityTable } from "dexie";
import type { Folder, Flashcard, Media, Review } from "./types";

export class CardsDatabase extends Dexie {
  folders!: EntityTable<Folder, "id">;
  cards!: EntityTable<Flashcard, "id">;
  media!: EntityTable<Media, "id">;
  reviews!: EntityTable<Review, "id">;
  constructor(name = "emir-cards-v1") {
    super(name);
    this.version(1).stores({
      folders: "id, parentId",
      cards: "id, folderId, schedule.due",
      media: "id",
      reviews: "id, cardId, createdAt",
    });
  }
}
export const db = new CardsDatabase();
