import { visibleMasks, maskStyle, type Occlusion } from "../occlusion";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X, ImageOff } from "lucide-react";
import { db } from "../db";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Dialog schließen"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const url = URL.createObjectURL(blob);
    setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return url;
}
export function CardImage({
  mediaId,
  data,
  type,
  name,
  zoom = false,
  occlusion,
  answer = false,
}: {
  mediaId: string;
  data?: ArrayBuffer;
  type?: string;
  name?: string;
  zoom?: boolean;
  occlusion?: Occlusion;
  answer?: boolean;
}) {
  const media = useLiveQuery(
    () => (data ? undefined : db.media.get(mediaId)),
    [mediaId, data],
  );
  const bytes = data || media?.data;
  const blob = useMemo(
    () =>
      bytes ? new Blob([bytes], { type: type || media?.type }) : undefined,
    [bytes, type, media?.type],
  );
  const url = useBlobUrl(blob);
  const [enlarged, setEnlarged] = useState(false);
  if (!url)
    return (
      <span className="image-placeholder">
        <ImageOff size={20} /> Bild wird geladen
      </span>
    );
  const baseImage = (
    <img
      src={url}
      alt={
        occlusion
          ? "Bild mit verdeckten Beschriftungen"
          : name || media?.name || "Kartenbild"
      }
      loading="lazy"
    />
  );
  const image =
    occlusion?.imageId === mediaId ? (
      <span className="occlusion-image" data-answer={answer}>
        {baseImage}
        <span className="occlusion-masks" aria-hidden="true">
          {visibleMasks(occlusion).map((shape, index) => (
            <span
              key={index}
              data-active={shape.group === occlusion.active}
              style={maskStyle(shape, occlusion.active, answer)}
            />
          ))}
        </span>
      </span>
    ) : (
      baseImage
    );
  return zoom ? (
    <button
      className={`study-image ${enlarged ? "enlarged" : ""}`}
      onClick={() => setEnlarged((v) => !v)}
      aria-label={enlarged ? "Bild verkleinern" : "Bild vergrößern"}
    >
      {image}
    </button>
  ) : (
    image
  );
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <p className="error-message" role="alert">
      {error}
    </p>
  ) : null;
}
export function errorText(error: unknown) {
  if (
    error instanceof Error &&
    (error.name === "QuotaExceededError" ||
      error.message.includes("QuotaExceeded"))
  )
    return "Der Gerätespeicher ist voll. Bitte sichere deine Sammlung und schaffe Speicherplatz.";
  return error instanceof Error
    ? error.message
    : "Das hat leider nicht funktioniert. Bitte versuche es erneut.";
}
