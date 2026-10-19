#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Bitte installiere zuerst Node.js (aktuelle LTS-Version) von https://nodejs.org.'
  read '?Enter zum Schließen … '
  exit 1
fi
if curl -fsS http://127.0.0.1:5173/api/health >/dev/null 2>&1; then
  open 'http://127.0.0.1:5173/app.html'
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
if ! pg_isready -q; then
  echo 'PostgreSQL läuft nicht. Bitte zuerst den lokalen PostgreSQL-Dienst starten.'
  read '?Enter zum Schließen … '
  exit 1
fi
if ! psql -d emir_anki -Atqc 'select 1' >/dev/null 2>&1; then
  createdb emir_anki
fi
npm run db:schema
node --env-file-if-exists=.env server/index.mjs &
api_pid=$!
trap 'kill $api_pid 2>/dev/null || true' EXIT INT TERM
(sleep 2; open 'http://127.0.0.1:5173/app.html') &
echo 'Emir Cards läuft gleich unter http://127.0.0.1:5173/app.html.'
echo 'Lass dieses Terminal während des Testens geöffnet. Beenden mit Ctrl+C.'
npm run dev
