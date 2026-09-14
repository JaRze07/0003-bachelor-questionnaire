# Implementation Plan: Bachelor Questionnaire

**Branch**: `001-bachelor-questionnaire` | **Date**: 2026-09-14 | **Spec**: `specs/001-bachelor-questionnaire/spec.md` (v3)

**Input**: Feature specification v3, constitution v2.0.0, `research.md` (game rules, ads, purchases), Codex critique v3 (`codex-spec-review-v3.md`, merged where accepted).

## Summary

Turn the one-party web game into a store app plus a small backend: the host runs the game in a Capacitor
app (Android first), the partner answers on a web link, spectators watch a score page, all backed by one
Cloud Run API on Firestore in Google Cloud project `jr07-0003-bachelor-questionnaire`. Free tier with curated
sets in five languages and AdMob ads; premium as a non-consumable in-app purchase verified server-side.
The party-time game state is local-first (IndexedDB) with an outbox that syncs when online.

## Technical Context

**Language/Version**: JavaScript (ES2022 modules) in the browser/WebView; TypeScript 5.9 on Node 22 for the API
**Primary Dependencies**:
- API: `hono` 4.13.7 + `@hono/node-server` 2.1.1, `@google-cloud/firestore` 9.1.0, `firebase-admin` (ID-token verification; version pinned at install), `zod` 4.6.4, `googleapis` (Play Developer API for purchase verification) — same versions as the JR07 dashboard where they overlap
- Client: no framework; Capacitor 8 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`), `@capacitor-firebase/authentication` (Google/Apple sign-in), `@capacitor-community/admob` (banner, interstitial, UMP consent), `@capgo/native-purchases` (Play Billing / StoreKit) — all four are new vendor SDKs listed for Jacek's approval (STATUS A2–A5)
**Storage**: Firestore (native mode) via the API only; IndexedDB on the host device; no client-side Firestore access
**Testing**: `vitest` 5 for the API (in-memory repository double + a Firestore-emulator suite that is skipped when the emulator is absent) and for pure game logic in `web/src/logic/`; manual regression checklist (`quickstart.md`) for the UI
**Target Platform**: Android 7.0+ (minSdk 24, targetSdk 36) for the host app; iOS 15+ later; evergreen mobile browsers for partner/spectator pages; Cloud Run (linux/amd64 container) for the API
**Project Type**: mobile app + web pages + API
**Performance Goals**: round actions feel instant (local write < 50 ms); partner answer save < 1 s p95; spectator refresh every 8 s served from a cached summary (< 200 ms p95); API cold start acceptable (< 3 s, scale to zero)
**Constraints**: offline-capable host app; scale-to-zero, max 2 instances, under the 50 PLN workspace budget cap; no secrets in the repo; this terminal has no gcloud/Java/Android SDK, so cloud setup runs from Jacek's PC and Android builds run in GitHub Actions
**Scale/Scope**: hobby scale (hundreds of games/month); 10 active games per host; 100 questions per game; ~12 screens in the host app, 2 web pages, ~20 API endpoints

## Constitution Check

| Principle | Gate | Status |
|---|---|---|
| I. Spec first, docs same commit | plan derives from spec v3; every implementation commit touches spec/STATUS/README when behaviour changes | pass |
| II. Minimal identity, privacy | host = Firebase Auth store sign-in only; partner/spectator = hashed scoped tokens; answers never on spectator endpoint; 90-day retention job | pass (retention job is a scheduled Cloud Run job, listed in tasks) |
| III. Party-time reliability | IndexedDB event journal + snapshot; lease epoch; versioned readiness check; rounds frozen at reveal; server never replaces accepted events | pass |
| IV. Free tier with light ads | ad placement enforced in one `ads.js` module with a placement allow-list; interstitial cap in code + tested | pass |
| V. Simplicity, pinned tooling | one web codebase, one API, one GCP project; four new SDKs flagged for approval; lockfiles committed | pass with approvals pending |
| VI. Verifiable quality bar | vitest for API + logic; quickstart checklist; Codex review before merge | pass |

No violations to justify; Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-bachelor-questionnaire/
├── spec.md               # v3
├── research.md           # game rules, ads, purchases (done)
├── plan.md               # this file
├── data-model.md         # Firestore + IndexedDB entities
├── contracts/api.md      # REST contract (host, partner, spectator, me)
├── quickstart.md         # run + manual regression checklist
├── codex-spec-review*.md # Codex critiques (data)
└── tasks.md              # /speckit-tasks output
```

### Source Code (repository root)

