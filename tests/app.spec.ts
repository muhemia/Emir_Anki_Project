import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import JSZip from "jszip";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

async function isolatedStaticServer() {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
  };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    const file = path.resolve(
      "dist",
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(path.resolve("dist") + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
async function createFolder(page: Page, name: string) {
  await expect(
    page
      .getByRole("navigation", { name: "Ordnerpfad" })
      .getByRole("button", { name: "Sammlung" }),
  ).toBeVisible();
  const route = await page
    .getByRole("navigation", { name: "Ordnerpfad" })
    .locator("button")
    .allTextContents();
  if (route.length === 1) {
    await page
      .getByRole("button", { name: "Neuer Ordner", exact: true })
      .click();
  } else {
    await root(page);
    for (const ancestor of route.slice(1)) {
      const toggle = page.getByRole("button", {
        name: new RegExp(`^Unterordner von ${ancestor} (anzeigen|ausblenden)$`),
      });
      if ((await toggle.getAttribute("aria-expanded")) === "false")
        await toggle.click();
    }
    await page
      .locator(".folder-card")
      .filter({
        has: page.getByRole("button", {
          name: `Ordner ${route.at(-1)} öffnen`,
        }),
      })
      .last()
      .getByRole("button", { name: "Unterordner hinzufügen" })
      .click();
  }
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByRole("button", {
      name: route.length === 1 ? "Ordner erstellen" : "Bestätigen",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (route.length > 1) {
    for (const ancestor of route.slice(1)) await openFolder(page, ancestor);
  }
}
async function openFolder(page: Page, name: string) {
  await page
    .getByRole("button", { name: `Ordner ${name} öffnen`, exact: true })
    .click();
}
async function createCard(
  page: Page,
  front: string,
  back: string,
  image = false,
) {
  await page.getByRole("button", { name: "Neue Karte", exact: true }).click();
  await page.getByLabel("Deine Frage", { exact: false }).fill(front);
  await page.getByLabel("Die Antwort", { exact: false }).fill(back);
  if (image) {
    await page
      .getByLabel("Bild zur Frage hinzufügen", { exact: true })
      .setInputFiles(path.resolve("public/icon-192.png"));
    await expect(
      page.getByRole("button", { name: "Bild entfernen" }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Karte erstellen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function root(page: Page) {
  await page
    .getByRole("navigation", { name: "Ordnerpfad" })
    .getByRole("button", { name: "Sammlung", exact: true })
    .click();
}
async function backup(page: Page) {
  await page
    .getByRole("button", { name: "Anki-Paket exportieren", exact: false })
    .click();
}
async function showCards(page: Page) {
  const toggle = page.getByRole("button", {
    name: "Karten anzeigen",
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
}
async function actions(page: Page, name: string, action: string) {
  if (
    !(await page
      .getByLabel(`Aktionen für ${name}`, { exact: true })
      .isVisible())
  )
    await showCards(page);
  await page.getByLabel(`Aktionen für ${name}`, { exact: true }).click();
  await page
    .locator("details[open]")
    .getByRole("button", { name: action, exact: true })
    .click();
}
async function offlineReload(page: Page, browserName: string) {
  await page.evaluate(() => {
    (window as unknown as { __beforeReload?: boolean }).__beforeReload = true;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __beforeReload?: boolean }).__beforeReload,
      ),
    )
    .toBeUndefined();
  await expect(
    page.getByRole("heading", { name: "Deine Sammlung." }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/app.html");
  await expect(
    page.getByRole("heading", { name: "Deine Sammlung." }),
  ).toBeVisible();
});

test("leere Sammlung, Hell/Dunkel, mobile Darstellung und persistente Daten", async ({
  page,
  isMobile,
}) => {
  await expect(page.locator(".folder-card")).toHaveCount(0);
  await expect(page.locator(".card-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Einstellungen öffnen" }).click();
  await page.getByRole("button", { name: "Dunkelmodus aktivieren" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Dialog schließen", exact: true })
    .click();
  await createFolder(page, "Eigener Ordner");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Ordner Eigener Ordner öffnen" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("Hauptmenü zeigt nur Ordner, Unterordner klappen auf und Reihenfolge bleibt erhalten", async ({
  page,
}) => {
  await expect(page.locator(".collection-toolbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Neue Karte" })).toHaveCount(0);
  await expect(
    page
      .locator(".collection-heading")
      .getByRole("button", { name: "Neuer Ordner" }),
  ).toBeVisible();
  await createFolder(page, "Bio");
  await createFolder(page, "Chemie");
  await createFolder(page, "Physik");
  const rootNames = page.locator(
    ".folder-tree > .folder-card > .folder-card-row .folder-card-text strong",
  );
  await expect(rootNames).toHaveText(["Bio", "Chemie", "Physik"]);
  await page.getByLabel("Reihenfolge für Physik").click();
  await page
    .locator("details[open]")
    .getByRole("button", { name: "Nach oben" })
    .click();
  await expect(rootNames).toHaveText(["Bio", "Physik", "Chemie"]);
  await page.reload();
  await expect(rootNames).toHaveText(["Bio", "Physik", "Chemie"]);

  await page
    .getByRole("button", { name: "Unterordner von Bio anzeigen" })
    .click();
  const bio = page.locator(".folder-tree > .folder-card").first();
  await expect(
    bio.getByRole("button", { name: "Unterordner hinzufügen" }),
  ).toBeVisible();
  await bio.getByRole("button", { name: "Unterordner hinzufügen" }).click();
  await expect(
    page.getByRole("dialog", { name: "Neuer Unterordner" }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Zellbiologie");
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(
    bio.getByRole("button", { name: "Ordner Zellbiologie öffnen" }),
  ).toBeVisible();
  await expect(
    bio.locator(".subfolder-list").first().locator(":scope > *").last(),
  ).toHaveClass(/add-subfolder/);
  await page.reload();
  await page
    .getByRole("button", { name: "Unterordner von Bio anzeigen" })
    .click();
  await expect(
    bio.getByRole("button", { name: "Ordner Zellbiologie öffnen" }),
  ).toBeVisible();
  await bio.getByRole("button", { name: "Ordner Zellbiologie öffnen" }).click();
  await expect(
    page.getByRole("navigation", { name: "Ordnerpfad" }).locator("button"),
  ).toHaveText(["Sammlung", "Zellbiologie"]);
  await expect(
    page.getByRole("button", { name: "Neuer Ordner", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Sammlung durchsuchen")).toHaveCount(0);
  await expect(
    page.locator(".folder-heading").getByRole("button", { name: "Neue Karte" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zur vorherigen Ansicht" }).click();
  await expect(
    page.getByRole("heading", { name: "Deine Sammlung." }),
  ).toBeVisible();
  await openFolder(page, "Bio");
  await openFolder(page, "Zellbiologie");
  await page.getByRole("button", { name: "Zur vorherigen Ansicht" }).click();
  await expect(page.getByRole("heading", { name: "Bio." })).toBeVisible();
});

test("Ordner und Karten verschieben, Zyklen verhindern und bearbeiten", async ({
  page,
}) => {
  await createFolder(page, "Biologie");
  await openFolder(page, "Biologie");
  await createFolder(page, "Anatomie");
  await openFolder(page, "Anatomie");
  await createCard(page, "Erste Frage", "Erste Antwort");
  await page
    .getByRole("navigation", { name: "Ordnerpfad" })
    .getByRole("button", { name: "Biologie", exact: true })
    .click();
  await actions(page, "Anatomie", "Verschieben");
  await page.getByRole("button", { name: "Hierher verschieben" }).click();
  await root(page);
  await expect(
    page.getByRole("button", { name: "Ordner Anatomie öffnen" }),
  ).toBeVisible();
  await actions(page, "Biologie", "Verschieben");
  await page.getByRole("radio", { name: "Anatomie", exact: true }).click();
  await page.getByRole("button", { name: "Hierher verschieben" }).click();
  await openFolder(page, "Anatomie");
  await expect(
    page.getByRole("button", { name: "Ordner Biologie öffnen" }),
  ).toBeVisible();
  await root(page);
  await actions(page, "Anatomie", "Verschieben");
  await expect(
    page.getByRole("radio", { name: "Anatomie", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Biologie/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await openFolder(page, "Anatomie");
  await actions(page, "Erste Frage", "Bearbeiten");
  await page
    .getByLabel("Deine Frage", { exact: false })
    .fill("Geänderte Frage");
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page.locator(".card-row")).toContainText("Geänderte Frage");
  await actions(page, "Geänderte Frage", "Verschieben");
  await page.getByRole("button", { name: "Hierher verschieben" }).click();
  await expect(page.locator(".card-row")).toHaveCount(0);
  await root(page);
  await showCards(page);
  await expect(page.locator(".card-row")).toContainText("Geänderte Frage");
  await actions(page, "Geänderte Frage", "Löschen");
  await page.getByRole("button", { name: "Endgültig löschen" }).click();
  await expect(page.locator(".card-row")).toHaveCount(0);
});

test("Teilbaum lernen, Antwort aufdecken, bewerten, rückgängig und erneut lernen", async ({
  page,
}) => {
  await createFolder(page, "Anderes Fach");
  await openFolder(page, "Anderes Fach");
  await createCard(page, "Außerhalb", "Soll nicht erscheinen");
  await root(page);
  await createFolder(page, "Biologie");
  await openFolder(page, "Biologie");
  await createFolder(page, "Anatomie");
  await openFolder(page, "Anatomie");
  await createFolder(page, "Kopf");
  await openFolder(page, "Kopf");
  await createCard(page, "Was schützt das Gehirn?", "Der Schädel.", true);
  await page
    .getByRole("navigation", { name: "Ordnerpfad" })
    .getByRole("button", { name: "Anatomie", exact: true })
    .click();
  await page.getByRole("button", { name: /Lernen starten/ }).click();
  await expect(page.locator(".study-question")).toContainText(
    "Was schützt das Gehirn?",
  );
  await expect(page.locator(".study-card")).not.toContainText("Außerhalb");
  await expect(page.locator(".study-answer")).toHaveCount(0);
  await page.getByRole("button", { name: /Antwort aufdecken/ }).click();
  await expect(page.locator(".study-answer")).toContainText("Der Schädel.");
  await page.getByRole("button", { name: /Nochmal/ }).click();
  await expect(
    page.getByRole("heading", { name: "Für den Moment geschafft." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Letzte Bewertung rückgängig" })
    .click();
  await expect(page.locator(".study-question")).toContainText(
    "Was schützt das Gehirn?",
  );
  await page.getByRole("button", { name: /Antwort aufdecken/ }).click();
  await page.getByRole("button", { name: /Einfach/ }).click();
  await expect(
    page.getByRole("heading", { name: "Für den Moment geschafft." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zur Sammlung", exact: true }).click();
  await page.getByRole("button", { name: /Lernen starten/ }).click();
  await expect(
    page.getByRole("heading", { name: "Für den Moment geschafft." }),
  ).toBeVisible();
});

test("Export, zweimal additiver Import, Bilder und vollständiger Offline-Neustart", async ({
  page,
  context,
  browserName,
}) => {
  const server = await isolatedStaticServer();
  try {
    await page.goto(server.url + "/app.html");
    await createFolder(page, "Biologie");
    await openFolder(page, "Biologie");
    await createCard(page, "Bildfrage", "Bildantwort", true);
    await root(page);
    await backup(page);
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Anki-Paket exportieren" })
      .click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/\.apkg$/);
    const file = await download.path();
    expect(file).toBeTruthy();
    const packageContents = await JSZip.loadAsync(await readFile(file!));
    expect(packageContents.file("collection.anki2")).toBeTruthy();
    expect(packageContents.file("collection.json")).toBeNull();
    await page
      .getByRole("button", { name: "Importieren", exact: true })
      .click();
    await page
      .getByLabel("Sicherungsdatei auswählen", { exact: true })
      .setInputFiles(file!);
    await expect(
      page.getByText("1 Ordner · 1 Karten · 1 Bilder"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Zur Sammlung hinzufügen" }).click();
    await expect(
      page.getByRole("button", {
        name: "Ordner Biologie (1) öffnen",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Neuer Ordner", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Ordner importieren", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page
      .getByLabel("Sicherungsdatei auswählen", { exact: true })
      .setInputFiles(file!);
    await page.getByRole("button", { name: "Zur Sammlung hinzufügen" }).click();
    await expect(
      page.getByRole("button", {
        name: "Ordner Biologie (2) öffnen",
        exact: true,
      }),
    ).toBeVisible();
    await openFolder(page, "Biologie (2)");
    await showCards(page);
    await page.locator(".card-row-content").click();
    await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
    await page.getByRole("button", { name: "Fertig" }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );
    // Stop the actual origin to verify cached navigation, including in WebKit.
    // Playwright 1.63 WebKit has a confirmed setOffline/SW bug: microsoft/playwright#42775.
    await server.stop();
    if (browserName !== "webkit") await context.setOffline(true);
    await offlineReload(page, browserName);
    await openFolder(page, "Biologie (2)");
    await showCards(page);
    await page.locator(".card-row-content").click();
    await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
    expect(
      await page
        .getByRole("dialog")
        .getByRole("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Fertig" }).click();
    await createCard(page, "Offline erstellt", "Offline gespeichert");
    await offlineReload(page, browserName);
    await openFolder(page, "Biologie (2)");
    await showCards(page);
    await expect(page.locator(".card-row")).toHaveCount(2);
    await context.setOffline(false);
  } finally {
    await server.stop();
  }
});

test("Anki-Paket kann in der App exportiert und wieder importiert werden", async ({
  page,
}) => {
  const server = await isolatedStaticServer();
  try {
    await page.goto(server.url + "/app.html");
    await createFolder(page, "Biologie");
    await openFolder(page, "Biologie");
    await createCard(page, "Frage für Anki", "Antwort für Anki", true);
    await root(page);
    await backup(page);
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Anki-Paket exportieren" })
      .click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/\.apkg$/);
    await page
      .getByRole("button", { name: "Importieren", exact: true })
      .click();
    await page
      .getByLabel("Sicherungsdatei auswählen", { exact: true })
      .setInputFiles((await download.path())!);
    await expect(
      page.getByText("1 Ordner · 1 Karten · 1 Bilder"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Zur Sammlung hinzufügen" }).click();
    await expect(
      page.getByRole("button", { name: "Ordner Biologie (1) öffnen" }),
    ).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("Installationsseite und Lern-App sind getrennt und behalten dieselbe Sammlung", async ({
  page,
}) => {
  await createFolder(page, "Mein vorhandenes Thema");
  await expect(
    page.getByRole("button", { name: "Einstellungen öffnen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "App installieren", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Navigation öffnen", exact: true }),
  ).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Wissen, das bei dir bleibt." }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "App-Navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "App installieren", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "App öffnen", exact: true }).click();
  await expect(page).toHaveURL(/app\.html$/);
  await expect(
    page.getByRole("button", {
      name: "Ordner Mein vorhandenes Thema öffnen",
      exact: true,
    }),
  ).toBeVisible();
  const manifest = await page.request.get("/manifest.webmanifest");
  const config = await manifest.json();
  expect(config.id).toBe("./");
  expect(config.start_url).toBe("./app.html");
  expect(config.display).toBe("standalone");
});

test("Ein installiertes Home-Screen-Symbol öffnet auch von der Startadresse die Lern-App", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "standalone", { value: true }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Deine Sammlung." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Einstellungen öffnen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "App installieren", exact: true }),
  ).toHaveCount(0);
});

test("500 Karten bleiben eingeklappt und im eigenen Bereich bedienbar", async ({
  page,
}) => {
  const zip = new JSZip();
  const now = Date.now();
  zip.file(
    "collection.json",
    JSON.stringify({
      format: "emir-cards",
      version: 1,
      kind: "share",
      createdAt: new Date(now).toISOString(),
      folders: [
        {
          id: "large-deck",
          parentId: null,
          name: "Großes Fach",
          color: "sage",
          createdAt: now,
        },
      ],
      cards: Array.from({ length: 500 }, (_, i) => ({
        id: `card-${i}`,
        folderId: "large-deck",
        front: `Frage ${String(i + 1).padStart(3, "0")}`,
        back: `Antwort ${i + 1}`,
        frontImages: [],
        backImages: [],
        createdAt: now - i,
        updatedAt: now,
      })),
      media: [],
      reviews: [],
    }),
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await page.getByRole("button", { name: "Neuer Ordner", exact: true }).click();
  await page
    .getByRole("button", { name: "Ordner importieren", exact: true })
    .click();
  await page
    .getByLabel("Sicherungsdatei auswählen", { exact: true })
    .setInputFiles({
      name: "500-karten.zip",
      mimeType: "application/zip",
      buffer,
    });
  await page.getByRole("button", { name: "Zur Sammlung hinzufügen" }).click();
  await openFolder(page, "Großes Fach");
  await createFolder(page, "Sichtbarer Unterordner");
  await expect(
    page.getByRole("button", { name: "Ordner Sichtbarer Unterordner öffnen" }),
  ).toBeVisible();
  const toggle = page.locator(".cards-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("500");
  await expect(page.locator(".card-row")).toHaveCount(0);
  await toggle.click();
  const list = page.getByRole("region", { name: "Kartenliste", exact: true });
  await expect(list).toBeVisible();
  await expect(list.locator(".card-row")).toHaveCount(500);
  const size = await list.evaluate((el) => ({
    height: el.clientHeight,
    content: el.scrollHeight,
  }));
  expect(size.height).toBeLessThanOrEqual(360);
  expect(size.content).toBeGreaterThan(size.height * 10);
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await list.locator(".card-row-content").last().click();
  await expect(page.getByRole("dialog")).toContainText("Frage 500");
  await page.getByRole("button", { name: "Fertig", exact: true }).click();
  await actions(page, "Frage 500", "Bearbeiten");
  await expect(page.getByLabel("Deine Frage", { exact: false })).toHaveValue(
    "Frage 500",
  );
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await toggle.click();
  await expect(list).toBeHidden();
  await expect(page.locator(".card-row")).toHaveCount(0);
  await toggle.click();
  await expect(list).toBeVisible();
  await root(page);
  await openFolder(page, "Großes Fach");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Sammlung durchsuchen")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Neuer Ordner", exact: true }),
  ).toHaveCount(0);
  await expect(toggle).toContainText("500");
  await toggle.click();
  await expect(list.locator(".card-row")).toHaveCount(500);
});

test("echtes aktuelles Anki-Paket importieren und als .apkg exportieren", async ({
  page,
}) => {
  await backup(page);
  await page.getByRole("button", { name: "Importieren", exact: true }).click();
  await page
    .getByLabel("Sicherungsdatei auswählen", { exact: true })
    .setInputFiles(path.resolve("tests/fixtures/anki-modern.apkg"));
  await expect(page.getByText("2 Ordner · 1 Karten · 1 Bilder")).toBeVisible();
  await page.getByRole("button", { name: "Zur Sammlung hinzufügen" }).click();
  await expect(
    page.getByRole("button", { name: "Ordner German öffnen", exact: true }),
  ).toBeVisible();
  await backup(page);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Anki-Paket exportieren" })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.apkg$/);
  const contents = await JSZip.loadAsync(
    await readFile((await download.path())!),
  );
  expect(contents.file("collection.json")).toBeNull();
  const database = await contents.file("collection.anki2")!.async("uint8array");
  expect(new TextDecoder().decode(database.slice(0, 16))).toBe(
    "SQLite format 3\0",
  );
  const media = JSON.parse(await contents.file("media")!.async("string"));
  expect(Object.keys(media)).toHaveLength(1);
  expect(contents.file(Object.keys(media)[0])).toBeTruthy();
});

test("nur direkte Karten exportieren und ohne neuen Ordner ins Ziel importieren", async ({
  page,
}, testInfo) => {
  await createFolder(page, "Anatomie");
  await createFolder(page, "Zielordner");
  await backup(page);
  await page
    .getByRole("button", { name: /Nur Karten aus „Sammlung“ speichern/ })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Anki-Paket exportieren" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Dialog schließen" }).click();

  await openFolder(page, "Anatomie");
  await createCard(page, "Direkt in Anatomie", "Anatomie-Antwort", true);
  await createFolder(page, "Histologie");
  await openFolder(page, "Histologie");
  await createCard(page, "Nur in Histologie", "Histologie-Antwort");
  await root(page);
  await openFolder(page, "Anatomie");
  await backup(page);
  await expect(
    page.getByRole("button", { name: /„Anatomie“ mit Unterordnern speichern/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Nur Karten aus „Anatomie“ speichern/ })
    .click();
  await expect(page.getByText(/1 direkt enthaltene Karten/)).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Anki-Paket exportieren" })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/Anatomie-nur-karten-.*\.apkg$/);
  const file = testInfo.outputPath("direct-cards.apkg");
  await download.saveAs(file);
  await page.getByRole("button", { name: "Dialog schließen" }).click();
  await root(page);
  await openFolder(page, "Zielordner");
  await backup(page);
  await page.getByRole("button", { name: "Importieren", exact: true }).click();
  await page
    .getByLabel("Sicherungsdatei auswählen", { exact: true })
    .setInputFiles(file);
  await expect(
    page.getByText("1 Karten · 1 Bilder", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Direkt zu „Zielordner“ hinzufügen – ohne neuen Ordner."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zur Sammlung hinzufügen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".folder-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Karten anzeigen", exact: true }),
  ).toBeVisible();
  await showCards(page);
  await expect(page.locator(".card-row")).toHaveCount(1);
  await expect(page.locator(".card-row")).toContainText("Direkt in Anatomie");
  await expect(
    page.getByText("Nur in Histologie", { exact: true }),
  ).toHaveCount(0);
  await page.locator(".card-row-content").click();
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  await page.getByRole("button", { name: "Fertig" }).click();
  await root(page);
  await expect(page.locator(".folder-tree > .folder-card")).toHaveCount(2);
});
