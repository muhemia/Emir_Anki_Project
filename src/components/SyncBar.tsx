import { useEffect, useState, useSyncExternalStore } from "react";
import { RefreshCw, CloudOff, CloudCheck } from "lucide-react";
import {
  checkRemote,
  getSyncState,
  resolveConflicts,
  subscribeSync,
  synchronize,
} from "../remote";
import { Modal } from "./ui";

export default function SyncBar({
  onReauthenticate,
}: {
  onReauthenticate: () => void;
}) {
  const status = useSyncExternalStore(subscribeSync, getSyncState);
  const [showConflicts, setShowConflicts] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") void checkRemote();
    };
    const timer = setInterval(check, 30000);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const unload = (event: BeforeUnloadEvent) => {
      if (getSyncState().pending || getSyncState().busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  async function resolve(choice: "local" | "server") {
    setResolving(true);
    setError("");
    try {
      await resolveConflicts(choice);
      setShowConflicts(false);
      await synchronize();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Abgleich fehlgeschlagen.",
      );
    } finally {
      setResolving(false);
    }
  }
  return (
    <>
      <section className="sync-bar" aria-label="Synchronisierung">
        <div className="sync-summary" role="status">
          {status.offline ? <CloudOff size={19} /> : <CloudCheck size={19} />}
          <div>
            <strong>
              {status.busy
                ? "Synchronisierung läuft …"
                : status.conflicts.length
                  ? "Versionskonflikt"
                  : status.offline
                    ? "Offline · lokal gespeichert"
                    : status.available
                      ? "Änderungen auf anderem Gerät verfügbar"
                      : status.pending
                        ? "Änderungen auf diesem Gerät"
                        : "Mit Server abgeglichen"}
            </strong>
            <small>
              {status.pending
                ? `${status.pending} lokale Änderungen noch zu übertragen. `
                : ""}
              {status.lastSynced
                ? `Letzter Abgleich: ${new Date(status.lastSynced).toLocaleString("de-DE")}`
                : "Noch kein Abgleich"}
            </small>
          </div>
        </div>
        <button
          className="button small"
          disabled={status.busy || resolving}
          onClick={() =>
            status.conflicts.length
              ? setShowConflicts(true)
              : void synchronize().catch(() => {})
          }
        >
          <RefreshCw size={16} />
          {status.conflicts.length ? "Konflikte lösen" : "Synchronisieren"}
        </button>
        {(status.error || error) && (
          <p className="sync-error" role="alert">
            {error || status.error}
            {status.error.includes("anmelden") && (
              <button onClick={onReauthenticate}>Erneut anmelden</button>
            )}
          </p>
        )}
      </section>
      {showConflicts && (
        <Modal
          title="Welche Fassung soll bleiben?"
          onClose={() => !resolving && setShowConflicts(false)}
        >
          <p>
            Diese Daten wurden auf mehreren Geräten geändert. Deine lokale
            Fassung ist noch vorhanden. Die Auswahl gilt für alle unten
            aufgeführten Konflikte, einschließlich Lernstand. Bei gelöschten
            Ordnern betrifft sie auch deren Inhalte.
          </p>
          <p>
            „Serverfassung“ ersetzt die betroffenen lokalen Änderungen und noch
            nicht übertragenen Lernbewertungen. „Dieses Gerät“ überträgt dessen
            Fassung beim nächsten Abgleich.
          </p>
          <ul className="sync-conflicts">
            {status.conflicts.map((c) => (
              <li key={`${c.kind}:${c.id}`}>
                <strong>
                  {
                    {
                      folders: "Ordner",
                      cards: "Karte",
                      media: "Bild",
                      reviews: "Lernbewertung",
                    }[c.kind]
                  }
                </strong>
                : {c.value?.name || c.value?.front || c.id}
                <br />
                <small>
                  {c.value
                    ? "Serverfassung vorhanden"
                    : "Auf dem Server gelöscht"}
                  {c.value?.back ? ` · Antwort: ${c.value.back}` : ""}
                </small>
              </li>
            ))}
          </ul>
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <button
              className="button"
              disabled={resolving}
              onClick={() => void resolve("server")}
            >
              Serverfassung übernehmen
            </button>
            <button
              className="button primary"
              disabled={resolving}
              onClick={() => void resolve("local")}
            >
              Dieses Gerät behalten
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
