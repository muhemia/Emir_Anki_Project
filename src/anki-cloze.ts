export type AnkiModel = {
  name?: string;
  type?: number;
  flds?: { name: string }[];
  tmpls?: { qfmt: string; afmt: string }[];
};

// Parse nested deletions before extracting images: pictures inside the active
// deletion must not accidentally appear on the question side.
export function renderCloze(source: string, ordinal: number, answer: boolean) {
  let position = 0;
  let found = false;
  function sequence(nested: boolean, depth: number): string {
    if (depth > 64)
      throw new Error("Der Lückentext ist zu stark verschachtelt.");
    let output = "";
    while (position < source.length) {
      if (
        nested &&
        (source.startsWith("}}", position) || source.startsWith("::", position))
      )
        break;
      const match = source.slice(position).match(/^{{c([1-9]\d*)::/i);
      if (match) {
        position += match[0].length;
        const number = Number(match[1]);
        const content = sequence(true, depth + 1);
        let hint = "";
        if (source.startsWith("::", position)) {
          position += 2;
          const end = source.indexOf("}}", position);
          if (end < 0)
            throw new Error("Ein Lückentext ist nicht abgeschlossen.");
          hint = source.slice(position, end);
          position = end;
        }
        if (!source.startsWith("}}", position))
          throw new Error("Ein Lückentext ist nicht abgeschlossen.");
        position += 2;
        if (number === ordinal + 1) {
          found = true;
          output += answer ? content : `[${hint || "…"}]`;
        } else output += content;
      } else output += source[position++];
    }
    return output;
  }
  const html = sequence(false, 0);
  return { html, found };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function clozeOrAnkiphilSides(
  model: AnkiModel,
  values: string[],
  ordinal: number,
): { front: string; back: string; simplified: boolean } | undefined {
  const fields = new Map(
    model.flds?.map((field, i) => [field.name, values[i] ?? ""]),
  );
  const get = (name: string) => {
    if (!fields.has(name)) throw new Error(`Das Anki-Feld „${name}“ fehlt.`);
    return fields.get(name)!;
  };
  const ankiphil =
    model.name === "Ankiphil - Cloze" ||
    model.name === "Ankiphil - Terminologie";
  if (ankiphil) {
    let front: string, back: string;
    if (model.type === 1 && model.name === "Ankiphil - Cloze") {
      const question = renderCloze(get("Text"), ordinal, false);
      if (!question.found)
        throw new Error("Die zur Anki-Karte gehörende Lücke fehlt.");
      front = question.html;
      back = renderCloze(get("Text"), ordinal, true).html;
    } else if (
      model.type === 0 &&
      model.name === "Ankiphil - Terminologie" &&
      (ordinal === 0 || ordinal === 1)
    ) {
      front = get(ordinal === 0 ? "Front" : "Back");
      back = get(ordinal === 0 ? "Back" : "Front");
    } else
      throw new Error(
        "Diese Ankiphil-Kartenvorlage wird noch nicht unterstützt.",
      );
    // Preserve learning content and source links, without copying the add-on's
    // timers, JavaScript, tracking metadata, logos or keyboard handlers.
    for (const name of [
      "Extra",
      "Zusatzinfos",
      "Hammer",
      "Image",
      "Meditricks",
      "Klinik",
      "Präparat",
      "AMBOSS-Link",
      "Scrollbares CT",
      "Source",
    ]) {
      const value = fields.get(name);
      if (value?.trim()) back += `<br><br>${escapeHtml(name)}:<br>${value}`;
    }
    return { front, back, simplified: true };
  }
  if (model.type !== 1) return undefined;
  const template = model.tmpls?.[0];
  if (!template) throw new Error("Eine Anki-Kartenvorlage fehlt.");
  if (
    /<\s*(?:script|iframe|canvas|audio|video)\b/i.test(
      template.qfmt + template.afmt,
    )
  )
    throw new Error(
      "Diese Lückentextvorlage benötigt eine noch nicht unterstützte Anki-Zusatzfunktion.",
    );
  let found = false;
  function render(source: string, answer: boolean, front = "") {
    const tokens = source.split(/({{[^{}]+}})/g);
    const sections: { name: string; enabled: boolean }[] = [];
    let result = "";
    for (const token of tokens) {
      if (!token.startsWith("{{")) {
        if (sections.every((s) => s.enabled)) result += token;
        continue;
      }
      const key = token.slice(2, -2).trim();
      if (key[0] === "#" || key[0] === "^") {
        const name = key.slice(1).trim();
        const present =
          !!get(name)
            .replace(/<[^>]*>/g, "")
            .trim() || /<img\b/i.test(get(name));
        sections.push({ name, enabled: key[0] === "#" ? present : !present });
        continue;
      }
      if (key[0] === "/") {
        if (sections.pop()?.name !== key.slice(1).trim())
          throw new Error("Ungültige bedingte Anki-Vorlage.");
        continue;
      }
      if (!sections.every((s) => s.enabled)) continue;
      if (key === "FrontSide") {
        result += front;
        continue;
      }
      const parts = key.split(":");
      const name = parts.pop()!.trim();
      if (parts.some((p) => !["cloze", "edit", "text"].includes(p)))
        throw new Error(
          "Ein Filter dieser Anki-Lückentextvorlage wird noch nicht unterstützt.",
        );
      let value = get(name);
      if (parts.includes("cloze")) {
        const rendered = renderCloze(value, ordinal, answer);
        if (!answer) found ||= rendered.found;
        value = rendered.html;
      }
      if (parts.includes("text")) value = value.replace(/<[^>]*>/g, "");
      result += value;
    }
    if (sections.length) throw new Error("Ungültige bedingte Anki-Vorlage.");
    return result;
  }
  const front = render(template.qfmt, false);
  if (!found) throw new Error("Die zur Anki-Karte gehörende Lücke fehlt.");
  return { front, back: render(template.afmt, true, front), simplified: false };
}
