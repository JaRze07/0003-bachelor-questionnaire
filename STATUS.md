# Bachelor Questionnaire

## Pending

- **Jacek:** put it live, one command on the box: `ssh jr07@91.98.25.205` then `curl -fsSL https://raw.githubusercontent.com/JaRze07/0003-bachelor-questionnaire/main/deploy/install.sh | bash`. It runs as its own compose project, takes a backup first, adds `bq.91-98-25-205.sslip.io` to Caddy, validates before reloading and never restarts the dashboard or the terminal. I cannot run it from here because this terminal has no access to Docker on the box
- **Jacek:** a Google sign-in client, so organisers can log in: Google Cloud console → APIs and services → Credentials → Create credentials → OAuth client id → **Web application**, authorised JavaScript origin `https://bq.91-98-25-205.sslip.io`, no redirect URI. Paste the client id here; it goes into `/srv/jr07/bachelor.env` as `BQ_GOOGLE_WEB_CLIENT_ID` and `BQ_GOOGLE_CLIENT_IDS`. Until then nobody can sign in on the box (development sign-in is refused in production on purpose)
- **Jacek:** do you want a nicer address than `bq.91-98-25-205.sslip.io`? Any domain you own works: point it at 91.98.25.205 and tell me the name
- **Jacek:** AdMob ad unit ids when you get to them (banner + interstitial); test ads until then
- **Jacek:** Play Console, once the account exists: app `com.jr07.bachelorquestionnaire`, one-off product `premium_forever` (about €1), and a service-account key saved as `/srv/jr07/secrets/bachelor/play-service-account.json`. Until then buying premium answers "the store could not confirm this yet"
- **Jacek:** "scrap the full old github and recreate it fresh" - do you mean deleting the repo and pushing a fresh one with no history? Irreversible, so not without a clear yes. The safe alternative is rewriting history so the old party files disappear (a force push)
- **Jacek:** the Google Cloud project `jr07-0003-bachelor` is no longer used for hosting. Keep it only for the OAuth client and later the Play service account, or create those in another project and delete this one: your call
- iOS after the Apple developer account exists
- Done 2026-09-19: **own server, web host app, live guest view** (spec `002-hetzner-live-web`, merged). One SQLite database on the JR07 box with real transactions and nightly backups; the organiser runs the game from the Android app or any browser; guests follow the question on the table, the dare, the partner's answer from the moment the organiser reveals it, and the score, refreshed every 2.5 s; Google sign-in exchanged for our own 30-day session; Firebase, Firestore and Cloud Run removed (the API is down to 4 dependencies). 113 tests, Codex review with 9 findings, all fixed
- Done 2026-09-16: v1 merged: API, host app, partner form, spectator page, offline event journal, AdMob gate, in-app purchase, five languages, Capacitor Android project, CI. Two Codex reviews
- Done 2026-09-16: the one-party app, its data and the Cloudflare Worker removed (SC-007)
- Done 2026-09-15: Q1-Q5 answered, spec v3.1, constitution, plan, data model, API contract, 43 tasks

## Specification

**Bachelor Questionnaire** is a "how well do you know your partner" party game as a mobile app (Android first,
iOS later). The partner answers a set of questions in advance through a private web link, no install; at the
party the host asks the guest of honour the same questions from the app, reveals the partner's answer, and a
wrong answer costs a drink or a dare. Guests follow the game live on a link: the question on the table, the dare,
the partner's answer once the organiser reveals it, and the score. The organiser can also run everything from a
browser. Free tier: 20 curated
questions in English, German, Spanish, Portuguese and Polish, banner ads plus at most one interstitial per hour.
Premium (in-app purchase, about €1, forever): up to 100 custom questions, penalty schemes, strike back and
double-or-nothing rules, no ads. Backend: one container with a SQLite database on the JR07 server (Hetzner); Google is used only for
sign-in and Play purchase verification. The full feature specification (v3.1, after two Codex critiques) follows this overview. The implementation lives on branch `001-bachelor-questionnaire`: `api/` (Cloud Run + Firestore), `web/` (host app, partner form, spectator page), `android/` (Capacitor, to be generated on a machine with the Android SDK).

Project principles: `.specify/memory/constitution.md` v2.0.0 (spec first; minimal identity and privacy by
design; local-first offline play; free tier with light ads; one web codebase + Capacitor + Google Cloud, pinned
tooling; verifiable quality bar).

What exists today is a hand-built version for one party (static GitHub Pages app, optional Cloudflare Worker
saving results). It stays the technical baseline; its hardcoded names and seed rounds are removed as part of the
generalisation. Setup details: `README.md` in this repo.
