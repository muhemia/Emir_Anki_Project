# Emir-Cards-Paket, Version 1

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

Validierung vor dem Import: Formatversion, Felder, eindeutige IDs, fehlende Verweise, Ordnerzyklen, Kartenseiten, Bildsignaturen und Größenlimits. Limits: 10.000 Ordner, 50.000 Karten/Medien, 500.000 Bewertungen, 12 MB JSON, 12 MB je Bild, 100 MB ZIP und 100 MB entpackte Medien. ZIP-Einträge werden begrenzt gestreamt, um übergroße entpackte Inhalte abzuweisen. Der Schreibvorgang erfolgt in einer einzelnen IndexedDB-Transaktion.
