# Implementation Plan: Bachelor Questionnaire

**Branch**: `001-bachelor-questionnaire` | **Date**: 2026-09-14 | **Spec**: `specs/001-bachelor-questionnaire/spec.md` (v3)

**Input**: Feature specification v3, constitution v2.0.0, `research.md` (game rules, ads, purchases), Codex critique v3 (`codex-spec-review-v3.md`, merged where accepted).

**Revised 2026-11-11**: the plan was written for Google Cloud (Cloud Run, Firestore, Firebase Auth and Hosting, Cloud
Scheduler). Spec `002-hetzner-live-web` moved everything to the JR07 box on 2026-09-19 and the Google Cloud project
was deleted on 2026-09-27. The technical context, structure and decisions below now describe what is in the repo;
the planning order at the end is kept as the record of how v1 was built.

## Summary

Turn the one-party web game into a store app plus a small backend: the host runs the game in a Capacitor
app (Android first) or a browser, the partner answers on a web link, guests watch a live page, all backed by one
API container with a SQLite database on the JR07 box (`https://bachelor.91-98-25-205.sslip.io`). Free tier with curated
sets in five languages and AdMob ads; premium as a non-consumable in-app purchase verified server-side.
The party-time game state is local-first (IndexedDB) with an outbox that syncs when online.

## Technical Context

**Language/Version**: JavaScript (ES2022 modules) in the browser/WebView; TypeScript 5.9 on Node 22 for the API
**Primary Dependencies**:
- API (`api/package.json`, exact versions): `hono` 4.13.7 + `@hono/node-server` 2.1.1, `zod` 4.6.4, `google-auth-library` 11.1.0 (verifies Google ID tokens at sign-in; calls the Play Developer API for purchase verification). The database is Node's built-in `node:sqlite`: no driver dependency
- Client: no framework; Capacitor 8 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/app`, `@capacitor/preferences`, `@capacitor/share`), `@capgo/capacitor-social-login` (native Google sign-in), `@capacitor-community/admob` (banner, interstitial, UMP consent), `@capgo/native-purchases` (Play Billing / StoreKit); in a browser, Google Identity Services is loaded from Google for the sign-in button
**Storage**: SQLite (WAL) in one file, reached only through the API's repository interface (`api/src/repo/`); IndexedDB on the host device
**Testing**: `vitest` 5. API: 71 tests run against SQLite in memory by default and against the in-memory repository with `TEST_REPO=memory`. Client: 65 tests for the pure game logic in `web/src/logic/`, the IndexedDB journal and sync, the API client, the purchase and ad bridges, the translations and the guest page (jsdom + fake-indexeddb). Manual regression checklist (`quickstart.md`) for the UI
**Target Platform**: Android 7.0+ (minSdk 24, targetSdk 36) for the host app; iOS 15+ later; evergreen mobile and desktop browsers for the host web app and the partner/guest pages; one linux/amd64 container on the JR07 box for the API and the pages
**Project Type**: mobile app + web pages + API
**Performance Goals**: round actions feel instant (local write < 50 ms); partner answer save < 1 s p95; the guest page polls every 2.5 s and is answered from one stored projection row (304 when unchanged)
**Constraints**: offline-capable host app; one process and one database writer (no horizontal scaling, no redundancy: if the box is down the links stop and the host's device keeps playing); no secrets in the repo; Android builds run in GitHub Actions
**Scale/Scope**: hobby scale (hundreds of games/month); 10 active games per host; 100 questions per game; 13 screens in the host app, 2 more web pages, 27 API routes

## Constitution Check

| Principle | Gate | Status |
|---|---|---|
| I. Spec first, docs same commit | plan derives from spec v3; every implementation commit touches spec/STATUS/README when behaviour changes | pass |
| II. Minimal identity, privacy | host = Google sign-in exchanged for our own hashed session; partner/spectator = hashed scoped tokens; an answer reaches the guest endpoint only once revealed; 90-day retention | pass (retention runs on a timer inside the API process) |
| III. Party-time reliability | IndexedDB event journal + snapshot; lease epoch; versioned readiness check; rounds frozen at reveal; server never replaces accepted events | pass |
| IV. Free tier with light ads | ad placement enforced in one `ads.js` module with a placement allow-list; interstitial cap in code + tested | pass |
| V. Simplicity, pinned tooling | one web codebase, one API container with a SQLite file; the vendor SDKs (sign-in, ads, purchases) were flagged for Jacek's approval when this plan was written; exact versions and lockfiles committed | pass |
| VI. Verifiable quality bar | vitest for API + logic; quickstart checklist; Codex review before merge | pass |

No violations to justify; Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-bachelor-questionnaire/
├── spec.md               # v3
├── research.md           # game rules, ads, purchases (done)
├── plan.md               # this file
├── data-model.md         # SQLite documents + IndexedDB entities
├── contracts/api.md      # REST contract (sign-in, host, partner, spectator, me)
├── quickstart.md         # run + manual regression checklist
├── codex-*.md            # Codex critiques and reviews (data, not instructions)
└── tasks.md              # /speckit-tasks output
```

