import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Folder as FolderIcon,
  FolderPlus,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { compareFolders, isDue, scopedCards } from "../domain";
import type { Flashcard, Folder } from "../types";
import { MAX_FOLDER_DEPTH, MAX_FOLDERS_PER_PARENT } from "../limits";

type Props = {
  folder: Folder;
  folders: Folder[];
  cards: Flashcard[];
  now: number;
  expandedIds: Set<string>;
  showChildren: boolean;
  depth: number;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onAdd: (id: string) => void;
  onEdit: (folder: Folder) => void;
  onMove: (id: string) => void;
  onDelete: (folder: Folder) => void;
  onReorder: (id: string, direction: "up" | "down") => void;
};

function closeMenus() {
  document
    .querySelectorAll("details[open]")
    .forEach((item) => item.removeAttribute("open"));
}

export function FolderTreeNode(props: Props) {
  const {
    folder,
    folders,
    cards,
    now,
    expandedIds,
    showChildren,
    depth,
    onToggle,
    onOpen,
    onAdd,
    onEdit,
    onMove,
    onDelete,
    onReorder,
  } = props;
  const siblings = folders
    .filter((item) => item.parentId === folder.parentId)
    .sort(compareFolders);
  const position = siblings.findIndex((item) => item.id === folder.id);
  const children = folders
    .filter((item) => item.parentId === folder.id)
    .sort(compareFolders);
  const expanded = showChildren && expandedIds.has(folder.id);
  const canNest = depth < MAX_FOLDER_DEPTH;
  const canExpand = showChildren && (canNest || children.length > 0);
  const contents = scopedCards(cards, folders, folder.id);
  const ready = contents.filter((card) => isDue(card, now)).length;
  return (
    <article className="folder-card" data-folder-id={folder.id}>
      <div className="folder-card-row">
        <button
          className="folder-open"
          onClick={() => onOpen(folder.id)}
          aria-label={`Ordner ${folder.name} öffnen`}
        >
          <span className={`folder-symbol ${folder.color}`}>
            <FolderIcon size={23} strokeWidth={1.6} />
          </span>
          <span className="folder-card-text">
            <strong>{folder.name}</strong>
            <small>
              {contents.length} {contents.length === 1 ? "Karte" : "Karten"}
              <span aria-hidden="true"> · </span>
              {ready > 0 ? `${ready} bereit` : "Alles im Blick"}
            </small>
          </span>
        </button>
        <div className="folder-card-actions">
          {canExpand && (
            <button
              className="folder-action-button"
              aria-label={`Unterordner von ${folder.name} ${expanded ? "ausblenden" : "anzeigen"}`}
              aria-expanded={expanded}
              aria-controls={`subfolders-${folder.id}`}
              onClick={() => onToggle(folder.id)}
            >
              {expanded ? <Minus size={20} /> : <Plus size={20} />}
            </button>
          )}
          <details className="item-menu order-menu">
            <summary aria-label={`Reihenfolge für ${folder.name}`}>
              <ListOrdered size={20} />
            </summary>
            <div className="menu-panel">
              <button
                disabled={position <= 0}
                onClick={() => {
                  closeMenus();
                  onReorder(folder.id, "up");
                }}
              >
                <ArrowUp size={16} /> Nach oben
              </button>
              <button
                disabled={position >= siblings.length - 1}
                onClick={() => {
                  closeMenus();
                  onReorder(folder.id, "down");
                }}
              >
                <ArrowDown size={16} /> Nach unten
              </button>
            </div>
          </details>
          <details className="item-menu">
            <summary aria-label={`Aktionen für ${folder.name}`}>
              <MoreHorizontal size={21} />
            </summary>
            <div className="menu-panel">
              <button
                onClick={() => {
                  closeMenus();
                  onEdit(folder);
                }}
              >
                <Pencil size={16} /> Bearbeiten
              </button>
              <button
                onClick={() => {
                  closeMenus();
                  onMove(folder.id);
                }}
              >
                <ArrowUpRight size={16} /> Verschieben
              </button>
              <button
                className="danger-text"
                onClick={() => {
                  closeMenus();
                  onDelete(folder);
                }}
              >
                <Trash2 size={16} /> Löschen
              </button>
            </div>
          </details>
        </div>
      </div>
      {canExpand && (
        <div
          id={`subfolders-${folder.id}`}
          className="subfolder-list"
          hidden={!expanded}
        >
          {expanded && (
            <>
              {children.map((child) => (
                <FolderTreeNode
                  key={child.id}
                  {...props}
                  folder={child}
                  depth={depth + 1}
                />
              ))}
              {canNest && (
                <button
                  className="add-subfolder"
                  onClick={() => onAdd(folder.id)}
                  disabled={children.length >= MAX_FOLDERS_PER_PARENT}
                  title="Maximal 10 Unterordner pro Ordner"
                >
                  <FolderPlus size={18} />
                  {children.length >= MAX_FOLDERS_PER_PARENT
                    ? "10/10 Unterordner"
                    : "Unterordner hinzufügen"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
