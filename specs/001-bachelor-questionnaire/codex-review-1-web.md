1. **P0 — Committed journal events never update the in-memory snapshot**

   - **Files:** [journal.js](/work/JR07/0003-bachelor-questionnaire/web/src/store/journal.js), [round.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/round.js)
   - **What breaks:** `append()` mutates an IndexedDB clone and returns it, but every caller ignores the returned snapshot. After `round.start`, the UI still sees no round, displays the wrong round number, and may select the same question again. After `round.mark`, `s.rounds.find(...)` returns `undefined`, so `outcome(round)` throws after the verdict has already committed.
   - **Concrete fix:** Introduce a single `commitEvent()` wrapper that awaits `append()`, then assigns `state.snapshot = result.snapshot` before rendering or starting sync. Use it for every journal event.

2. **P0 — Network responses can overwrite newer committed rounds**

   - **Files:** [sync.js](/work/JR07/0003-bachelor-questionnaire/web/src/store/sync.js), [state.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/state.js), [editors.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/editors.js), [main.js](/work/JR07/0003-bachelor-questionnaire/web/src/main.js)
   - **What breaks:** `pushEvents()`, `pullGame()`, and several API handlers retain a snapshot across a network `await`, then call `saveGame(snapshot)`. If a round commits meanwhile, the older snapshot overwrites it in `games`; the journal event remains, but the projected local state loses the round. A sync started for game A can also finish after game B opens and replace `state.snapshot` with A.
   - **Concrete fix:** After each network response, open a read/write transaction, reload the latest game row, and merge only server-owned fields into it. Never wholesale-save a pre-request snapshot. Serialize sync per game and only update global state if the same game is still open.

3. **P0 — Multiple host mutations bypass the event journal entirely**

   - **Files:** [main.js](/work/JR07/0003-bachelor-questionnaire/web/src/main.js), [editors.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/editors.js)
   - **What breaks:** Starting a game, editing settings/questions, hiding questions, and setting host answers are performed API-first and then saved as snapshots. They cannot commit offline and violate the one-transaction journal invariant. In particular, `startPlay()` waits for the transition request and starts a round without recording the transition locally.
   - **Concrete fix:** Model these as journal events that update the snapshot in the same IndexedDB transaction. Advance the UI after that commit and upload asynchronously.

4. **P0 — Double taps produce duplicate journal actions**

   - **File:** [round.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/round.js)
   - **What breaks:** Reveal, verdict, strike-back, fix-up, and finish controls remain enabled while their async handlers run. Two taps can append duplicate `round.start` events with the same round ID, duplicate verdicts, duplicate guests, or duplicate finish events.
   - **Concrete fix:** Acquire an action-level lock and disable the relevant controls synchronously before the first `await`; release them only on failure or after navigation. Also make mutations idempotent by rejecting an already-started/marked round ID inside the transaction.

5. **P0 — The doubled round start is split across two transactions**

   - **File:** [round.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/round.js)
   - **What breaks:** One Reveal action commits `round.start` and then optionally commits `round.double`. A crash or storage failure between them leaves a partially recorded round that does not match what the host selected.
   - **Concrete fix:** Put `doubled` in the `round.start` event and create the complete round in one `append()` transaction, or add a batch-append API that writes both events and the snapshot atomically.

6. **P1 — Lease/read-only state is not enforced at the write boundary**

   - **Files:** [journal.js](/work/JR07/0003-bachelor-questionnaire/web/src/store/journal.js), [main.js](/work/JR07/0003-bachelor-questionnaire/web/src/main.js), [state.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/state.js)
   - **What breaks:** Only the Play button checks `readOnly`. A non-holder can still finish an open round, fix results, finish the game, or use editor mutations. When sync detects a stale epoch, the UI is not rerendered, and `renderGame()` writes the divergence warning into `home-notice`, which is hidden on the game page. `claimLease()` also treats every HTTP error as offline and may retain write access after an authorization failure.
   - **Concrete fix:** Reject writes centrally in the journal/API mutation layer when `snapshot.readOnly` is true. On stale epoch, immediately rerender and disable every mutation control. Show divergence in the game notice. Only tolerate genuine offline errors when claiming a lease.

7. **P1 — A started but unfinished round becomes selectable again**

   - **Files:** [queue.js](/work/JR07/0003-bachelor-questionnaire/web/src/logic/queue.js), [round.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/round.js)
   - **What breaks:** `unplayed()` excludes only rounds whose result is not `unplayed`. A persisted `round.start` therefore does not consume its question. After a reload or interrupted round, the same question can be started again, and there is no resume path for `currentRoundId`.
   - **Concrete fix:** Give rounds an explicit lifecycle such as `started`, `marked`, and `voided`; exclude every non-voided started round from the pool. Resume `currentRoundId` at boot. Fix-up to “unplayed” should void/remove the completed round rather than making a live started round indistinguishable from a reverted one.

