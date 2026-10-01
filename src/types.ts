import type { Card, ReviewLog } from "ts-fsrs";
export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  createdAt: number;
}
export interface Flashcard {
  id: string;
  folderId: string | null;
  front: string;
  back: string;
  frontImages: string[];
  backImages: string[];
  schedule: Card;
  createdAt: number;
  updatedAt: number;
}
export interface Media {
  id: string;
  name: string;
  type: string;
  data: ArrayBuffer;
}
export interface Review {
  id: string;
  cardId: string;
  log: ReviewLog;
  before: Card;
  createdAt: number;
}
export const colors = [
  "sage",
  "blue",
  "amber",
  "rose",
  "violet",
  "stone",
] as const;