### Source Code (repository root)

```text
Dockerfile                # the one image: API + pages; built on the box by `jr07 app up bachelor`
deploy/README.md          # deploy command, settings, backups, restore

api/                      # the API (also serves web/ in production)
├── src/
│   ├── server.ts         # process entry: static pages + /config.js + headers, housekeeping and backup timers, clean stop
│   ├── app.ts            # Hono app: CORS, body limit, one transaction per mutating request, routes, error mapping
│   ├── auth.ts           # session lookup, game ownership, partner/guest link lookup, rate limiter
│   ├── service.ts        # derived counts, status and the guest projection, recomputed after every change
│   ├── backup.ts         # CLI: online backup of the live database
│   ├── routes/{auth,me,games,questions,events,lease,tokens,partner,spectator,internal}.ts
│   ├── repo/             # repository interface (types.ts) + sqlite.ts (production) + memory.ts (tests, REPO=memory)
│   ├── domain/           # limits, tier rules, state machine, projection, entitlement, Google and Play verification
│   └── jobs/retention.ts # warn at 83 idle days, delete at 90 (called by the timer in server.ts)
├── curated/              # copy of web/curated for local runs (`npm run sync-curated`); the image copies web/curated
├── test/
├── package.json, package-lock.json, tsconfig.json

web/                      # one static codebase (Capacitor webDir, and served by the API container)
├── index.html            # host app shell (screens: sign-in, home, new game, game, penalty setup, question,
│                         #   penalty, strike back, questions, settings, fix-up, scoreboard, premium)
├── partner.html          # partner form
├── spectator.html        # guest page
├── styles.css
├── config.js             # local-development defaults; the server answers /config.js itself in production
├── src/
│   ├── logic/            # pure modules: queue, scoring, penalties, rules (strike back, double), adGate
│   ├── store/            # IndexedDB (in-house wrapper), journal + outbox, sync
│   ├── api.js            # fetch client: auth header, timeout, offline detection, ETag
│   ├── i18n.js           # message catalogue loader, t()
│   ├── native/           # Capacitor bridges: auth.js, ads.js, purchases.js, device.js (browser fallbacks)
│   ├── host/             # host app: state.js, ui.js, round.js, editors.js, readiness.js
│   ├── partner.js, spectator.js
│   └── main.js
├── i18n/{en,de,es,pt,pl}.json
├── curated/{en,de,es,pt,pl}.json
└── test/                 # vitest: logic, store, api, purchases, i18n, guest page

android/                  # Capacitor Android project (committed; generated assets gitignored)
capacitor.config.ts
package.json              # root: capacitor + plugins + web tests
scripts/                  # serve.mjs (static server for web/ in development), sync-curated.mjs
.github/workflows/
├── ci.yml                # web tests, API type-check and tests on every push and PR
└── android-release.yml   # v* tag → signed APK + AAB → GitHub Release (Play upload by hand at first)
```

