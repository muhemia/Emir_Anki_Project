# Emir Cards

Karteikarten-Web-App mit React, TypeScript, Vite, FSRS und PostgreSQL. Jeder Nutzer hat einen eigenen Benutzernamen und ein Passwort. Ordner, Karten, Bilder und Lernverlauf werden benutzerbezogen in PostgreSQL gespeichert. Es gibt keine E-Mail-Adresse, Rollen oder Admin-Oberfläche.

## Auf dem VPS installieren

Frontend, API und Datenbankschema liegen gemeinsam in diesem Repository. Der vorbereitete Weg verwendet Ubuntu/Debian, Nginx, Node.js und PostgreSQL. Die [VPS-Anleitung](deployment/README.md) enthält die Befehle zum Klonen, Installieren, Aktivieren von HTTPS und Aktualisieren.

Nach der dort beschriebenen Systemvorbereitung:

```sh
git clone https://github.com/muhemia/Emir_Anki_Project.git
cd Emir_Anki_Project
npm ci
npm run build
sudo bash deployment/install.sh cards.meine-domain.de
sudo certbot certonly --webroot -w /var/www/letsencrypt -d cards.meine-domain.de
sudo bash deployment/enable-https.sh cards.meine-domain.de
```

`cards.meine-domain.de` durch die eigene Domain ersetzen. Der Installer richtet Datenbank, API-Dienst und tägliche Backups ein. Passwörter werden auf dem VPS erzeugt. Domain/DNS, die HTTPS-Ausstellung und eine Backup-Kopie außerhalb des VPS bleiben Bestandteile der Servereinrichtung.

## Lokal starten (Mac)

Voraussetzungen: Node.js 22 oder neuer und ein laufender PostgreSQL-Server. Die lokale Datenbank heißt `emir_anki`.

```sh
npm ci
createdb emir_anki               # nur beim ersten Mal
npm run db:schema
```

In zwei Terminals starten:

```sh
npm run dev:api   # API auf http://127.0.0.1:3001
npm run dev       # Web-App auf http://127.0.0.1:5173/app.html
```

Alternativ startet `Start.command` beide Dienste und öffnet die App. Die API liest `DATABASE_URL` oder die PostgreSQL-Umgebungsvariablen aus `.env`; ein Beispiel steht in `.env.example`. `.env` wird nicht in Git eingecheckt. Die Vite-Entwicklungsansicht leitet `/api` an den lokalen API-Server weiter.

Auf `localhost`, `127.0.0.1` und `::1` öffnet auch die Startadresse `/` direkt die App: mit Anmeldung oder, bei bestehender Sitzung, der Sammlung. Die Installationsseite wird lokal übersprungen. Das gilt auch für die lokale Produktionsvorschau.

## Konten und Daten

Ein Konto kann direkt auf der Anmeldeseite angelegt werden. Der Benutzername enthält 3–32 Zeichen (`a–z`, `0–9`, `_`, `-`), das Passwort mindestens 8 Zeichen. Passwörter werden mit einem gesalzenen scrypt-Hash gespeichert. Die Anmeldung setzt ein `HttpOnly`-Sitzungscookie; nur die API greift auf PostgreSQL zu. Jede Datenbankzeile für Karten, Ordner, Bilder und Bewertungen enthält die Nutzer-ID. Fremdschlüssel halten die Verweise innerhalb des jeweiligen Nutzerkontos.

Das Datenbankschema liegt in `server/schema.sql`, die Express-API in `server/index.mjs` und der Delta-Abgleich in `server/sync.mjs`. PostgreSQL enthält die gemeinsame Sammlung pro Konto. Auf jedem Gerät hält IndexedDB eine dauerhafte Arbeitskopie; React liest beim Lernen ausschließlich daraus.

