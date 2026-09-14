# Tasks: Bachelor Questionnaire

**Input**: `spec.md` v3.1, `plan.md`, `data-model.md`, `contracts/api.md`, `quickstart.md`
**Branch**: `001-bachelor-questionnaire` (code); docs (spec, STATUS, README) are kept current on the same branch and land on `main` at merge

**Tests**: required by constitution VI and SC-010 (vitest for API and pure logic). UI by the quickstart checklist.

## Format: `[ID] [P?] [Story] Description` — [P] = parallelisable; stories US1 free party, US3 partner, US2 premium, US4 second phone

## Phase 1: Setup

- [ ] T001 Root `package.json` (private, `"type": "module"`), scripts `test`, `web` (static server), `cap:*`; pin Capacitor 8 core/cli/android; `.gitignore` for node_modules, android generated assets, `.env*`, keystores
- [ ] T002 [P] `api/` skeleton: `package.json` (hono 4.13.7, @hono/node-server 2.1.1, @google-cloud/firestore 9.1.0, firebase-admin, zod 4.6.4, googleapis; dev: typescript 5.9.3, tsx, vitest 5), `tsconfig.json`, `Dockerfile` (node:22-slim), `src/index.ts` with `/healthz`
- [ ] T003 [P] `web/` skeleton: `index.html`, `partner.html`, `spectator.html`, `styles.css` (ported from the current dark theme), `src/main.js`, `src/partner.js`, `src/spectator.js`, `web/test/` with vitest + fake-indexeddb + jsdom
- [ ] T004 [P] `.github/workflows/ci.yml`: node 22, `npm ci` root + api, `npm test` both, on push and PR
- [ ] T005 [P] `firebase.json` (hosting public `web`, headers for partner/spectator: no-referrer, no-store, CSP) and `.firebaserc` placeholder for `jr07-0003-bachelor-questionnaire`

## Phase 2: Foundational

- [ ] T010 `api/src/repo/types.ts` repository interface (users, purchases, games, questions, answers, rounds, events, tokens, projection, snapshots) + `repo/memory.ts` in-memory implementation + `repo/firestore.ts`
- [ ] T011 [P] `api/src/auth.ts`: Firebase ID-token verification (firebase-admin), `DEV_AUTH` dev bearer, token hashing (sha256) and `X-Game-Token` lookup with role check, rate limiter (in-memory per instance)
- [ ] T012 [P] `api/src/domain/limits.ts` + `domain/tier.ts` (limits table §6.4, free vs premium rules, `premium_revoked`), `domain/state.ts` (game state machine §4, active-game counting), unit tests
- [ ] T013 [P] `api/src/domain/projection.ts`: build the spectator summary from marked rounds; unit tests prove partner answers, guest names and unmarked rounds never appear
- [ ] T014 [P] `web/src/store/idb.js` (in-house IndexedDB wrapper with versioned schema `bq` v1: games, events, outbox, divergent, meta) + tests with fake-indexeddb, including a schema-migration test
- [ ] T015 [P] `web/src/logic/queue.js` (next question, random order decided once per round, hidden questions, new questions appended), `logic/scoring.js`, `logic/penalties.js` (schemes, custom options), `logic/rules.js` (strike back, double or nothing, combinations) with tests
- [ ] T016 [P] `web/src/i18n.js` + `web/i18n/en.json` message catalogue (all host/partner/spectator strings), fallback-to-English with console warning; test
- [ ] T017 [P] `web/src/api.js` fetch client (auth header, `X-Game-Token`, ETag support, error mapping, offline detection)
- [ ] T018 `web/src/store/journal.js`: append event + snapshot in one transaction, UI callback only on `oncomplete`, failure surfaces an error; `store/sync.js`: upload events (`POST /games/:id/events`), handle `stale_epoch` → divergent store, drain outbox, piggybacked partner answers; tests
- [ ] T019 [P] `web/src/native/{auth,ads,purchases,device}.js`: Capacitor bridges with browser fallbacks (dev sign-in prompt, ad placeholder box, local "buy" stub, deviceId in meta)

**Checkpoint**: `npm test` (root + api) green; API runs with `REPO=memory DEV_AUTH=1`.

## Phase 3: US1 — Free host runs a party (P1, MVP)

- [ ] T020 `api/src/routes/me.ts`: `GET /me`
- [ ] T021 `api/src/routes/games.ts`: `POST /games` (curated copy, tokens, epoch 1), `GET /games`, `GET /games/:id`, `PATCH /games/:id` (tier checks, hidden ≤ 5, language rules), `POST /games/:id/transition`, `DELETE /games/:id`, `GET /games/:id/export`; tests
- [ ] T022 `api/src/routes/tokens.ts`: regenerate/revoke partner and spectator tokens; tests (old token → 404)
- [ ] T023 `api/src/routes/events.ts`: idempotent event upload, epoch check, round application (frozen at reveal), counts, projection rewrite, piggyback partner answers; tests incl. duplicate ids and stale epoch
- [ ] T024 `api/src/routes/spectator.ts`: `GET /s/summary` with ETag/304; tests
- [ ] T025 `web/curated/en.json`: 20 generic English questions with `id`, `text`, `theme`, `context` (what a good answer looks like, for translators); reviewed for tone
- [ ] T026 Host app screens in `web/src/host/`: sign-in/home (games list, New game, banner slot), new game (language, title), game overview (partner status, links with copy/share, readiness check, Start), question, penalty setup, penalty reveal, fix-up, scoreboard (filter, export JSON, share summary), settings. Port the round flow from the old `app.js` (hide/re-hide answer, Correct/Wrong, penalty screen, random order, refresh recovery)
- [ ] T027 `web/src/host/readiness.js`: versioned readiness check per spec §7 (hash, IndexedDB read-back, catalogue, simulated reload) with "Ready / Needs refresh / Failed" states; tests for the hash logic
- [ ] T028 `web/src/spectator.js` + `spectator.html`: token from fragment, 8 s conditional polling paused when hidden, stale after 20 s, clear on 404/410
- [ ] T029 `web/src/native/ads.js` + `web/src/logic/adGate.js`: banner on home and scoreboard only (placement allow-list), interstitial gate (active foreground seconds persisted, ≥ 3600 s, natural breaks only), UMP consent flow, fail-closed; tests for the gate
- [ ] T030 Export and share summary (text + PNG rendered on canvas), guest names omitted by default with a toggle

