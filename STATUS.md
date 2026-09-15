# Bachelor Questionnaire

## Pending

- Implementing on branch `001-bachelor-questionnaire` (43 tasks in `specs/001-bachelor-questionnaire/tasks.md`): API (Cloud Run, Firestore), web (host app, partner form, spectator page), Capacitor Android, translations via Codex, then Codex review and merge
- Curated question sets: English master (20 questions), then de/es/pt/pl via Codex with context, reviewed; `web/curated/<lang>.json`
- Strip the original party's names and seed rounds from the app, README and questions when the generic version is built (spec FR-010, task T073)
- Remove `worker.js`, `wrangler.toml`, `worker-README.md`, `results.json` sync when the new API lands (Cloudflare retired, task T073)
- **Jacek:** D1 hosting prerequisites: this terminal has no gcloud, so from your PC run `.\tools\gcp-new-project.ps1 -Short 0003-bachelor-questionnaire -Apis firestore.googleapis.com,run.googleapis.com,cloudscheduler.googleapis.com,pubsub.googleapis.com,identitytoolkit.googleapis.com,firebase.googleapis.com,androidpublisher.googleapis.com` (region europe-central2 like the dashboard). Or tell me to write a `gcloud` script you paste. Deploy commands will be in the README
  - Answer (2026-09-15): done from the PC. Google Cloud project **`jr07-0003-bachelor`** (ids are capped at 30 characters, so the slug is shortened) in the JR07 folder, billing linked, APIs enabled: firestore, run, cloudscheduler, pubsub, identitytoolkit, firebase, androidpublisher. Region europe-central2. The terminal now has `gcloud` too (tools/gcp-new-project.sh), so this never needs the PC again.
- **Jacek:** D2 store accounts: do you have a Google Play Console account (25 USD one-off)? An Apple developer account (99 USD/year) + a Mac? Android ships first either way; iOS waits for these
  - Answer (2026-09-15): not yet, but I will. For mac ill use a streaming service
- **Jacek:** D3 purchases: (a) Capacitor plugin `@capgo/native-purchases` talking to Play Billing directly, receipt verification in our API via the Google Play Developer API (no extra vendor, more code, my default); or (b) RevenueCat (one more SDK and account, free under 2.5k USD monthly revenue, handles verification, restore and both stores). I build (a) behind an interface so (b) stays possible
  - Answer (2026-09-15): whichever you think is better
- **Jacek:** D4 ads: AdMob is the only network serving both stores natively. Please create an AdMob account (free, your Google account), add the app, create one banner and one interstitial ad unit and paste the two ids here; the app uses AdMob test ids until then. Interstitial at most once per 60 min of use, only between games, never mid-round
  - Answer (2026-09-15): set up an account but will do the rest later
- **Jacek:** New vendor SDKs I want to add (constitution V needs your OK): `@capacitor-firebase/authentication` (Google/Apple sign-in), `@capacitor-community/admob` (ads + consent), `@capgo/native-purchases` (in-app purchase), plus `firebase-admin` and `googleapis` on the server. All pinned in lockfiles. OK?
- **Jacek:** Cloudflare clean-up: the old hand-made Worker (`areeb-bachelor-results`) still exists in your Cloudflare dashboard with a GitHub token in its secrets. Delete the Worker there and revoke that GitHub token (GitHub → Settings → Developer settings → tokens). Nothing else on Cloudflare is needed any more. (Answer to "what is this about?": that Worker was the old live-sync backend, deployed by hand from a restaurant; it is being retired, so no `wrangler login` is needed)
- Done 2026-09-14: Codex critique of spec v3 (`codex-spec-review-v3.md`) merged into spec v3.1 (lease epoch, event journal, rounds frozen at reveal, question revisions, spectator projection, entitlement state machine, decisions D1–D5); plan, data model, API contract, quickstart and 43 tasks written (`specs/001-bachelor-questionnaire/`)
- Done 2026-09-14: Q1–Q5 answered by Jacek via the dashboard and folded into spec v3; rules research in `research.md` (strike back = on a correct answer the player hands the penalty to a guest); constitution v2.0.0 (store sign-in, Google Cloud + Capacitor)
- Done 2026-09-14: spec-kit scaffold added (`specify init` 1.0.6, bash scripts, claude skills), constitution v1.0.0, `CLAUDE.md` refreshed from the workspace template
- Done 2026-09-13: spec v2 in `specs/001-bachelor-questionnaire/spec.md`, revised after the Codex critique (`codex-spec-review.md`)

## Specification

**Bachelor Questionnaire** is a "how well do you know your partner" party game as a mobile app (Android first,
iOS later). The partner answers a set of questions in advance through a private web link, no install; at the
party the host asks the guest of honour the same questions from the app, reveals the partner's answer, and a
wrong answer costs a drink or a dare. Guests follow the score on a spectator link. Free tier: 20 curated
questions in English, German, Spanish, Portuguese and Polish, banner ads plus at most one interstitial per hour.
Premium (in-app purchase, about €1, forever): up to 100 custom questions, penalty schemes, strike back and
double-or-nothing rules, no ads. Backend on Google Cloud (Firebase Auth, Firestore, Cloud Run); Cloudflare
retired. The full feature specification (v3.1, 2026-09-14, after two Codex critiques) follows this overview.

Project principles: `.specify/memory/constitution.md` v2.0.0 (spec first; minimal identity and privacy by
design; local-first offline play; free tier with light ads; one web codebase + Capacitor + Google Cloud, pinned
tooling; verifiable quality bar).

What exists today is a hand-built version for one party (static GitHub Pages app, optional Cloudflare Worker
saving results). It stays the technical baseline; its hardcoded names and seed rounds are removed as part of the
generalisation. Setup details: `README.md` in this repo.