Änderungen werden zunächst lokal gespeichert. **„Synchronisieren“ lädt eigene Änderungen hoch und neue Serveränderungen herunter.** Das gilt für Karten, Ordner, Bilder und Lernfortschritt. Ein frisches Gerät lädt nach der ersten Anmeldung einmal die komplette Sammlung. Später werden nur Änderungen seit dem letzten Abgleich übertragen. Alle 30 Sekunden und beim Zurückkehren in die App wird eine kleine Versionsnummer abgefragt; neue Inhalte werden erst nach dem Klick übernommen. Beim Synchronisieren wird eine laufende Lernsitzung beendet, damit kein veralteter Lernstand weiterverwendet wird.

Versionskonflikte bleiben sichtbar, bis eine Fassung ausgewählt wurde. Unterbrochene Uploads werden mit derselben Kennung wiederholt. Löschvermerke verhindern, dass alte Gerätekopien gelöschte Daten unbemerkt wiederherstellen. Lokale Änderungen bleiben bei einem Verbindungsfehler und nach Neuladen erhalten. Der Service Worker ermöglicht nach dem ersten vollständigen Laden des Produktionsbuilds auch einen Offline-Neustart. Die Vite-Entwicklungsansicht hat keinen solchen Offline-App-Cache.

Bei noch nicht übertragenen Änderungen verhindert die App das Abmelden und weist beim Schließen darauf hin. Der lokale Kontenspeicher bleibt bei Logout erhalten. Website-Daten zu löschen entfernt diese Kopie einschließlich unübertragener Änderungen. Eine lokale Gerätekopie ersetzt kein Backup.

Alte browserlokale Sammlungen werden nicht automatisch in ein Konto übernommen, da `localhost` keinen Zugriff auf den Speicher der alten Sites-Adresse hat. Die bisherige Sites-Seite ist auf Eigentümerzugriff begrenzt. Wenn dort noch Karten liegen, dort ein `.apkg` exportieren und es im neuen Konto importieren. Anki-Import startet den Lernfortschritt in Emir Cards neu.

## Karten und Anki

- Ordner mit Unterordnern, Karten mit Text und Bildern und FSRS-Wiederholungen.
- Export als echtes Anki-Paket (`.apkg`): ganze Sammlung, ausgewählter Ordner mit Unterordnern oder nur dessen direkte Karten.
- Import von `.apkg` und älteren Emir-Cards-ZIP-Sicherungen; Imports ergänzen vorhandene Karten. Unterstützt Basic, Standard-Lückentexte und Ankiphil-Cloze-/Terminologiekarten. Jede vorhandene Lückenkarte wird als eigene Frage-/Antwortkarte übernommen, inklusive Hinweisen, Zusatztexten und Bildern.
- Keine festen Anzahl- oder Tiefenlimits für Hauptordner, Unterordner und Karten, auch beim Verschieben, Importieren und Synchronisieren. Speicherplatz, Arbeitsspeicher und die Dateigrößen beim Import begrenzen die praktisch nutzbare Sammlung.

Die Formatdetails stehen in [FORMAT.md](FORMAT.md).

## Bauen und prüfen

```sh
npm run build
npm run test
npm run test:api
npm run test:e2e
```

Die ältere native iOS-Version liegt weiterhin im Projekt und verwendet lokal SQLite. Diese Web-App verwendet PostgreSQL; für einen späteren iOS-Umbau ist die native Speicheranbindung separat anzupassen.

API- und Browsertests benötigen einen lokalen PostgreSQL-Benutzer mit dem Recht, Testdatenbanken anzulegen. Sie verwenden ausschließlich `emir_sync_test_<pid>` beziehungsweise `emir_anki_e2e` und entfernen diese anschließend. Eine bereits vorhandene Browser-Testdatenbank wird nicht überschrieben. `PGHOST`, `PGUSER` und `PGPASSWORD` können für andere PostgreSQL-Installationen gesetzt werden. Die CI startet dafür einen eigenen PostgreSQL-Dienst.

## Hosting und verbleibende Schritte

Installationsskripte, VPS-Checkliste sowie Nginx-, systemd- und Backup-Vorlagen liegen unter [deployment/README.md](deployment/README.md). Lokal laufen Entwicklung und Datenbank bereits; Domain, Zertifikate, Produktionszugangsdaten, Dienstinstallation und externe Backups werden erst auf dem VPS eingerichtet.
