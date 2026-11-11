# Bachelor Questionnaire

## Pending

- **Jacek:** create the Google sign-in client so organisers can log in: Google Cloud console, project **`jr07-0000-dashboard`** (the only one left) → APIs and services → Credentials → Create credentials → OAuth client id → **Web application**, authorised JavaScript origin `https://bachelor.91-98-25-205.sslip.io`, no redirect URI. Paste the client id here and I redeploy with it. Until then the sign-in screen says sign-in is not set up; the partner and guest links already work
- **Jacek:** try it on your phone: https://bachelor.91-98-25-205.sslip.io. I have no browser here, so the screens have never been seen by a human eye. Sign-in needs the item above, but the pages, languages and layout can be judged now. The guest page is the one to look at: open it while I walk a game through on the test instance if you want to see it move
- **Jacek:** do you want a nicer address than `bachelor.91-98-25-205.sslip.io`? Any domain you own works: point it at 91.98.25.205 and tell me the name
- **Jacek:** AdMob ad unit ids: the AdMob account is connected to the dashboard (publisher `pub-9929077265418734`, MA rating, blocking set 2026-09-27). Google's API refuses to create ad units for small publishers, so the two test units (banner + interstitial) are created on the AdMob test app `0003-test` in the console; the dashboard's Finance → AdMob panel then shows their IDs (`ca-app-pub-9929077265418734/…`) and the answer here is those two IDs plus the app ID `ca-app-pub-9929077265418734~5081639504`. Decision: test with `0003-test`, a proper "Bachelor Questionnaire" AdMob app at MVP time. Test ads until then
- **Jacek:** Play Console, once the account exists: app `com.jr07.bachelorquestionnaire`, one-off product `premium_forever` (about €1), and, for purchase checks, a Play Developer API link: the organisation forbids service-account keys, so we use Play Console → API access → link a Google Cloud project (`jr07-0000-dashboard`) and grant the API to a service account there; the API then signs in with Workload Identity or, simplest, Jacek pastes a short-lived token when needed - I will propose the exact path once the Console exists. Until then buying premium answers "the store could not confirm this yet". I can generate the Android signing key and store it as repo secrets when you say go
- **Jacek:** "scrap the full old github and recreate it fresh" - do you mean deleting the repo and pushing a fresh one with no history? Irreversible, so not without a clear yes. The safe alternative is rewriting history so the old party files disappear (a force push)
- iOS after the Apple developer account exists (Capacitor iOS project, Sign in with Apple, App Store purchase checks)
- Implementation debt, not urgent: cursor pagination for host game lists and exports (`specs/001-bachelor-questionnaire/codex-review-2.md`)
- Purchases cannot be verified or refunded yet, whatever the Play Console holds. Two things are missing on the server: a credential for the Play Developer API (the code uses Google application-default credentials; the container has none, so every check answers "the store could not confirm this yet"), and a way to hear about refunds (the route in the code is a Pub/Sub push that nothing delivers to; spec 002 named a pull on a timer, which was not built). To design together with the Play Console item above; until then a refund would only be noticed when that purchase is verified again
- The purchase screen has never run on a phone. Its bridge to the store plugin was wrong and is fixed against the plugin's documented results (Done, 2026-11-11), with unit tests only: buy and restore need one real pass on a device once the Play product exists
- Features the task list calls done that the code does not have (`specs/001-bachelor-questionnaire/tasks.md`, "Audit"): the share summary as an image, the switch to leave guest names out of an export, the "n new questions" notice for the organiser, adding a question while offline, an export of actions that could not be sent, server snapshots sent by the app, the 24-hour entitlement refresh, and the simulated-reload part of the readiness check. None blocks a party
- **Jacek:** the Android app lets the system back up its data (`android:allowBackup="true"`), which includes the sign-in session and the party links stored on the phone. Fine for most apps; say if you would rather switch it off before the first store release

## Done

- **2026-11-11: review of the whole project** (code read end to end; tests before: 51 client, 64 API; after: 65 and 71, type-check clean). Not deployed: the fixes reach the live site with the next `jr07 app up bachelor`
  - A slow upload no longer blocks everyone else: request bodies are read before the database's single writer is taken, and bodies over 2 MiB are refused
  - A party is no longer throttled by its shared address: guests and the partner on one Wi-Fi were limited together to about ten guests' worth of polling; now only requests without a working link count against an address
  - The question and answer an organiser's phone freezes offline are checked (text, 300 and 500 characters) before they reach the guests' page
  - The retention job can no longer undo a takeover or a new link made while it runs, and the 90-day warning goes away once the organiser is active again
  - The server stops cleanly when the container is stopped, and sends HSTS
  - Buying premium could never have worked: the app read the store plugin's results in the wrong shape and would have sent the order number instead of the purchase token. Fixed against the plugin's definitions; not yet tried on a phone (Pending)
  - A second account on one phone or browser no longer sees the first one's cached games offline or starts with its premium; a server that is down now counts as offline, so the app still opens and keeps what it had queued; the dashed "ad" box no longer shows on the live web version
  - Removed: the Cloud Run Dockerfile, the Cloud Scheduler endpoint, unused database statements, comments about Google Cloud
