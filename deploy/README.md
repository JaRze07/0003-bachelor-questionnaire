# Running Bachelor Questionnaire on the JR07 box

**Live: https://bachelor.91-98-25-205.sslip.io**

One container, built from the `Dockerfile` in the project root, serving the API under `/v1` and the three pages
(host app, partner form, guest page) from the same origin. Data is one SQLite file on the container's persistent
`/data` volume, which survives restarts and rebuilds.

## Deploy or update

From a dashboard terminal, after pushing to `main`:

```bash
jr07 app up bachelor --port 8080 --dir JR07/0003-bachelor-questionnaire \
  -e NODE_ENV=production \
  -e WEB_BASE=https://bachelor.91-98-25-205.sslip.io \
  -e CORS_ORIGINS=https://bachelor.91-98-25-205.sslip.io,capacitor://localhost,https://localhost \
  -e PLAY_PACKAGE_NAME=com.jr07.bachelorquestionnaire \
  -e GOOGLE_WEB_CLIENT_ID=<web client id> \
  -e GOOGLE_CLIENT_IDS=<web client id>[,<android client id>]
```

`jr07` rebuilds the image, replaces the container and keeps the `/data` volume. HTTPS and the route are handled by
the box. Every setting is passed on this command line: there is no env file to keep in sync, and the environment of
a running app is visible with `docker inspect` on the box only.

| Setting | Meaning |
|---|---|
| `GOOGLE_WEB_CLIENT_ID` | OAuth client id (type **Web application**) used by the sign-in button in the browser |
| `GOOGLE_CLIENT_IDS` | every client id whose tokens the API accepts: the web one and, later, the Android one |
| `AD_UNIT_BANNER`, `AD_UNIT_INTERSTITIAL` | AdMob ids; empty means test ads |
| `PORT`, `DB_PATH`, `BACKUP_DIR` | set by the image and the provisioner; do not override |

**Sign-in needs the OAuth client.** Create it in the Google Cloud console: APIs and services, Credentials, Create
credentials, OAuth client id, Web application. Authorised JavaScript origin `https://bachelor.91-98-25-205.sslip.io`,
no redirect URI. Until it is passed, the sign-in screen says so plainly and the party links still work.

**Production refuses to cheat.** With `NODE_ENV=production` the container exits at startup if `DEV_AUTH=1` or
`PLAY_FAKE=1` is set, so a deployed instance can never accept development sign-in or invented purchase tokens.

## Operate

```bash
jr07 app ls
jr07 app logs bachelor --lines 100     # one line per housekeeping run and per backup
jr07 app restart bachelor
jr07 app down bachelor                 # stops and unpublishes; the data volume is kept
```

## Backups and restore

The container writes an online backup to `/data/backups` every 24 hours and keeps 14. To take one now, or to
restore:

```bash
# on the box
docker exec app-bachelor node dist/backup.js /data/backups/manual-$(date +%F).db
docker cp app-bachelor:/data/backups/manual-$(date +%F).db .     # copy it off the box

# restore: stop, replace, start
docker stop app-bachelor
docker run --rm -v app-bachelor-data:/data -v "$PWD":/in alpine \
  sh -c 'cp /in/<backup>.db /data/bachelor.db && rm -f /data/bachelor.db-wal /data/bachelor.db-shm'
docker start app-bachelor
```

Verified on 2026-09-19 locally and on 2026-09-24 on the box: a backup taken from a running server comes up in a
fresh one with the same games, links and score.

## Checked after the first deploy (2026-09-24)

Host, partner and guest pages load over HTTPS; a Polish game was created, answered through the partner link, played
one round, and the guest link showed the question, then the answer only after the organiser's reveal, then the
score; a container restart kept everything; a development bearer and an unknown session are refused with 401, and
sign-in without a configured client answers `google_not_configured`.

## What this replaced

Cloud Run, Firestore, Firebase Auth, Firebase Hosting, Cloud Scheduler and the Pub/Sub subscription, and then the
hand-written compose file and install script that preceded `jr07`. Google is now used for sign-in (an OAuth client,
free) and Play purchase verification only.
