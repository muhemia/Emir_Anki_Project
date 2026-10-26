# Altes Emir-Cards-ZIP-Paket, Version 1

Die App exportiert jetzt ausschließlich `.apkg`. Das Paket enthält eine echte Anki-SQLite-Sammlung (`collection.anki2`), die Medienzuordnung `media` und Bilddateien mit numerischen Namen; `collection.json` ist nicht enthalten. Ordner werden als Anki-Decks und Karten als Basic-Notizen exportiert. Der Anki-Export mit Lernstand bildet Termine und Bewertungen in Ankis Schema ab. Beim Rückimport aus Anki startet der Lernstand in Emir Cards neu.

Der Export „Nur Karten“ enthält ausschließlich Karten direkt im ausgewählten Ordner und ihre Bilder. Anki benötigt für diese Karten ein Deck; das Paket verwendet dafür ein neutrales Deck. Die Anki-Datenbank trägt in `col.conf.emirCards` die Kennzeichnung `{ "version": 1, "mode": "direct-cards" }`. Emir Cards erkennt damit beim direkten Import, dass keine Ordner angelegt werden sollen, und fügt die Karten dem gewählten Ziel hinzu. Der Ordnerexport behält dagegen den gewählten Ordner und seine Unterordner bei und lässt alle übergeordneten Ordner weg.

Die unten beschriebenen ZIP-Dateien stammen aus älteren Emir-Cards-Versionen. Sie können weiterhin importiert werden und bewahren dabei den ursprünglichen FSRS-Stand exakt.

Eine ZIP-Datei enthält `collection.json` und optional Bilddateien unter `media/`. Es gibt keine externe Bildreferenz und keine ausführbaren Karteninhalte.

Das JSON enthält:

- `format`: exakt `emir-cards`.
- `version`: `1`. Andere Versionen werden vor dem Import abgewiesen.
- `kind`: `backup` oder `share`.
- `createdAt`: ISO-Datum des Exports.
- `folders`: `id`, `parentId` (null bedeutet Wurzelebene), `name`, `color`, `createdAt` als Unix-Millisekunden.
- `cards`: `id`, `folderId`, `front`, `back`, `frontImages`/`backImages` als Medien-IDs, `createdAt`, `updatedAt`; bei Backups zusätzlich `schedule` aus ts-fsrs. Datumsfelder im Schedule sind ISO-Zeichenketten und werden nach dem Import wieder zu Date-Objekten.
- `media`: `id`, `name`, `type` (`image/jpeg`, `image/png` oder `image/webp`), `path` relativ zur ZIP-Datei.
- `reviews`: nur bei Backups, mit `id`, `cardId`, `log`, `before` (Schedule vor Bewertung), `createdAt`.

Themenexporte setzen den ausgewählten Ordner zur Wurzel des Pakets. Dessen interne Unterordnerstruktur bleibt erhalten. Bei geteilten Themen werden Schedules weggelassen und Bewertungen als leere Liste exportiert. Der Empfänger beginnt mit neuen Karten.

Importe erfolgen im aktuell ausgewählten Ordner (oder auf der obersten Ebene). Alle IDs werden neu vergeben und sämtliche Verweise entsprechend umgeschrieben. Gleichnamige Ordner werden nur auf derselben Ebene nummeriert. Es findet kein Zusammenführen oder Überschreiben vorhandener Inhalte statt. Ein Backup-Import in eine leere Sammlung stellt den exportierten Stand wieder her; in eine bestehende Sammlung fügt er ihn als zusätzliche Inhalte hinzu.

Validierung vor dem Import: Formatversion, Felder, eindeutige IDs, fehlende Verweise, Ordnerzyklen, Kartenseiten, Bildsignaturen und Größenlimits. Keine feste Anzahlgrenze für Ordner oder Karten. Paketlimits: 50.000 Medien, 500.000 Bewertungen, 12 MB JSON, 12 MB je Bild, 200 MB ZIP und 200 MB entpackte Medien. ZIP-Einträge werden begrenzt gestreamt, um übergroße entpackte Inhalte abzuweisen. In der Web-App wird der abgeschlossene Import zunächst lokal gespeichert und beim nächsten Synchronisieren in einer PostgreSQL-Transaktion übertragen.
