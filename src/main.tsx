import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Landing from "./Landing";
import "./style.css";
import "./native.css";
import "./landing.css";

const installed =
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const showApp = location.pathname.endsWith("/app.html") || installed;
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="startup-error">
        <h1>Der Lernraum konnte nicht geöffnet werden.</h1>
        <p>
          Bitte lade die Seite neu. Prüfe, ob der Browser das Speichern von
          Website-Daten erlaubt und genügend Gerätespeicher frei ist.
        </p>
        <p>Bestehende Daten werden dabei nicht gelöscht.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Erneut öffnen
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>{showApp ? <App /> : <Landing />}</ErrorBoundary>
  </StrictMode>,
);
