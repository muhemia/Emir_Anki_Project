import { describe, expect, it } from "vitest";
import { clozeOrAnkiphilSides, renderCloze } from "./anki-cloze";

describe("Anki-Lückentexte", () => {
  it("versteckt jede Wiederholung der aktuellen Nummer und erhält andere Antworten", () => {
    const text = "{{c1::eins::Zahl}} / {{c2::zwei}} / {{c1::drei}}";
    expect(renderCloze(text, 0, false)).toEqual({
      html: "[Zahl] / zwei / […]",
      found: true,
    });
    expect(renderCloze(text, 1, false).html).toBe("eins / […] / drei");
    expect(renderCloze(text, 0, true).html).toBe("eins / zwei / drei");
  });
  it("löst verschachtelte Lücken auf, ohne verdeckte Inhalte preiszugeben", () => {
    const text = "{{c1::außen {{c2::innen}} Ende}}";
    expect(renderCloze(text, 0, false).html).toBe("[…]");
    expect(renderCloze(text, 1, false).html).toBe("außen […] Ende");
    expect(renderCloze(text, 0, true).html).toBe("außen innen Ende");
    expect(() => renderCloze("{{c1::offen", 0, false)).toThrow(
      "nicht abgeschlossen",
    );
  });
  it("wandelt Ankiphil-Terminologie mit Zusatztext in beiden Richtungen um", () => {
    const model = {
      name: "Ankiphil - Terminologie",
      type: 0,
      flds: ["Front", "Back", "Extra"].map((name) => ({ name })),
    };
    expect(
      clozeOrAnkiphilSides(model, ["Begriff", "Bedeutung", "Beispiel"], 0),
    ).toMatchObject({
      front: "Begriff",
      back: "Bedeutung<br><br>Extra:<br>Beispiel",
    });
    expect(
      clozeOrAnkiphilSides(model, ["Begriff", "Bedeutung", ""], 1),
    ).toMatchObject({ front: "Bedeutung", back: "Begriff" });
  });
  it("weist Image-Occlusion-Skripte und fehlende Lücken ausdrücklich ab", () => {
    const model = {
      type: 1,
      flds: [{ name: "Text" }],
      tmpls: [{ qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}" }],
    };
    expect(() => clozeOrAnkiphilSides(model, ["{{c2::Antwort}}"], 0)).toThrow(
      "Lücke fehlt",
    );
    model.tmpls[0].qfmt += "<script>anki.imageOcclusion.setup()</script>";
    expect(() => clozeOrAnkiphilSides(model, ["{{c1::Antwort}}"], 0)).toThrow(
      "Zusatzfunktion",
    );
  });
});
