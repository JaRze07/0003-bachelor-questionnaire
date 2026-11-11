# Data model: Bachelor Questionnaire

Revised 2026-11-11 against `api/src/repo/types.ts` and `api/src/repo/sqlite.ts`.

All server data lives in **one SQLite file** (`/data/bachelor.db` in the container, WAL mode) and is reached only
through the API's repository interface. The store is a document store on purpose: one table
`docs (kind, parent, id, data)` with `data` as JSON, where `parent` is the game id for everything that belongs to a
game and empty otherwise. Expression indexes cover the lookups that are not by key (games by host, games by last
activity, purchases by account, tokens by game, sessions by expiry). The paths below (`games/{gameId}/rounds/{id}`)
name `kind`, `parent` and `id`; they are the shapes the code reads and writes, and the in-memory repository used in
tests has the same interface.

Field types are given as TypeScript-ish. Timestamps are ISO-8601 UTC strings; game and question ids are random
base62 (12 chars).

One request = one transaction. There is a single writer connection and an in-process queue in front of it; reads
outside a transaction use a second, read-only connection and therefore see committed data only.

## Server documents

### `sessions/{sha256(token)}`
| Field | Type | Notes |
|---|---|---|
| uid | string | the account the session belongs to |
| provider | `'google'|'apple'|'dev'` | only `google` is issued today |
| createdAt, expiresAt | string | 30 days; refused and removed after `expiresAt`; deleted on sign-out; swept every 6 hours |
The bearer token itself is never stored, so a copy of the database holds no usable credential.

### `users/{uid}`
| Field | Type | Notes |
|---|---|---|
| uid | string | account id (doc id): `g:<Google subject>`; in development whatever follows `dev:` |
| premium | `{ state: 'none'|'pending'|'active'|'revoked'|'unknown'; platform?: 'play'|'appstore'; productId?: string; purchaseToken?: string; since?: string; lastVerifiedAt?: string; revokedAt?: string; revokeReason?: string }` | entitlement state machine (FR-036); `active` is derived as `state === 'active'` |
| locale | string? | reserved; not written today |
| createdAt, lastSeenAt | string | `lastSeenAt` is refreshed at most once a minute |
The number of active games (limit 10) is counted from the games on each request, not stored.

### `purchases/{purchaseToken}`
| Field | Type | Notes |
|---|---|---|
| uid | string | |
| platform | `'play'|'appstore'` | |
| productId | string | `premium_forever` |
| orderId | string | from the store |
| state | `'pending'|'active'|'revoked'|'unknown'` | updated by verify/restore (and by a Play notification, once those are delivered); refund/chargeback → `revoked`. The user's `premium` stays `active` while any other purchase of theirs is active |
| boundAt | string | first binding to `uid`; never rebound to another uid automatically |
| raw | object | verification response (no PII) |
| verifiedAt | string | |

### `games/{gameId}`
| Field | Type | Notes |
|---|---|---|
| hostUid | string | owner |
| status | `'draft'|'awaiting_partner'|'ready'|'in_progress'|'finished'` | state machine below |
| language | `'en'|'de'|'es'|'pt'|'pl'` | changeable in draft only |
| title | string ≤ 60 | optional label ("Anna's hen night"); shown to the host and on the guest page |
| settings | `{ penaltyScheme: 'drink_or_dare'|'drink'|'dare'|'custom'; customPenalties: {label≤40, description≤200}[] ≤ 6; rules: { strikeBack: boolean; doubleOrNothing: boolean }; randomOrder: boolean }` | premium-only values rejected for free hosts |
| tier | `'free'|'premium'` | snapshot of the host's entitlement at creation; premium features unlock if host later buys |
| hiddenQuestionIds | string[] | hide list; at most 5 for a free host (FR-020) |
| tokens | `{ partner: { hash: string; version: number; revokedAt?: string }; spectator: {…} }` | sha256 of the plain token; plain token returned once |
| epoch | number | host lease epoch; takeover increments; uploads with a lower epoch → 409 |
| lease | `{ deviceId: string; label: string; updatedAt: string; lastSyncAt: string }` | current holder; an upload from another device is refused (`not_lease_holder`) even with the right epoch |
| revision | number | bumped on every host mutation and partner answer; used for `ifRevision` and readiness hashing |
| partnerLastLoadedAt | string? | defines "new questions" for the partner (FR-013) |
| counts | `{ questions: number; answered: number; rounds: number; correct: number; wrong: number }` | denormalised for status/spectator |
| partnerOpenedAt, partnerLastAnswerAt | string? | status "not opened / in progress" |
| lastActivityAt | string | retention clock |
| retentionWarnedAt | string? | when the 7-day warning was given; it counts only while `lastActivityAt` is older |
| createdAt, updatedAt, finishedAt | string | |

