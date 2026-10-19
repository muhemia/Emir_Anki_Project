#!/usr/bin/env bash
# Ubuntu/Debian mit systemd; aus einem zuvor gebauten Checkout aufrufen.
set -euo pipefail
umask 027
fail() { echo "Fehler: $*" >&2; exit 1; }
[[ ${1:-} == '--help' ]] && { echo 'Aufruf: sudo bash deployment/install.sh cards.example.org'; exit 0; }
[[ $(id -u) == 0 ]] || fail 'Bitte mit sudo ausführen.'
[[ $# == 1 ]] || fail 'Genau einen Domainnamen angeben.'
source_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
domain=$1
for command in node npm psql createdb nginx systemctl runuser openssl curl git; do
  command -v "$command" >/dev/null || fail "Programm fehlt: $command (siehe deployment/README.md)."
done
node_binary=$(command -v node)
[[ $node_binary =~ ^/[a-zA-Z0-9_./-]+$ ]] || fail 'Node-Pfad enthält nicht unterstützte Zeichen.'
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)' || fail 'Node.js ab 22.12 erforderlich; empfohlen: Node 24.'
node "$source_dir/deployment/render-config.mjs" http "$domain" >/dev/null
[[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]] || fail 'Ubuntu-/Debian-Nginx mit sites-available und sites-enabled erforderlich.'
[[ -f "$source_dir/dist/app.html" && -f "$source_dir/dist/sw.js" ]] || fail 'Zuerst im Checkout npm ci und npm run build ausführen.'
[[ -f "$source_dir/package-lock.json" ]] || fail 'package-lock.json fehlt.'
systemctl is-active --quiet postgresql || fail 'PostgreSQL starten: sudo systemctl enable --now postgresql'
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres -Atqc 'SELECT 1' >/dev/null
nginx -t
if ! id emircards >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/emir-cards --create-home --shell /usr/sbin/nologin emircards
fi
runuser -u emircards -- "$node_binary" --version >/dev/null || fail 'Node muss für emircards zugänglich sein; keine Installation in einem privaten Home-Verzeichnis verwenden.'
install -d -m 0755 /srv/emir-cards /srv/emir-cards/releases /var/www/letsencrypt
install -d -m 0700 -o emircards -g emircards /var/backups/emir-cards

if [[ ! -f /etc/emir-cards.env ]]; then
  # Fremde gleichnamige Datenbanken/Konten nicht übernehmen.
  existing=$(runuser -u postgres -- psql -X -d postgres -Atqc "SELECT 1 FROM pg_roles WHERE rolname='emircards' UNION ALL SELECT 1 FROM pg_database WHERE datname='emir_cards'")
  [[ -z $existing ]] || fail 'Datenbank oder DB-Rolle existiert bereits, aber /etc/emir-cards.env fehlt. Bitte die manuelle Installation in deployment/README.md verwenden.'
  database_password=$(openssl rand -hex 32)
  (umask 077; printf 'NODE_ENV=production\nPORT=3001\nAPP_ORIGIN=https://%s\nDATABASE_URL=postgresql://emircards:%s@127.0.0.1:5432/emir_cards\nBACKUP_DIR=/var/backups/emir-cards\n' "$domain" "$database_password" > /etc/emir-cards.env)
fi
chown root:emircards /etc/emir-cards.env
chmod 0640 /etc/emir-cards.env
# Env-Datei mit Node lesen, niemals als Shellcode ausführen.
node --env-file=/etc/emir-cards.env --input-type=module - "$domain" <<'JS'
const origin=`https://${process.argv[2]}`;
const db=new URL(process.env.DATABASE_URL);
if(process.env.APP_ORIGIN!==origin || process.env.NODE_ENV!=='production' || process.env.PORT!=='3001' || process.env.BACKUP_DIR!=='/var/backups/emir-cards' || db.hostname!=='127.0.0.1' || db.port!=='5432' || db.pathname!=='/emir_cards' || db.username!=='emircards' || !/^[a-f0-9]{64}$/.test(db.password)) {
  console.error('install.sh erwartet seine lokale Standardkonfiguration und die ursprüngliche Domain. Für eine eigene Datenbank-/Domainkonfiguration die manuelle Anleitung verwenden.');process.exit(1);
}
JS
# Wiederaufnahme nach unterbrochener Ersteinrichtung: vorhandene Rollen behalten.
node --env-file=/etc/emir-cards.env --input-type=module <<'JS' | runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres >/dev/null
const password=new URL(process.env.DATABASE_URL).password;
process.stdout.write(`SELECT 'CREATE ROLE emircards LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ''${password}''' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='emircards')\n\\gexec\n`);
JS
exists=$(runuser -u postgres -- psql -X -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='emir_cards'")
if [[ -z $exists ]]; then runuser -u postgres -- createdb --owner=emircards emir_cards; fi

release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$source_dir" rev-parse --short HEAD)-$$"
release_dir="/srv/emir-cards/releases/$release_id"
install -d -m 0755 -o emircards -g emircards "$release_dir"
cp "$source_dir/package.json" "$source_dir/package-lock.json" "$release_dir/"
cp -R "$source_dir/dist" "$source_dir/server" "$source_dir/scripts" "$release_dir/"
# Auch bereits geöffnete ältere App-Versionen können ihre Assets weiter laden.
if [[ -d /srv/emir-cards/current/dist/assets ]]; then
  cp -an /srv/emir-cards/current/dist/assets/. "$release_dir/dist/assets/"
fi
chown -R emircards:emircards "$release_dir"
runuser -u emircards -- env PATH="$(dirname "$node_binary"):$PATH" npm ci --omit=dev --prefix "$release_dir" --cache "$release_dir/.npm-cache" --no-audit --no-fund
rm -rf -- "$release_dir/.npm-cache"
chown -R root:root "$release_dir"
chmod -R a+rX "$release_dir"

if [[ -e /srv/emir-cards/current ]]; then
  runuser -u emircards -- "$node_binary" --env-file=/etc/emir-cards.env /srv/emir-cards/current/scripts/backup.mjs
fi
# Während der Migration keine Schreibzugriffe der bisherigen API zulassen.
if systemctl is-active --quiet emir-cards; then systemctl stop emir-cards; fi
runuser -u emircards -- "$node_binary" --env-file=/etc/emir-cards.env "$release_dir/server/migrate.mjs"
ln -sfn "$release_dir" /srv/emir-cards/current.next
mv -Tf /srv/emir-cards/current.next /srv/emir-cards/current
sed "s|/usr/bin/node|$node_binary|g" "$source_dir/deployment/emir-cards.service" > /etc/systemd/system/emir-cards.service
sed "s|/usr/bin/node|$node_binary|g" "$source_dir/deployment/emir-cards-backup.service" > /etc/systemd/system/emir-cards-backup.service
install -m 0644 "$source_dir/deployment/emir-cards-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now emir-cards
healthy=false
for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3001/api/health >/dev/null; then healthy=true; break; fi
  sleep 1
done
systemctl is-active --quiet emir-cards || fail 'API-Dienst ist nicht aktiv. Prüfe journalctl -u emir-cards und ob Port 3001 bereits belegt ist.'
[[ $healthy == true ]] || fail 'API startet nicht. Diagnose: journalctl -u emir-cards -n 80'
systemctl enable --now emir-cards-backup.timer
systemctl start emir-cards-backup.service

# Bei Updates die bestehende HTTPS-Konfiguration behalten.
if [[ ! -f /etc/nginx/sites-available/emir-cards ]]; then
  node "$source_dir/deployment/render-config.mjs" http "$domain" > /etc/nginx/sites-available/emir-cards
fi
ln -sfn /etc/nginx/sites-available/emir-cards /etc/nginx/sites-enabled/emir-cards
nginx -t
systemctl enable --now nginx
systemctl reload nginx
printf '\nRelease installiert: %s\n' "$release_id"
printf 'API und tägliche Backups laufen. Für die erste HTTPS-Freigabe:\n  sudo certbot certonly --webroot -w /var/www/letsencrypt -d %s\n  sudo bash deployment/enable-https.sh %s\n' "$domain" "$domain"
