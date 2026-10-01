import { useState, type FormEvent } from "react";
import {
  Check,
  ImagePlus,
  Trash2,
  FolderOpen,
  ArrowUpRight,
} from "lucide-react";
import { db } from "../db";
import {
  id,
  newSchedule,
  saveFolder,
  subtree,
  moveCard,
  moveFolder,
} from "../domain";
import { processImage } from "../media";
import { colors, type Flashcard, type Folder, type Media } from "../types";
import { Modal, CardImage, ErrorMessage, errorText } from "./ui";

export function FolderEditor({
  folder,
  parentId,
  onClose,
  onSaved,
}: {
  folder?: Folder;
  parentId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(folder?.name || "");
  const [color, setColor] = useState(folder?.color || "sage");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await saveFolder(
        name,
        folder ? folder.parentId : parentId,
        color,
        folder?.id,
      );
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const labels = ["Salbei", "Blau", "Bernstein", "Rosé", "Violett", "Grau"];
  return (
    <Modal
      title={folder ? "Ordner bearbeiten" : "Neuer Ordner"}
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={submit} className="dialog-body">
        <p className="muted">
          Gib deinem Thema einen Platz. Du kannst es jederzeit verschieben.
        </p>
        <label className="field-label" htmlFor="folder-name">
          Name
        </label>
        <input
          id="folder-name"
          autoFocus
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Wie heißt dein Thema?"
          required
        />
        <fieldset className="color-field">
          <legend>Ordnerfarbe</legend>
          <div className="color-options">
            {colors.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`color-dot ${c} ${color === c ? "selected" : ""}`}
                aria-label={labels[i]}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              >
                {color === c && <Check size={18} />}
              </button>
            ))}
          </div>
        </fieldset>
        <ErrorMessage error={error} />
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            Abbrechen
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? "Speichern …" : folder ? "Speichern" : "Ordner erstellen"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function CardEditor({
  card,
  folderId,
  folderName,
  onClose,
  onSaved,
}: {
  card?: Flashcard;
  folderId: string | null;
  folderName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [front, setFront] = useState(card?.front || "");
  const [back, setBack] = useState(card?.back || "");
  const [frontImages, setFrontImages] = useState<string[]>(
    card?.frontImages || [],
  );
  const [backImages, setBackImages] = useState<string[]>(
    card?.backImages || [],
  );
  const [pending, setPending] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const valid =
    (front.trim() || frontImages.length) && (back.trim() || backImages.length);
  const dirty =
    front !== (card?.front || "") ||
    back !== (card?.back || "") ||
    JSON.stringify(frontImages) !== JSON.stringify(card?.frontImages || []) ||
    JSON.stringify(backImages) !== JSON.stringify(card?.backImages || []);
  const close = () => {
    if (
      !busy &&
      !imageBusy &&
      (!dirty || window.confirm("Ungespeicherte Änderungen verwerfen?"))
    )
      onClose();
  };
  async function addImages(files: FileList | null, side: "front" | "back") {
    if (!files?.length) return;
    setImageBusy(true);
    setError("");
    try {
      const existing = side === "front" ? frontImages : backImages;
      if (existing.length + files.length > 20)
        throw new Error("Pro Kartenseite sind maximal 20 Bilder möglich.");
      const processed: Media[] = [];
      for (const file of Array.from(files))
        processed.push(await processImage(file));
      setPending((prev) => [...prev, ...processed]);
      (side === "front" ? setFrontImages : setBackImages)((prev) => [
        ...prev,
        ...processed.map((m) => m.id),
      ]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setImageBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy || imageBusy) return;
    setBusy(true);
    setError("");
    try {
      await db.transaction("rw", db.cards, db.folders, db.media, async () => {
        const target = card ? card.folderId : folderId;
        if (target && !(await db.folders.get(target)))
          throw new Error("Dieser Ordner wurde inzwischen entfernt.");
        const current = card ? await db.cards.get(card.id) : undefined;
        if (card && !current)
          throw new Error("Diese Karte wurde inzwischen entfernt.");
        const imageIds = new Set([...frontImages, ...backImages]);
        await db.media.bulkPut(pending.filter((m) => imageIds.has(m.id)));
        await db.cards.put({
          id: card?.id || id(),
          folderId: target,
          front: front.trim(),
          back: back.trim(),
          frontImages,
          backImages,
          schedule: current?.schedule || newSchedule(),
          createdAt: card?.createdAt || Date.now(),
          updatedAt: Date.now(),
        });
        if (card) {
          const all = await db.cards.toArray();
          const used = new Set(
            all.flatMap((c) => [...c.frontImages, ...c.backImages]),
          );
          await db.media.bulkDelete(
            [...card.frontImages, ...card.backImages].filter(
              (m) => !used.has(m),
            ),
          );
        }
      });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={card ? "Karte bearbeiten" : "Neue Karte"}
      onClose={close}
      wide
    >
      <form onSubmit={submit} className="dialog-body">
        <p className="editor-location">
          <FolderOpen size={15} />
          {folderName}
        </p>
        <div className="editor-sides">
          {(["front", "back"] as const).map((side) => {
            const images = side === "front" ? frontImages : backImages;
            return (
              <section className="editor-side" key={side}>
                <label className="field-label" htmlFor={`${side}-text`}>
                  <span className="eyebrow">
                    {side === "front" ? "01 · VORDERSEITE" : "02 · RÜCKSEITE"}
                  </span>
                  <span>
                    {side === "front" ? "Deine Frage" : "Die Antwort"}
                  </span>
                </label>
                <textarea
                  id={`${side}-text`}
                  autoFocus={side === "front"}
                  maxLength={50000}
                  value={side === "front" ? front : back}
                  onChange={(e) =>
                    (side === "front" ? setFront : setBack)(e.target.value)
                  }
                  placeholder={
                    side === "front"
                      ? "Was möchtest du dir merken?"
                      : "Was ist die richtige Antwort?"
                  }
                  rows={7}
                />
                <div className="editor-images">
                  {images.map((mediaId) => (
                    <div className="image-tile" key={mediaId}>
                      <CardImage
                        mediaId={mediaId}
                        data={pending.find((m) => m.id === mediaId)?.data}
                        type={pending.find((m) => m.id === mediaId)?.type}
                      />
                      <button
                        className="image-remove"
                        type="button"
                        aria-label="Bild entfernen"
                        onClick={() =>
                          (side === "front" ? setFrontImages : setBackImages)(
                            (prev) => prev.filter((i) => i !== mediaId),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <label
                  className={`button image-add ${imageBusy ? "disabled" : ""}`}
                >
                  <ImagePlus size={17} />
                  {imageBusy ? "Bild wird vorbereitet …" : "Bild hinzufügen"}
                  <input
                    className="visually-hidden"
                    aria-label={
                      side === "front"
                        ? "Bild zur Frage hinzufügen"
                        : "Bild zur Antwort hinzufügen"
                    }
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={imageBusy || busy}
                    onChange={(e) => {
                      void addImages(e.target.files, side);
                      e.target.value = "";
                    }}
                  />
                </label>
              </section>
            );
          })}
        </div>
        <p className="small muted">
          Text, Bilder oder beides. Bilder werden bis 2.048 Pixel gespeichert
          und bleiben auf deinem Gerät.
        </p>
        <ErrorMessage error={error} />
        <div className="dialog-actions">
          <button
            className="button secondary"
            type="button"
            onClick={close}
            disabled={busy || imageBusy}
          >
            Abbrechen
          </button>
          <button
            className="button primary"
            disabled={!valid || busy || imageBusy}
          >
            {busy
              ? "Speichern …"
              : card
                ? "Änderungen speichern"
                : "Karte erstellen"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MoveDialog({
  kind,
  itemId,
  folders,
  onClose,
  onSaved,
}: {
  kind: "folder" | "card";
  itemId: string;
  folders: Folder[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const excluded = kind === "folder" ? subtree(folders, itemId) : new Set();
  const paths = (folder: Folder): string => {
    const parent = folders.find((f) => f.id === folder.parentId);
    return parent ? `${paths(parent)} / ${folder.name}` : folder.name;
  };
  async function submit() {
    setBusy(true);
    try {
      if (kind === "folder") await moveFolder(itemId, target);
      else await moveCard(itemId, target);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === "folder" ? "Ordner verschieben" : "Karte verschieben"}
      onClose={() => !busy && onClose()}
    >
      <div className="dialog-body">
        <p className="muted">
          Wähle den neuen Platz. Der Lernfortschritt bleibt erhalten.
        </p>
        <div
          className="destination-list"
          role="radiogroup"
          aria-label="Zielordner"
        >
          <button
            className={target === null ? "selected" : ""}
            role="radio"
            aria-checked={target === null}
            onClick={() => setTarget(null)}
          >
            <ArrowUpRight size={18} />
            <span>
              Sammlung <small>Oberste Ebene</small>
            </span>
            {target === null && <Check size={17} />}
          </button>
          {folders
            .filter((f) => !excluded.has(f.id))
            .sort((a, b) => paths(a).localeCompare(paths(b), "de"))
            .map((f) => (
              <button
                className={target === f.id ? "selected" : ""}
                key={f.id}
                role="radio"
                aria-checked={target === f.id}
                onClick={() => setTarget(f.id)}
              >
                <FolderOpen size={18} />
                <span>{paths(f)}</span>
                {target === f.id && <Check size={17} />}
              </button>
            ))}
        </div>
        <ErrorMessage error={error} />
        <div className="dialog-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Abbrechen
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Verschieben …" : "Hierher verschieben"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
