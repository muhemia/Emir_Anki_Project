import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
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
  await page.getByRole("button", { name: "Neuer Ordner", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Ordner erstellen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
    .getByRole("button", { name: "Sicherung erstellen", exact: false })
    .click();
}
async function actions(page: Page, name: string, action: string) {
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
  await page.goto("/");
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
  if (isMobile)
    await page.getByRole("button", { name: "Navigation öffnen" }).click();
  await page.getByRole("button", { name: "Dunkelmodus aktivieren" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if (isMobile)
    await page
      .getByRole("button", { name: "Navigation schließen", exact: true })
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
  await expect(page.locator(".card-row")).toContainText("Geänderte Frage");
  await actions(page, "Geänderte Frage", "Löschen");
  await page.getByRole("button", { name: "Endgültig löschen" }).click();
  await expect(page.locator(".card-row")).toHaveCount(0);
});

test("Teilbaum lernen, Antwort aufdecken, bewerten, rückgängig und erneut lernen", async ({
  page,
}) => {
  await createCard(page, "Außerhalb", "Soll nicht erscheinen");
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
    await page.goto(server.url);
    await createFolder(page, "Biologie");
    await openFolder(page, "Biologie");
    await createCard(page, "Bildfrage", "Bildantwort", true);
    await root(page);
    await backup(page);
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "ZIP-Datei exportieren" }).click();
    const download = await downloadEvent;
    const file = await download.path();
    expect(file).toBeTruthy();
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
    await backup(page);
    await page
      .getByRole("button", { name: "Importieren", exact: true })
      .click();
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
    await expect(page.locator(".card-row")).toHaveCount(2);
    await context.setOffline(false);
  } finally {
    await server.stop();
  }
});
