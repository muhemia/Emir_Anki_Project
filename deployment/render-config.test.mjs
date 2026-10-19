import { test } from "node:test";
import assert from "node:assert/strict";
import { renderConfig, validateDomain } from "./render-config.mjs";
test("Domain wird in HTTP-, HTTPS- und Zertifikatpfade eingesetzt", async () => {
  const http = await renderConfig("http", "cards.example.org");
  const https = await renderConfig("https", "cards.example.org");
  assert.match(http, /server_name cards\.example\.org;/);
  assert.match(http, /well-known\/acme-challenge/);
  assert.doesNotMatch(http, /ssl_certificate/);
  assert.match(https, /letsencrypt\/live\/cards\.example\.org\/fullchain\.pem/);
  assert.match(https, /proxy_pass http:\/\/127\.0\.0\.1:3001;/);
  assert.match(https, /root \/srv\/emir-cards\/current\/dist;/);
  assert.doesNotMatch(http + https, /cards\.example\.com/);
});
test("Domains können keine Shell- oder Nginx-Konfiguration einschleusen", () => {
  for (const domain of [
    "https://cards.example.org",
    "cards.example.org; return 200",
    "$(whoami).org",
    "../etc/passwd",
    "-cards.example.org",
    "cards..org",
    "127.0.0.1",
    "cards.example.org\n}",
    "a".repeat(64) + ".org",
  ])
    assert.throws(() => validateDomain(domain));
});
