import { expect, it } from "vitest";
import { parseOcclusion, maskStyle, visibleMasks } from "./occlusion";
import { clozeOrAnkiphilSides } from "./anki-cloze";
it("erhält Maskengruppen und deckt nur die aktive Gruppe auf", () => {
  const data = parseOcclusion(
    "{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.2:oi=1}}{{c2::image-occlusion:rect:left=.6:top=.2:width=.3:height=.2:oi=1}}",
    1,
  );
  expect(visibleMasks({ ...data, imageId: "x" })).toHaveLength(2);
  expect(maskStyle(data.shapes[0], 1, false).background).toBe("#ef8c8c");
  expect(maskStyle(data.shapes[0], 1, true).background).toBe("transparent");
  expect(maskStyle(data.shapes[1], 1, true).background).toBe("#ffe39b");
  expect(
    visibleMasks({
      ...data,
      imageId: "x",
      shapes: data.shapes.map((s) => ({ ...s, hideOthers: false })),
    }),
  ).toHaveLength(1);
  expect(() =>
    parseOcclusion("{{c1::image-occlusion:ellipse:left=.1}}", 1),
  ).toThrow();
  expect(() =>
    parseOcclusion("{{c1::image-occlusion:rect:left=NaN}}", 1),
  ).toThrow();
});
it("erzeugt vier getrennte Muskelabfragen ohne vorzeitige Antwort", () => {
  const names = [
    "Titel",
    "Muskel",
    "Ursprung",
    "Ansatz",
    "Funktion",
    "Innervation",
  ];
  const values = [
    "Testgruppe",
    "Testmuskel",
    "Antwort U",
    "Antwort A",
    "Antwort F",
    "Antwort I",
  ];
  for (let i = 0; i < 4; i++) {
    const result = clozeOrAnkiphilSides(
      {
        name: "Ankiphil - Muskeltrainer",
        type: 0,
        flds: names.map((name) => ({ name })),
      },
      values,
      i,
    )!;
    expect(result.front).toContain(names[i + 2] + "?");
    expect(result.front).not.toContain("Antwort");
    expect(result.back).toContain(values[i + 2]);
  }
});
