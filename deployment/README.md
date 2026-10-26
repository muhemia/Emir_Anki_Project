# Betrieb auf einem Hostinger-VPS

Das Repository enthält Installationsskripte und Vorlagen. Die Skripte werden erst auf dem VPS ausgeführt. Benötigt wird ein VPS mit Linux, systemd, Node.js ab 22.12, PostgreSQL und Nginx. Ein reines PHP-/Shared-Hosting-Paket reicht für diese Node-API nicht aus.

## Schnellstart auf einem neuen VPS (Ubuntu/Debian)

Diese Anleitung installiert eine einzelne Instanz unter einer Domain, z. B. `cards.meine-domain.de`. Ersetze diese Domain in allen Befehlen. Der Installer verwendet einen eigenen Linux-Benutzer `emircards`, eine lokale PostgreSQL-Datenbank `emir_cards` und Port 3001 für die API. Die vorhandenen lokalen Karten werden nicht automatisch auf den VPS kopiert; dafür im bisherigen Konto `.apkg` exportieren und im neuen Konto importieren.

### 1. System vorbereiten

Domain per A-Record auf die VPS-Adresse zeigen lassen. Falls ein AAAA-Record gesetzt ist, muss auch dessen IPv6-Adresse zum VPS führen. In der Server-/Hostinger-Firewall den tatsächlichen SSH-Port sowie 80 und 443 freigeben. PostgreSQL und Port 3001 bleiben intern.

Als normaler Benutzer mit sudo-Rechten:

```sh
sudo apt-get update
sudo apt-get install -y git curl openssl nginx postgresql postgresql-client certbot ca-certificates
sudo systemctl enable --now postgresql
```

Node.js 24 muss systemweit installiert sein und für den Dienstbenutzer erreichbar sein. Falls es noch fehlt, können die offiziellen NodeSource-Pakete verwendet werden:

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/emir-nodesource-setup.sh
sudo bash /tmp/emir-nodesource-setup.sh
sudo apt-get install -y nodejs
node --version
npm --version
```

Eine Node-Installation ausschließlich unter einem privaten Benutzerverzeichnis (etwa nvm) ist für den systemd-Dienst ungeeignet. Die Pakete der Distribution allein können für dieses Projekt zu alt sein; der Installer prüft die Mindestversion 22.12.

### 2. Klonen, bauen und installieren

```sh
git clone https://github.com/muhemia/Emir_Anki_Project.git
cd Emir_Anki_Project
npm ci
npm run build
sudo bash deployment/install.sh cards.meine-domain.de
```

Der Installer erledigt:

- eigenes Dienstkonto, Datenbankrolle ohne Superuser-Rechte und Datenbank anlegen;
- zufälliges Datenbankpasswort und `/etc/emir-cards.env` erzeugen;
- einen Release nach `/srv/emir-cards/releases/` kopieren und nur Produktionsabhängigkeiten installieren;
- Schema migrieren, API als systemd-Dienst starten und Erreichbarkeit prüfen;
- täglichen Backup-Timer aktivieren und sofort eine Sicherung erstellen;
- zunächst eine HTTP-Konfiguration für die Zertifikatsausstellung aktivieren.

Nach diesem Schritt zeigt HTTP eine Wartungsmeldung. Die App wird im nächsten Schritt über HTTPS freigegeben. Die Zugangsdaten stehen ausschließlich in der geschützten Datei `/etc/emir-cards.env`; sie gehören nicht ins Repository.

### 3. HTTPS aktivieren

Sobald DNS und Port 80 funktionieren:

```sh
sudo certbot certonly --webroot -w /var/www/letsencrypt -d cards.meine-domain.de
sudo bash deployment/enable-https.sh cards.meine-domain.de
sudo certbot renew --dry-run
```

Certbot fragt nach E-Mail-Adresse und Zustimmung zu den Zertifikatsbedingungen. Das HTTPS-Skript setzt Domain und Zertifikatpfade ein, prüft Nginx und installiert einen Reload-Hook für Zertifikatserneuerungen. Den von Certbot eingerichteten Timer/cron-Job aktiv lassen.

Jetzt öffnen: `https://cards.meine-domain.de/app.html`. Registrieren, Karten erstellen, synchronisieren und auf einem zweiten Gerät anmelden. Neue Konten können sich derzeit frei registrieren.

### 4. Backups und Betrieb abschließen

Die täglichen Dumps liegen unter `/var/backups/emir-cards/`. Richte zusätzlich eine verschlüsselte Kopie außerhalb des VPS und eine Aufbewahrungsregel ein. Das Projekt löscht keine alten Dumps automatisch. Eine Wiederherstellung auf dem eigenen VPS mindestens einmal prüfen (siehe unten).

```sh
sudo systemctl status emir-cards
sudo systemctl list-timers emir-cards-backup.timer
sudo journalctl -u emir-cards -n 80
sudo systemctl start emir-cards-backup.service
```