8. **P1 — Opening and starting a cached game is still gated on the network**

   - **Files:** [api.js](/work/JR07/0003-bachelor-questionnaire/web/src/api.js), [state.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/state.js), [main.js](/work/JR07/0003-bachelor-questionnaire/web/src/main.js), [round.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/round.js)
   - **What breaks:** `openGame()` waits for a pull before returning, and non-offline server errors discard the usable local path. Fetches have no timeout, so a captive or half-dead connection can block entry indefinitely. `startPlay()` waits for the server transition, and `finishGame()` waits for event upload after the local commit.
   - **Concrete fix:** Render the local snapshot immediately, perform pull/lease work in the background with a bounded timeout, and treat remote failures as sync status rather than navigation failures. Start and finish from the local journal commit; never await upload before advancing.

9. **P1 — Partner saves are neither serialized nor isolated per question**

   - **File:** [partner.js](/work/JR07/0003-bachelor-questionnaire/web/src/partner.js)
   - **What breaks:** All questions share one debounce timer, while multiple PUTs can be in flight. A second edit can be sent with the old `baseRev`, conflict with the tab’s own first request, and an older response can call `render()` and replace newer text in the textarea.
   - **Concrete fix:** Maintain `{draft, timer, inFlight, generation}` per question. Serialize PUTs for each question, send the latest draft after the current request completes, update `baseRev` before the next request, and ignore responses whose generation is obsolete.

10. **P1 — Failed partner saves are discarded while navigation still succeeds**

   - **File:** [partner.js](/work/JR07/0003-bachelor-questionnaire/web/src/partner.js)
   - **What breaks:** An offline `flush()` returns normally, so Previous/Next advances and `renderOne()` restores the old server value, losing the typed answer. Done can hide the form and display success after the user confirms that saves are pending. A `question_changed` response reloads the game and discards the local answer instead of retaining it for conflict resolution.
   - **Concrete fix:** Store drafts independently of `game.answers`. Make `flush()` return an explicit result and block navigation/completion or preserve the draft for retry on failure. For edited questions, display old/new question text with the unsaved answer and require an explicit discard or resubmit choice.

11. **P1 — Bearer links can leak across games**

   - **File:** [main.js](/work/JR07/0003-bachelor-questionnaire/web/src/main.js)
   - **What breaks:** `links = snapshot.links ?? links` retains the previous game’s partner and spectator URLs when the newly opened snapshot has no links. The host can copy and distribute a bearer token for the wrong game.
   - **Concrete fix:** Key links by game ID or reset them to `{ partner: null, spectator: null }` on every game switch. Populate them only from the opened game’s persisted/server response.

12. **P1 — Spectator polling can overlap, roll back the score, and continue after “gone”**

   - **File:** [spectator.js](/work/JR07/0003-bachelor-questionnaire/web/src/spectator.js)
   - **What breaks:** `setInterval()` starts another request even if the previous poll is still pending. Responses can arrive out of order, replacing a newer score and ETag with older data. `gone()` clears the interval but leaves the visibility listener and in-flight polls active, so polling may restart or the board may reappear.
   - **Concrete fix:** Use a self-scheduling `setTimeout` started only after the previous poll settles. Track a stopped/generation flag, abort in-flight fetches when possible, and remove the visibility listener when the token is gone.

13. **P1 — Async UI handlers expose unhandled rejections**

   - **Files:** [round.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/round.js), [main.js](/work/JR07/0003-bachelor-questionnaire/web/src/main.js), [partner.js](/work/JR07/0003-bachelor-questionnaire/web/src/partner.js), [ui.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/ui.js)
   - **What breaks:** `confirmStrike()`, `finishGame()`, `setResult()`, several navigation handlers, and partner `boot()` can reject without a catch because `addEventListener` ignores returned promises. An IndexedDB failure can leave controls/screens stuck, while a boot-time API or catalogue failure replaces the entire host UI with the fatal message.
   - **Concrete fix:** Make `on()` wrap handler results with `Promise.resolve(...).catch(...)`, and add local `try/finally` blocks to restore controls and retain the current screen. Reserve the fatal boot screen for cases where neither the shell nor local data can load.

14. **P1 — Ad placement and frequency are not fail-closed**

   - **Files:** [main.js](/work/JR07/0003-bachelor-questionnaire/web/src/main.js), [ads.js](/work/JR07/0003-bachelor-questionnaire/web/src/native/ads.js)
   - **What breaks:** Navigating from Home to New Game or Premium does not call `syncBanner()`, so the native banner remains visible on a forbidden screen. If `hideBanner()` fails, it may remain visible during play. Concurrent `maybeInterstitial()` calls can both pass the non-atomic counter check, and if an ad displays but persisting the reset fails, another can be shown within the hour. A hung AdMob promise blocks `createGame()` because the interstitial is awaited.
   - **Concrete fix:** Couple banner state to the central `show()` transition. On hide failure, attempt removal and mark the banner unavailable. Reserve the interstitial allowance atomically before invoking AdMob, protect it with a single-flight lock, and wrap SDK calls in a short timeout so navigation always continues.

