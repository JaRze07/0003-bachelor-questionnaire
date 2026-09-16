- **`api/src/routes/events.ts`, `api/src/service.ts`, `api/src/routes/lease.ts` — Lease enforcement is neither strict nor race-safe.** An upload is accepted when `game.lease` is absent, so the uploader does not actually have to hold a lease. More seriously, an old holder’s request can validate, race with a takeover, and then `refreshDerived()` calls `repo.games.set(game)` with the stale game, restoring the old `epoch` and `lease`; the final `lease` update can overwrite the takeover again. The legitimate new holder is then rejected as stale. Make lease acquisition/takeover and event application transactional: re-read the current game, require an existing matching `deviceId` and `epoch`, and conditionally update `lastSyncAt`. Never persist `lease`, `epoch`, or tokens through `refreshDerived`; update only explicitly owned fields.

- **`api/src/routes/events.ts`, `api/src/repo/firestore.ts` — Applying an event and recording its journal document are not atomic.** If round/game/projection writes succeed but `events.add()` fails, the retry sees no journal entry and reapplies the event. `round.strikeBack` can add the same guest twice, revisions can be incremented twice, and a successfully applied `game.finish` is rejected on retry because the game is now finished. Commit the idempotency document and all materialized changes in one Firestore transaction/batch with a create-if-absent precondition; do the equivalent atomically in the repository abstraction.

- **`web/src/logic/queue.js`, `api/src/repo/types.ts`, `api/src/routes/events.ts` — The “started round holds its question” fix is lost after a server pull.** Local rounds have `started: true`, but server `Round` objects persist only `startedAt`. Once `pullGame()` replaces local rounds, an interrupted `result: 'unplayed'` round no longer satisfies the queue’s held predicate, so its question can be served again without being voided. Persist an explicit `voided` flag (false on start, true on an unplayed fix-up) and determine holding from persisted `startedAt && !voided`, or delete a round transactionally when it is explicitly voided.

- **`web/src/partner.js` — Conflict handling breaks per-question serialization and can lose newer typing.** On `answer_conflict`, `inFlight` is cleared before the conflict dialog resolves. The outer `finally` consequently schedules another save while the dialog is open, allowing duplicate concurrent requests and repeated conflict dialogs. The dialog also closes over the old `text`; either choice can overwrite or discard text typed while the original request was pending. Keep the question locked through conflict resolution, preserve `record(question.id).draft` as the authoritative newest text, update `baseRev`, and schedule exactly one retry only after the current save operation has fully released the lock.

- **`api/src/routes/partner.ts` — The server-side answer revision check is not atomic.** Two partner tabs can read the same `baseRev`, both pass the check, both write the same next revision, and one answer silently overwrites the other. Perform the answer read, `baseRev` comparison, and write in a Firestore transaction/compare-and-set operation.

- **`web/src/store/sync.js`, `web/src/store/journal.js` — Re-reading the row in `mergeServer` does not prevent stale server responses from overwriting fresher fields.** `pushEvents()` constructs `answers` and `revision` from its captured snapshot/response before the transaction; a concurrent pull can store newer answers, after which the older push response replaces them. Conversely, `pullGame()` can receive an old response, observe that events were acknowledged in the meantime, and replace local rounds with the pre-event server rounds. Merge nested answers inside the transaction by `questionRev`/`rev`, reject revision regressions, and version-check server snapshots before replacing rounds/game state.

- **`web/src/host/state.js` — The global `syncing` promise can permanently skip a different game’s upload.** If game A is syncing when game B requests `sync()`, B receives A’s promise and no B upload is started after it settles. A final action in B can therefore remain pending indefinitely. Track synchronization per game ID, or queue a follow-up run for the requested game after the active run completes.

- **`web/src/spectator.js` — A hung request stops polling permanently.** Self-scheduling happens only in `finally`; if `fetch()` or the initial catalogue request never settles, `polling` remains true, no timer is installed, and visibility changes cannot restart the loop. Add an `AbortController` timeout around each summary request and catalogue load, then clear `polling` and reschedule in `finally`.

- **`api/src/domain/entitlement.ts`, `api/src/repo/firestore.ts` — Purchase ownership can still be granted to two users.** `get(token)`, verification, and `set()` are separate operations, so two users verifying the same unbound token concurrently can both receive premium before the last write wins the purchase document. Claim the hashed purchase document transactionally with a create/precondition, allowing updates only when its stored `uid` already matches.

- **`api/src/repo/firestore.ts`, `api/src/domain/entitlement.ts` — “All purchases” is capped at an unordered 50 documents.** `listByUid()` applies `limit(50)`, so a valid active purchase can be omitted and a notification for another token can incorrectly revoke the user’s entitlement. Remove the limit, paginate through every purchase, or maintain an atomic per-user active-purchase aggregate.

- **`web/src/native/ads.js` — The interstitial allowance can still be double-spent.** `interstitialInFlight` is checked before `await meta(...)` but is set only afterward. Two rapid calls can both pass the check, read the eligible allowance, and show two ads. Acquire the in-flight lock before the first await and release it on every exit; use an IndexedDB transaction as well if multiple tabs must share the allowance.
---

## What Claude did with this review (2026-09-16)

**Fixed:**

- **Lease and derived state.** `refreshDerived` now merges only the fields it owns, so no counts update can
  restore a stale epoch, lease or token set. An upload with no lease on the game claims it for that device;
  a different holder is refused. Test: a takeover survives an unrelated host mutation.
- **Retry safety.** Strike back is idempotent by guest name, so a resent action cannot name the same guest
  twice even with fresh event ids. Test added.
- **Voided rounds survive a pull.** `voided` is part of the server round, and the client's queue treats any
  round with a start time as holding its question until it is voided.
- **Partner answers are compare-and-set.** `answers.setIfRev` is a Firestore transaction (and an equivalent
  check in the in-memory repository), so two tabs writing at the same instant produce one winner and one
  409. Test: two simultaneous writes, one 200 and one 409.
- **Purchases are claimed atomically.** `purchases.claim` reserves the hashed document in a transaction before
  verification; a reservation that never verifies is released so the real owner can claim it later.
- **Client merges.** `mergeServer` takes a function evaluated inside the transaction; answers merge per
  question by revision, revisions never regress, and a pull older than the stored revision is dropped. Tests
  added for both.
- **Sync per game.** The in-flight map is keyed by game id, so one game's upload no longer swallows another's.
- **Requests are bounded.** The API client aborts after 12 s (7 s on the spectator page), so a captive portal
  looks like being offline instead of freezing the app; the spectator loop always rearms in `finally` and
  falls back to the English catalogue.
- **Interstitial lock** is taken before the first await.

**Accepted but deferred** (unchanged from the first pass): fully transactional application of the event journal
together with its idempotency document, and cursor pagination for host lists and exports. Both need a
transaction-aware repository layer across every route; at this scale (one host device and one partner per game,
a few hundred games a month) the remaining window is a retried upload arriving during a crash, and every event
type is now idempotent on its own. Recorded here as implementation debt.