### Spätere Updates

Im geklonten Repository als normaler Benutzer:

```sh
git pull --ff-only
npm ci
npm run build
sudo bash deployment/install.sh cards.meine-domain.de
```

Der Installer behält die Datenbank, vorhandene Zugangsdaten und HTTPS-Konfiguration. Vor einer Migration wird ein Backup angelegt; während der Migration stoppt die API kurz. Alte Releases und öffentliche Assets bleiben erhalten. Bei einem Fehler bricht das Skript ab und meldet den betroffenen Schritt; kein automatisches Zurücksetzen der Datenbank. Eine Domainänderung oder externe Datenbank benötigt eine manuelle Anpassung anhand der Vorlagen. Das Skript nimmt keine fremden gleichnamigen Datenbanken ohne passende Konfiguration in Besitz.

### Geprüfter Installationsweg

GitHub Actions testet neben den App-Funktionen eine frische Linux-Installation mit echtem PostgreSQL, systemd und Nginx. Ein lokal ausgestelltes Testzertifikat prüft dabei HTTPS, statische Frontend-Dateien, sichere Cookies und den Sync über Nginx. Ein zweites Deployment prüft den Erhalt vorhandener Daten; ein Dump wird in einer separaten Datenbank wiederhergestellt. Die echte Domain, öffentliche DNS-Auflösung und die Ausstellung durch Let's Encrypt können erst auf dem VPS geprüft werden.

