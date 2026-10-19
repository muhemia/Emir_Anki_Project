import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateDomain(domain) {
  if (
    typeof domain !== "string" ||
    domain.length > 253 ||
    !domain.includes(".") ||
    !domain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /^[0-9.]+$/.test(domain)
  )
    throw new Error(
      "Bitte einen Domainnamen wie cards.example.org angeben, ohne https:// oder Pfad.",
    );
  return domain;
}
export async function renderConfig(kind, domain) {
  validateDomain(domain);
  if (!["http", "https"].includes(kind))
    throw new Error("Konfiguration muss http oder https sein.");
  const source = await readFile(
    new URL(
      kind === "http" ? "./nginx-http.conf" : "./nginx.conf",
      import.meta.url,
    ),
    "utf8",
  );
  return source.replaceAll("cards.example.com", domain);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.stdout.write(await renderConfig(process.argv[2], process.argv[3]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
