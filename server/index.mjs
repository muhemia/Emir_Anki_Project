import express from "express";
import { registerSync } from "./sync.mjs";
import pg from "pg";
import {
  randomBytes,
  randomUUID,
  scrypt,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DATABASE_URL ? undefined : process.env.PGHOST || "/tmp",
  database: process.env.DATABASE_URL
    ? undefined
    : process.env.PGDATABASE || "emir_anki",
});
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.APP_ORIGIN?.startsWith("https://") || !process.env.DATABASE_URL)
)
  throw new Error(
    "Produktion benötigt eine HTTPS-APP_ORIGIN und DATABASE_URL.",
  );
const app = express();
if (production) app.set("trust proxy", "loopback");
app.disable("x-powered-by");

const sessionAge = 30 * 24 * 60 * 60 * 1000;

const usernamePattern = /^[a-z0-9_-]{3,32}$/;
const allowedOrigins = new Set(
  [
    ...(production
      ? []
      : [
          "http://127.0.0.1:5173",
          "http://localhost:5173",
          "http://127.0.0.1:4173",
          "http://localhost:4173",
        ]),
    process.env.APP_ORIGIN,
  ].filter(Boolean),
);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const cookie = (token, maxAge) =>
  `emir_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${production || process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`;
const getCookie = (req) => {
  const item = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("emir_session="));
  return item?.slice("emir_session=".length);
};

app.use("/api", (req, _res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.get("origin");
    if (!origin || !allowedOrigins.has(origin))
      return next(new HttpError(403, "Ungültige Anfragequelle."));
  }
  _res.setHeader("Cache-Control", "no-store");
  _res.setHeader("X-Content-Type-Options", "nosniff");
  _res.setHeader("Referrer-Policy", "same-origin");
  if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
    return next(new HttpError(415, "JSON erwartet."));
  next();
});
app.use("/api/auth", express.json({ limit: "8kb" }));
app.use(express.json({ limit: "300mb" }));
async function throttle(req, res, next) {
  try {
    const registration = req.path.endsWith("/register");
    const limit = registration ? 8 : 40;
    const key = tokenHash(`${registration ? "register" : "login"}:${req.ip}`);
    const result = await pool.query(
      `INSERT INTO auth_limits (key_hash) VALUES ($1)
      ON CONFLICT (key_hash) DO UPDATE SET
      attempts=CASE WHEN auth_limits.window_started < now()-interval '15 minutes' THEN 1 ELSE auth_limits.attempts+1 END,
      window_started=CASE WHEN auth_limits.window_started < now()-interval '15 minutes' THEN now() ELSE auth_limits.window_started END RETURNING attempts`,
      [key],
    );
    if (result.rows[0].attempts > limit) {
      res.setHeader("Retry-After", "900");
      return res.status(429).json({
        error:
          "Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.",
      });
    }
    next();
  } catch (error) {
    next(error);
  }
}

async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await deriveKey(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}
async function validPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = await deriveKey(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    expected.length === candidate.length && timingSafeEqual(expected, candidate)
  );
}
async function startSession(userId, res) {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [tokenHash(token), userId, new Date(Date.now() + sessionAge)],
  );
  res.setHeader("Set-Cookie", cookie(token, Math.floor(sessionAge / 1000)));
}
async function requireUser(req, _res, next) {
  try {
    const token = getCookie(req);
    if (!token) return fail(401, "Bitte melde dich an.");
    const result = await pool.query(
      `SELECT users.id, users.username FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`,
      [tokenHash(token)],
    );
    if (!result.rowCount) return fail(401, "Deine Sitzung ist abgelaufen.");
    if (
      req.get("X-Account-ID") &&
      req.get("X-Account-ID") !== result.rows[0].id
    )
      return fail(
        401,
        "In einem anderen Tab ist ein anderes Konto angemeldet. Bitte erneut anmelden.",
      );
    req.user = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

app.post("/api/auth/register", throttle, async (req, res) => {
  const username = String(req.body?.username || "")
    .trim()
    .toLowerCase();
  const password = req.body?.password;
  if (!usernamePattern.test(username))
    return fail(
      400,
      "Der Benutzername braucht 3–32 Zeichen (a–z, 0–9, _ oder -). ",
    );
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128
  )
    return fail(400, "Das Passwort braucht 8–128 Zeichen.");
  const userId = randomUUID();
  try {
    await pool.query(
      "INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)",
      [userId, username, await passwordHash(password)],
    );
  } catch (error) {
    if (error.code === "23505")
      return fail(409, "Dieser Benutzername ist bereits vergeben.");
    throw error;
  }
  await startSession(userId, res);
  res.status(201).json({ id: userId, username });
});

app.post("/api/auth/login", throttle, async (req, res) => {
  const username = String(req.body?.username || "")
    .trim()
    .toLowerCase();
  const password = req.body?.password;
  if (
    !usernamePattern.test(username) ||
    typeof password !== "string" ||
    password.length > 128
  )
    return fail(401, "Benutzername oder Passwort ist falsch.");
  const result = await pool.query(
    "SELECT id, username, password_hash FROM users WHERE username = $1",
    [username],
  );
  if (
    !(await validPassword(
      password,
      result.rows[0]?.password_hash || dummyPasswordHash,
    )) ||
    !result.rowCount
  )
    return fail(401, "Benutzername oder Passwort ist falsch.");
  const user = result.rows[0];
  await startSession(user.id, res);
  res.json({ id: user.id, username: user.username });
});

const dummyPasswordHash = await passwordHash(randomBytes(32).toString("hex"));

app.get("/api/auth/me", requireUser, (req, res) => res.json(req.user));
app.post("/api/auth/logout", async (req, res) => {
  if (getCookie(req))
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [
      tokenHash(getCookie(req)),
    ]);
  res.setHeader("Set-Cookie", cookie("", 0));
  res.status(204).end();
});

registerSync(app, pool, requireUser);
// Old clients must update instead of replacing an entire collection.
app.all("/api/data", requireUser, (_req, res) =>
  res.status(410).json({
    error:
      "Bitte die App neu laden. Diese Version verwendet den neuen Änderungsabgleich.",
  }),
);

app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});
app.use((error, _req, res, _next) => {
  if (error instanceof HttpError)
    return res.status(error.status).json({ error: error.message });
  if (error?.code === "23503" || error?.code === "22P02")
    return res
      .status(400)
      .json({ error: "Die Sammlung enthält ungültige Verweise." });
  if (error.type === "entity.too.large")
    return res.status(413).json({ error: "Die Anfrage ist zu groß." });
  if (error.type === "entity.parse.failed")
    return res.status(400).json({ error: "Ungültiges JSON." });
  console.error("API error", { code: error.code, name: error.name });
  res.status(500).json({ error: "Ein Serverfehler ist aufgetreten." });
});

const port = Number(process.env.PORT || 3001);
await pool.query("SELECT 1");
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`API läuft auf http://127.0.0.1:${port}`),
);
const cleanup = setInterval(() => {
  void pool
    .query("DELETE FROM sessions WHERE expires_at < now()")
    .catch(() => {});
  void pool
    .query(
      "DELETE FROM auth_limits WHERE window_started < now()-interval '1 day'",
    )
    .catch(() => {});
}, 3600000);
cleanup.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(cleanup);
    server.close(() => void pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  });
