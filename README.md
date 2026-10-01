# Emir Cards

Eine lokale Karteikarten-App für iPhone, Android und Computer. React, TypeScript und Vite als installierbare PWA. Keine Anmeldung, keine API, keine Cloud-Datenbank, keine Analyse-Dienste und kein Anwendungsbackend. Die App startet leer.

## Ausprobieren auf diesem Mac

**`Start.command` doppelklicken** und das Terminal geöffnet lassen. Die App öffnet sich unter **http://localhost:4173/app.html**. Zum Beenden im Terminal `Ctrl+C` drücken. Node.js in einer aktuellen LTS-Version muss installiert sein (Entwicklung und Tests mit Node 24).

Alternativ im Projektordner:

```sh
npm ci
npm run build
npm run preview
```

Dann http://localhost:4173/app.html öffnen. Die Produktionsvorschau enthält den Service Worker und eignet sich für Offline-Tests. Verwende dieselbe Adresse und denselben Browser, damit du dieselbe lokale Sammlung siehst. `localhost:4173`, `127.0.0.1:4173`, der Entwicklungsserver und eine spätere Internetadresse haben jeweils getrennte Daten. Über Export und Import kannst du die Sammlung übertragen.

Für Codeänderungen mit automatischer Aktualisierung:

```sh
npm run dev
```

