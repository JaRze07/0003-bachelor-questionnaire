# Bachelor Questionnaire

## Pending

- **Jacek:** AdMob ad unit ids when you get to them: paste a banner id and an interstitial id here and I put them in the repo variables `AD_UNIT_BANNER` and `AD_UNIT_INTERSTITIAL`. Until then the app uses AdMob test ids
- **Jacek:** Play Console, once the account exists: create the app with package `com.jr07.bachelorquestionnaire` and a one-off product `premium_forever` (about €1), and link the Cloud Run service account under API access so purchases verify. Also needed: an Android upload keystore, which I can generate and store as repo secrets when you say go
- **Jacek:** shall I deploy the backend now? `scripts/deploy.md` has every command for project `jr07-0003-bachelor` (Cloud Run, Firestore, Firebase Hosting, the daily retention job). The terminal has gcloud, so I can run them; it costs a few cents a month at this scale and stays under the 50 PLN cap
- **Jacek:** "scrap the full old github and recreate it fresh" - do you mean deleting the repo `JaRze07/0003-bachelor-questionnaire` and pushing a fresh one with no history? Every trace of the original party is gone from the current code, but the old files still exist in past commits. Deleting a repo is irreversible and loses its history, so I will not do it without a clear yes. The safe alternative is to keep the repo and rewrite history so the old files never appear (a force push)
- iOS after the Apple developer account exists: Capacitor iOS project, Sign in with Apple, App Store Server notifications in the API
- Implementation debt recorded in `specs/001-bachelor-questionnaire/codex-review-2.md`: fully transactional event application and cursor pagination for host lists and exports. Not needed at this scale, revisit if the app gets real traffic
- Done 2026-09-16: **v1 merged to `main`.** API on Cloud Run (Hono + Firestore), host app, partner form, spectator page, IndexedDB event journal with a host lease epoch, offline readiness check, AdMob gate, in-app purchase with a server-side entitlement state machine, retention job, five languages, Capacitor Android project, CI and a signed-release workflow. 93 tests. Two Codex reviews of the code, real findings fixed (see `codex-review-1-api.md`, `codex-review-1-web.md`, `codex-review-2.md`)
- Done 2026-09-16: the one-party app, its questions and results, the single-file build and the Cloudflare Worker are removed; no original party name remains in the working tree (SC-007)
- Done 2026-09-15: Q1-Q5 answered, spec v3.1 after two Codex critiques, constitution v2.0.0, plan, data model, API contract, quickstart, 43 tasks
- Done 2026-09-15: Google Cloud project `jr07-0003-bachelor` created (europe-central2, billing linked, APIs on); gcloud now available in the dashboard terminal

## Specification

**Bachelor Questionnaire** is a "how well do you know your partner" party game as a mobile app (Android first,
iOS later). The partner answers a set of questions in advance through a private web link, no install; at the
party the host asks the guest of honour the same questions from the app, reveals the partner's answer, and a
wrong answer costs a drink or a dare. Guests follow the score on a spectator link. Free tier: 20 curated
questions in English, German, Spanish, Portuguese and Polish, banner ads plus at most one interstitial per hour.
Premium (in-app purchase, about €1, forever): up to 100 custom questions, penalty schemes, strike back and
double-or-nothing rules, no ads. Backend on Google Cloud (Firebase Auth, Firestore, Cloud Run); Cloudflare
retired. The full feature specification (v3.1, after two Codex critiques) follows this overview. The implementation lives on branch `001-bachelor-questionnaire`: `api/` (Cloud Run + Firestore), `web/` (host app, partner form, spectator page), `android/` (Capacitor, to be generated on a machine with the Android SDK).

Project principles: `.specify/memory/constitution.md` v2.0.0 (spec first; minimal identity and privacy by
design; local-first offline play; free tier with light ads; one web codebase + Capacitor + Google Cloud, pinned
tooling; verifiable quality bar).

What exists today is a hand-built version for one party (static GitHub Pages app, optional Cloudflare Worker
saving results). It stays the technical baseline; its hardcoded names and seed rounds are removed as part of the
generalisation. Setup details: `README.md` in this repo.