### `games/{gameId}/questions/{questionId}`
| Field | Type | Notes |
|---|---|---|
| text | string 1–300 | |
| theme | string ≤ 40 | optional category label |
| order | number | 10, 20, 30 … for cheap reorders (does not change `rev`) |
| rev | number | content revision; text edits bump it and invalidate the partner answer (after host confirmation) |
| source | `'curated'|'custom'` | curated ids are stable (`en-007`) |
| createdAt | string | with `partnerLastLoadedAt` decides "new" for the partner |
| hostAnswer | string ≤ 500? | manual answer by host (FR-011); used only while no partner answer for that `rev` exists |

### `games/{gameId}/answers/{questionId}`
| Field | Type | Notes |
|---|---|---|
| text | string ≤ 500 | blank allowed (flagged in UI) |
| rev | number | answer revision; `PUT` requires `baseRev` (two open partner pages → 409) |
| questionRev | number | the question revision this answer belongs to; a stale one means "invalidated" |
| updatedAt | string | |
Written only through the partner token. Never included in spectator responses.

### `games/{gameId}/rounds/{roundId}`
| Field | Type | Notes |
|---|---|---|
| n | number | 1-based display number |
| questionId | string | |
| frozen | `{ questionRev, text, theme?, answer: { text, source: 'partner'|'host'|'none' }, penaltyScheme, rules }` | snapshot taken when the round starts (§7); immutable. Text and answer come from the host's device when they fit the limits, else from the server |
| epoch | number | host epoch the round was played in |
| penalty | `{ type: 'drink'|'dare'|'custom'|'none'; label: string ≤ 40; description: string ≤ 200 }` | |
| result | `'correct'|'wrong'|'unplayed'` | `unplayed` while the round is on the table; the fix-up screen may set it back to `unplayed`, which also sets `voided` |
| voided | boolean | a round fixed back to unplayed: it leaves the projection and its question returns to the queue |
| startedAt | string | device time of `round.start`; orders the rounds |
| revealedAt | string? | server time of `round.reveal`; from then on guests see the answer of the round on the table |
| doubled | boolean | double or nothing |
| strikeBack | `{ guest: string ≤ 40 }[]` ≤ 2 | recipients when the rule is on; shown on the guest page as "taken by" (002 FR-103) |
| markedAt | string | device time, informational only |
| syncedAt | string | server |

### `games/{gameId}/events/{eventId}`
Accepted journal events (`type`, `seq`, `epoch`, `deviceId`, `at`, `payload`); the source of truth for rounds and
counts on the server, replayable. Ids are client-generated UUIDs → idempotent upload.

### `games/{gameId}/projections/summary` (guest projection)
| Field | Type | Notes |
|---|---|---|
| language, title, status | | |
| score | `{ correct, wrong, played, total }` | `total` = playable questions |
| live | `{ n, question, theme?, penalty: { type, label, description }, doubled, answerRevealed, answer? } | null` | the newest started, unmarked, non-voided round; `answer` only once `revealedAt` is set; `null` when nothing is on the table or the game is finished |
| rounds | `[{ n, question, theme?, answer, result, penalty: { type, label, description }, doubled, takenBy: string[] }]` ≤ 100 | marked rounds only |
| revision | number | ETag value |
| updatedAt | string | |
Rebuilt by the API after every change to the game (`service.ts` → `domain/projection.ts`). Rounds of hidden
questions and voided rounds are left out. This document is the **only** thing the guest endpoint serialises.

