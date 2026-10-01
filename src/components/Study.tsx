import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  RotateCcw,
  Sparkles,
  Eye,
} from "lucide-react";
import { Rating, State, type Grade } from "ts-fsrs";
import { db } from "../db";
import {
  intervalLabel,
  reviewCard,
  scheduler,
  scopedCards,
  studyQueue,
  undoReview,
} from "../domain";
import type { Flashcard } from "../types";
import { CardImage, ErrorMessage, errorText } from "./ui";

const grades: {
  grade: Grade;
  label: string;
  help: string;
  className: string;
}[] = [
  {
    grade: Rating.Again,
    label: "Nochmal",
    help: "Nicht gewusst",
    className: "again",
  },
  {
    grade: Rating.Hard,
    label: "Schwer",
    help: "Richtig, aber mühsam",
    className: "hard",
  },
  {
    grade: Rating.Good,
    label: "Gut",
    help: "Richtig erinnert",
    className: "good",
  },
  {
    grade: Rating.Easy,
    label: "Einfach",
    help: "Sofort gewusst",
    className: "easy",
  },
];
export function Study({
  folderId,
  folderName,
  onExit,
}: {
  folderId: string | null;
  folderName: string;
  onExit: () => void;
}) {
  const [active, setActive] = useState<Flashcard | null>(null);
  const [all, setAll] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [reviewed, setReviewed] = useState(0);
  const [last, setLast] = useState<{ reviewId: string; cardId: string }>();
  const lock = useRef(false);
  const mounted = useRef(true);
  const activeRef = useRef<Flashcard | null>(null);
  const nextDue = useRef(Infinity);
  const [shownAt, setShownAt] = useState(new Date());
  const refresh = useCallback(
    async (preferredId?: string) => {
      const [cards, folders] = await Promise.all([
        db.cards.toArray(),
        db.folders.toArray(),
      ]);
      const scope = scopedCards(cards, folders, folderId);
      const queue = studyQueue(scope);
      const next = preferredId
        ? queue.find((c) => c.id === preferredId) || queue[0]
        : queue[0];
      if (!mounted.current) return;
      nextDue.current = Math.min(
        ...scope
          .filter((c) => c.schedule.state !== State.New)
          .map((c) => +new Date(c.schedule.due)),
      );
      setAll(scope);
      setActive(next || null);
      activeRef.current = next || null;
      setRevealed(false);
      setShownAt(new Date());
      setLoading(false);
    },
    [folderId],
  );
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e) => {
      setError(errorText(e));
      setLoading(false);
    });
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!activeRef.current && !lock.current && Date.now() >= nextDue.current)
        void refresh().catch((e) => setError(errorText(e)));
    }, 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function rate(grade: Grade) {
    if (!active || !revealed || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await reviewCard(active.id, grade, new Date());
      setLast(result);
      setReviewed((n) => n + 1);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function undo() {
    if (!last || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await undoReview(last.reviewId);
      await refresh(last.cardId);
      setReviewed((n) => Math.max(0, n - 1));
      setLast(undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.repeat ||
        (e.target instanceof HTMLElement &&
          ["INPUT", "TEXTAREA", "BUTTON"].includes(e.target.tagName))
      )
        return;
      if (e.code === "Space" && active && !revealed) {
        e.preventDefault();
        setShownAt(new Date());
        setRevealed(true);
      }
      if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(Number(e.key) as Grade);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  const queue = studyQueue(all, now);
  const later = all
    .filter(
      (c) => c.schedule.state !== State.New && +new Date(c.schedule.due) > now,
    )
    .sort((a, b) => +new Date(a.schedule.due) - +new Date(b.schedule.due));
  const preview = active
    ? scheduler.repeat(active.schedule, shownAt)
    : undefined;
  return (
    <div className="study-page">
      <header className="study-header">
        <button className="button ghost" onClick={onExit} disabled={busy}>
          <ArrowLeft size={18} />
          <span>Sammlung</span>
        </button>
        <div>
          <span className="eyebrow">DEIN LERNMOMENT</span>
          <h1>{folderName}</h1>
        </div>
        <button
          className="icon-button"
          aria-label="Letzte Bewertung rückgängig"
          title="Letzte Bewertung rückgängig"
          disabled={!last || busy}
          onClick={() => void undo()}
        >
          <RotateCcw size={20} />
        </button>
      </header>
      <div className="session-line">
        <span>
          <span className="status-dot" /> {queue.length} bereit
        </span>
        <span>{reviewed} Wiederholungen geschafft</span>
      </div>
      <ErrorMessage error={error} />
      {loading ? (
        <div className="study-card empty-study">
          Deine Karten werden vorbereitet …
        </div>
      ) : active ? (
        <>
          <article
            className={`study-card ${revealed ? "revealed" : ""}`}
            key={active.id}
          >
            <div className="study-card-top">
              <span className="eyebrow">FRAGE</span>
              <span className="badge">
                {active.schedule.state === State.New
                  ? "Neue Karte"
                  : active.schedule.state === State.Review
                    ? "Wiederholung"
                    : "In Übung"}
              </span>
            </div>
            <div className="study-question">
              {active.front && <p>{active.front}</p>}
              <div className="study-media">
                {active.frontImages.map((m) => (
                  <CardImage key={m} mediaId={m} zoom />
                ))}
              </div>
            </div>
            {revealed ? (
              <div className="study-answer">
                <span className="eyebrow">ANTWORT</span>
                {active.back && <p>{active.back}</p>}
                <div className="study-media">
                  {active.backImages.map((m) => (
                    <CardImage key={m} mediaId={m} zoom />
                  ))}
                </div>
              </div>
            ) : (
              <div className="think-hint">
                <Sparkles size={16} /> Nimm dir einen Moment zum Erinnern.
              </div>
            )}
          </article>
          {!revealed ? (
            <div className="reveal-actions">
              <button
                className="button primary reveal"
                onClick={() => {
                  setShownAt(new Date());
                  setRevealed(true);
                }}
              >
                <Eye size={19} />
                Antwort aufdecken <ArrowRight size={19} />
              </button>
              <span className="keyboard-tip">oder drücke die Leertaste</span>
            </div>
          ) : (
            <div className="rating-area">
              <p>Wie gut konntest du dich erinnern?</p>
              <div className="rating-buttons">
                {grades.map((g) => (
                  <button
                    key={g.grade}
                    className={`rating ${g.className}`}
                    disabled={busy}
                    onClick={() => void rate(g.grade)}
                    title={g.help}
                  >
                    <span className="rating-interval">
                      {preview
                        ? intervalLabel(preview[g.grade].card.due, +shownAt)
                        : ""}
                    </span>
                    <strong>{g.label}</strong>
                    <small>{g.help}</small>
                  </button>
                ))}
              </div>
              <span className="keyboard-tip">
                Tasten 1–4 · „Schwer“ bedeutet: richtig erinnert.
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="study-card empty-study">
          <div className="completion-icon">
            <Check size={34} />
          </div>
          <span className="eyebrow">GUT GEMACHT</span>
          <h2>
            {all.length
              ? "Für den Moment geschafft."
              : "Hier ist noch Platz für Wissen."}
          </h2>
          <p>
            {all.length
              ? "Alle gerade fälligen Karten sind erledigt. Dein Lernfortschritt ist gespeichert."
              : "Erstelle deine erste Karte in diesem Thema und komm zum Lernen zurück."}
          </p>
          {later[0] && (
            <div className="next-review">
              <Clock3 size={18} /> Nächste Karte in{" "}
              {intervalLabel(later[0].schedule.due, now)}
            </div>
          )}
          <button className="button primary" onClick={onExit}>
            Zur Sammlung <ArrowRight size={18} />
          </button>
        </div>
      )}
      <p className="study-footnote">
        Ein Schritt nach dem anderen. Wissen braucht Wiederholung.
      </p>
    </div>
  );
}
