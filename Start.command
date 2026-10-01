#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Bitte installiere zuerst Node.js (aktuelle LTS-Version) von https://nodejs.org.'
  read '?Enter zum Schließen … '
  exit 1
fi
if curl -fsS http://localhost:4173/ 2>/dev/null | /usr/bin/grep -q 'Emir Cards'; then
  open 'http://localhost:4173'
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run build
(sleep 2; open 'http://localhost:4173') &
echo 'Emir Cards läuft gleich unter http://localhost:4173.'
echo 'Lass dieses Terminal während des Testens geöffnet. Beenden mit Ctrl+C.'
npm run preview
