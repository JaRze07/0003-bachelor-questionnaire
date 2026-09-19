# Running Bachelor Questionnaire on the JR07 box

One container next to the dashboard on the Hetzner CX33. It serves the API under `/v1` and the three pages (host
app, partner form, guest page) from the same origin. Data is one SQLite file.

```
/srv/jr07/apps/0003                 checkout of this repo
/srv/jr07/data/bachelor/bachelor.db the database (WAL)
/srv/jr07/data/bachelor/backups/    one backup per night, 14 kept; one before every deploy, 5 kept
/srv/jr07/secrets/bachelor/         play-service-account.json (only when the Play Console exists)
/srv/jr07/.env                      BQ_* settings, see below
```

## First install and every update

```bash
ssh jr07@91.98.25.205
curl -fsSL https://raw.githubusercontent.com/JaRze07/0003-bachelor-questionnaire/main/deploy/install.sh | bash
```

The script pulls the repo, copies the database aside, builds and starts the container, adds the hostname to the
dashboard's Caddyfile if it is missing, validates and reloads Caddy, and checks `/healthz` over HTTPS. It never
touches the dashboard or terminal containers.

## Settings in `/srv/jr07/.env`

| Name | Meaning |
|---|---|
| `BQ_GOOGLE_WEB_CLIENT_ID` | OAuth client id (type **Web application**) used by the sign-in button in the browser |
| `BQ_GOOGLE_CLIENT_IDS` | every client id whose tokens the API accepts, comma separated: the web one and, later, the Android one |
| `BQ_PLAY_FAKE` | `1` until the Play Console exists; set to `0` once `play-service-account.json` is in place |
| `BQ_HOST` (shell, optional) | hostname, default `bq.91-98-25-205.sslip.io` |

Create the OAuth client in the Google Cloud console: APIs and services, Credentials, Create credentials, OAuth client
id, Web application. Authorised JavaScript origin: `https://bq.91-98-25-205.sslip.io`. No redirect URI is needed.
Until the id is set the sign-in screen cannot work on the box (development sign-in is off in production).

## Operate

```bash
cd /srv/jr07/apps/0003/deploy
docker compose logs -f bachelor-api          # live log: one line per housekeeping run and per backup
docker compose restart bachelor-api
ls -lh /srv/jr07/data/bachelor/backups
```

Restore: stop the container, copy a backup over `bachelor.db`, delete `bachelor.db-wal` and `bachelor.db-shm`, start
it again. Verified on 2026-09-19: a backup taken from a running server came up in a fresh one with the same games,
links and score.

## What this replaced

Cloud Run, Firestore, Firebase Auth, Firebase Hosting, Cloud Scheduler and the Pub/Sub push subscription. Google is
still used for two things: sign-in (an OAuth client, free) and Play purchase verification (a service account).
The Google Cloud project `jr07-0003-bachelor` can be reduced to just that, or deleted once the OAuth client lives
in another project.
