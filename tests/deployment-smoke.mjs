// Runs against the disposable Linux CI installation, using its local test CA.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "emir-deploy-"));
const origin = "https://cards.example.test";
const common = [
  "--silent",
  "--show-error",
  "--resolve",
  "cards.example.test:443:127.0.0.1",
  "--cacert",
  "/etc/letsencrypt/live/cards.example.test/fullchain.pem",
];
function request(path, { body, originHeader = origin } = {}) {
  const headers = join(directory, "headers"),
    output = join(directory, "body");
  const args = [
    ...common,
    "--dump-header",
    headers,
    "--output",
    output,
    "--write-out",
    "%{http_code}",
    "--cookie",
    join(directory, "cookies"),
    "--cookie-jar",
    join(directory, "cookies"),
  ];
  if (body !== undefined)
    args.push(
      "-H",
      "Content-Type: application/json",
      "-H",
      `Origin: ${originHeader}`,
      "--data",
      JSON.stringify(body),
    );
  const status = Number(
    execFileSync("curl", [...args, origin + path], { encoding: "utf8" }),
  );
  return {
    status,
    headers: readFileSync(headers, "utf8"),
    body: readFileSync(output, "utf8"),
  };
}
try {
  const html = request("/app.html");
  assert.equal(html.status, 200);
  assert.match(html.headers, /content-security-policy:/i);
  assert.doesNotMatch(html.headers, /cache-control:.*max-age=31536000/i);
  const scripts = [...html.body.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.ok(scripts.length);
  for (const path of scripts) {
    const script = request("/" + path.replace(/^\.\//, ""));
    assert.equal(script.status, 200);
    assert.match(script.headers, /(javascript|ecmascript)/i);
  }
  assert.equal(request("/api/health").body, '{"ok":true}');
  const registered = request("/api/auth/register", {
    body: { username: "deployment_test", password: "disposable-ci-password" },
  });
  assert.equal(registered.status, 201, registered.body);
  assert.match(registered.headers, /set-cookie:.*HttpOnly.*Secure/i);
  const pull = request("/api/sync", {
    body: {
      batchId: "ed339a87-4f9e-4887-8a47-3a2723bc2fc5",
      cursor: 0,
      changes: [],
    },
  });
  assert.equal(pull.status, 200, pull.body);
  assert.deepEqual(JSON.parse(pull.body).changes, []);
  const folder = {
    id: "45017b50-d6ee-425d-931c-f1f120046658",
    parentId: null,
    name: "Deploymenttest",
    color: "sage",
    createdAt: Date.now(),
  };
  const push = request("/api/sync", {
    body: {
      batchId: "8bdd0069-3655-42fa-8fb8-063e0a74497f",
      cursor: JSON.parse(pull.body).cursor,
      changes: [
        { kind: "folders", id: folder.id, baseVersion: 0, value: folder },
      ],
    },
  });
  assert.equal(push.status, 200, push.body);
  assert.equal(
    request("/api/sync", { originHeader: "https://evil.example", body: {} })
      .status,
    403,
  );
  assert.equal(request("/api/auth/logout", { body: {} }).status, 204);
  assert.equal(request("/api/auth/me").status, 401);
  console.log(
    "HTTPS, Nginx, Frontend-Dateien, Secure-Cookies, Login-Sitzung und PostgreSQL-Sync erfolgreich geprüft.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