15. **P2 — Doubled strike-back allows two guests in logic but only one in the UI**

   - **Files:** [round.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/round.js), [rules.js](/work/JR07/0003-bachelor-questionnaire/web/src/logic/rules.js)
   - **What breaks:** `outcome()` returns `maxGuests: 2` for a doubled correct answer, but `confirmStrike()` ignores `maxGuests`, records one guest, and immediately leaves the strike screen.
   - **Concrete fix:** Keep the strike screen active until the maximum is reached or the host finishes early, and enforce the limit transactionally with `addStrikeBack()` semantics.

16. **P2 — Premium entitlement is not actually cached for offline startup**

   - **Files:** [state.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/state.js), [main.js](/work/JR07/0003-bachelor-questionnaire/web/src/main.js)
   - **What breaks:** `refreshMe()` claims the cached entitlement is used offline, but `/me` is never persisted or restored. After a cold offline launch, a premium host is treated as free: premium controls are locked and ads are eligible.
   - **Concrete fix:** Persist the last verified entitlement and its verification metadata in IndexedDB, load it before the network refresh, and replace it only after a successful authoritative response.

17. **P2 — The random-order premium control remains enabled for free hosts**

   - **File:** [editors.js](/work/JR07/0003-bachelor-questionnaire/web/src/host/editors.js)
   - **What breaks:** `renderSettings()` disables the strike-back and double controls when locked but not `rule-random`. Free users can toggle it, producing a doomed API mutation and misleading UI.
   - **Concrete fix:** Set `rule-random.disabled = locked` and guard `saveSettings()` against locked mutations, not just the rendering layer.
---

## What Claude did with this review (2026-09-16)

**Fixed:**

| # | Finding | Fix |
|---|---|---|
| 1 | Committed events never reached the in-memory snapshot | A single `commit()` wrapper in the round flow appends through `appendMany` and adopts the returned snapshot. This was a real crash: after a verdict the round was not in memory and `outcome(round)` threw. |
| 2 | Network responses overwriting newer rounds | `mergeServer()` re-reads the stored row inside the transaction and merges only server-owned fields; `pushEvents`, `pullGame`, lease, takeover and link regeneration all go through it. `sync()` runs one at a time and only applies to the game still open. |
| 4 | Double taps | `commit()` holds an action lock and disables the buttons it was given; the mutations also ignore a round that is already started or marked. |
| 5 | The doubled start split over two transactions | `round.start` and `round.double` are written together by `appendMany`. |
| 6 | Read-only not enforced at the write boundary | `appendMany` refuses to write when the snapshot is read-only, the game screen disables every mutating control, and a refused lease claim marks the device read-only instead of assuming offline. |
| 7 | A started round's question could be served again | A round holds its question while `started` and not `voided`; a fix-up back to "unplayed" sets `voided`. |
| 8 | Opening and starting gated on the network | The local snapshot renders first; lease, pull and sync run behind the screen. Starting a game writes the local status and uploads the transition in the background, so the first round begins offline. |
| 9, 10 | Partner saves shared one timer and lost text | Per-question record with draft, timer, in-flight flag and generation counter. Saves are serialised per question, the newest draft is sent after the current request, a failed save keeps the draft and navigation no longer restores the old value. |
| 11 | Links leaking between games | Links are keyed by game id and reset when another game is opened. |
| 12 | Overlapping spectator polls | Self-scheduling `setTimeout`, one poll at a time, out-of-order responses dropped by revision, and the visibility listener removed when the link is gone. |
| 13 | Unhandled rejections in handlers | `on()` wraps every handler; failures are logged and the screen stays. |
| 14 | Ad placement and frequency | `show()` notifies an observer that syncs the banner on every navigation, a failed hide removes the banner and disables banners for the session, the interstitial allowance is spent before the SDK is called, one at a time, with a 5 s timeout. |
| 15 | Doubled strike back allowed two guests but took one | The strike screen stays open until the maximum is named. |
| 16 | Entitlement not cached for an offline start | `/me` is cached in IndexedDB and loaded before the network call. |

**Rejected:**

- **3** (host mutations should be journal events). Editing questions, penalty schemes and hidden lists are
  server-side features by design: the partner form has to see the change, and the spec says a question added
  offline is "not yet visible to the partner". Only *starting* a game was wrongly gated on the network, and that
  is fixed under 8. Gameplay itself is already journal-only.
- **17** (random order should be disabled for free hosts). Random order is a baseline feature, free in every tier
  (spec FR-006); only penalty schemes and extra rules are premium.
