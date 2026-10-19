import { useEffect, useRef, useState, type FormEvent } from "react";
import App from "./App";
import SyncBar from "./components/SyncBar";
import {
  ApiError,
  cachedAccount,
  canSignOut,
  currentAccount,
  initializeRemote,
  releaseRemote,
  signIn,
  signOut,
  signUp,
  type Account,
} from "./remote";

export default function AuthGate() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const boot = useRef<Promise<Account> | null>(null);
  useEffect(() => {
    let active = true;
    boot.current ??= (async () => {
      let user: Account;
      let offline = false;
      try {
        user = await currentAccount();
      } catch (reason) {
        const cached = cachedAccount();
        if ((reason instanceof ApiError && reason.status < 500) || !cached)
          throw reason;
        user = cached;
        offline = true;
      }
      await initializeRemote(user, offline);
      return user;
    })();
    boot.current
      .then((user) => {
        if (active) setAccount(user);
      })
      .catch((reason) => {
        if (active && !(reason instanceof ApiError && reason.status === 401))
          setError(
            reason instanceof Error
              ? reason.message
              : "Server nicht erreichbar.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const user = await (register
        ? signUp(username, password)
        : signIn(username, password));
      await initializeRemote(user);
      setAccount(user);
      setPassword("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Anmeldung fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!(await canSignOut()))
      throw new Error(
        "Bitte zuerst synchronisieren und Versionskonflikte lösen. Deine Änderungen sind bisher nur auf diesem Gerät gespeichert.",
      );
    await signOut();
    await releaseRemote();
    setAccount(null);
    setPassword("");
  }

  if (loading)
    return (
      <div className="loading-screen">
        <p>Dein Lernraum wird geladen …</p>
      </div>
    );
  if (account)
    return (
      <>
        <SyncBar
          onReauthenticate={() => {
            setUsername(account.username);
            setAccount(null);
            setError("");
          }}
        />
        <App username={account.username} onLogout={logout} />
      </>
    );
  return (
    <main className="auth-page">
      <div className="auth-card">
        <img
          src={`${import.meta.env.BASE_URL}favicon.svg`}
          alt=""
          width="48"
          height="48"
        />
        <span className="eyebrow">EMIR CARDS</span>
        <h1>{register ? "Konto erstellen" : "Willkommen zurück"}</h1>
        <p>Deine Karten werden in deinem eigenen Konto gespeichert.</p>
        <form onSubmit={submit}>
          <label htmlFor="auth-username">Benutzername</label>
          <input
            id="auth-username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            pattern="[A-Za-z0-9_-]{3,32}"
            minLength={3}
            maxLength={32}
            required
          />
          <label htmlFor="auth-password">Passwort</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={register ? 8 : undefined}
            maxLength={128}
            required
          />
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy
              ? "Einen Moment …"
              : register
                ? "Konto erstellen"
                : "Anmelden"}
          </button>
        </form>
        <button
          className="auth-switch"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register
            ? "Ich habe schon ein Konto"
            : "Noch kein Konto? Jetzt erstellen"}
        </button>
      </div>
    </main>
  );
}