```text
api/                      # Cloud Run service
├── src/
│   ├── index.ts          # Hono app, routes mounted
│   ├── auth.ts           # Firebase ID-token verification, token hashing/lookup
│   ├── routes/{games,questions,events,lease,tokens,partner,spectator,me,internal}.ts
│   ├── repo/             # Repository interface + Firestore impl + in-memory impl (tests)
│   ├── domain/           # tier rules, limits, state machine, purchase verification
│   └── jobs/retention.ts # scheduled cleanup (Cloud Run job)
├── test/
├── Dockerfile
├── package.json, package-lock.json, tsconfig.json

web/                      # one static codebase (Capacitor webDir and Firebase Hosting public dir)
├── index.html            # host app shell (screens: home, games, new game, links, questions, penalty setup,
│                         #   question, penalty reveal, fix-up, scoreboard, settings/premium)
├── partner.html          # partner form
├── spectator.html        # spectator page
├── styles.css
├── src/
│   ├── logic/            # pure modules: queue, scoring, penalties, rules (strike back, double), adGate, tier
│   ├── store/            # IndexedDB (in-house wrapper), journal, outbox, sync, readiness
│   ├── api.js            # fetch client with auth header
│   ├── i18n.js           # message catalogue loader, t()
│   ├── native/           # Capacitor bridges: auth.js, ads.js, purchases.js, device.js (browser fallbacks)
│   ├── host/             # screen controllers for the host app
│   ├── partner.js, spectator.js
│   └── main.js
├── i18n/{en,de,es,pt,pl}.json
├── curated/{en,de,es,pt,pl}.json
└── test/                 # vitest for logic/ and store/

android/                  # Capacitor Android project (committed; generated assets gitignored)
capacitor.config.ts
package.json              # root: capacitor + plugins + web tests
firebase.json             # Hosting: public web/, only partner/spectator/assets are linked; index.html shows "install the app" in a plain browser
.github/workflows/
├── ci.yml                # api + web tests on push/PR
└── android-release.yml   # v* tag → signed APK + AAB → GitHub Release (Play upload by hand at first)
```

**Structure Decision**: mobile + web + API in one repo. `web/` is shared by the Capacitor app and Firebase
Hosting so the partner and spectator pages reuse styles, i18n and the API client. The old root-level files
(`app.js`, `index.html`, `styles.css`, `questions.json`, `results.json`, `worker.js`, `wrangler.toml`,
`worker-README.md`, `debug.html`, `hasina-game-single-file.html`, `build-single-file.py`,
`original-build-plan.md`, `SETUP-STEPS.md`, `pages.yml`) are removed once `web/` reaches feature parity
(FR-006); game-flow code is ported from `app.js`, not rewritten from scratch.

## Phase 0: Research (resolved)

| Unknown | Decision | Rationale | Alternatives |
|---|---|---|---|
| Ad network | AdMob + UMP via `@capacitor-community/admob` | only network native to both stores; consent built in | AppLovin MAX / Unity (mediation, later) |
| Purchases | `@capgo/native-purchases` + server verification with the Google Play Developer API (`purchases.products.get`) | no extra vendor; entitlement lives in our Firestore | RevenueCat (A3b) |
| Host auth | Firebase Authentication via `@capacitor-firebase/authentication`, API verifies ID tokens with `firebase-admin` | store accounts, no passwords, works with Apple later | own magic-link (more code, another mail vendor) |
| Local storage | IndexedDB with a 150-line in-house wrapper | constitution III; no dependency | `localStorage` (size limits, blocking) |
| Sync model | append-only local event journal (uuid ids) uploaded idempotently; host lease **epoch** decides authority; rounds frozen at reveal | never overwrite accepted events; honest about offline split-brain | CRDT (overkill), heartbeat leases (untestable offline) |
| Token delivery | token in the URL fragment, sent as `X-Game-Token`; `no-referrer`, `no-store`, CSP | tokens never reach Hosting/API access logs | token in path (logged) |
| Purchase state | store notifications (Play RTDN via Pub/Sub push) + verify on demand; entitlement state machine in Firestore | refunds propagate without polling | scheduled reconciliation job |
| Spectator refresh | 8 s polling of a summary endpoint with 5 s server cache | scale-to-zero friendly | SSE/Durable objects (needs always-on) |
| Retention | Cloud Run job on Cloud Scheduler, daily | constitution II | Firestore TTL policies (can't warn 7 days before) |
| Android build | GitHub Actions like GameMatch: `npm ci` → `cap sync` → Gradle `bundleRelease` + `assembleRelease` → sign → Release | terminal has no Java/SDK | local build on PC |
| API deploy | `gcloud run deploy --source api` from Jacek's PC (documented in README); later a GitHub Actions deploy with Workload Identity if wanted | no gcloud here | Cloud Build trigger |
| Translations | Codex read-only with the English master + per-question context; Claude reviews; stored in `web/curated/<lang>.json` and `web/i18n/<lang>.json` | Jacek's instruction (token-heavy) | Claude direct |

## Phase 1: Design

See `data-model.md` (entities, validation, state machine), `contracts/api.md` (endpoints, auth, errors) and
`quickstart.md` (run and verify). Post-design constitution re-check: unchanged, pass.

## Phase 2: Task planning approach (for /speckit-tasks)

Order: setup (root package, api skeleton, web skeleton, CI) → foundational (repo layer, auth, tokens, i18n,
IndexedDB store, logic modules with tests) → US1 free host runs a party (create game, partner form, host flow
ported from `app.js`, spectator page, scoreboard, export, ads) → US3 partner answers (already needed by US1,
split into its own story for the form UX and "new questions") → US2 premium (purchase + verification, editing,
penalty schemes, extra rules) → US4 host changes phone (lease/takeover) → polish (retention job, Android
project, release workflow, README, strip old files).