Der Entwicklungsserver wird im Terminal angezeigt (normalerweise http://127.0.0.1:5173). Der Service Worker ist dort absichtlich nicht aktiv; Offline-Verhalten mit der Produktionsvorschau testen.

## Installationsseite und App

- **http://localhost:4173/** ist die eigene Webseite zum Installieren, mit Anleitung für iPhone und Android und einem Link zum Ausprobieren.
- **http://localhost:4173/app.html** ist die eigentliche Lern-App. Ihre Navigation liegt unten (Sammlung, Lernen, Mehr); Einstellungen, Hell-/Dunkelmodus und Sicherungen befinden sich unter Mehr. Sie hat keinen Drawer und keinen Installationsbutton.
- Installierte PWA-Symbole starten direkt in der Lern-App. Das Manifest verweist auf `app.html`; bereits vorhandene Home-Screen-Verknüpfungen auf die Startseite werden im Standalone-Modus ebenfalls direkt zur Lernansicht geführt.
- Beide Ansichten verwenden dieselbe Website-Adresse und dieselbe IndexedDB. Ein Wechsel zwischen ihnen überschreibt oder verschiebt keine Karten. Der bisherige PWA-Identifier bleibt erhalten.
- Die separate Webseite verändert die Installationstechnik nicht: Es bleibt eine PWA, keine native IPA-/APK-Datei. Der Browser installiert die App; unter iOS ist der Schritt über das Teilen-Menü erforderlich.

## Version 1

- Dynamischer Ordnerbaum; Ordner können Karten und weitere Ordner enthalten.
- Ordner erstellen, umbenennen, einfärben, verschieben und mit Bestätigung löschen.
- Ganze Teilbäume zwischen oberster Ebene und Unterordnern verschieben. Zyklen werden verhindert.
- Karten mit Text und/oder Bildern auf beiden Seiten; bearbeiten, ansehen, verschieben und löschen.
- Suche in Frage, Antwort und Ordnernamen innerhalb des ausgewählten Teilbaums.
- Lernen bezieht sich auf den ausgewählten Ordner einschließlich aller Unterordner und direkter Karten.
- Neue und fällige Karten, ohne Tageslimit; fällige Wiederholungen vor neuen Karten.
- FSRS mit Nochmal / Schwer / Gut / Einfach, angezeigten Zeitabständen und Rückgängigmachen der letzten Bewertung dieser Sitzung.
- Lernschritte 1 und 10 Minuten, Zielbehaltensrate 90 %. Eine mit „Nochmal“ bewertete Karte kehrt zum fälligen Zeitpunkt zurück. Eine Karte wird nicht durch „Gut“ dauerhaft entfernt.
- Hell-/Dunkelmodus; anfangs an die Systemeinstellung angepasst, die Auswahl wird gespeichert.
- Offline-Betrieb nach vollständigem Erstladen, einschließlich Bilder, Lernen, Anlegen und Export.
- ZIP-Export der ganzen Sammlung inklusive Lernfortschritt sowie Themenexport zum Teilen ohne persönlichen Lernfortschritt.
- Jeder Import ergänzt. Neue interne IDs verhindern Überschreiben; gleiche Ordnernamen auf derselben Ebene werden zu „Biologie (1)“, „Biologie (2)“ usw.
- Wiederholtes Importieren derselben Datei erzeugt bewusst weitere Kopien.

Die internen Daten liegen in IndexedDB. Bilder werden als Binärdaten gespeichert und zur Anzeige lokal in Blob-URLs umgewandelt. Keine externen Schriftarten, Bilddienste oder CDN-Laufzeitabhängigkeiten.

## Kurz durchtesten

1. „Biologie“ erstellen, darin „Anatomie“, darin „Kopf“.
2. In Kopf eine Frage und Antwort mit Bild anlegen.
3. Anatomie öffnen und „Lernen starten“ wählen. Die Kopf-Karte ist enthalten.
4. Antwort aufdecken, „Nochmal“ wählen und die letzte Bewertung rückgängig machen. Danach „Einfach“ wählen: Die Karte ist erst zum nächsten Termin fällig.
5. Anatomie über das Drei-Punkte-Menü auf die oberste Ebene verschieben. Die Kopf-Karte behält ihren Lernstand.
6. Sicherung erstellen und zweimal wieder importieren. Vorhandene Ordner bleiben erhalten; neue Kopien werden nummeriert.
7. Unter Mehr den Dunkelmodus einschalten und neu laden. Darstellung und Inhalte bleiben erhalten.
8. Auf „Auch offline bereit“ warten, Seite einmal neu laden, Browser/Computer offline schalten und erneut laden. Karten und Bilder bleiben nutzbar. Auch offline eine neue Karte erstellen.

Löschen ist nach Bestätigung dauerhaft. Vor größeren Änderungen eine Sicherung exportieren.

## Auf einem Handy installieren

Der fertige **`dist/`-Ordner** kann auf statischem HTTPS-Webspace unter einer festen Adresse liegen. Ein laufender Node-Server, Servercode, Zugangsdaten oder eine Datenbank im Internet sind dafür nicht nötig. Die Dateien werden zur Installation und bei App-Updates ausgeliefert; persönliche Lerninhalte bleiben auf dem Gerät.

- iPhone/Safari: Adresse öffnen → Teilen → Zum Home-Bildschirm → als Web-App öffnen → Hinzufügen.
- Android/Chrome: Adresse öffnen → App installieren.
- `localhost` auf einem Handy bezeichnet das Handy, nicht diesen Mac. Für Installations- und Offline-Tests auf einem echten Handy ist eine erreichbare **HTTPS-Adresse** erforderlich. Ein einfacher HTTP-Link zur lokalen IP ist dafür nicht ausreichend.
- Für Tests am Handy wurde noch keine öffentliche Website bereitgestellt. Die lokale Vorschau funktioniert auf diesem Mac.

Nach dem ersten vollständigen Laden zeigt die App „Auch offline bereit“. Updates werden angeboten und erst nach deiner Bestätigung aktiviert. Die Website-Adresse langfristig beibehalten; ein Umzug benötigt vorher Export und danach Import.

## Sicherungen und Grenzen

Browser können lokale Daten löschen, etwa bei Speicherknappheit oder beim Entfernen der Website-Daten. „Dauerhaften Speicher anfragen“ unter Mehr kann helfen, ersetzt aber keine Sicherung. Regelmäßig eine ZIP-Datei außerhalb der App speichern. Die App kann nicht im Hintergrund beliebige Ordner in der iPhone-Dateien-App beschreiben. Ein erfolgreicher Export-Download bedeutet noch nicht, dass du die Datei an einem sicheren Ort abgelegt hast.

Version 1 akzeptiert JPG, PNG und WebP, bis 20 MB je Eingabebild. Bilder werden auf maximal 2.048 Pixel an der längsten Seite verkleinert (PNG bleibt transparent); maximal 20 Bilder je Kartenseite. Karten enthalten einfachen Text mit Zeilenumbrüchen. ZIP-Pakete und enthaltene Medien sind auf jeweils insgesamt 100 MB begrenzt, einzelne gespeicherte Bilder auf 12 MB, die JSON-Datei auf 12 MB. Größere Sammlungen in einzelnen Themen exportieren. Beschädigte Dateien werden vor dem Schreiben geprüft; der eigentliche Import läuft in einer Transaktion.

Diese Version enthält noch keinen `.apkg`-Import, keine Lückentexte/Bildverdeckung, kein geräteübergreifendes Synchronisieren und keine automatische Anpassung der FSRS-Parameter an die eigene Historie. Sie bildet die hier vereinbarten Grundfunktionen ab, nicht sämtliche Funktionen von Anki.

## Entwicklung und Prüfungen

```sh
npm ci
npx playwright install chromium webkit
npm run check
```

- Vitest + fake-indexeddb: Teilbäume, Verschieben, Löschregeln, FSRS, Undo, vollständige Sicherungen mit Medien, additiver Import, geteilte Themen und beschädigte Pakete.
- Playwright: vollständige Abläufe in Chromium/Desktop, Chromium mit Android-Viewport und WebKit mit iPhone-Viewport; inklusive Offline-Neustart.
- Beim Offline-Neustart wird der jeweilige Testserver vollständig abgeschaltet. In Chromium wird zusätzlich die Offline-Emulation aktiviert. WebKit 1.63 hat einen [bestätigten Fehler in der Offline-Emulation mit Service Workern](https://github.com/microsoft/playwright/issues/42775); dort verifiziert der abgeschaltete Server den Start aus dem Cache.
- Browser-Emulation ersetzt den abschließenden Test auf echten iPhones und Android-Geräten nicht.

`src/domain.ts` enthält Ordner- und Lernregeln, `src/backup.ts` das Dateiformat und die Importprüfung, `src/db.ts` die Datenbank, `src/components/` die Dialoge und Lernansicht. Das ZIP-Format ist in [FORMAT.md](FORMAT.md) beschrieben.
