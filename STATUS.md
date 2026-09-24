# Bachelor Questionnaire

## Pending

- **Jacek:** create the Google sign-in client so organisers can log in: Google Cloud console → APIs and services → Credentials → Create credentials → OAuth client id → **Web application**, authorised JavaScript origin `https://bachelor.91-98-25-205.sslip.io`, no redirect URI. Paste the client id here and I redeploy with it. Until then the sign-in screen says sign-in is not set up; the partner and guest links already work
- **Jacek:** try it on your phone: https://bachelor.91-98-25-205.sslip.io. I have no browser here, so the screens have never been seen by a human eye. Sign-in needs the item above, but the pages, languages and layout can be judged now. The guest page is the one to look at: open it while I walk a game through on the test instance if you want to see it move
- **Jacek:** do you want a nicer address than `bachelor.91-98-25-205.sslip.io`? Any domain you own works: point it at 91.98.25.205 and tell me the name
- **Jacek:** AdMob ad unit ids when you get to them (one banner, one interstitial); the app uses test ads until then
- **Jacek:** Play Console, once the account exists: app `com.jr07.bachelorquestionnaire`, one-off product `premium_forever` (about €1), and a service-account key for purchase checks. Until then buying premium answers "the store could not confirm this yet". I can generate the Android signing key and store it as repo secrets when you say go
- **Jacek:** "scrap the full old github and recreate it fresh" - do you mean deleting the repo and pushing a fresh one with no history? Irreversible, so not without a clear yes. The safe alternative is rewriting history so the old party files disappear (a force push)
- **Jacek:** the Google Cloud project `jr07-0003-bachelor` no longer hosts anything. Keep it only for the OAuth client and the later Play service account, or create those elsewhere and delete it: your call
- iOS after the Apple developer account exists (Capacitor iOS project, Sign in with Apple, App Store purchase checks)
- Implementation debt, not urgent: cursor pagination for host game lists and exports (`specs/001-bachelor-questionnaire/codex-review-2.md`)

## Done

- **2026-09-24:** Codex review of the hosting change: development sign-in can no longer run against a real server, a cached session the server cannot accept is discarded, and a refused account call returns to the sign-in screen (`specs/002-hetzner-live-web/codex-review-2.md`)
- **2026-09-24: live on the JR07 box** at https://bachelor.91-98-25-205.sslip.io, published with `jr07 app up` (WORKFLOW §4d) instead of the hand-written compose file and install script. Checked on the box: all three pages over HTTPS, a Polish game created, answered through the partner link, one round played, the guest link showing the question then the answer only after the organiser's reveal, data surviving a container restart, and a development bearer refused with 401. `deploy/README.md` has the deploy command, settings, backups and restore
- **2026-09-19: own server, web organiser app, live guest view** (spec `002-hetzner-live-web`). One SQLite database with real transactions and nightly backups; the organiser runs the game from the app or any browser; guests see the question on the table, the dare, the partner's answer from the reveal, and the score, refreshed every 2.5 s; Google sign-in exchanged for our own 30-day session; Firebase, Firestore and Cloud Run removed, the API down to four dependencies. Codex review: 9 findings, all fixed
- **2026-09-16: v1** merged: API, organiser app, partner form, guest page, offline event journal with a device lease, AdMob gate, in-app purchase with a server-side entitlement state machine, retention job, five languages, Capacitor Android project, CI, signed release workflow. Two Codex reviews, real findings fixed
- **2026-09-16:** the one-party app, its questions and results, the single-file build and the Cloudflare Worker removed; no name from the original party remains in the working tree (SC-007). Answer to "what is this about?" on the old Worker: it was the hand-made live-sync backend, now retired, so no `wrangler login` is needed
- **2026-09-15:** Q1-Q5 answered by Jacek (store app with in-app premium, ads from day one, five languages, guest link, Claude researches the rules) and folded into spec v3.1 after two Codex critiques; constitution, plan, data model, API contract, quickstart and 43 tasks written
- **2026-09-15:** Google Cloud project created from the PC, and gcloud added to the terminal. Superseded on 2026-09-19: hosting moved to the box, and the project now only holds the OAuth client

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
