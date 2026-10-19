import { test as base, expect } from "@playwright/test";
import pg from "pg";
import { randomUUID, randomBytes, createHash, scryptSync } from "node:crypto";
export const test = base.extend<{
  account: { id: string; username: string; password: string };
}>({
  account: [
    async ({ context }, use) => {
      const client = new pg.Client({
        host: process.env.PGHOST || "/tmp",
        database: "emir_anki_e2e",
      });
      await client.connect();
      const id = randomUUID(),
        username = `test_${id.replaceAll("-", "").slice(0, 20)}`,
        password = "test-password-only";
      const salt = randomBytes(16).toString("hex"),
        hash = scryptSync(password, salt, 64).toString("hex"),
        token = randomBytes(32).toString("base64url");
      await client.query(
        "INSERT INTO users (id,username,password_hash) VALUES ($1,$2,$3)",
        [id, username, `${salt}:${hash}`],
      );
      await client.query(
        "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(token).digest("hex"), id],
      );
      await context.addCookies(
        ["http://localhost:4174", "http://127.0.0.1"].map((url) => ({
          name: "emir_session",
          value: token,
          url,
          httpOnly: true,
          sameSite: "Lax" as const,
        })),
      );
      try {
        await use({ id, username, password });
      } finally {
        await client.query("DELETE FROM users WHERE id=$1", [id]);
        await client.end();
      }
    },
    { auto: true },
  ],
});
export { expect };