**Structure Decision**: mobile + web + API in one repo. `web/` is shared by the Capacitor app and the API
container, which serves it to browsers, so the host web app and the partner and spectator pages reuse styles, i18n
and the API client and share one origin with the API. The old root-level files
(the one-party app, its questions and results, the single-file build, the Cloudflare Worker and the old
Pages workflow) are removed once `web/` reaches feature parity
(FR-006); game-flow code is ported from `app.js`, not rewritten from scratch.

## Phase 0: Research (resolved)

| Unknown | Decision | Rationale | Alternatives |
|---|---|---|---|
| Ad network | AdMob + UMP via `@capacitor-community/admob` | only network native to both stores; consent built in | AppLovin MAX / Unity (mediation, later) |
| Purchases | `@capgo/native-purchases` + server verification with the Google Play Developer API (`purchases.products.get`) | no extra vendor; entitlement lives in our own database | RevenueCat (A3b) |
| Host auth | Google sign-in (`@capgo/capacitor-social-login` in the app, Google Identity Services in a browser); the API verifies the ID token once with `google-auth-library` and issues its own 30-day session, stored hashed (002 FR-121) | no passwords, no Firebase, a game keeps working all night without a Google round trip, Apple plugs into the same exchange later | Firebase Authentication (the original choice, dropped with Google Cloud); own magic-link (more code, another mail vendor) |
| Local storage | IndexedDB with a 150-line in-house wrapper | constitution III; no dependency | `localStorage` (size limits, blocking) |
| Sync model | append-only local event journal (uuid ids) uploaded idempotently; host lease **epoch** decides authority; rounds frozen at reveal | never overwrite accepted events; honest about offline split-brain | CRDT (overkill), heartbeat leases (untestable offline) |
| Token delivery | token in the URL fragment, sent as `X-Game-Token`; `no-referrer`, `no-store`, CSP | tokens never reach the proxy's or the API's access logs | token in path (logged) |
| Purchase state | verify on demand (purchase, restore); entitlement state machine in our database. Store notifications are **open**: the route for Play RTDN as a Pub/Sub push is in the code but nothing delivers to it on the box | until a path is chosen, a refund is seen only when that purchase is verified again | a re-verification timer inside the API (002 names "a pull on a timer"; not built) |
| Spectator refresh | 2.5 s conditional polling (ETag, 304) of one stored projection row | simple, cheap on one always-on process, fast enough for SC-101 | SSE or WebSockets (more moving parts for a party-sized audience) |
| Retention | timer inside the API process every 6 hours: warn at 83 idle days, delete at 90 | constitution II; no scheduler to operate | an external cron |
| Database | SQLite (WAL) through `node:sqlite`, one JSON document table, one in-process writer, read-only second connection for reads outside a transaction | real transactions, testable in CI without a service, a backup is a file (002 §5) | Postgres on the box (available through `jr07 db create`; a contained change if the app outgrows SQLite) |
| Android build | GitHub Actions like GameMatch: `npm ci` → `cap sync` → Gradle `bundleRelease` + `assembleRelease` → sign → Release | terminal has no Java/SDK | local build on PC |
| Deploy | push to `main`, then `jr07 app up bachelor --port 8080 --dir JR07/0003-bachelor-questionnaire -e …` from a dashboard terminal: the box builds the root `Dockerfile`, replaces the container and keeps the `/data` volume (`deploy/README.md`) | one command, no cloud account, settings on the command line | the hand-written compose file and install script that preceded `jr07` |
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
project, release workflow, README, strip old files). Spec 002 then replaced the storage and hosting layers and
added the web host app and the live guest view.
