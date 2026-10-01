import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ArrowLeft,
  Settings2,
  ChevronRight,
  Clock3,
  Folder as FolderIcon,
  FolderPlus,
  HardDrive,
  Image,
  Layers,
  Moon,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { State } from "ts-fsrs";
import { db } from "./db";
import { deleteContent, isDue, scopedCards, subtree } from "./domain";
import type { Flashcard, Folder } from "./types";
import { FolderEditor, CardEditor, MoveDialog } from "./components/Editors";
import { BackupDialog } from "./components/BackupDialog";
import { Study } from "./components/Study";
import { Modal, CardImage, ErrorMessage, errorText } from "./components/ui";

type Dialog =
  | { kind: "folder"; folder?: Folder }
  | { kind: "card"; card?: Flashcard }
  | { kind: "move"; item: "folder" | "card"; id: string }
  | { kind: "delete"; item: "folder" | "card"; id: string; name: string }
  | { kind: "backup"; tab?: "export" | "import" }
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
export default function App() {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog>();
  const [studying, setStudying] = useState(false);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme || "light",
  );
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const {
    offlineReady: [offlineReady],
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
      setCurrentId(null);
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
  const title = folder?.name || "Deine Sammlung";
  const scope = scopedCards(cards, folders, currentId);
  const scopeIds = new Set(scope.map((c) => c.id));
  const due = scope.filter(
    (c) => c.schedule.state !== State.New && isDue(c, now),
  ).length;
  const fresh = scope.filter((c) => c.schedule.state === State.New).length;
  const todayCount = today.filter((r) => scopeIds.has(r.cardId)).length;
  const query = search.toLocaleLowerCase("de").trim();
  const visibleCards = (
    query
      ? scope.filter((c) =>
          `${c.front} ${c.back}`.toLocaleLowerCase("de").includes(query),
        )
      : cards.filter((c) => c.folderId === currentId)
  ).sort((a, b) => b.createdAt - a.createdAt);
  const folderScope = subtree(folders, currentId);
  const visibleFolders = folders
    .filter((f) =>
      query
        ? folderScope.has(f.id) &&
          f.id !== currentId &&
          f.name.toLocaleLowerCase("de").includes(query)
        : f.parentId === currentId,
    )
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  const crumbs: Folder[] = [];
  let ancestor = folder;
  const seen = new Set<string>();
  while (ancestor && !seen.has(ancestor.id)) {
    seen.add(ancestor.id);
    crumbs.unshift(ancestor);
    ancestor = folders.find((f) => f.id === ancestor?.parentId);
  }
  const navigate = (folderId: string | null) => {
    setCurrentId(folderId);
    setSearch("");
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
              aria-label="Zum übergeordneten Ordner"
              onClick={() => navigate(folder.parentId)}
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
          <button onClick={() => navigate(null)}>Sammlung</button>
          {crumbs.map((c) => (
            <span key={c.id}>
              <ChevronRight size={13} />
              <button
                onClick={() => navigate(c.id)}
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
          <div className="page-heading">
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
            <button
              className="button primary"
              onClick={() => open({ kind: "card" })}
            >
              <Plus size={18} />
              Neue Karte
            </button>
          </div>
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
                  <strong>{fresh}</strong>
                  <span>Neue Karten</span>
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
          <div className="collection-toolbar">
            <div className="section-title">
              <h2>{query ? "Suchergebnisse" : "Deine Inhalte"}</h2>
              <span>{scope.length} Karten insgesamt</span>
            </div>
            <div className="toolbar-actions">
              <div className="search-field">
                <Search size={17} />
                <input
                  aria-label="Sammlung durchsuchen"
                  placeholder="Suchen …"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button small"
                    aria-label="Suche leeren"
                    onClick={() => setSearch("")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                className="button secondary"
                onClick={() => open({ kind: "folder" })}
              >
                <FolderPlus size={17} />
                <span>Neuer Ordner</span>
              </button>
            </div>
          </div>
          {visibleFolders.length > 0 && (
            <section className="folder-grid" aria-label="Ordner">
              {visibleFolders.map((f) => {
                const contents = scopedCards(cards, folders, f.id);
                const ready = contents.filter((c) => isDue(c, now)).length;
                return (
                  <article className="folder-card" key={f.id}>
                    <button
                      className="folder-open"
                      onClick={() => navigate(f.id)}
                      aria-label={`Ordner ${f.name} öffnen`}
                    >
                      <div className={`folder-symbol ${f.color}`}>
                        <FolderIcon size={24} strokeWidth={1.6} />
                      </div>
                      <h3>{f.name}</h3>
                      <p>
                        {contents.length}{" "}
                        {contents.length === 1 ? "Karte" : "Karten"}
                        <span>·</span>
                        {ready > 0 ? `${ready} bereit` : "Alles im Blick"}
                      </p>
                      <ArrowUpRight size={17} className="folder-arrow" />
                    </button>
                    <ItemMenu
                      label={f.name}
                      onEdit={() => open({ kind: "folder", folder: f })}
                      onMove={() =>
                        open({ kind: "move", item: "folder", id: f.id })
                      }
                      onDelete={() =>
                        open({
                          kind: "delete",
                          item: "folder",
                          id: f.id,
                          name: f.name,
                        })
                      }
                    />
                  </article>
                );
              })}
            </section>
          )}
          {visibleCards.length > 0 && (
            <section className="cards-section" aria-label="Karteikarten">
              <div className="cards-list-head">
                <span>KARTE</span>
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
                        {c.frontImages.length + c.backImages.length > 0 && (
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
              <span className="eyebrow">
                {query ? "NOCH NICHT GEFUNDEN" : "HIER BEGINNT DEIN WISSEN"}
              </span>
              <h2>
                {query
                  ? "Keine passenden Inhalte."
                  : folder
                    ? "Mach dieses Thema zu deinem."
                    : "Was möchtest du dir merken?"}
              </h2>
              <p>
                {query
                  ? "Probiere einen anderen Suchbegriff. Wir suchen auch in allen Unterordnern."
                  : "Erstelle einen Ordner für dein erstes Thema oder starte direkt mit einer Karte. Der Rest wächst mit dir."}
              </p>
              <div className="empty-actions">
                {query ? (
                  <button
                    className="button secondary"
                    onClick={() => setSearch("")}
                  >
                    Suche zurücksetzen
                  </button>
                ) : (
                  <>
                    <button
                      className="button primary"
                      onClick={() => open({ kind: "folder" })}
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
                  </>
                )}
              </div>
            </section>
          )}
          <footer className="collection-footer">
            <span>
              <HardDrive size={14} />
              {offlineReady
                ? "Auch offline bereit"
                : "Deine Karten bleiben auf diesem Gerät"}
            </span>
            <button onClick={() => open({ kind: "backup" })}>
              Sicherung erstellen <ArrowUpRight size={13} />
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
          parentId={currentId}
          onImport={() => open({ kind: "backup", tab: "import" })}
          onClose={() => setDialog(undefined)}
          onSaved={() =>
            saved(
              dialog.folder
                ? "Ordner gespeichert."
                : "Dein neuer Ordner ist bereit.",
            )
          }
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
          folderId={currentId}
          folderName={folder?.name || "Sammlung"}
          hasContent={!!(folders.length || cards.length)}
          onClose={() => setDialog(undefined)}
          onSaved={setToast}
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
              Diese Aktion kann nur über eine vorherige Sicherung rückgängig
              gemacht werden.
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
                  Sicherung & Import
                  <small>Sammlung sichern oder Karten hinzufügen</small>
                </span>
                <ChevronRight size={18} />
              </button>
              <button
                className="settings-row"
                onClick={async () => {
                  const ok = await navigator.storage
                    ?.persist?.()
                    .catch(() => false);
                  setToast(
                    ok
                      ? "Dauerhafter Speicher wurde gewährt. Bitte trotzdem regelmäßig sichern."
                      : "Der Browser entscheidet über dauerhaften Speicher. Bitte regelmäßig sichern.",
                  );
                }}
              >
                <HardDrive size={21} />
                <span>
                  Speicher schützen<small>Dauerhaften Speicher anfragen</small>
                </span>
                <ChevronRight size={18} />
              </button>
            </section>
            <p className="settings-note">
              Deine Karten liegen auf diesem Gerät. Sichere sie regelmäßig als
              Datei. Beim Wechsel auf ein anderes Gerät oder eine andere
              Website-Adresse kannst du die Sicherung importieren.
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
      <nav className="bottom-nav" aria-label="App-Navigation">
        <button
          className={!dialog || dialog.kind !== "settings" ? "active" : ""}
          aria-current={!dialog ? "page" : undefined}
          onClick={() => {
            setDialog(undefined);
            navigate(null);
          }}
        >
          <Layers size={23} />
          <span>Sammlung</span>
        </button>
        <button onClick={() => setStudying(true)}>
          <BookOpen size={23} />
          <span>Lernen</span>
          {due + fresh > 0 && <i className="tab-dot" />}
        </button>
        <button
          className={dialog?.kind === "settings" ? "active" : ""}
          onClick={() => open({ kind: "settings" })}
        >
          <Settings2 size={23} />
          <span>Mehr</span>
        </button>
      </nav>
    </div>
  );
}