**Checkpoint**: quickstart items 1–10 pass in a browser with the memory API.

## Phase 4: US3 — Partner answers (P1)

- [ ] T040 `api/src/routes/partner.ts`: `GET /p/game` (marks opened, computes `isNew`, updates last-load marker), `PUT /p/answers/:qId` (questionRev/baseRev conflicts), `POST /p/report`; status transitions awaiting_partner ↔ ready; tests for conflicts and deleted questions
- [ ] T041 `web/src/partner.js` + `partner.html`: one-at-a-time with list toggle, progress, debounce + blur saves, Saving/Saved/Offline states, Done gating, conflict dialog, "new questions first", finished read-only, report link; game language only
- [ ] T042 Host side: partner status card (not opened / n/N / complete / n new), "n new questions added to the queue" notice, host-answer entry for unanswered questions with precedence rules (FR-011)

**Checkpoint**: quickstart items 1, 12, 13b, 15 pass.

## Phase 5: US2 — Premium (P2)

- [ ] T050 `api/src/domain/entitlement.ts`: state machine (none/pending/active/revoked/unknown), idempotent binding, `purchase_bound_elsewhere`; `api/src/domain/play.ts`: Google Play Developer API verification behind an interface with a fake for tests; `routes/me.ts` verify/restore; `routes/internal.ts` `POST /internal/play/rtdn` (Pub/Sub push, OIDC check); tests incl. refund → revoked keeps content
- [ ] T051 `api/src/routes/questions.ts`: create/patch (rev bump + `confirmInvalidate`)/reorder/delete/host-answer with tier checks and the 100 limit; tests
- [ ] T052 Host app: premium screen (price from store, Buy, Restore, states, offline message), entitlement cache in meta with 24 h staleness rule, ads removed when active, read-only premium config when revoked
- [ ] T053 Host app: questions editor (add/edit with invalidation confirm/reorder/delete, curated preview + hide up to 5 for free), penalty scheme editor (custom options ≤ 6), rules toggles
- [ ] T054 Round flow additions: strike back (guest nickname, remembered, up to 2 when doubled), double or nothing (×2 penalty screen), fix-up compatibility; logic tests already in T015, add UI wiring
- [ ] T055 Offline question add → "not yet visible to partner" until acked (outbox)

**Checkpoint**: quickstart item 11 passes with the dev purchase stub; API tests cover FR-036.

## Phase 6: US4 — Host changes phone (P2)

- [ ] T060 `api/src/routes/lease.ts`: lease info + takeover (epoch++), reflected in `GET /games/:id`; tests for stale-epoch rejection after takeover
- [ ] T061 Host app: read-only mode with last sync time, Take over confirmation with the offline warning, divergent export screen for rejected events

**Checkpoint**: quickstart item 13 passes.

## Phase 7: Polish and delivery

- [ ] T070 `api/src/jobs/retention.ts` + `POST /internal/jobs/retention` (warn at 83 d, delete at 90 d); in-app warning banner; tests
- [ ] T071 Capacitor: `capacitor.config.ts` (appId `com.jr07.bachelorquestionnaire`, webDir `web`), `npx cap add android`, commit `android/`, plugins registered; `.github/workflows/android-release.yml` (JDK 21, SDK 36, `bundleRelease` + `assembleRelease`, sign with repo secrets, attach AAB + APK to the Release on `v*` tags; dispatch = dry run)
- [ ] T072 Translations: Codex read-only prompt with `en.json` (curated + i18n) and per-question context → `de`, `es`, `pt`, `pl`; Claude reviews each for tone, length limits and cultural fit; tests assert identical key sets and id sets
- [ ] T073 Remove the old party files (`app.js`, root `index.html`, `styles.css`, `questions.json`, `results.json`, `worker.js`, `wrangler.toml`, `worker-README.md`, `debug.html`, `hasina-game-single-file.html`, `build-single-file.py`, `original-build-plan.md`, `SETUP-STEPS.md`, `pages.yml`); `grep -ri "hasina\|areeb"` empty (SC-007)
- [ ] T074 README rewrite (product, structure, run, deploy API from a PC with gcloud, Hosting deploy, Android release, Play Console setup steps for Jacek, secrets list); STATUS and spec updated in the same commits
- [ ] T075 Codex read-only review of the branch (`tools/codex-review.sh`), fix real findings, second review, merge to `main`

## Dependencies
- Phase 2 before any story; T010 before all API routes; T014/T018 before T026.
- US3 (partner) API (T040) is needed for quickstart item 1 of US1; implement T040 right after T023 when working sequentially.
- T050 before T052; T051 before T053; T060 before T061.
- T071 needs Jacek's Play Console/AdMob ids only for the store build, not for the CI dry run.

## Parallel example
T011, T012, T013, T014, T015, T016, T017, T019 touch different files and can be written together after T010.
