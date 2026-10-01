import { id } from "./domain";
import { isImage } from "./backup";
import type { Media } from "./types";
export async function processImage(file: File): Promise<Media> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Bitte wähle ein Bild unter 20 MB.");
  if (
    !isImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type)
  )
    throw new Error("Bitte wähle ein JPG-, PNG- oder WebP-Bild.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(
      "Dieses Bild lässt sich nicht öffnen. Bitte verwende JPG, PNG oder WebP.",
    );
  });
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error(
      "Die Bildverarbeitung ist auf diesem Gerät nicht verfügbar.",
    );
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error("Bild konnte nicht gespeichert werden.")),
      mime,
      0.88,
    ),
  );
  if (blob.size > 12 * 1024 * 1024)
    throw new Error(
      "Das verarbeitete Bild ist zu groß. Bitte wähle eine kleinere Bilddatei.",
    );
  return {
    id: id(),
    data: await blob.arrayBuffer(),
    type: blob.type,
    name: file.name.slice(0, 255),
  };
}
