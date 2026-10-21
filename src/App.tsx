import { useEffect, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ArrowLeft,
  Settings2,
  ChevronRight,
  Clock3,
  FolderPlus,
  HardDrive,
  Image,
  Layers,
  Moon,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { State } from "ts-fsrs";
import { db } from "./db";
import { subscribeSync, getSyncState } from "./remote";
import { isNative, saveNativeTheme } from "./native-storage";
import {
  compareFolders,
  deleteContent,
  isDue,
  reorderFolder,
  scopedCards,
} from "./domain";
import type { Flashcard, Folder } from "./types";
import { FolderEditor, CardEditor, MoveDialog } from "./components/Editors";
import { BackupDialog } from "./components/BackupDialog";
import { Study } from "./components/Study";
import { FolderSort } from "./components/FolderSort";
import { FolderTreeNode } from "./components/FolderTree";
import { Modal, CardImage, ErrorMessage, errorText } from "./components/ui";
import {
  folderDepth,
  MAX_CARDS_PER_FOLDER,
  MAX_FOLDERS_PER_PARENT,
} from "./limits";

type Dialog =
  | { kind: "folder"; folder?: Folder; parentId?: string; fromTree?: boolean }
  | { kind: "card"; card?: Flashcard }
  | { kind: "move"; item: "folder" | "card"; id: string }
  | { kind: "delete"; item: "folder" | "card"; id: string; name: string }
  | { kind: "backup"; tab?: "export" | "import"; folderId?: string | null }
  | { kind: "settings" }
  | { kind: "preview"; card: Flashcard };
function closeMenus() {
  document
    .querySelectorAll("details[open]")
    .forEach((d) => d.removeAttribute("open"));
}
function ItemMenu({
  label,
  onEdit,
  onMove,
  onDelete,
}: {
  label: string;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <details className="item-menu">
      <summary aria-label={`Aktionen für ${label}`}>
        <MoreHorizontal size={21} />
      </summary>
      <div className="menu-panel">
        <button
          onClick={() => {
            closeMenus();
            onEdit();
          }}
        >
          <Pencil size={16} />
          Bearbeiten
        </button>
        <button
          onClick={() => {
            closeMenus();
            onMove();
          }}
        >
          <ArrowUpRight size={16} />
          Verschieben
        </button>
        <button
          className="danger-text"
          onClick={() => {
            closeMenus();
            onDelete();
          }}
        >
          <Trash2 size={16} />
          Löschen
        </button>
      </div>
    </details>
  );
}
export default function App({
  username,
  onLogout,
}: {
  username?: string;
  onLogout?: () => Promise<void>;
}) {
  const [navigationPath, setNavigationPath] = useState<(string | null)[]>([
    null,
  ]);
  const currentId = navigationPath.at(-1) ?? null;
  const [cardsExpanded, setCardsExpanded] = useState(false);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [dialog, setDialog] = useState<Dialog>();
  const [studying, setStudying] = useState(false);
  const sync = useSyncExternalStore(subscribeSync, getSyncState);
  useEffect(() => {
    if (!isNative) {
      setStudying(false);
      setDialog(undefined);
    }
  }, [sync.lastSynced]);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme || "light",
  );
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const data = useLiveQuery(async () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return {
      folders: await db.folders.toArray(),
      cards: await db.cards.toArray(),
      today: await db.reviews
        .where("createdAt")
        .aboveOrEqual(+midnight)
        .toArray(),
    };
  }, [new Date(now).toDateString()]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("emir-theme", theme);
    } catch {}
    void saveNativeTheme(theme);
  }, [theme]);
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (!(e.target as Element).closest("details")) closeMenus();
    };
    document.addEventListener("click", fn);
    return () => document.removeEventListener("click", fn);
  }, []);
  useEffect(() => {
    if (data && currentId && !data.folders.some((f) => f.id === currentId))
      setNavigationPath([null]);
  }, [data, currentId]);
  if (!data)
    return (
      <div className="loading-screen">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <p>Dein Lernraum wird geöffnet …</p>
      </div>
    );
  const { folders, cards, today } = data;
  const folder = folders.find((f) => f.id === currentId);
  const backupFolderId =
    dialog?.kind === "backup" && dialog.folderId !== undefined
      ? dialog.folderId
      : currentId;
  const title = folder?.name || "Deine Sammlung";
  const scope = scopedCards(cards, folders, currentId);
  const scopeIds = new Set(scope.map((c) => c.id));
  const due = scope.filter(
    (c) => c.schedule.state !== State.New && isDue(c, now),
  ).length;
  const fresh = scope.filter((c) => c.schedule.state === State.New).length;
  const todayCount = today.filter((r) => scopeIds.has(r.cardId)).length;
  const visibleCards = cards
    .filter((c) => c.folderId === currentId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const visibleFolders = folders
    .filter((f) => f.parentId === currentId)
    .sort(compareFolders);
  const rootFolderCount = folders.filter((f) => f.parentId === null).length;
  const childFolderDepth = folder ? folderDepth(folders, currentId) + 1 : 1;
  const crumbs = navigationPath
    .slice(1)
    .map((id) => folders.find((f) => f.id === id))
    .filter((item): item is Folder => !!item);
  const navigate = (folderId: string | null) => {
    setNavigationPath((path) =>
      folderId === null
        ? [null]
        : path.at(-1) === folderId
          ? path
          : [...path, folderId],
    );
    setCardsExpanded(false);
  };
  const navigateToPath = (index: number) => {
    setNavigationPath((path) => path.slice(0, index + 1));
    setCardsExpanded(false);
  };
  const toggleFolder = (folderId: string) => {
    closeMenus();
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };
  const saved = (message: string) => {
    setDialog(undefined);
    setToast(message);
  };
  const open = (next: Dialog) => {
    setError("");
    setDialog(next);
  };
  async function remove() {
    if (dialog?.kind !== "delete") return;
    setBusy(true);
    setError("");
    try {
      await deleteContent(dialog.item, dialog.id);
      saved("Aus deiner Sammlung entfernt.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (studying)
    return (
      <Study
        folderId={currentId}
        folderName={folder?.name || "Deine Sammlung"}
        onExit={() => setStudying(false)}
      />
    );
  return (
    <div className="native-shell">
      <div className="workspace">
        <header className="native-header">
          {folder ? (
            <button
              className="icon-button"
              aria-label="Zur vorherigen Ansicht"
              onClick={() => navigateToPath(navigationPath.length - 2)}
            >
              <ArrowLeft size={23} />
            </button>
          ) : (
            <div className="native-brand">
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
              <span>emir cards</span>
            </div>
          )}
          {folder && <span className="native-header-title">{folder.name}</span>}
          <button
            className="icon-button"
            aria-label="Einstellungen öffnen"
            onClick={() => open({ kind: "settings" })}
          >
            <Settings2 size={22} />
          </button>
        </header>
        <nav aria-label="Ordnerpfad" className="breadcrumbs native-crumbs">
          <button onClick={() => navigateToPath(0)}>Sammlung</button>
          {crumbs.map((c, index) => (
            <span key={c.id}>
              <ChevronRight size={13} />
              <button
                onClick={() => navigateToPath(index + 1)}
                aria-current={c.id === currentId ? "page" : undefined}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        <main className="main-content">
          {needRefresh && (
            <div className="update-banner">
              <span>
                Eine neue Version ist bereit. Speichere offene Änderungen und
                aktualisiere die App.
              </span>
              <button
                className="button secondary"
                onClick={() => void updateServiceWorker(true)}
              >
                Aktualisieren
              </button>
            </div>
          )}
          <div
            className={`page-heading ${folder ? "folder-heading" : "collection-heading"}`}
          >
            <div>
              <h1>
                {title}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {folder
                  ? "Alle Karten dieses Themas und seiner Unterordner."
                  : "Deine Themen. Dein Tempo."}
              </p>
            </div>
            {!folder && (
              <button
                className="button primary new-root-folder"
                onClick={() => open({ kind: "folder" })}
                disabled={rootFolderCount >= MAX_FOLDERS_PER_PARENT}
                title="Maximal 10 Hauptordner"
                aria-label={
                  rootFolderCount >= MAX_FOLDERS_PER_PARENT
                    ? "Limit erreicht: 10 Hauptordner"
                    : undefined
                }
              >
                <FolderPlus size={18} />
                {rootFolderCount >= MAX_FOLDERS_PER_PARENT
                  ? "10/10 Ordner"
                  : "Neuer Ordner"}
              </button>
            )}
            {folder && (
              <button
                className="button primary new-folder-card"
                onClick={() => open({ kind: "card" })}
                disabled={visibleCards.length >= MAX_CARDS_PER_FOLDER}
                title="Maximal 1.500 Karten direkt pro Ordner"
              >
                <Plus size={18} />
                {visibleCards.length >= MAX_CARDS_PER_FOLDER
                  ? "1.500/1.500 Karten"
                  : "Neue Karte"}
              </button>
            )}
          </div>
          {folder && (
            <section className="overview" aria-label="Lernübersicht">
              <div className="stats">
                <div className="stat">
                  <span className="stat-icon">
                    <Clock3 size={19} />
                  </span>
                  <div>
                    <strong>{due}</strong>
                    <span>Jetzt fällig</span>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-icon">
                    <Sparkles size={19} />
                  </span>
                  <div>
                    <strong>{scope.length}</strong>
                    <span>Karten insgesamt</span>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-icon">
                    <Check size={19} />
                  </span>
                  <div>
                    <strong>{todayCount}</strong>
                    <span>Heute wiederholt</span>
                  </div>
                </div>
              </div>
              <button
                className="study-start"
                onClick={() => setStudying(true)}
                disabled={!scope.length}
              >
                <span className="play-icon">
                  <Play size={16} fill="currentColor" />
                </span>
                <span>
                  <strong>Lernen starten</strong>
                  <small>
                    {due + fresh
                      ? `${due + fresh} Karten bereit`
                      : "In deinem Tempo"}
                  </small>
                </span>
                <ArrowRight size={19} />
              </button>
            </section>
          )}
          {folder && (
            <div className="collection-toolbar">
              <div className="section-title">
                <h2>Deine Inhalte</h2>
                <span>{visibleCards.length}/1.500 hier</span>
              </div>
            </div>
          )}
          {visibleFolders.length > 0 && (
            <FolderSort
              folders={folders}
              onReorder={async (id, targetId, placement) => {
                try {
                  await reorderFolder(id, targetId, placement);
                } catch (e) {
                  setToast(errorText(e));
                  throw e;
                }
              }}
            >
              <section className="folder-tree" aria-label="Ordner">
                {visibleFolders.map((f) => (
                  <FolderTreeNode
                    key={f.id}
                    folder={f}
                    folders={folders}
                    cards={cards}
                    now={now}
                    expandedIds={expandedFolderIds}
                    showChildren
                    depth={childFolderDepth}
                    onToggle={toggleFolder}
                    onOpen={navigate}
                    onAdd={(parentId) =>
                      open({ kind: "folder", parentId, fromTree: true })
                    }
                    onEdit={(item) => open({ kind: "folder", folder: item })}
                    onMove={(id) => open({ kind: "move", item: "folder", id })}
                    onDelete={(item) =>
                      open({
                        kind: "delete",
                        item: "folder",
                        id: item.id,
                        name: item.name,
                      })
                    }
                  />
                ))}
              </section>
            </FolderSort>
          )}
          {visibleCards.length > 0 && (
            <section className="cards-section" aria-label="Karteikarten">
              <button
                className="cards-toggle"
                aria-expanded={cardsExpanded}
                aria-controls="card-list"
                aria-label={
                  cardsExpanded ? "Karten ausblenden" : "Karten anzeigen"
                }
                onClick={() => {
                  closeMenus();
                  setCardsExpanded(!cardsExpanded);
                }}
              >
                <ChevronRight
                  size={20}
                  className={cardsExpanded ? "expanded" : ""}
                />
                <span>Karten</span>
                <span className="cards-count">{visibleCards.length}</span>
              </button>
              <div
                id="card-list"
                key={currentId}
                className="cards-scroll"
                role="region"
                aria-label="Kartenliste"
                tabIndex={0}
                hidden={!cardsExpanded}
              >
                {cardsExpanded && (
                  <>
                    <div className="cards-list-head">
                      <span>FRAGE</span>
                      <span>LERNSTAND</span>
                    </div>
                    {visibleCards.map((c) => (
                      <article className="card-row" key={c.id}>
                        <button
                          className="card-row-content"
                          onClick={() => open({ kind: "preview", card: c })}
                        >
                          <span className="card-symbol">
                            <Layers size={19} />
                          </span>
                          <span className="card-row-text">
                            <strong>{c.front || "Bildkarte"}</strong>
                            <small>
                              {c.back || "Antwort mit Bild"}
                              {c.frontImages.length + c.backImages.length >
                                0 && (
                                <span className="has-image">
                                  <Image size={12} />
                                  {c.frontImages.length + c.backImages.length}
                                </span>
                              )}
                            </small>
                          </span>
                          <span
                            className={`badge ${c.schedule.state === State.New ? "new" : isDue(c, now) ? "due" : ""}`}
                          >
                            {c.schedule.state === State.New
                              ? "Neu"
                              : isDue(c, now)
                                ? "Fällig"
                                : new Date(c.schedule.due).toLocaleDateString(
                                    "de-DE",
                                    { day: "2-digit", month: "2-digit" },
                                  )}
                          </span>
                        </button>
                        <ItemMenu
                          label={c.front || "Bildkarte"}
                          onEdit={() => open({ kind: "card", card: c })}
                          onMove={() =>
                            open({ kind: "move", item: "card", id: c.id })
                          }
                          onDelete={() =>
                            open({
                              kind: "delete",
                              item: "card",
                              id: c.id,
                              name: c.front || "Bildkarte",
                            })
                          }
                        />
                      </article>
                    ))}
                  </>
                )}
              </div>
            </section>
          )}
          {!visibleFolders.length && !visibleCards.length && (
            <section className="empty-state">
              <div className="empty-art">
                <div className="empty-card back">
                  <span />
                </div>
                <div className="empty-card front">
                  <Sparkles size={25} />
                  <i />
                  <i />
                  <i />
                </div>
                <span className="art-dot one" />
                <span className="art-dot two" />
              </div>
              <span className="eyebrow">HIER BEGINNT DEIN WISSEN</span>
              <h2>
                {folder
                  ? "Mach dieses Thema zu deinem."
                  : "Was möchtest du dir merken?"}
              </h2>
              <p>
                {folder
                  ? "Füge hier deine erste Karte hinzu."
                  : "Erstelle einen Ordner für dein erstes Thema. Der Rest wächst mit dir."}
              </p>
              {!folder && (
                <div className="empty-actions">
                  <button
                    className="button primary"
                    onClick={() => open({ kind: "folder" })}
                    disabled={rootFolderCount >= MAX_FOLDERS_PER_PARENT}
                  >
                    <FolderPlus size={18} />
                    Ersten Ordner erstellen
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => open({ kind: "backup", tab: "import" })}
                  >
                    <Upload size={16} />
                    Sammlung importieren
                  </button>
                </div>
              )}
            </section>
          )}
          <footer className="collection-footer">
            <span>
              <HardDrive size={14} />
              {isNative
                ? "Deine Karten bleiben auf diesem Gerät"
                : "Lokal gespeichert · Mit Synchronisieren im Konto sichern"}
            </span>
            <button onClick={() => open({ kind: "backup" })}>
              Anki-Paket exportieren <ArrowUpRight size={13} />
            </button>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <button aria-label="Hinweis schließen" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {dialog?.kind === "folder" && (
        <FolderEditor
          folder={dialog.folder}
          parentId={dialog.parentId ?? currentId}
          fromTree={dialog.fromTree}
          onImport={() =>
            open({
              kind: "backup",
              tab: "import",
              folderId: dialog.parentId ?? currentId,
            })
          }
          onClose={() => setDialog(undefined)}
          onSaved={() => {
            if (dialog.fromTree && dialog.parentId && !dialog.folder) {
              setExpandedFolderIds(
                (ids) => new Set([...ids, dialog.parentId!]),
              );
            }
            saved(
              dialog.folder
                ? "Ordner gespeichert."
                : "Dein neuer Ordner ist bereit.",
            );
          }}
        />
      )}
      {dialog?.kind === "card" && (
        <CardEditor
          card={dialog.card}
          folderId={currentId}
          folderName={
            dialog.card
              ? folders.find((f) => f.id === dialog.card?.folderId)?.name ||
                "Sammlung"
              : folder?.name || "Sammlung"
          }
          onClose={() => setDialog(undefined)}
          onSaved={() =>
            saved(
              dialog.card
                ? "Karte gespeichert."
                : "Eine neue Karte für dein Wissen.",
            )
          }
        />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog
          kind={dialog.item}
          itemId={dialog.id}
          folders={folders}
          onClose={() => setDialog(undefined)}
          onSaved={() => saved("An den neuen Platz verschoben.")}
        />
      )}
      {dialog?.kind === "backup" && (
        <BackupDialog
          initialTab={dialog.tab}
          folderId={backupFolderId}
          folderName={
            folders.find((f) => f.id === backupFolderId)?.name || "Sammlung"
          }
          hasContent={!!(folders.length || cards.length)}
          directCardCount={
            cards.filter((card) => card.folderId === backupFolderId).length
          }
          onClose={() => setDialog(undefined)}
          onSaved={(message) => {
            setToast(message);
            if (dialog.tab === "import" && backupFolderId) {
              setExpandedFolderIds((ids) => new Set([...ids, backupFolderId]));
            }
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <Modal
          title={
            dialog.item === "folder" ? "Ordner löschen?" : "Karte löschen?"
          }
          onClose={() => !busy && setDialog(undefined)}
        >
          <div className="dialog-body">
            <p className="delete-name">{dialog.name}</p>
            <p className="muted">
              {dialog.item === "folder"
                ? `Dabei werden alle Unterordner und ${scopedCards(cards, folders, dialog.id).length} enthaltenen Karten mit ihrem Lernfortschritt gelöscht.`
                : "Die Karte und ihr Lernfortschritt werden gelöscht."}{" "}
              Ein zuvor exportiertes Anki-Paket kann die Karten wieder
              hinzufügen. Ihr Lernfortschritt startet in Emir Cards neu.
            </p>
            <ErrorMessage error={error} />
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setDialog(undefined)}
              >
                Abbrechen
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy ? "Löschen …" : "Endgültig löschen"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog?.kind === "preview" && (
        <Modal title="Karte ansehen" onClose={() => setDialog(undefined)} wide>
          <div className="dialog-body preview-content">
            <span className="eyebrow">FRAGE</span>
            <p>{dialog.card.front}</p>
            <div className="study-media">
              {dialog.card.frontImages.map((m) => (
                <CardImage key={m} mediaId={m} zoom />
              ))}
            </div>
            <hr />
            <span className="eyebrow">ANTWORT</span>
            <p>{dialog.card.back}</p>
            <div className="study-media">
              {dialog.card.backImages.map((m) => (
                <CardImage key={m} mediaId={m} zoom />
              ))}
            </div>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => open({ kind: "card", card: dialog.card })}
              >
                <Pencil size={17} />
                Karte bearbeiten
              </button>
              <button
                className="button primary"
                onClick={() => setDialog(undefined)}
              >
                Fertig
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog?.kind === "settings" && (
        <Modal title="Deine Einstellungen" onClose={() => setDialog(undefined)}>
          <div className="dialog-body settings-body">
            <section className="settings-group">
              <h3>Darstellung</h3>
              <button
                className="settings-row"
                aria-label={
                  theme === "light"
                    ? "Dunkelmodus aktivieren"
                    : "Hellmodus aktivieren"
                }
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              >
                {theme === "light" ? <Moon size={21} /> : <Sun size={21} />}
                <span>Dunkelmodus</span>
                <span
                  className={`theme-switch ${theme === "dark" ? "on" : ""}`}
                  aria-hidden="true"
                >
                  <i />
                </span>
              </button>
            </section>
            <section className="settings-group">
              <h3>Deine Daten</h3>
              <button
                className="settings-row"
                onClick={() => open({ kind: "backup" })}
              >
                <ShieldCheck size={21} />
                <span>
                  Anki-Export & Import
                  <small>
                    Sammlung als .apkg speichern oder Karten hinzufügen
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            </section>
            {onLogout && (
              <section className="settings-group">
                <h3>Konto</h3>
                <p className="muted">Angemeldet als {username}</p>
                <ErrorMessage error={error} />
                <button
                  className="settings-row"
                  onClick={() =>
                    void onLogout().catch((reason) =>
                      setError(errorText(reason)),
                    )
                  }
                >
                  <span>Abmelden</span>
                  <ArrowRight size={18} />
                </button>
              </section>
            )}
            <p className="settings-note">
              {isNative
                ? "Deine Karten liegen auf diesem Gerät."
                : "Änderungen werden lokal gespeichert und beim Synchronisieren in dein Konto übertragen."}{" "}
              Du kannst sie zusätzlich als Anki-Paket (.apkg) exportieren.
            </p>
            <div className="app-version">
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
              <span>
                Emir Cards
                <small>Version 1.1 · Dein persönlicher Lernraum</small>
              </span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
