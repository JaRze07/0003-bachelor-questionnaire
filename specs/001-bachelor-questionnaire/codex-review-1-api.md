1. **P0 — Journal events can be recorded without being applied**

   - **File:** `api/src/routes/events.ts` (`POST /:id/events`), `api/src/repo/firestore.ts`
   - **What breaks:** Each event document is written before rounds, game state, counts, and projection are persisted. If the request crashes or times out after `events.add()`, a retry sees `events.has()` and acknowledges the event without replaying it. The offline host then deletes an event that never affected the game. Processing 500 events with sequential reads and writes makes this especially likely.
   - **Concrete fix:** Persist the journal and materialized state transactionally. Either process bounded chunks in Firestore transactions, or store an `appliedSeq` checkpoint and replay every stored-but-unapplied event before acknowledging it. Use Firestore `create()`/transaction preconditions for event IDs; do not use event existence alone as proof of application.

2. **P0 — The lease does not actually restrict writes to its holder**

   - **File:** `api/src/routes/events.ts`, `api/src/routes/lease.ts`
   - **What breaks:** Event upload checks only `epoch`; it never verifies that `deviceId` equals `game.lease.deviceId`. Any host device that knows the current epoch can upload without taking over. First acquisition and simultaneous takeovers are also read-modify-write races, so two devices can both believe they hold the same epoch.
   - **Concrete fix:** In one Firestore transaction, read the game, require both the current epoch and lease-holder device ID to match, and append/apply the event. Make acquisition and takeover transactional; takeover must atomically increment the stored epoch rather than incrementing a stale object.

3. **P0 — Stale whole-document writes corrupt epochs, tokens, status, and revisions**

   - **File:** `api/src/routes/partner.ts`, `api/src/routes/events.ts`, `api/src/routes/games.ts`, `api/src/routes/tokens.ts`, `api/src/service.ts`, `api/src/repo/firestore.ts`
   - **What breaks:** Routes load a `Game`, later overwrite the entire document with `set()`. A partner GET that only intends to update `partnerLastLoadedAt` can overwrite a concurrent takeover, token regeneration, `in_progress` transition, revision increment, or finish. Partner writes can regress an active game to `ready`; event uploads can overwrite a newly incremented epoch. Concurrent revisions can both write the same next revision, causing spectator ETags to return `304` for changed data.
   - **Concrete fix:** Stop saving stale `Game` objects. Add repository transaction/CAS operations that read the current game and update only owned fields. Serialize partner answer, event, transition, lease, token, counts, and revision updates per game. Atomically write the game and spectator projection.

4. **P0 — Partner answer optimistic concurrency is not atomic**

   - **File:** `api/src/routes/partner.ts`, `api/src/repo/firestore.ts`
   - **What breaks:** Two clients can submit the same `baseRev`; both read the same answer, both pass the check, both return success, and the last write silently wins. The subsequent derived-state updates can also overwrite each other or host progress.
   - **Concrete fix:** Perform the answer read, `baseRev` comparison, answer write, and game-derived update in a Firestore transaction. Use a document version/update-time precondition if derived projection is processed separately.

5. **P0 — Purchase ownership and premium state are raceable**

   - **File:** `api/src/domain/entitlement.ts`, `api/src/auth.ts`, `api/src/repo/firestore.ts`
   - **What breaks:** `purchases.get()` followed by `purchases.set()` lets two UIDs concurrently bind the same purchase token and both receive premium. An `unknown` verification is still permanently bound, so a transient Play outage can let one account block the legitimate owner. Full `users.set()` calls also allow `hostAuth` last-seen updates to overwrite a concurrent premium grant or revocation.
   - **Concrete fix:** Verify externally, then transactionally create/read the hashed purchase record, reject a different owner, and update the user. Do not bind tokens on transient/`unknown` results. Update `lastSeenAt` with a field-level update rather than overwriting the user.

6. **P1 — Refund notifications can be acknowledged without revoking premium**

   - **File:** `api/src/domain/play.ts`, `api/src/domain/entitlement.ts`, `api/src/routes/internal.ts`
   - **What breaks:** The verifier converts every Play API failure into `unknown`; an active entitlement remains active, and the Pub/Sub handler still returns `204`, preventing retry. A refund can therefore leave premium enabled indefinitely. Notifications are not durably recorded despite the route comment.
   - **Concrete fix:** Distinguish definitive store states from retryable failures. Return a non-2xx response on transient verification failures so Pub/Sub retries, and persist/deduplicate `messageId`. For authenticated voided-purchase notifications, record revocation durably before returning success, then reconcile with Play.

7. **P1 — One revoked token can revoke another valid purchase**

   - **File:** `api/src/domain/entitlement.ts`, `api/src/routes/me.ts`
   - **What breaks:** Premium is overwritten from whichever token is processed last. Restoring an active token followed by an old revoked token leaves the user revoked. A later notification for any historical token can also revoke an entitlement backed by a different active purchase.
   - **Concrete fix:** Derive entitlement from all purchases bound to the user: premium remains active while any verified purchase is active. Store per-purchase state and transactionally recompute the aggregate entitlement after verification or notification.

