import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
test.use({ serviceWorkers: "block" });
async function sync(page: Page) {
  await page
    .getByRole("button", { name: "Synchronisieren", exact: true })
    .click();
  await expect(
    page.getByText("Mit Server abgeglichen", { exact: true }),
  ).toBeVisible();
}
async function open(page: Page) {
  await page
    .getByRole("button", { name: "Ordner Anatomie öffnen", exact: true })
    .click();
}
async function show(page: Page) {
  const b = page.getByRole("button", { name: "Karten anzeigen", exact: true });
  if (await b.isVisible()) await b.click();
}
async function edit(page: Page, old: string, value: string) {
  await show(page);
  await page.getByLabel(`Aktionen für ${old}`, { exact: true }).click();
  await page
    .locator("details[open]")
    .getByRole("button", { name: "Bearbeiten", exact: true })
    .click();
  await page.getByLabel("Deine Frage", { exact: false }).fill(value);
  await page
    .getByRole("button", { name: "Änderungen speichern", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("zwei Geräte, dauerhafte lokale Änderungen, Verbindungsabbruch und Versionskonflikt", async ({
  page,
  browser,
  account,
}) => {
  await page.goto("/app.html");
  await page.getByRole("button", { name: "Neuer Ordner", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Anatomie");
  await page
    .getByRole("button", { name: "Ordner erstellen", exact: true })
    .click();
  await open(page);
  await page.getByRole("button", { name: "Neue Karte", exact: true }).click();
  await page
    .getByLabel("Deine Frage", { exact: false })
    .fill("Ursprüngliche Frage");
  await page.getByLabel("Die Antwort", { exact: false }).fill("Antwort");
  await page
    .getByLabel("Bild zur Frage hinzufügen", { exact: true })
    .setInputFiles("public/icon-192.png");
  await expect(
    page.getByRole("button", { name: "Bild entfernen" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Karte erstellen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Änderungen auf diesem Gerät", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await open(page);
  await show(page);
  await expect(page.locator(".card-row")).toContainText("Ursprüngliche Frage");
  // A stopped API behind Nginx (502) must still allow the cached account.
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 502, body: "API temporarily unavailable" }),
  );
  await page.reload();
  await expect(
    page.getByText("Offline · lokal gespeichert", { exact: true }),
  ).toBeVisible();
  await open(page);
  await show(page);
  await expect(page.locator(".card-row")).toContainText("Ursprüngliche Frage");
  await page.unroute("**/api/auth/me");
  await page.reload();
  // Server commits; browser loses the response. Retry must not duplicate writes.
  await page.route(
    "**/api/sync",
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Synchronisieren", exact: true })
    .click();
  await expect(page.locator(".sync-error")).toBeVisible();
  await page.reload();
  await sync(page);
  const other = await browser.newContext();
  try {
    const phone = await other.newPage();
    await phone.goto("http://localhost:4174/app.html");
    await phone
      .getByLabel("Benutzername", { exact: true })
      .fill(account.username);
    await phone.getByLabel("Passwort", { exact: true }).fill(account.password);
    await phone.getByRole("button", { name: "Anmelden", exact: true }).click();
    await open(phone);
    await show(phone);
    await expect(phone.locator(".card-row")).toHaveCount(1);
    await expect(phone.locator(".card-row")).toContainText(
      "Ursprüngliche Frage",
    );
    await phone.locator(".card-row-content").click();
    await expect(phone.getByRole("dialog").getByRole("img")).toBeVisible();
    await phone.getByRole("button", { name: "Fertig", exact: true }).click();
    await open(page);
    await edit(page, "Ursprüngliche Frage", "Laptop-Fassung");
    await edit(phone, "Ursprüngliche Frage", "Handy-Fassung");
    await sync(phone);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByText("Änderungen auf anderem Gerät verfügbar", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Synchronisieren", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Konflikte lösen", exact: true }),
    ).toBeVisible();
    await show(page);
    await expect(page.locator(".card-row")).toContainText("Laptop-Fassung");
    await page
      .getByRole("button", { name: "Konflikte lösen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Dieses Gerät behalten", exact: true })
      .click();
    await expect(
      page.getByText("Mit Server abgeglichen", { exact: true }),
    ).toBeVisible();
    await sync(phone);
    await show(phone);
    await expect(phone.locator(".card-row")).toContainText("Laptop-Fassung");
    // A real browser DB exists per account and contains exactly one card.
    const count = await page.evaluate(
      async (id) =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open(`emir-cards-account-${id}`);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const count = db.transaction("cards").objectStore("cards").count();
            count.onsuccess = () => {
              resolve(count.result);
              db.close();
            };
          };
        }),
      account.id,
    );
    expect(count).toBe(1);
  } finally {
    await other.close();
  }
});
