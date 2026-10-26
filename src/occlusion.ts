import { z } from "zod";
const coordinate = z.number().finite().min(-1).max(2);
export const occlusionSchema = z
  .object({
    imageId: z.string().min(1).max(128),
    active: z.number().int().positive(),
    shapes: z
      .array(
        z
          .object({
            group: z.number().int().nonnegative(),
            left: coordinate,
            top: coordinate,
            width: z.number().finite().positive().max(2),
            height: z.number().finite().positive().max(2),
            hideOthers: z.boolean(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .refine((v) => v.shapes.some((s) => s.group === v.active));
export type Occlusion = z.infer<typeof occlusionSchema>;
export function parseOcclusion(
  text: string,
  active: number,
): Omit<Occlusion, "imageId"> {
  const matches = [...text.matchAll(/{{c(\d+)::image-occlusion:([^}]+)}}/g)];
  const shapes = matches.map((match) => {
    const [kind, ...properties] = match[2].split(":");
    if (kind !== "rect")
      throw new Error(
        "Diese Form der Bildverdeckung wird noch nicht unterstützt.",
      );
    const values = Object.fromEntries(properties.map((p) => p.split("=")));
    if (
      Object.keys(values).some(
        (k) => !["left", "top", "width", "height", "oi"].includes(k),
      )
    )
      throw new Error(
        "Diese Bildverdeckung enthält nicht unterstützte Eigenschaften.",
      );
    if (values.oi !== undefined && !["0", "1"].includes(values.oi))
      throw new Error("Ungültige Bildverdeckung.");
    return {
      group: Number(match[1]),
      left: Number(values.left),
      top: Number(values.top),
      width: Number(values.width),
      height: Number(values.height),
      hideOthers: values.oi === "1",
    };
  });
  const result = occlusionSchema.safeParse({
    imageId: "pending",
    active,
    shapes,
  });
  if (
    !result.success ||
    (text.match(/image-occlusion:/g)?.length ?? 0) !== matches.length
  )
    throw new Error("Die Bildverdeckung ist ungültig oder unvollständig.");
  return { active: result.data.active, shapes: result.data.shapes };
}
export function maskStyle(
  shape: Occlusion["shapes"][number],
  active: number,
  answer: boolean,
) {
  return {
    position: "absolute" as const,
    left: `${shape.left * 100}%`,
    top: `${shape.top * 100}%`,
    width: `${shape.width * 100}%`,
    height: `${shape.height * 100}%`,
    boxSizing: "border-box" as const,
    background:
      shape.group === active ? (answer ? "transparent" : "#ef8c8c") : "#ffe39b",
    border: `1px solid ${shape.group === active ? "#a12c2c" : "#7f651f"}`,
  };
}
export function visibleMasks(occlusion: Occlusion) {
  return occlusion.shapes.filter(
    (s) => s.group === occlusion.active || s.group === 0 || s.hideOthers,
  );
}
