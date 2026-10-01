import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const browser = await chromium.launch();
const page = await browser.newPage();
let svg = readFileSync(
  new URL("../public/favicon.svg", import.meta.url),
  "utf8",
);
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["icon-maskable.png", 512],
]) {
  const source = name.includes("maskable")
    ? svg.replace('rx="30"', 'rx="0"')
    : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>body{margin:0}img{width:100vw;height:100vh;display:block}</style><img src="data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}">`,
  );
  await page
    .locator("img")
    .screenshot({
      path: new URL(`../public/${name}`, import.meta.url).pathname,
      omitBackground: true,
    });
}
await browser.close();
