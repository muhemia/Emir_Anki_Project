import { z } from "zod";
const uid = z.uuid();
const num = z.number().finite().nonnegative();
const time = num.int().max(Number.MAX_SAFE_INTEGER);
const date = z.iso.datetime({ offset: true });
const schedule = z
  .object({
    due: date,
    stability: num,
    difficulty: num.max(10),
    elapsed_days: num,
    scheduled_days: num,
    learning_steps: num.int(),
    reps: num.int(),
    lapses: num.int(),
    state: num.int().max(3),
    last_review: date.optional(),
  })
  .strict();
const log = z
  .object({
    rating: num.int().min(1).max(4),
    state: num.int().max(3),
    due: date,
    stability: num,
    difficulty: num.max(10),
    elapsed_days: num,
    last_elapsed_days: num,
    scheduled_days: num,
    learning_steps: num.int(),
    review: date,
  })
  .strict();
export const schemas = {
  folders: z
    .object({
      id: uid,
      parentId: uid.nullable(),
      name: z.string().trim().min(1).max(120),
      color: z.enum(["sage", "blue", "amber", "rose", "violet", "stone"]),
      createdAt: time,
      sortOrder: num.int().max(2147483647).optional(),
    })
    .strict(),
  cards: z
    .object({
      id: uid,
      folderId: uid.nullable(),
      front: z.string().max(50000),
      back: z.string().max(50000),
      frontImages: z.array(uid).max(20),
      backImages: z.array(uid).max(20),
      schedule,
      createdAt: time,
      updatedAt: time,
    })
    .strict()
    .refine(
      (c) =>
        (c.front.trim() || c.frontImages.length) &&
        (c.back.trim() || c.backImages.length),
    ),
  media: z
    .object({
      id: uid,
      name: z.string().max(255),
      type: z.enum(["image/png", "image/jpeg", "image/webp"]),
      data: z
        .string()
        .max(16 * 1024 * 1024)
        .regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        ),
    })
    .strict(),
  reviews: z
    .object({ id: uid, cardId: uid, log, before: schedule, createdAt: time })
    .strict(),
};
export const batchSchema = z
  .object({
    batchId: uid,
    cursor: time,
    changes: z
      .array(
        z
          .object({
            kind: z.enum(["folders", "cards", "media", "reviews"]),
            id: uid,
            baseVersion: time,
            value: z.unknown().nullable(),
          })
          .strict(),
      )
      .max(100000),
  })
  .strict();
export function parseBatch(body) {
  const batch = batchSchema.parse(body);
  const seen = new Set();
  for (const change of batch.changes) {
    const key = `${change.kind}:${change.id}`;
    if (seen.has(key)) throw new Error("Doppelte Änderung.");
    seen.add(key);
    if (change.value !== null) {
      change.value = schemas[change.kind].parse(change.value);
      if (change.value.id !== change.id) throw new Error("Ungültige Kennung.");
      if (change.kind === "media") {
        const b = Buffer.from(change.value.data, "base64");
        const valid =
          change.value.type === "image/png"
            ? b
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : change.value.type === "image/jpeg"
              ? b[0] === 255 && b[1] === 216 && b[2] === 255
              : b.subarray(0, 4).toString() === "RIFF" &&
                b.subarray(8, 12).toString() === "WEBP";
        if (!valid) throw new Error("Ungültige Bilddaten.");
      }
    }
  }
  return batch;
}
