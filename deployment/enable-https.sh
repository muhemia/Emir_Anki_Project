#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 && $# == 1 ]] || { echo 'Aufruf: sudo bash deployment/enable-https.sh cards.example.org' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
domain=$1
node "$source_dir/deployment/render-config.mjs" https "$domain" >/dev/null
node --env-file=/etc/emir-cards.env -e 'if(process.env.APP_ORIGIN!=="https://"+process.argv[1]){console.error("Domain stimmt nicht mit APP_ORIGIN überein.");process.exit(1)}' "$domain"
[[ -f "/etc/letsencrypt/live/$domain/fullchain.pem" && -f "/etc/letsencrypt/live/$domain/privkey.pem" ]] || { echo 'Zuerst das Zertifikat mit Certbot ausstellen.' >&2; exit 1; }
config=/etc/nginx/sites-available/emir-cards
previous=$(mktemp)
cp "$config" "$previous"
trap 'rm -f "$previous"' EXIT
node "$source_dir/deployment/render-config.mjs" https "$domain" > "$config"
if ! nginx -t; then cp "$previous" "$config"; exit 1; fi
systemctl reload nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/emir-cards-nginx <<'HOOK'
#!/bin/sh
set -eu
nginx -t
systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/emir-cards-nginx
printf 'HTTPS aktiviert: https://%s/app.html\nPrüfe die Erneuerung mit: sudo certbot renew --dry-run\n' "$domain"