### `games/{gameId}/snapshots/{snapshotId}`
The payload of an uploaded `snapshot` event, last 20 per game. The API accepts and stores them, but the app does
not send any and nothing reads them back; the safety net in practice is the nightly database backup.

### `tokens/{hash}`
| Field | Type | Notes |
|---|---|---|
| gameId | string | |
| role | `'partner'|'spectator'` | |
| version | number | must equal `games.tokens[role].version` |
| createdAt | string | |
Lookup index for partner/spectator requests; revoking or replacing a link deletes the doc (replacing also bumps the version). Doc id is the
sha256 of the plain token, so the token never appears in logs or queries.

### `curated/{language}` (optional cache)
Not needed at launch: curated sets ship inside the app (`web/curated/<lang>.json`) and are copied into a
game's `questions` at creation. Reserved for future over-the-air updates.

## Validation rules (enforced by the API with zod; mirrored in the client for instant feedback)
- Question text 1–300 chars; per game ≤ 100 (premium) / curated 20 (free) with ≤ 5 hidden.
- Answer ≤ 500 chars; penalty label ≤ 40, description ≤ 200; custom penalties ≤ 6.
- Host: ≤ 10 games not `finished`.
- Free hosts: no question create/update/delete/reorder; `settings.penaltyScheme` must be `drink_or_dare`; rules off.
- Rounds: `questionId` must exist and must not be hidden. The server does not insist on an answer; the app only offers questions that have one.
- Partner writes accepted only while status ∈ {awaiting_partner, ready, in_progress}; `questionRev` and `baseRev` must match.
- Event uploads: `epoch` must equal the current epoch and the device must hold the lease (409 otherwise); unknown event types are a validation error; an event that cannot be applied (a `round.mark` for a round not started, gameplay after finish) comes back in `rejected`.
- Request bodies over 2 MiB are refused (413); an event payload over 64 KiB is rejected.
- Entitlement: `pending` never unlocks; `revoked` disables premium mutations (403 `premium_revoked`) but never deletes content.

## State machine (`games.status`)
```
draft ──(host: send partner link)──► awaiting_partner ──(all answered)──► ready
ready ──(new unanswered question)──► awaiting_partner
awaiting_partner | ready ──(host: start; partial allowed)──► in_progress
in_progress ──(host: finish)──► finished            (finished is terminal; partner link read-only)
any ──(host: delete)──► deleted (hard delete of the game subtree + tokens)
```
`draft` exists in the type but is never stored: creating a game issues both links, so a game starts in `awaiting_partner`.

## IndexedDB (host device), database `bq`, version 1
| Store | Key | Content |
|---|---|---|
| games | gameId | local snapshot: `game` (server document), `questions[]`, `answers{}`, `rounds[]`, `deviceId`, `localSeq`, `epoch`, `revision`, `readOnly`, `lastServerSync`, `links` (partner and guest URLs, as given at creation), `readiness: { hash, at }` |
| events | `id` (uuid); index `byGameSeq` on `[gameId, seq]` | append-only journal: `{ id, gameId, seq, epoch, type, at, payload, acked: 0|1 }`; acknowledged events stay |
| outbox | autoincrement `key` | non-event requests queued while offline: `{ gameId, op: { method, path }, payload, createdAt }`. Used today for an offline game deletion only |
| divergent | autoincrement `key` | events the server rejected or refused after a takeover: `{ gameId, event, storedAt }` |
| meta | key | `session` (our session token and its expiry), `deviceId`, `deviceLabel`, `adUse` (`{ activeSeconds, lastInterstitialAt }`), `consent`, `entitlement` (cached `GET /me` + `cachedAt`; cleared on sign-out), `devPurchase` (development stub) |

The session token and the party links live in this database in plain form: they are as protected as the browser
profile or the app's storage. Offline, the home screen lists only the games whose `game.hostUid` is the signed-in account.

Every UI action = one IndexedDB transaction that appends the event and updates the snapshot; the screen advances
only after `oncomplete`. Readiness = a sha256 over the app build, the game revision, language, settings, question
revisions and answer revisions matches the hash stored by the last successful check; otherwise "Needs refresh"
(still playable). The check itself is described in spec §7 with its as-built note.
