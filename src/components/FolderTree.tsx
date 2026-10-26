import {
  ArrowUpRight,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { compareFolders, isDue, scopedCards } from "../domain";
import type { Flashcard, Folder } from "../types";
import { FolderDragHandle, useFolderSort } from "./FolderSort";

type Props = {
  folder: Folder;
  folders: Folder[];
  cards: Flashcard[];
  now: number;
  expandedIds: Set<string>;
  showChildren: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onAdd: (id: string) => void;
  onEdit: (folder: Folder) => void;
  onMove: (id: string) => void;
  onDelete: (folder: Folder) => void;
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
    onToggle,
    onOpen,
    onAdd,
    onEdit,
    onMove,
    onDelete,
  } = props;
  const { drag } = useFolderSort();
  const children = folders
    .filter((item) => item.parentId === folder.id)
    .sort(compareFolders);
  const expanded = showChildren && expandedIds.has(folder.id);
  const canExpand = showChildren && children.length > 0;
  const contents = scopedCards(cards, folders, folder.id);
  const ready = contents.filter((card) => isDue(card, now)).length;
  return (
    <article
      className={`folder-card ${drag?.active && drag.folder.id === folder.id ? "is-dragging" : ""} ${drag?.drop?.id === folder.id ? `drop-${drag.drop.placement}` : ""}`}
      data-folder-id={folder.id}
    >
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
              {children.length} Unterordner
              <span aria-hidden="true"> · </span>
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
              <ChevronRight
                size={20}
                className={
                  expanded ? "folder-chevron expanded" : "folder-chevron"
                }
              />
            </button>
          )}
          <FolderDragHandle folder={folder} />
          <details className="item-menu">
            <summary aria-label={`Aktionen für ${folder.name}`}>
              <MoreHorizontal size={20} />
            </summary>
            <div className="menu-panel">
              <button
                onClick={() => {
                  closeMenus();
                  onAdd(folder.id);
                }}
              >
                <FolderPlus size={16} /> Unterordner hinzufügen
              </button>
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
          {expanded &&
            children.map((child) => (
              <FolderTreeNode key={child.id} {...props} folder={child} />
            ))}
        </div>
      )}
    </article>
  );
}
