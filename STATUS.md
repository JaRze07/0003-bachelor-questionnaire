# Bachelor Questionnaire

## Pending

- Next in the pipeline: Codex critique of spec v3 → merge → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → implement on branch `001-bachelor-questionnaire` (API + web + Capacitor Android), Codex review, merge
- Create Google Cloud project `jr07-0003-bachelor-questionnaire` (Firestore, Firebase Auth, Cloud Run, Firebase Hosting) once A1 is confirmed
- Curated question sets: English master (20 questions), then de/es/pt/pl via Codex with context, reviewed; `specs/001-bachelor-questionnaire/curated/<lang>.json`
- Strip the original party's names and seed rounds from the app, README and questions when the generic version is built (spec FR-010)
- Remove `worker.js`, `wrangler.toml`, `worker-README.md`, `results.json` sync when the new API lands (Cloudflare retired)
- **Jacek:** A1 hosting: OK to build the backend on Google Cloud (Firebase Auth + Firestore + Cloud Run API + Firebase Hosting for the partner/spectator pages) in a new project `jr07-0003-bachelor-questionnaire`? Reason: org, billing, 50 PLN cap and kill switch already exist there, and the dashboard uses the same stack. A fresh Cloudflare account would be a second vendor with its own billing. (I proceed with Google Cloud unless you say otherwise)
- **Jacek:** A2 mobile wrapper: Capacitor around the existing plain HTML/JS app (like GameMatch and GiftGenie, signed via GitHub Actions), Android on the Play Store first. iOS later, because it needs an Apple developer account (99 USD/year) and a Mac build. Do you have a Google Play Console account (25 USD one-off)? An Apple developer account?
- **Jacek:** A3 purchases: (a) a Capacitor plugin talking to Play Billing / StoreKit directly, receipt verification in our own API (no extra vendor, more code); or (b) RevenueCat (one more SDK and account, free under 2.5k USD monthly revenue, handles verification, restore and both stores). I proceed with (a) unless you prefer (b)
- **Jacek:** A4 ads: AdMob is the practical choice (only network that serves both stores natively; Apple has no publisher ad network). You need an AdMob account (free, Google account) so I can get ad unit ids; until then the app uses AdMob test ids. Interstitial once per 60 min of use at natural breaks only, never mid-round: OK?
- **Jacek:** A5 sign-in: host must sign in with the store account (Google / Apple) to create a game, no guest mode; partner and spectators never sign in. OK?
- **Jacek:** Cloudflare clean-up: the old hand-made Worker (`areeb-bachelor-results`) still exists in your Cloudflare dashboard with a GitHub token in its secrets. Delete the Worker there and revoke that GitHub token (GitHub → Settings → Developer settings → tokens). Nothing else on Cloudflare is needed any more. (Answer to "what is this about?": that Worker was the old live-sync backend, deployed by hand from a restaurant; it is being retired, so no `wrangler login` is needed)
- Done 2026-09-14: Q1–Q5 answered by Jacek via the dashboard and folded into spec v3 (`specs/001-bachelor-questionnaire/spec.md`); rules research in `research.md` (strike back = on a correct answer the player hands the penalty to a guest); constitution v2.0.0 (store sign-in, Google Cloud + Capacitor)
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
retired. The full feature specification (v3, 2026-09-14) follows this overview.

Project principles: `.specify/memory/constitution.md` v2.0.0 (spec first; minimal identity and privacy by
design; local-first offline play; free tier with light ads; one web codebase + Capacitor + Google Cloud, pinned
tooling; verifiable quality bar).

What exists today is a hand-built version for one party (static GitHub Pages app, optional Cloudflare Worker
saving results). It stays the technical baseline; its hardcoded names and seed rounds are removed as part of the
generalisation. Setup details: `README.md` in this repo.
