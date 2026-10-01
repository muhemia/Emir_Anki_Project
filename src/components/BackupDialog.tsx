import { useState } from "react";
import {
  Download,
  Upload,
  ShieldCheck,
  FileArchive,
  Check,
  FolderOpen,
} from "lucide-react";
import {
  commitImport,
  exportPackage,
  prepareImport,
  type PreparedImport,
} from "../backup";
import { Modal, ErrorMessage, errorText } from "./ui";

export function BackupDialog({
  folderId,
  folderName,
  hasContent,
  initialTab = "export",
  onClose,
  onSaved,
}: {
  folderId: string | null;
  folderName: string;
  hasContent: boolean;
  initialTab?: "export" | "import";
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [tab, setTab] = useState<"export" | "import">(initialTab);
  const [kind, setKind] = useState<"backup" | "share">("backup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<PreparedImport>();
  const [fileName, setFileName] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const blob = await exportPackage(
        kind,
        kind === "backup" ? null : folderId,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = folderName
        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
        .slice(0, 60);
      a.download = `emir-${kind === "backup" ? "sicherung" : safeName}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (kind === "backup") {
        try {
          localStorage.setItem("emir-last-export", new Date().toISOString());
        } catch {}
      }
      onSaved("Export bereit. Speichere die ZIP-Datei an einem sicheren Ort.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function read(file?: File) {
    if (!file) return;
    setBusy(true);
    setPrepared(undefined);
    setError("");
    setFileName(file.name);
    try {
      setPrepared(await prepareImport(file));
    } catch (e) {
      setError(errorText(e));
    } finally {
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
        `${result.folders} Ordner und ${result.cards} Karten hinzugefügt.`,
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
                className={kind === "backup" ? "selected" : ""}
                onClick={() => setKind("backup")}
              >
                <ShieldCheck size={23} />
                <span>
                  <strong>Alles sichern</strong>
                  <small>
                    Komplette Sammlung, Bilder und dein Lernfortschritt.
                  </small>
                </span>
                {kind === "backup" && <Check size={18} />}
              </button>
              <button
                className={kind === "share" ? "selected" : ""}
                onClick={() => setKind("share")}
              >
                <FolderOpen size={23} />
                <span>
                  <strong>Thema teilen</strong>
                  <small>
                    „{folderName}“ mit allen Unterordnern. Ohne deinen
                    Lernfortschritt.
                  </small>
                </span>
                {kind === "share" && <Check size={18} />}
              </button>
            </div>
            <div className="info-note">
              <ShieldCheck size={18} />
              <p>
                Speichere die ZIP-Datei zum Beispiel in „Dateien“ auf deinem
                iPhone oder auf einem anderen Gerät. Das schützt dich auch, wenn
                App-Daten gelöscht werden.
              </p>
            </div>
            <button
              className="button primary full"
              disabled={busy || !hasContent}
              onClick={() => void download()}
            >
              <Download size={18} />
              {busy ? "Sicherung wird erstellt …" : "ZIP-Datei exportieren"}
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Füge eine Emir-Cards-Datei zu „{folderName}“ hinzu. Dein
              vorhandener Bestand bleibt erhalten. Gleiche Ordnernamen werden
              nummeriert.
            </p>
            <label className={`dropzone ${busy ? "disabled" : ""}`}>
              <FileArchive size={34} />
              <strong>
                {busy ? "Datei wird geprüft …" : "Sicherungsdatei auswählen"}
              </strong>
              <span>Emir-Cards-ZIP · bis 100 MB</span>
              <input
                className="visually-hidden"
                type="file"
                accept=".zip,application/zip"
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
                    {prepared.data.folders.length} Ordner ·{" "}
                    {prepared.data.cards.length} Karten ·{" "}
                    {prepared.data.media.length} Bilder
                  </p>
                  <p>
                    {prepared.data.kind === "backup"
                      ? "Mit gespeichertem Lernfortschritt"
                      : "Die Karten starten als neue Karten"}
                  </p>
                </div>
              </div>
            )}
            <p className="small muted">
              Version 1 unterstützt unser ZIP-Format. Anki-Dateien (.apkg)
              folgen in einer späteren Version.
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
