import { useRef, useState } from "react";
import JSZip from "jszip";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import {
  Download,
  Upload,
  ShieldCheck,
  FileArchive,
  Check,
  FolderOpen,
  Layers,
} from "lucide-react";
import { commitImport, prepareImport, type PreparedImport } from "../backup";
import { exportAnkiPackage, prepareAnkiImport } from "../anki";
import { Modal, ErrorMessage, errorText } from "./ui";
import { isNative, saveNativeExportDate } from "../native-storage";

export function BackupDialog({
  folderId,
  folderName,
  hasContent,
  directCardCount,
  initialTab = "export",
  onClose,
  onSaved,
}: {
  folderId: string | null;
  folderName: string;
  hasContent: boolean;
  directCardCount: number;
  initialTab?: "export" | "import";
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [tab, setTab] = useState<"export" | "import">(initialTab);
  const [kind, setKind] = useState<"anki" | "share" | "cards">("anki");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<PreparedImport>();
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const reading = useRef(false);
  async function download() {
    setBusy(true);
    setError("");
    try {
      const blob = await exportAnkiPackage(
        kind === "anki" ? null : folderId,
        kind === "anki",
        undefined,
        kind === "cards" ? "direct" : "subtree",
      );
      const safeName = folderName
        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
        .slice(0, 60);
      const filename = `emir-${kind === "anki" ? "anki-sammlung" : kind === "cards" ? `${safeName}-nur-karten` : safeName}-${new Date().toISOString().slice(0, 10)}.apkg`;
      if (isNative) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        await Filesystem.writeFile({
          path: filename,
          data: btoa(binary),
          directory: Directory.Cache,
        });
        const file = await Filesystem.getUri({
          path: filename,
          directory: Directory.Cache,
        });
        await Share.share({
          url: file.uri,
          dialogTitle: "Anki-Paket speichern",
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      if (kind === "anki") {
        try {
          const date = new Date().toISOString();
          localStorage.setItem("emir-last-export", date);
          await saveNativeExportDate(date);
        } catch {}
      }
      onSaved(
        isNative
          ? "Datei im Teilen-Menü bereit."
          : "Export bereit. Speichere die Datei an einem sicheren Ort.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function read(file?: File) {
    if (!file || busy || reading.current) return;
    reading.current = true;
    setBusy(true);
    setPrepared(undefined);
    setError("");
    setFileName(file.name);
    try {
      if (!/\.(apkg|zip)$/i.test(file.name))
        throw new Error("Bitte wähle eine .apkg- oder .zip-Datei.");
      if (file.size > 200 * 1024 * 1024)
        throw new Error("Bitte wähle eine Datei mit höchstens 200 MB.");
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      setPrepared(
        zip.file("collection.json")
          ? await prepareImport(file)
          : await prepareAnkiImport(file),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      reading.current = false;
      setBusy(false);
    }
  }
  async function importData() {
    if (!prepared) return;
    setBusy(true);
    setError("");
    try {
      const result = await commitImport(prepared, folderId);
      onSaved(
        result.folders
          ? `${result.folders} Ordner und ${result.cards} Karten hinzugefügt.`
          : `${result.cards} Karten zu „${folderName}“ hinzugefügt.`,
      );
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Deine Sammlung, zum Mitnehmen"
      onClose={() => !busy && onClose()}
    >
      <div className="dialog-body">
        <div className="segmented">
          <button
            className={tab === "export" ? "active" : ""}
            onClick={() => {
              setTab("export");
              setError("");
            }}
            disabled={busy}
          >
            <Download size={16} />
            Exportieren
          </button>
          <button
            className={tab === "import" ? "active" : ""}
            onClick={() => {
              setTab("import");
              setError("");
            }}
            disabled={busy}
          >
            <Upload size={16} />
            Importieren
          </button>
        </div>
        {tab === "export" ? (
          <>
            <p className="muted">
              Eine Datei für deine Karten und Bilder. Du bestimmst, wo sie
              liegt.
            </p>
            <div className="export-options">
              <button
                className={kind === "anki" ? "selected" : ""}
                onClick={() => setKind("anki")}
              >
                <ShieldCheck size={23} />
                <span>
                  <strong>Alles für Anki exportieren</strong>
                  <small>
                    Alle Karten und Bilder als .apkg, mit Anki-Lernstand.
                  </small>
                </span>
                {kind === "anki" && <Check size={18} />}
              </button>
              <button
                className={kind === "share" ? "selected" : ""}
                onClick={() => setKind("share")}
              >
                <FolderOpen size={23} />
                <span>
                  <strong>„{folderName}“ mit Unterordnern speichern</strong>
                  <small>
                    Dieser Ordner, alle Unterordner und ihre Karten als .apkg,
                    ohne Lernfortschritt.
                  </small>
                </span>
                {kind === "share" && <Check size={18} />}
              </button>
              <button
                className={kind === "cards" ? "selected" : ""}
                onClick={() => setKind("cards")}
              >
                <Layers size={23} />
                <span>
                  <strong>Nur Karten aus „{folderName}“ speichern</strong>
                  <small>
                    {directCardCount} direkt enthaltene Karten als .apkg, ohne
                    Unterordner und Lernfortschritt.
                  </small>
                </span>
                {kind === "cards" && <Check size={18} />}
              </button>
            </div>
            <div className="info-note">
              <ShieldCheck size={18} />
              <p>
                {kind === "anki"
                  ? "Dieses .apkg lässt sich in Anki öffnen. Wähle dort beim Import die Übernahme des Lernfortschritts. Beim Rückimport in Emir Cards starten die Karten als neue Karten."
                  : kind === "cards"
                    ? "Beim Import in Emir Cards werden diese Karten direkt zum geöffneten Ordner hinzugefügt. Es wird kein neuer Ordner angelegt."
                    : "Dieses .apkg enthält den ausgewählten Ordner mit seinen Unterordnern und Karten. Übergeordnete Ordner sind nicht enthalten."}
              </p>
            </div>
            <button
              className="button primary full"
              disabled={
                busy ||
                !hasContent ||
                (kind === "cards" && directCardCount === 0)
              }
              onClick={() => void download()}
            >
              <Download size={18} />
              {busy ? "Datei wird erstellt …" : "Anki-Paket exportieren"}
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Füge eine Anki- oder Emir-Cards-Datei zu „{folderName}“ hinzu.
              Dein vorhandener Bestand bleibt erhalten. Gleiche Ordnernamen
              werden nummeriert.
            </p>
            <label
              className={`dropzone ${busy ? "disabled" : ""} ${dragOver ? "drag-over" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (busy || !event.dataTransfer.types.includes("Files")) return;
                dragDepth.current += 1;
                setDragOver(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = busy ? "none" : "copy";
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (!dragDepth.current) setDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                dragDepth.current = 0;
                setDragOver(false);
                if (busy || reading.current) return;
                const files = event.dataTransfer.files;
                if (files.length !== 1) {
                  setPrepared(undefined);
                  setFileName("");
                  setError("Bitte genau eine .apkg- oder .zip-Datei ablegen.");
                  return;
                }
                void read(files[0]);
              }}
            >
              <FileArchive size={34} />
              <strong>
                {busy
                  ? "Datei wird geprüft …"
                  : dragOver
                    ? "Datei hier ablegen"
                    : "Datei hier ablegen oder auswählen"}
              </strong>
              <span>Anki .apkg oder Emir-Cards-ZIP · bis 200 MB</span>
              <input
                className="visually-hidden"
                type="file"
                accept=".apkg,.zip,application/zip"
                aria-label="Sicherungsdatei auswählen"
                disabled={busy}
                onChange={(e) => {
                  void read(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {prepared && (
              <div className="import-summary">
                <Check size={19} />
                <div>
                  <strong>{fileName}</strong>
                  <p>
                    {prepared.data.folders.length > 0 && (
                      <>{prepared.data.folders.length} Ordner · </>
                    )}
                    {prepared.data.cards.length} Karten ·{" "}
                    {prepared.data.media.length} Bilder
                  </p>
                  {prepared.warnings?.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                  {prepared.data.folders.length === 0 && (
                    <p>
                      Direkt zu „{folderName}“ hinzufügen – ohne neuen Ordner.
                    </p>
                  )}
                  <p>
                    {prepared.data.kind === "backup"
                      ? "Mit gespeichertem Lernfortschritt"
                      : "Die Karten starten als neue Karten"}
                  </p>
                </div>
              </div>
            )}
            <p className="small muted">
              Anki-Import unterstützt Vorder-/Rückseitenkarten, Lückentexte und
              Ankiphil-Karten einschließlich Muskeltrainer und Bildverdeckungen
              mit JPG-, PNG- oder WebP-Bildern. Lücken werden zu einzelnen
              Frage-/Antwortkarten.
            </p>
            <button
              className="button primary full"
              disabled={!prepared || busy}
              onClick={() => void importData()}
            >
              <Upload size={18} />
              {busy ? "Bitte warten …" : "Zur Sammlung hinzufügen"}
            </button>
          </>
        )}
        <ErrorMessage error={error} />
      </div>
    </Modal>
  );
}
