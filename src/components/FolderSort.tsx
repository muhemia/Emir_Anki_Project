import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { compareFolders } from "../domain";
import type { Folder } from "../types";

type Placement = "before" | "after";
type Drop = { id: string; placement: Placement };
type Drag = {
  folder: Folder;
  pointerId: number | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  drop: Drop | null;
};
type SortContext = {
  drag: Drag | null;
  start: (event: PointerEvent<HTMLButtonElement>, folder: Folder) => void;
  move: (event: PointerEvent<HTMLButtonElement>) => void;
  finish: () => void;
  cancel: () => void;
  keyboard: (event: KeyboardEvent<HTMLButtonElement>, folder: Folder) => void;
};
const Context = createContext<SortContext | null>(null);

export function FolderSort({
  folders,
  onReorder,
  children,
}: {
  folders: Folder[];
  onReorder: (
    id: string,
    targetId: string,
    placement: Placement,
  ) => Promise<void>;
  children: ReactNode;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const current = useRef<Drag | null>(null);
  const [announcement, announce] = useState("");
  const update = (next: Drag | null) => {
    current.current = next;
    setDrag(next);
  };
  const cancel = () => {
    if (!current.current) return;
    update(null);
    announce("Sortieren abgebrochen.");
  };
  const targetAt = (state: Drag, x: number, y: number): Drop | null => {
    const row = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>(".folder-card-row");
    const targetId = row?.parentElement?.dataset.folderId;
    const target = folders.find((item) => item.id === targetId);
    if (
      !row ||
      !target ||
      target.id === state.folder.id ||
      target.parentId !== state.folder.parentId
    )
      return null;
    const rect = row.getBoundingClientRect();
    return {
      id: target.id,
      placement: y < rect.top + rect.height / 2 ? "before" : "after",
    };
  };
  const finish = () => {
    const state = current.current;
    update(null);
    if (!state?.active || !state.drop) return;
    void onReorder(state.folder.id, state.drop.id, state.drop.placement)
      .then(() => announce(`${state.folder.name} wurde neu sortiert.`))
      .catch(() =>
        announce("Die Reihenfolge konnte nicht gespeichert werden."),
      );
  };
  const start = (event: PointerEvent<HTMLButtonElement>, folder: Folder) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    document
      .querySelectorAll("details[open]")
      .forEach((item) => item.removeAttribute("open"));
    update({
      folder,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      drop: null,
    });
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const state = current.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const active =
      state.active ||
      Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >
        5;
    update({
      ...state,
      active,
      x: event.clientX,
      y: event.clientY,
      drop: active ? targetAt(state, event.clientX, event.clientY) : null,
    });
  };
  const keyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    folder: Folder,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    const state = current.current;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (state) finish();
      else {
        update({
          folder,
          pointerId: null,
          startX: 0,
          startY: 0,
          x: 0,
          y: 0,
          active: true,
          drop: null,
        });
        announce(
          `${folder.name} ausgewählt. Mit Pfeil hoch oder runter die Position wählen und mit Enter ablegen.`,
        );
      }
      return;
    }
    if (!state || state.pointerId !== null || state.folder.id !== folder.id)
      return;
    if (event.key === "Tab") {
      cancel();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const siblings = folders
      .filter((item) => item.parentId === folder.parentId)
      .sort(compareFolders);
    const others = siblings.filter((item) => item.id !== folder.id);
    if (!others.length) return;
    const position = state.drop
      ? others.findIndex((item) => item.id === state.drop!.id) +
        (state.drop.placement === "after" ? 1 : 0)
      : siblings.findIndex((item) => item.id === folder.id);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? others.length
          : Math.max(
              0,
              Math.min(
                others.length,
                position + (event.key === "ArrowUp" ? -1 : 1),
              ),
            );
    const drop: Drop =
      next === others.length
        ? { id: others.at(-1)!.id, placement: "after" }
        : { id: others[next].id, placement: "before" };
    update({ ...state, drop });
    announce(`${folder.name}, Position ${next + 1} von ${siblings.length}.`);
  };

  useEffect(() => {
    if (!drag?.active) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("keydown", escape);
    document.body.classList.add("folder-sorting");
    return () => {
      document.removeEventListener("keydown", escape);
      document.body.classList.remove("folder-sorting");
    };
  }, [drag?.active]);

  useEffect(() => {
    if (!drag?.active || drag.pointerId === null) return;
    let frame: number;
    let last = 0;
    const scroll = (time: number) => {
      const state = current.current;
      if (!state) return;
      const edge = 75;
      const direction =
        state.y < edge ? -1 : state.y > window.innerHeight - edge ? 1 : 0;
      if (direction && time - last > 16) {
        window.scrollBy(0, direction * 10);
        const drop = targetAt(state, state.x, state.y);
        if (
          drop?.id !== state.drop?.id ||
          drop?.placement !== state.drop?.placement
        )
          update({ ...state, drop });
        last = time;
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [drag?.active, drag?.pointerId, folders]);

  return (
    <Context.Provider value={{ drag, start, move, finish, cancel, keyboard }}>
      <span id="folder-sort-help" className="visually-hidden">
        Zum Sortieren ziehen. Nur Ordner im selben übergeordneten Ordner können
        neu angeordnet werden. Alternativ Leertaste, Pfeiltasten und Enter
        verwenden. Escape bricht ab.
      </span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
      {children}
      {drag?.active &&
        drag.pointerId !== null &&
        createPortal(
          <div
            className="folder-drag-preview"
            style={{
              left: Math.min(drag.x + 14, window.innerWidth - 210),
              top: drag.y + 14,
            }}
            aria-hidden="true"
          >
            <GripVertical size={19} />
            <span>{drag.folder.name}</span>
          </div>,
          document.body,
        )}
    </Context.Provider>
  );
}

export function useFolderSort() {
  const context = useContext(Context);
  if (!context) throw new Error("FolderSort fehlt.");
  return context;
}

export function FolderDragHandle({ folder }: { folder: Folder }) {
  const sort = useFolderSort();
  return (
    <button
      className="folder-action-button folder-drag-handle"
      aria-label={`Ordner ${folder.name} sortieren`}
      aria-describedby="folder-sort-help"
      aria-pressed={sort.drag?.active && sort.drag.folder.id === folder.id}
      title="Ziehen, um die Reihenfolge zu ändern"
      onPointerDown={(event) => sort.start(event, folder)}
      onPointerMove={sort.move}
      onPointerUp={sort.finish}
      onPointerCancel={sort.cancel}
      onLostPointerCapture={() => {
        if (sort.drag) sort.cancel();
      }}
      onKeyDown={(event) => sort.keyboard(event, folder)}
      onContextMenu={(event) => event.preventDefault()}
    >
      <GripVertical size={20} />
    </button>
  );
}
