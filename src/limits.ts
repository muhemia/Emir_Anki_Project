import type { Flashcard, Folder } from "./types";

export const MAX_FOLDERS_PER_PARENT = 10;
export const MAX_FOLDER_DEPTH = 4;
export const MAX_CARDS_PER_FOLDER = 1500;

function depthInMap(
  byId: Map<string, Folder>,
  folderId: string | null,
  cache: Map<string | null, number>,
): number {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = folderId;
  while (!cache.has(current)) {
    if (current === null) break;
    if (seen.has(current)) throw new Error("Die Ordnerstruktur ist ungültig.");
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) throw new Error("Der Zielordner wurde entfernt.");
    path.push(current);
    current = folder.parentId;
  }
  let depth = cache.get(current) ?? 0;
  for (let i = path.length - 1; i >= 0; i--) {
    depth++;
    cache.set(path[i], depth);
  }
  return depth;
}

export function folderDepth(
  folders: Folder[],
  folderId: string | null,
): number {
  return depthInMap(
    new Map(folders.map((folder) => [folder.id, folder])),
    folderId,
    new Map([[null, 0]]),
  );
}

function branchHeight(folders: Folder[], folderId: string): number {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    children.set(folder.parentId, siblings);
  }
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: folderId, depth: 1 }];
  let height = 0;
  for (const item of queue) {
    if (visited.has(item.id))
      throw new Error("Die Ordnerstruktur ist ungültig.");
    visited.add(item.id);
    height = Math.max(height, item.depth);
    for (const childId of children.get(item.id) ?? [])
      queue.push({ id: childId, depth: item.depth + 1 });
  }
  return height;
}

export function assertFolderPlacement(
  folders: Folder[],
  parentId: string | null,
  existingId?: string,
) {
  const old = existingId
    ? folders.find((folder) => folder.id === existingId)
    : undefined;
  if (existingId && !old) throw new Error("Der Ordner wurde entfernt.");
  if (old?.parentId === parentId) return;
  const siblings = folders.filter(
    (folder) => folder.parentId === parentId && folder.id !== existingId,
  );
  if (siblings.length >= MAX_FOLDERS_PER_PARENT)
    throw new Error(
      parentId === null
        ? "Es sind maximal 10 Hauptordner möglich."
        : "Pro Ordner sind maximal 10 Unterordner möglich.",
    );
  const height = existingId ? branchHeight(folders, existingId) : 1;
  if (folderDepth(folders, parentId) + height > MAX_FOLDER_DEPTH)
    throw new Error("Es sind maximal vier Ordnerebenen möglich.");
}

export function assertCardCapacity(
  cards: Flashcard[],
  folderId: string | null,
) {
  if (
    cards.filter((card) => card.folderId === folderId).length >=
    MAX_CARDS_PER_FOLDER
  )
    throw new Error("Pro Ordner sind maximal 1.500 Karten möglich.");
}

export function assertImportCapacity(
  existingFolders: Folder[],
  incomingFolders: Folder[],
  existingCards: Flashcard[],
  incomingCards: Flashcard[],
) {
  const folders = [...existingFolders, ...incomingFolders];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depthCache = new Map<string | null, number>([[null, 0]]);
  const childCounts = new Map<string | null, number>();
  for (const folder of folders)
    childCounts.set(
      folder.parentId,
      (childCounts.get(folder.parentId) ?? 0) + 1,
    );
  for (const folder of incomingFolders) {
    if ((childCounts.get(folder.parentId) ?? 0) > MAX_FOLDERS_PER_PARENT)
      throw new Error(
        folder.parentId === null
          ? "Der Import würde das Limit von 10 Hauptordnern überschreiten."
          : "Der Import würde das Limit von 10 Unterordnern pro Ordner überschreiten.",
      );
    if (depthInMap(byId, folder.id, depthCache) > MAX_FOLDER_DEPTH)
      throw new Error(
        "Der Import würde die Grenze von vier Ordnerebenen überschreiten.",
      );
  }
  const cardCounts = new Map<string | null, number>();
  for (const card of [...existingCards, ...incomingCards])
    cardCounts.set(card.folderId, (cardCounts.get(card.folderId) ?? 0) + 1);
  for (const card of incomingCards) {
    if ((cardCounts.get(card.folderId) ?? 0) > MAX_CARDS_PER_FOLDER)
      throw new Error(
        "Der Import würde das Limit von 1.500 Karten pro Ordner überschreiten.",
      );
  }
}
