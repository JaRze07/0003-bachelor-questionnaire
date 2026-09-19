#!/usr/bin/env bash
# Install or update Bachelor Questionnaire on the JR07 box. Idempotent. Run as the jr07 user:
#   curl -fsSL https://raw.githubusercontent.com/JaRze07/0003-bachelor-questionnaire/main/deploy/install.sh | bash
# or, from a checkout:  bash deploy/install.sh
#
# It only ever touches its own compose project (jr07-bachelor) plus one block in the dashboard's Caddyfile, which
# is validated before Caddy is asked to reload. The dashboard and terminal containers are never restarted.
set -euo pipefail
ROOT=/srv/jr07
APP=$ROOT/apps/0003
DATA=$ROOT/data/bachelor
ENVFILE=$ROOT/bachelor.env
DASH=$ROOT/app/deploy
HOST=${BQ_HOST:-bq.91-98-25-205.sslip.io}
log() { echo "=== $*"; }
dc() { docker compose --env-file "$ENVFILE" -f "$APP/deploy/docker-compose.yml" "$@"; }

log "checkout"
mkdir -p "$ROOT/apps" "$DATA/backups" "$ROOT/secrets/bachelor"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone https://github.com/JaRze07/0003-bachelor-questionnaire.git "$APP"; fi
sudo chown -R 1000:1000 "$DATA"            # the container runs as node (uid 1000)

log "settings"
if [ ! -f "$ENVFILE" ]; then
  umask 077
  cat > "$ENVFILE" <<ENV
# Bachelor Questionnaire settings (this app only). See deploy/README.md.
BQ_PUBLIC_URL=https://$HOST
BQ_GOOGLE_WEB_CLIENT_ID=
BQ_GOOGLE_CLIENT_IDS=
BQ_AD_UNIT_BANNER=
BQ_AD_UNIT_INTERSTITIAL=
ENV
  echo "created $ENVFILE - fill in BQ_GOOGLE_WEB_CLIENT_ID and BQ_GOOGLE_CLIENT_IDS, then run this script again"
fi
chmod 600 "$ENVFILE"

log "network"
NET=$(grep -E '^JR07_NETWORK=' "$ENVFILE" | cut -d= -f2- || true); NET=${NET:-deploy_default}
docker network inspect "$NET" >/dev/null 2>&1 || { echo "network $NET not found: is the dashboard's compose project up?"; exit 1; }

log "backup before deploy"
# An online backup through SQLite, taken by the running container. Copying bachelor.db alone would miss
# whatever is still in the write-ahead log.
if dc ps --status running --services 2>/dev/null | grep -q '^bachelor-api$'; then
  dc exec -T bachelor-api node dist/backup.js "/data/backups/pre-deploy-$(date +%Y%m%d-%H%M%S).db"
fi
ls -1t "$DATA"/backups/pre-deploy-*.db 2>/dev/null | tail -n +6 | xargs -r rm -f

log "container"
dc up -d --build
dc ps

log "caddy route"
if ! grep -q "$HOST" "$DASH/Caddyfile"; then
  cp -a "$DASH/Caddyfile" "$DASH/Caddyfile.before-bachelor"
  printf '\n%s {\n\tencode zstd gzip\n\treverse_proxy bachelor-api:8080\n}\n' "$HOST" >> "$DASH/Caddyfile"
  echo "added $HOST to the Caddyfile (previous version kept as Caddyfile.before-bachelor)"
fi
CADDY="docker compose -f $DASH/docker-compose.yml exec -T caddy caddy"
if $CADDY validate --config /etc/caddy/Caddyfile; then
  $CADDY reload --config /etc/caddy/Caddyfile
else
  echo "Caddyfile did not validate: restoring the previous version, Caddy keeps running on its current config"
  [ -f "$DASH/Caddyfile.before-bachelor" ] && cp -a "$DASH/Caddyfile.before-bachelor" "$DASH/Caddyfile"
  exit 1
fi

log "check"
sleep 3
curl -fsS "https://$HOST/healthz" && echo && echo "live: https://$HOST"