8. **P1 — Offline round snapshots are reconstructed from mutable server state**

   - **File:** `api/src/routes/events.ts`
   - **What breaks:** `round.start` requires the current question to exist, uses the current question revision/theme and current settings, and only partially trusts the client’s frozen snapshot. If a question or settings changed while the host was offline, the uploaded round is corrupted; if the question was deleted, the event is silently discarded and acknowledged.
   - **Concrete fix:** Define a strict, bounded schema for the complete frozen round and make that immutable snapshot authoritative for offline starts. Preserve question text, revision, theme, selected answer, penalty scheme, and rules from play time. Alternatively store immutable question revisions and reference the exact revision.

9. **P1 — Invalid or out-of-order events are silently acknowledged**

   - **File:** `api/src/routes/events.ts`
   - **What breaks:** Missing rounds/questions, invalid state transitions, invalid results, and misplaced dependent events simply return from `applyEvent`; the route still stores and acknowledges them. Sequence numbers are not checked for gaps, duplicate sequence numbers, or regression, so different IDs can apply the same logical action twice and late events are reduced against the wrong state.
   - **Concrete fix:** Track an applied sequence per epoch/device, reject gaps and conflicting duplicate sequences, and return explicit per-event rejection details. Prefer deterministic replay in sequence order. Only acknowledge an event once it is validly applied or durably queued for later application.

10. **P1 — Finished games remain mutable outside the fix-up window**

    - **File:** `api/src/routes/events.ts`, `api/src/routes/questions.ts`, `api/src/routes/games.ts`
    - **What breaks:** Only `round.fixup` calls `fixupAllowed()`. Ordinary `round.mark`, `round.penalty`, `round.double`, and `round.strikeBack` events can modify a finished game indefinitely. Questions, host answers, ordering, and settings can also be changed after finishing.
    - **Concrete fix:** Enforce status guards centrally. After finish, reject all gameplay and content mutations except the explicitly supported fix-up operation, and apply its 24-hour deadline using a server timestamp.

11. **P1 — Fixing a round to `unplayed` does not remove it**

    - **File:** `api/src/routes/events.ts`
    - **What breaks:** `renumber(full.rounds)` returns the retained rounds, but its return value is ignored. A fixed-up round keeps `markedAt`, so the abandoned-round deletion branch never removes it. It remains in storage/export, can create numbering gaps, and later fix-ups can create another round for the same question.
    - **Concrete fix:** Remove the round from `full.rounds`, delete its Firestore document, assign the returned renumbered array, and persist all affected round numbers atomically.

12. **P1 — Event and snapshot input is effectively unbounded**

    - **File:** `api/src/routes/events.ts`, `api/src/app.ts`
    - **What breaks:** `payload` and `snapshot.data` accept arbitrary size and depth, and JSON is fully buffered before validation. A request can exceed Firestore’s 1 MiB document limit, consume substantial memory, or write huge event documents. `p.frozen` is only a TypeScript cast, so malformed objects reach storage.
    - **Concrete fix:** Add an HTTP body-size limit before `c.req.json()`, strict schemas for each event type, byte limits for payloads/snapshots, and `.strict()` object validation. Reject oversized events before writing any journal document.

13. **P1 — The spectator limit blocks normal party polling and is easy to bypass for abuse**

    - **File:** `api/src/auth.ts`
    - **What breaks:** All spectators share one token bucket capped at 20 requests/minute. Several spectators polling the ETag endpoint will immediately rate-limit each other. Conversely, invalid tokens each get a distinct bucket, allowing unlimited Firestore lookups; 50,000 unique keys clear every existing limit. Limits reset on instance restart and differ across Cloud Run instances.
    - **Concrete fix:** Use a shared rate limiter or edge policy. Apply an IP/device bucket before token lookup, retain a generous per-token aggregate limit for valid spectator links, and never clear all buckets as a memory-management strategy. Add tighter limits for purchase verification and invalid Firebase tokens.

14. **P1 — Retention can delete an active game and warning scans can starve**

    - **File:** `api/src/jobs/retention.ts`, `api/src/repo/firestore.ts`
    - **What breaks:** A game can receive activity after `listIdleBefore()` but before `deleteTree()`, causing active content to be deleted. Concurrent writes can then recreate only part of the tree. Warning queries repeatedly fetch at most 500 documents without a cursor or an un-warned predicate; already-warned documents can occupy the page indefinitely.
    - **Concrete fix:** Transactionally recheck `lastActivityAt` and mark the game with a deletion tombstone before recursive deletion; all writers must reject tombstoned games. Query warnings with deterministic ordering, eligibility fields, and cursor pagination.

15. **P2 — Core reads and exports are unbounded**

    - **File:** `api/src/repo/firestore.ts`, `api/src/routes/games.ts`, `api/src/service.ts`
    - **What breaks:** `listByHost`, `events.list`, `rounds.list`, and exports read entire collections. Finished games can accumulate without bound, and clients can create unlimited rounds using new IDs. Eventually ordinary game loads and exports exceed request time, memory, or response limits.
    - **Concrete fix:** Add cursor pagination and explicit limits to repository APIs, enforce a domain limit or uniqueness rule for rounds, and generate large exports asynchronously or stream them from a bounded query.