- **2026-11-11:** Google Cloud purged from the feature docs: `specs/001-bachelor-questionnaire/{spec,plan,tasks}.md`, the API contract, the data model and the quickstart now describe what runs (one Node container with SQLite on the box, Google sign-in exchanged for our own session, timers for retention and backups), each passage checked against the code and `deploy/`; the decommissioning paragraph is gone from `deploy/README.md`. Where the code does less than the spec, the spec says so ("As built")

- **Jacek:** the Google Cloud project `jr07-0003-bachelor` no longer hosts anything. Keep it only for the OAuth client and the later Play service account, or create those elsewhere and delete it: your call
  - Resolved (2026-09-27): deleted (30-day recovery window). Nothing of this app lives on Google Cloud; the OAuth client for organiser sign-in goes into `jr07-0000-dashboard`, the one project that stays (it holds the dashboard's own client and the budget kill switch)
- **2026-09-24:** Codex review of the hosting change: development sign-in can no longer run against a real server, a cached session the server cannot accept is discarded, and a refused account call returns to the sign-in screen (`specs/002-hetzner-live-web/codex-review-2.md`)
- **2026-09-24: live on the JR07 box** at https://bachelor.91-98-25-205.sslip.io, published with `jr07 app up` (WORKFLOW §4d) instead of the hand-written compose file and install script. Checked on the box: all three pages over HTTPS, a Polish game created, answered through the partner link, one round played, the guest link showing the question then the answer only after the organiser's reveal, data surviving a container restart, and a development bearer refused with 401. `deploy/README.md` has the deploy command, settings, backups and restore
- **2026-09-19: own server, web organiser app, live guest view** (spec `002-hetzner-live-web`). One SQLite database with real transactions and nightly backups; the organiser runs the game from the app or any browser; guests see the question on the table, the dare, the partner's answer from the reveal, and the score, refreshed every 2.5 s; Google sign-in exchanged for our own 30-day session; Firebase, Firestore and Cloud Run removed, the API down to four dependencies. Codex review: 9 findings, all fixed
- **2026-09-16: v1** merged: API, organiser app, partner form, guest page, offline event journal with a device lease, AdMob gate, in-app purchase with a server-side entitlement state machine, retention job, five languages, Capacitor Android project, CI, signed release workflow. Two Codex reviews, real findings fixed
- **2026-09-16:** the one-party app, its questions and results, the single-file build and the Cloudflare Worker removed; no name from the original party remains in the working tree (SC-007). Answer to "what is this about?" on the old Worker: it was the hand-made live-sync backend, now retired, so no `wrangler login` is needed
- **2026-09-15:** Q1-Q5 answered by Jacek (store app with in-app premium, ads from day one, five languages, guest link, Claude researches the rules) and folded into spec v3.1 after two Codex critiques; constitution, plan, data model, API contract, quickstart and 43 tasks written
- **2026-09-15:** Google Cloud project created from the PC, and gcloud added to the terminal. Superseded on 2026-09-19: hosting moved to the box; the project was deleted on 2026-09-27

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
sign-in, ads and Play purchase verification.

Specifications: `specs/001-bachelor-questionnaire/spec.md` (the game, v3.1 after two Codex critiques) and
`specs/002-hetzner-live-web/spec.md` (own server, web organiser app, live guest view), which amends it. Both are
implemented and on `main`: `api/` (Node + Hono + SQLite), `web/` (host app, partner form, guest page), `android/`
(Capacitor project, built and signed by GitHub Actions on a `v*` tag). Deploying is `jr07 app up bachelor`, see
`deploy/README.md`.

Project principles: `.specify/memory/constitution.md` v3.1.0 (spec first; minimal identity and privacy by
design; local-first offline play; free tier with light ads; one web codebase + Capacitor + one container on our own
server, pinned tooling; verifiable quality bar).

The hand-built version for one party that this grew out of (a static GitHub Pages app with an optional Cloudflare
Worker) was removed on 2026-09-16; nothing of it remains in the working tree. Setup details: `README.md`.