Referenzen: [NodeSource-Installationsanleitung](https://github.com/nodesource/distributions), [Nginx-Proxy-Dokumentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [Certbot mit Nginx](https://certbot.eff.org/instructions?os=ubuntufocal&ws=nginx).

## Bereits im Code vorbereitet

- [x] React-Produktionsbuild und Express-API getrennt starten.
- [x] PostgreSQL-Schema mit Nutzerzuordnung und transaktionaler Migration.
- [x] Anmeldung mit Benutzername/Passwort, scrypt, serverseitigen Sessions und HttpOnly-Cookies.
- [x] Sichere Cookies bei `NODE_ENV=production`, Prüfung von `Origin`, Anmeldebegrenzung, Datenvalidierung.
- [x] Dauerhafte Gerätekopie pro Konto, manueller Delta-Abgleich, Konfliktanzeige und Wiederholung unterbrochener Uploads.
- [x] API nur auf Loopback; Nginx liefert statische Dateien und leitet `/api/` weiter.
- [x] systemd-Dienst, täglicher Backup-Timer und Backup-Skript.
- [x] Testdatenbanken getrennt von der echten lokalen Sammlung; CI mit PostgreSQL.

## Manuelle Installation als Alternative

1. **Server vorbereiten:** System aktualisieren, SSH-Schlüssel einrichten, Service-Benutzer `emircards` ohne sudo anlegen. Firewall nur für SSH, HTTP und HTTPS öffnen. PostgreSQL und Port 3001 nicht öffentlich freigeben.
2. **Datenbank anlegen:** Datenbank `emir_cards` und einen eigenen Besitzer `emircards` ohne Superuser-/CREATEDB-Rechte anlegen. Starkes DB-Passwort setzen. Auf Loopback lauschen lassen.
3. **Release bereitstellen:** Code nach `/srv/emir-cards/releases/<release>` kopieren/klonen. `npm ci` und `npm run build` ausführen. `current` auf dieses Release zeigen lassen. Das Deployment-Konto besitzt den Code; der API-Benutzer benötigt nur Leserechte.
4. **Umgebung setzen:** `production.env.example` als `/etc/emir-cards.env` ablegen, Platzhalter ersetzen, Eigentümer `root:emircards`, Rechte `0640`. `APP_ORIGIN` exakt mit Protokoll und ohne abschließenden Slash eintragen. Keine Geheimnisse in Vite-Variablen oder Git speichern.
5. **Schema installieren:** Mit dem neuen Release und der geschützten Umgebung `node --env-file=/etc/emir-cards.env server/migrate.mjs` ausführen. Vor Updates eine Datenbanksicherung erstellen. Die Migration läuft transaktional und ist wiederholbar; nicht automatisch bei jedem API-Start.
6. **API starten:** `emir-cards.service` nach `/etc/systemd/system/` kopieren; Pfade zu Node und Projekt prüfen. `systemctl daemon-reload` und `systemctl enable --now emir-cards`. `curl --fail http://127.0.0.1:3001/api/health` muss erfolgreich sein.
7. **Domain/TLS:** DNS auf den VPS setzen. Zunächst nur den HTTP-Block aktivieren, ACME-Verzeichnis anlegen und Zertifikat ausstellen. Danach den HTTPS-Block mit den echten Zertifikatpfaden aktivieren. `nginx -t`, anschließend neu laden; Zertifikatserneuerung prüfen. `nginx.conf` enthält die endgültige Vorlage.
8. **Backups aktivieren:** `/var/backups/emir-cards` mit Besitzer `emircards` und Rechten `0700` anlegen. Backup-Service und Timer installieren; Timer aktivieren. Manuell starten und einen Dump wiederherstellen (siehe unten). Eine verschlüsselte Kopie außerhalb des VPS und eine Aufbewahrungsregel einrichten; das Skript löscht bewusst keine alten Dumps.
9. **Abnahme:** Registrierung, Login/Logout, zwei getrennte Konten, Handy/Laptop-Sync, Bilder, `.apkg`, Konflikte und Offline-Neustart über HTTPS testen. Prüfen, dass API-Cookies `Secure` und `HttpOnly` tragen. Nach Reload muss die neue App-Version aktiv sein; beim Service-Worker-Update zuerst lokale Änderungen synchronisieren.
10. **Betrieb:** Dienste-/Backup-Fehler und freien Speicher überwachen, Updates einplanen. `journalctl -u emir-cards` zeigt API-Fehler, `systemctl list-timers` den Backup-Zeitplan. Neue Releases bauen und prüfen, sichern, migrieren, `current` wechseln und API neu starten. Alte Releases aufbewahren; ein Code-Rollback darf kein inkompatibles Schema voraussetzen.

## Wiederherstellung prüfen

Dumps enthalten Konten, Passworthashes, Sitzungen, Karten, Bilder, Lernverläufe und Sync-Metadaten. Entsprechend vertraulich behandeln. Für einen Test eine **neue leere Testdatenbank** anlegen und mit `pg_restore --no-owner --no-privileges --dbname=<testdatenbank> <datei.dump>` einspielen. Tabellenzahlen und einen App-Zugriff mit dieser Datenbank prüfen. `pg_restore --list` allein prüft keine vollständige Wiederherstellung.

Nach einer echten Wiederherstellung aus einem älteren Stand vorhandene Sessions widerrufen (`DELETE FROM sessions`) und Geräte kontrolliert neu anbinden. Ein Client mit neuerem Sync-Cursor wird absichtlich blockiert. Zunächst seine lokalen Karten als `.apkg` sichern, dann dessen Website-Daten zurücksetzen, anmelden und fehlende Karten bei Bedarf importieren. Anki-Import setzt den Lernstand in dieser App zurück. Niemals die lokale Gerätekopie ungeprüft löschen.

## Bewusste Grenzen der ersten Version

- Synchronisierung erfolgt über den Button. Andere Geräte werden beim Fokuswechsel und etwa alle 30 Sekunden auf neue Serverstände hingewiesen. Solange das Quellgerät nicht hochlädt, kann der Server die Änderungen nicht ankündigen.
- Beim ersten Login wird die gesamte Sammlung geladen; danach nur geänderte Datensätze einschließlich Bildern, Ordnern und Lernbewertungen. Kein vollständiger Export pro Bewertung und keine Kartenabrufe während des Lernens.
- Gleichzeitige Änderungen derselben Karte erfordern eine Auswahl. Diese Auswahl gilt aktuell für alle angezeigten Konflikte; es gibt noch keinen Editor zum Zusammenführen einzelner Textfelder. Die Serverfassung ersetzt dabei auch nicht übertragene Bewertungen der betroffenen Karte.
- Der Browsercache bleibt nach Abmelden auf dem Gerät; der Zugang zur App verlangt danach wieder eine Online-Anmeldung. Nach einer abgebrochenen Netzwerkverbindung kann die zuletzt angemeldete Person offline weiterarbeiten. Das ist kein verschlüsselter Tresor: auf gemeinsam genutzten Macs getrennte Browser-/OS-Profile verwenden.
- Browser können Website-Daten bei Speichermangel oder manuellem Löschen entfernen. Nicht synchronisierte Daten liegen ausschließlich auf diesem Gerät. Synchronisieren und PostgreSQL-Backups bleiben notwendig.
- 200 MB Bilder pro Konto, bis zu 12 MB je Bild; maximal 300 MB pro Sync-Anfrage. Große Erstübertragungen sind noch nicht paginiert. Tombstones und Idempotenzbelege werden dauerhaft aufbewahrt, damit lange offline gebliebene Geräte sicher wiederkommen können. Deren Größe beobachten.
- Keine E-Mail-Verifizierung, Rollen oder Admin-Oberfläche. Passwortwiederherstellung und eine öffentliche Registrierungsfreigabe nur für eingeladene Kollegen wären separate Erweiterungen. Registrierung ist derzeit öffentlich erreichbar, aber begrenzt.
- Die native iOS-App nutzt weiterhin ihren bestehenden lokalen SQLite-Speicher. Dieser neue Konten-Sync betrifft die Web-App.