16. **P2 — Game creation and the active-game quota are non-atomic**

    - **File:** `api/src/routes/games.ts`
    - **What breaks:** Concurrent creates can both observe fewer than ten active games and exceed the quota. Tokens and questions are written before the game; a later failure leaves orphan token and subcollection documents.
    - **Concrete fix:** Maintain an active-game counter transactionally with game creation, or use a transaction over a per-user quota document. Commit the game, token documents, initial questions, and projection in a single Firestore batch after reserving the quota.

17. **P2 — Client-controlled IDs and timestamps can cause 500s and corrupt deadlines**

    - **File:** `api/src/routes/events.ts`, `api/src/routes/me.ts`, `api/src/repo/firestore.ts`
    - **What breaks:** Event and round IDs allow `/`, but are used as Firestore document IDs. Purchase tokens up to 2,000 characters are also used directly as document IDs, exceeding Firestore’s 1,500-byte limit or containing path separators. Event timestamps are arbitrary strings; invalid or future `finishedAt` values break fix-up windows, round ordering, and abandoned-round cleanup.
    - **Concrete fix:** Restrict journal IDs to UUID/base64url syntax, hash purchase tokens for document IDs, require safe integers for sequences, and validate RFC 3339 timestamps. Use server receipt time for retention and authorization deadlines, with only bounded client-time skew for display/order metadata.

18. **P2 — Disabled or revoked Firebase sessions remain authorized**

    - **File:** `api/src/auth.ts`
    - **What breaks:** `verifyIdToken(idToken)` does not check Firebase revocation or disabled-user state. A revoked host token remains usable until its normal expiry.
    - **Concrete fix:** Use `verifyIdToken(idToken, true)` where immediate revocation is required, or implement a cached revocation/session-version check and explicitly accept/document the bounded expiry window.
---

## What Claude did with this review (2026-09-16)

**Fixed** (each with a test):

| # | Finding | Fix |
|---|---|---|
| 2 | The lease did not restrict writes | Event upload now requires the uploading device to be the lease holder (`not_lease_holder`, 409). The client treats it like a stale epoch: read-only until the host takes over here. |
| 3 | Stale whole-document writes | The partner route, the token routes, the lease routes and the event route now merge only the fields they own (`repo.games.update`), so a partner page load can no longer overwrite a takeover, a token regeneration or a transition. `hostAuth` updates `lastSeenAt` the same way. |
| 5 | Purchases bound on a failed verification | An `unknown` verification of a new token is refused (`verification_unavailable`) instead of binding it. |
| 6 | Refunds acknowledged without revoking | A store failure during a notification returns 503, so Pub/Sub redelivers. |
| 7 | One revoked token revoking another purchase | The entitlement is now derived from every purchase bound to the user: premium stays active while any of them is active. |
| 9 | Invalid events silently acknowledged | `applyEvent` returns whether it applied; the response carries a `rejected` list and the journal document is written only after the event changed the game. |
| 10 | Finished games stayed mutable | Only fix-ups (inside the 24 h window) and snapshots apply to a finished game. |
| 11 | Fix-up to `unplayed` left the round numbered | Renumbering is now applied to the stored rounds; an unplayed round keeps its id (it is the idempotency key) but loses its number and leaves the projection. |
| 12 | Unbounded event and snapshot payloads | 64 KiB per event, 512 KiB per snapshot, 200 events per request, checked before anything is written. |
| 13 | Spectator rate limit too low, abusable | A caller bucket runs before the token lookup; the per-link budget now fits a room (600/min spectator, 120/min partner) and the memory guard sweeps stale buckets instead of clearing every limit. |
| 17 | Client ids and timestamps | Event and round ids must match `[A-Za-z0-9_-]{8,64}` / `{4,64}`, timestamps must be RFC 3339, `game.finish` uses the server's receipt time, and Firestore purchase documents are keyed by the hash of the purchase token. |
| 18 | Revoked sessions stayed valid | `verifyIdToken(idToken, true)`. |

**Accepted but deferred**, with the reason (they need Firestore transactions across the repository layer, which is
a larger change than this feature; the risk at the scale of one host device plus one partner per game is small):

- **1, 4, 16** full transactional application of the journal, of partner answers and of the active-game quota.
  Mitigated for now: the journal document is written only after the event applied, so a retry cannot skip an
  unapplied event; answers still use `baseRev`, which catches the realistic case of two partner tabs.
- **8** the frozen round is still reconciled against the current question. The client sends the complete frozen
  snapshot and the server prefers it for text and answer; making it fully authoritative needs immutable question
  revisions server-side.
- **14** retention tombstones and cursor pagination for the warning scan.
- **15** cursor pagination for host game lists, events, rounds and exports.

Recorded here rather than in the spec because they are implementation debt, not behaviour changes.
