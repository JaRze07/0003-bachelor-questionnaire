#!/usr/bin/env bash
# Install or update Bachelor Questionnaire on the JR07 box. Idempotent. Run as the jr07 user:
#   curl -fsSL https://raw.githubusercontent.com/JaRze07/0003-bachelor-questionnaire/main/deploy/install.sh | bash
# or, from a checkout:  bash deploy/install.sh
set -euo pipefail
ROOT=/srv/jr07
APP=$ROOT/apps/0003
DATA=$ROOT/data/bachelor
DASH=$ROOT/app/deploy
HOST=${BQ_HOST:-bq.91-98-25-205.sslip.io}
log() { echo "=== $*"; }

log "checkout"
mkdir -p "$ROOT/apps" "$DATA/backups" "$ROOT/secrets/bachelor"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone https://github.com/JaRze07/0003-bachelor-questionnaire.git "$APP"; fi
sudo chown -R 1000:1000 "$DATA"            # the container runs as node (uid 1000)

log "backup before deploy"
if [ -f "$DATA/bachelor.db" ]; then cp -a "$DATA/bachelor.db" "$DATA/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).db"; fi
ls -1t "$DATA"/backups/pre-deploy-*.db 2>/dev/null | tail -n +6 | xargs -r rm -f

log "container"
cd "$APP/deploy"
BQ_PUBLIC_URL="https://$HOST" docker compose up -d --build
docker compose ps

log "caddy route"
if ! grep -q "$HOST" "$DASH/Caddyfile"; then
  printf '\n%s {\n\tencode zstd gzip\n\treverse_proxy bachelor-api:8080\n}\n' "$HOST" >> "$DASH/Caddyfile"
  echo "added $HOST to the Caddyfile"
fi
docker compose -f "$DASH/docker-compose.yml" exec -T caddy caddy validate --config /etc/caddy/Caddyfile
docker compose -f "$DASH/docker-compose.yml" exec -T caddy caddy reload --config /etc/caddy/Caddyfile

log "check"
sleep 3
curl -fsS "https://$HOST/healthz" && echo && echo "live: https://$HOST"
