# Bachelor Questionnaire

## Pending

- Codex review of the branch is running; real findings get fixed, then a second review, then merge to `main`
- Android: run `npx cap add android` on a machine with the Android SDK (this terminal has no Java), commit `android/`, then tag `v0.1.0` to get a signed APK and AAB from GitHub Actions
- Deploy: `scripts/deploy.md` has the Cloud Run, Hosting, Scheduler and Pub/Sub commands for project `jr07-0003-bachelor`; the terminal now has gcloud, so I can run them when you want the API live
- iOS after the Apple developer account exists (Capacitor project, Sign in with Apple, StoreKit verification in the API)
- **Jacek:** AdMob ad unit ids when you get to it: paste a banner id and an interstitial id here, I put them in the repo variables `AD_UNIT_BANNER` and `AD_UNIT_INTERSTITIAL`. Until then the app uses AdMob test ids
- **Jacek:** Play Console: after the account exists I need the app created with package `com.jr07.bachelorquestionnaire` and a one-off product `premium_forever` (about €1), plus the Cloud Run service account linked under API access so purchases verify
- **Jacek:** "scrap the full old github and recreate it fresh" - do you mean deleting the GitHub repo `JaRze07/0003-bachelor-questionnaire` and pushing a fresh one with no history? I have removed every trace of the original party from the working tree, but the old files still exist in past commits. Deleting a repo is irreversible and loses issues and history, so I will not do it without a clear yes. The alternative I can do safely: keep the repo and rewrite history so the old files never appear (needs a force push)
- Done 2026-09-16: implementation of the whole pipeline on branch `001-bachelor-questionnaire`: Cloud Run API (Hono + Firestore, 38 tests), host app, partner form, spectator page, IndexedDB event journal with lease epoch, AdMob gate, purchases, five languages (Codex translations, reviewed), retention job, CI, Android release workflow, README, and removal of the one-party app (SC-007)
- Done 2026-09-15: Q1-Q5 answered, spec v3.1 after two Codex critiques, constitution v2.0.0, plan, data model, API contract, quickstart, 43 tasks
- Done 2026-09-15: Google Cloud project `jr07-0003-bachelor` created by Jacek from the PC (europe-central2, billing linked, APIs on); gcloud now available in the dashboard terminal

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
