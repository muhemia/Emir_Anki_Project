import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ArrowRight,
  Check,
  Download,
  Layers,
  Plus,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { Modal, errorText } from "./components/ui";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function Landing() {
  const [prompt, setPrompt] = useState<InstallPrompt>();
  const [help, setHelp] = useState(false);
  const [message, setMessage] = useState("");
  const [installing, setInstalling] = useState(false);
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    const before = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const installed = () => {
      setPrompt(undefined);
      setMessage("Installiert. Öffne Emir Cards jetzt über dein App-Symbol.");
    };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  async function install() {
    if (!prompt) {
      setHelp(true);
      return;
    }
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(undefined);
      setMessage(
        choice.outcome === "accepted"
          ? "Installation gestartet. Danach findest du Emir Cards auf deinem Home-Bildschirm."
          : "Du kannst die Installation jederzeit erneut öffnen.",
      );
    } catch (e) {
      setMessage(errorText(e));
      setHelp(true);
    } finally {
      setInstalling(false);
    }
  }
  return (
    <div className="landing">
      <header className="landing-header">
        <a className="landing-brand" href="./">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <span>emir cards</span>
        </a>
        <a className="landing-open" href="./app.html">
          App öffnen <ArrowRight size={16} />
        </a>
      </header>
      <main>
        <section className="landing-hero">
          <div className="landing-copy">
            <span className="landing-eyebrow">
              <span /> DEIN PERSÖNLICHER LERNRAUM
            </span>
            <h1>
              Wissen, das
              <br />
              bei dir <em>bleibt.</em>
            </h1>
            <p>
              Deine Karteikarten. Deine Themen. Deine Lern-App fürs Handy – mit
              Bildern, cleveren Wiederholungen und Platz für alles, was du dir
              merken möchtest.
            </p>
            <button
              className="button primary landing-install"
              onClick={() => void install()}
              disabled={installing}
            >
              <Download size={20} />
              {installing ? "Installation wird geöffnet …" : "App installieren"}
              <ArrowRight size={19} />
            </button>
            <div className="landing-platforms">
              <Smartphone size={15} /> Für iPhone und Android · Ohne Konto
            </div>
            <a className="try-link" href="./app.html">
              Erst im Browser ausprobieren <ArrowRight size={16} />
            </a>
            {message && (
              <p className="landing-message" role="status">
                {message}
              </p>
            )}
          </div>
          <div className="phone-stage" aria-hidden="true">
            <div className="phone-halo" />
            <div className="phone-demo">
              <div className="phone-speaker" />
              <div className="phone-demo-header">
                <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
                <span>emir cards</span>
                <Settings2 size={19} />
              </div>
              <h2>
                Deine Sammlung<span>.</span>
              </h2>
              <p>Deine Themen. Dein Tempo.</p>
              <div className="phone-demo-study">
                <Sparkles size={21} />
                <span>
                  Ein guter Moment
                  <br />
                  <strong>für neues Wissen.</strong>
                </span>
              </div>
              <div className="phone-demo-section">
                <span>Deine Inhalte</span>
                <Plus size={18} />
              </div>
              <div className="phone-demo-card">
                <Layers size={30} />
                <h3>
                  Was möchtest du
                  <br />
                  dir merken?
                </h3>
                <p>Eine Karte ist ein guter Anfang.</p>
                <span>
                  Erste Karte erstellen <Plus size={14} />
                </span>
              </div>
              <div className="phone-home" />
            </div>
            <div className="phone-label">
              <Check size={15} /> Dein Wissen, immer dabei.
            </div>
          </div>
        </section>
        <section
          className="landing-features"
          aria-label="Das steckt in der App"
        >
          <article>
            <Layers size={23} />
            <h2>Ordnung, die mitwächst.</h2>
            <p>
              Ordner und Karten erstellen und so verschieben, wie es für dich
              passt.
            </p>
          </article>
          <article>
            <WifiOff size={23} />
            <h2>Auch ohne Internet.</h2>
            <p>
              Einmal vollständig laden. Danach überall lernen, auch im
              Flugmodus.
            </p>
          </article>
          <article>
            <ShieldCheck size={23} />
            <h2>Deine Daten bleiben bei dir.</h2>
            <p>
              Alles liegt auf deinem Gerät. Eine ZIP-Datei sichert deine
              Sammlung.
            </p>
          </article>
        </section>
        <section className="landing-how">
          <span className="eyebrow">VON DIESER SEITE AUF DEIN HANDY</span>
          <h2>Einmal hinzufügen. Jeden Tag öffnen.</h2>
          <ol>
            <li>
              <span>01</span>
              <p>
                <strong>Hier installieren</strong>Öffne diese Seite auf deinem
                Handy und tippe auf „App installieren“.
              </p>
            </li>
            <li>
              <span>02</span>
              <p>
                <strong>Zum Home-Bildschirm hinzufügen</strong>Auf dem iPhone
                führt dich das Teilen-Menü dorthin. Unter Android der
                Installationsdialog.
              </p>
            </li>
            <li>
              <span>03</span>
              <p>
                <strong>Über das App-Symbol starten</strong>Du landest direkt in
                deiner Sammlung, in einem eigenen Fenster ohne Browserleiste.
              </p>
            </li>
          </ol>
        </section>
        {needRefresh && (
          <div className="landing-update">
            <span>Eine neue Version ist bereit.</span>
            <button
              className="button secondary"
              onClick={() => void updateServiceWorker(true)}
            >
              Aktualisieren
            </button>
          </div>
        )}
      </main>
      <footer className="landing-footer">
        <span>Emir Cards · Gemacht fürs Lernen.</span>
        <span>
          {offlineReady
            ? "App-Dateien für offline bereit"
            : "Kostenlos · Ohne Anmeldung"}
        </span>
      </footer>
      {help && (
        <Modal title="Emir Cards installieren" onClose={() => setHelp(false)}>
          <div className="dialog-body">
            <p className="muted">
              Öffne diese Seite im Browser deines Handys. Danach genügen ein
              paar Schritte:
            </p>
            <div className="install-steps">
              <strong>iPhone · Safari</strong>
              <p>
                Tippe auf Teilen, dann auf „Zum Home-Bildschirm“. Aktiviere „Als
                Web-App öffnen“, falls angezeigt, und bestätige mit
                „Hinzufügen“.
              </p>
              <strong>Android · Chrome</strong>
              <p>
                Öffne das Browsermenü und wähle „App installieren“ oder „Zum
                Startbildschirm hinzufügen“.
              </p>
              <strong>Auf dem Computer</strong>
              <p>
                Chrome und Edge bieten die Installation über das Symbol in der
                Adressleiste an.
              </p>
            </div>
            <div className="info-note">
              <Smartphone size={20} />
              <p>
                Das App-Symbol öffnet direkt deine Lern-App. Diese
                Installationsseite wird dort nicht angezeigt.
              </p>
            </div>
            <a className="button primary full" href="./app.html">
              Jetzt im Browser ausprobieren <ArrowRight size={18} />
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}
