# Data model: Bachelor Questionnaire

All server data lives in Firestore and is accessed only by the API (admin SDK; security rules deny clients).
Field types are given as TypeScript-ish. Timestamps are Firestore `Timestamp`; ids are random base62 (12 chars).

## Firestore

### `users/{uid}`
| Field | Type | Notes |
|---|---|---|
| uid | string | Firebase Auth uid (doc id) |
| premium | `{ state: 'none'|'pending'|'active'|'revoked'|'unknown'; platform?: 'play'|'appstore'; productId?: string; purchaseToken?: string; since?: Timestamp; lastVerifiedAt?: Timestamp; revokedAt?: Timestamp; revokeReason?: string }` | entitlement state machine (FR-036); `active` is derived as `state === 'active'` |
| locale | string | last device language, for notices |
| activeGames | number | maintained by API; limit 10 |
| createdAt, lastSeenAt | Timestamp | |

### `purchases/{purchaseToken}`
| Field | Type | Notes |
|---|---|---|
| uid | string | |
| platform | `'play'|'appstore'` | |
| productId | string | `premium_forever` |
| orderId | string | from the store |
| state | `'pending'|'active'|'revoked'|'unknown'` | updated by verify/restore and by Play RTDN; refund/chargeback → `revoked` → `users/{uid}.premium.state = 'revoked'` |
| boundAt | Timestamp | first binding to `uid`; never rebound to another uid automatically |
| raw | object | verification response (no PII) |
| verifiedAt | Timestamp | |

### `games/{gameId}`
| Field | Type | Notes |
|---|---|---|
| hostUid | string | owner |
| status | `'draft'|'awaiting_partner'|'ready'|'in_progress'|'finished'` | state machine below |
| language | `'en'|'de'|'es'|'pt'|'pl'` | changeable in draft only |
| title | string ≤ 60 | optional, host-only label ("Anna's hen night") |
| settings | `{ penaltyScheme: 'drink_or_dare'|'drink'|'dare'|'custom'; customPenalties: {label≤40, description≤200}[] ≤ 6; rules: { strikeBack: boolean; doubleOrNothing: boolean }; randomOrder: boolean }` | premium-only values rejected for free hosts |
| tier | `'free'|'premium'` | snapshot of the host's entitlement at creation; premium features unlock if host later buys |
| hiddenQuestionIds | string[] ≤ 5 | free tier hide list (FR-020) |
| tokens | `{ partner: { hash: string; version: number; revokedAt?: Timestamp }; spectator: {…} }` | sha256 of the plain token; plain token returned once |
| epoch | number | host lease epoch; takeover increments; uploads with a lower epoch → 409 |
| lease | `{ deviceId: string; label: string; updatedAt: Timestamp; lastSyncAt: Timestamp }` | current holder (informational; the epoch is the authority) |
| revision | number | bumped on every host mutation and partner answer; used for `ifRevision` and readiness hashing |
| partnerLastLoadedAt | Timestamp? | defines "new questions" for the partner (FR-013) |
| counts | `{ questions: number; answered: number; rounds: number; correct: number; wrong: number }` | denormalised for status/spectator |
| partnerOpenedAt, partnerLastAnswerAt | Timestamp? | status "not opened / in progress" |
| lastActivityAt | Timestamp | retention clock |
| retentionWarnedAt | Timestamp? | 7-day warning shown |
| createdAt, updatedAt, finishedAt | Timestamp | |

### `games/{gameId}/questions/{questionId}`
| Field | Type | Notes |
|---|---|---|
| text | string 1–300 | |
| theme | string ≤ 40 | optional category label |
| order | number | 10, 20, 30 … for cheap reorders (does not change `rev`) |
| rev | number | content revision; text edits bump it and invalidate the partner answer (after host confirmation) |
| source | `'curated'|'custom'` | curated ids are stable (`en-007`) |
| createdAt | Timestamp | with `partnerLastLoadedAt` decides "new" for the partner |
| hostAnswer | string ≤ 500? | manual answer by host (FR-011); used only while no partner answer for that `rev` exists |

### `games/{gameId}/answers/{questionId}`
| Field | Type | Notes |
|---|---|---|
| text | string ≤ 500 | blank allowed (flagged in UI) |
| rev | number | answer revision; `PUT` requires `baseRev` (two open partner pages → 409) |
| questionRev | number | the question revision this answer belongs to; a stale one means "invalidated" |
| updatedAt | Timestamp | |
Written only through the partner token. Never included in spectator responses.

### `games/{gameId}/rounds/{roundId}`
| Field | Type | Notes |
|---|---|---|
| n | number | 1-based display number |
| questionId | string | |
| frozen | `{ questionRev, text, answer: { text, source: 'partner'|'host' }, penaltyScheme, rules }` | snapshot taken at reveal (§7); immutable |
| epoch | number | host epoch the round was played in |
| penalty | `{ type: 'drink'|'dare'|'custom'|'none'; label: string ≤ 40; description: string ≤ 200 }` | |
| result | `'correct'|'wrong'|'unplayed'` | fix-up screen may set `unplayed` (round leaves the projection, question returns to the queue) |
| doubled | boolean | double or nothing |
| strikeBack | `{ guest: string ≤ 40 }[]` ≤ 2 | recipients when the rule is on; host-only |
| markedAt | Timestamp | device time, informational only |
| syncedAt | Timestamp | server |

### `games/{gameId}/events/{eventId}`
Accepted journal events (`type`, `seq`, `epoch`, `deviceId`, `at`, `payload`); the source of truth for rounds and
counts on the server, replayable. Ids are client-generated UUIDs → idempotent upload.

### `games/{gameId}/public/summary` (spectator projection)
| Field | Type | Notes |
|---|---|---|
| language, title, status | | |
| score | `{ correct, wrong, played, total }` | `total` = playable questions |
| rounds | `[{ n, question, result, penalty: { type, label }, doubled }]` ≤ 100 | only marked rounds; rewritten by the API on mark/fix-up |
| revision | number | ETag value |
| updatedAt | Timestamp | |
This document is the **only** thing the spectator endpoint serialises.

### `games/{gameId}/snapshots/{snapshotId}`
Full JSON export of the game (questions, answers, rounds, settings) written by the client after each round
while online (max one per 30 s) and by the retention job before deletion warnings. Keep the last 20.

### `tokens/{hash}`
| Field | Type | Notes |
|---|---|---|
| gameId | string | |
| role | `'partner'|'spectator'` | |
| version | number | must equal `games.tokens[role].version` |
| createdAt | Timestamp | |
Lookup index for partner/spectator requests; revocation deletes the doc and bumps the version. Doc id is the
sha256 of the plain token, so the token never appears in logs or queries.

### `curated/{language}` (optional cache)
Not needed at launch: curated sets ship inside the app (`web/curated/<lang>.json`) and are copied into a
game's `questions` at creation. Reserved for future over-the-air updates.

## Validation rules (enforced by the API with zod; mirrored in the client for instant feedback)
- Question text 1–300 chars; per game ≤ 100 (premium) / curated 20 (free) with ≤ 5 hidden.
- Answer ≤ 500 chars; penalty label ≤ 40, description ≤ 200; custom penalties ≤ 6.
- Host: ≤ 10 games not `finished`.
- Free hosts: no question create/update/delete/reorder; `settings.penaltyScheme` must be `drink_or_dare`; rules off.
- Rounds: `questionId` must exist and have an answer (partner or host) unless `result = 'unplayed'`.
- Partner writes accepted only while status ∈ {awaiting_partner, ready, in_progress}; `questionRev` and `baseRev` must match.
- Event uploads: `epoch` must equal the current epoch (409 otherwise); unknown event types rejected; a `round.mark` for a round not started is rejected.
- Entitlement: `pending` never unlocks; `revoked` disables premium mutations (403 `premium_revoked`) but never deletes content.

## State machine (`games.status`)
```
draft ──(host: send partner link)──► awaiting_partner ──(all answered)──► ready
ready ──(new unanswered question)──► awaiting_partner
awaiting_partner | ready ──(host: start; partial allowed)──► in_progress
in_progress ──(host: finish)──► finished            (finished is terminal; partner link read-only)
any ──(host: delete)──► deleted (hard delete of the game subtree + tokens)
```
`draft` is skipped when the host copies the partner link immediately after creation.

## IndexedDB (host device), database `bq`, version 1
| Store | Key | Content |
|---|---|---|
| games | gameId | local snapshot: game doc, questions[], answers{}, rounds[], `epoch`, `revision`, `lastServerSync`, `readiness: { hash, at }` |
| events | `[gameId, seq]` | append-only journal: `{ id (uuid), gameId, seq, epoch, type, at, payload, acked: boolean }` |
| outbox | autoincrement | pending non-event mutations: `{ gameId, op: 'game.patch'|'question.*'|'snapshot'|'game.delete', payload, createdAt }` |
| divergent | autoincrement | events rejected with `stale_epoch`, kept for a recoverable export |
| meta | key | `deviceId`, `deviceLabel`, `adUse` (`{ activeSeconds, lastInterstitialAt }`), `consent`, `entitlement` (cached `GET /me` + `fetchedAt`), `lastLanguage`, `schemaVersion` |

Every UI action = one IndexedDB transaction that appends the event and updates the snapshot; the screen advances
only after `oncomplete`. Readiness = `sha256(appBuild + revision + language + rulesJson)` matches the stored
readiness hash **and** the check list in spec §7 passed; otherwise "Needs refresh" (still playable) or a failure.
