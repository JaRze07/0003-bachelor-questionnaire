# API contract: Bachelor Questionnaire (v1)

Base URL: `https://bachelor.91-98-25-205.sslip.io/v1` (the same origin serves the pages; `http://localhost:8080/v1`
in development). JSON in and out, UTF-8. All timestamps ISO-8601 UTC strings.
Every response carries `X-Request-Id`. Errors: `{ "error": { "code": string, "message": string, "details"?: object } }`
with HTTP 400 (validation), 401 (no/invalid session), 403 (tier or role), 404 (unknown game/token, also used for
revoked tokens so probing learns nothing), 409 (conflict: revision, epoch, state), 410 (game deleted), 413 (body over
2 MiB, `payload_too_large`), 429 (rate limit, with `Retry-After`), 500.

Every mutating request runs as one database transaction: all of its writes land or none. The body is read in full
before the transaction starts. Revised 2026-11-11 against `api/src/routes/`.

## Authentication

| Role | Mechanism |
|---|---|
| Host | `Authorization: Bearer <session token>`. The token comes from `POST /auth/google` and is valid 30 days; the API stores only its sha256. With `DEV_AUTH=1` (local only; the server refuses to start with it when `NODE_ENV=production`) `Bearer dev:<uid>` is accepted. |
| Partner | `X-Game-Token: <partner token>` (taken by the page from the URL fragment). |
| Spectator | `X-Game-Token: <spectator token>`. |
| Store notifications | a Google OIDC token for the service account in `INTERNAL_SA_EMAIL`, audience `INTERNAL_AUDIENCE`. Neither is set on the box, so `/internal/*` answers 401 there. |

Link tokens are 32 random bytes, base64url; the API stores `sha256(token)` and the role. Rate limits, per minute, in
memory: host 300 requests per account; partner link 120; guest link 3000 (a room of 100 guests polling every 2.5 s);
requests **without a working link** 240 per address; sign-in 20 per address. Good partner and guest requests are not
counted per address, because a party shares one. Over the limit → 429 with `Retry-After`.

### `POST /auth/google`
Body `{ idToken }` (a Google ID token issued to one of the client ids in `GOOGLE_CLIENT_IDS`).
→ `{ token, uid: 'g:<Google subject>', name, expiresAt }`. 401 `invalid_google_token`; 401 `google_not_configured`
while no client id is set. The account is created on first sign-in.

### `POST /auth/signout`
Deletes the session named in `Authorization`. → 204, always.

## Host endpoints

### `GET /me`
→ `{ uid, premium: { active, state: 'none'|'pending'|'active'|'revoked'|'unknown', since?, lastVerifiedAt? }, activeGames, limits: { activeGames: 10, questions: 100|20, hidden: 5 } }`

### `POST /me/purchases/verify`
Body `{ platform: 'play'|'appstore', productId, purchaseToken }` (only Play is verified today; `productId` must be
`premium_forever`, else 409 `unknown_product`).
Verifies with the store, binds the token to `uid` (409 `purchase_bound_elsewhere` if bound to another uid),
records the purchase, updates the user's `premium`. → same shape as `GET /me`. 409 `verification_unavailable` when
the store could not be asked: nothing is bound and the app may try again.

### `POST /me/purchases/restore`
Body `{ platform, purchaseTokens: string[] }` (at most 20) → verifies each, skipping the ones that fail → `GET /me` shape.

### `GET /games`
→ `{ games: [{ id, title, status, language, tier, counts, epoch, partner: { opened, answered, total, newUnanswered }, lastActivityAt, createdAt, updatedAt, retentionWarnedAt? }] }`
(no finished games older than 30 days; newest first; `retentionWarnedAt` only while the game has stayed idle since the warning). Not paginated.

### `POST /games`
Body `{ language, title?, source: 'curated'|'blank' }` (`blank` needs premium). Copies the curated set for
`language` into `questions`. → 201 `{ game, questions, tokens: { partner: { url }, spectator: { url } }, epoch }`
(plain tokens appear only here and in regenerate; the URLs are `WEB_BASE/partner.html#t=…` and `…/spectator.html#t=…`).
403 `active_game_limit` at 10.

### `GET /games/:id`
→ `{ game, questions: [{ id, text, theme, order, rev, source, createdAt, hostAnswer? }], answers: { [qId]: { text, rev, questionRev, updatedAt } }, rounds: [...], epoch, revision, serverTime }`.
Hidden questions are listed in `game.hiddenQuestionIds`. Host only, must own the game; anyone else gets 404 `game_not_found`.

### `PATCH /games/:id`
Body: any of `{ title, language (not started, no answers, link not opened; else 409 `language_locked`), settings, hiddenQuestionIds }`.
Tier rules enforced (403 `premium_required`, `premium_revoked`, `hidden_limit`). Body may include `ifRevision` → 409 `revision_mismatch`. → `{ game }`.

### `POST /games/:id/transition`
Body `{ to: 'awaiting_partner'|'in_progress'|'finished', allowPartial?: boolean, confirm?: true }`.
Rules from spec §4; 409 `invalid_transition`; starting needs at least one answer (409 `no_answers`) and, with
unanswered questions left, `allowPartial` (409 `partial_answers`); finishing needs `confirm` (400 `confirm_required`). → `{ game }`.

### `DELETE /games/:id`
Hard delete of the subtree, projection and token hashes. → 204.

### `GET /games/:id/export?omitGuests=true`
→ full JSON export (questions with revisions, answers, rounds, settings, events), `Content-Disposition: attachment`.

### Questions (premium for create/update/delete/reorder; hidden toggle is free)
- `POST /games/:id/questions` `{ text, theme?, afterId? }` → 201 `{ question }` (rev 1). 403 `question_limit` at 100; 409 `game_finished`.
- `PATCH /games/:id/questions/:qId` `{ text?, theme?, confirmInvalidate?: true }` → `{ question }`, new rev when text changes; 409 `answer_would_be_invalidated` unless `confirmInvalidate`.
- `POST /games/:id/questions/reorder` `{ orderedIds: string[] }` → 204 (revisions unchanged).
- `DELETE /games/:id/questions/:qId` → 204 (played rounds keep their frozen copy).
- `PUT /games/:id/questions/:qId/host-answer` `{ text }` → 204 (FR-011; ignored for rounds already started). Free and premium.

### Rounds and events (host device journal upload)
`POST /games/:id/events`
Body `{ epoch, deviceId, events: [{ id, seq, type, at, payload }] }` where `type` ∈ `round.start | round.penalty |
round.reveal | round.mark | round.strikeBack | round.double | round.fixup | game.finish | snapshot`.
At most 200 events per request; ids and round ids are `[A-Za-z0-9_-]`, 8 to 64 characters (rounds: 4 to 64).
- 409 `stale_epoch` when `epoch` is not the current one, 409 `not_lease_holder` when another device holds the game
  (both: the app parks the events as divergent and goes read-only until it takes over).
- Idempotent by event `id`; already-known ids are acknowledged again.
- Applies rounds, updates `counts`, rewrites the guest projection. `round.start` may carry `payload.frozen`
  `{ text, answer: { text, source } }`, the question and answer as the device froze them offline; each is kept if it
  fits the question (300) and answer (500) limits, otherwise the server's copy is used.
- An event that cannot be applied (unknown round, finished game, rule off) or whose payload is over 64 KiB (512 KiB
  for `snapshot`) is not stored and comes back in `rejected`.
- `snapshot` events are stored apart (last 20 per game). Nothing reads them back yet and the app does not send them.
→ `{ acknowledged: string[], rejected: [{ id, reason: 'too_large'|'not_applicable' }], epoch, revision, partnerAnswers: { [qId]: { text, rev, questionRev } } }` (the server piggybacks the partner's answers).

### Lease
- `POST /games/:id/lease` `{ deviceId, label }` → `{ epoch, holder: { deviceId, label, updatedAt }, lastSyncAt, isHolder }`.
- `POST /games/:id/lease/takeover` `{ deviceId, label, confirm: true }` → increments epoch → same shape (400 `confirm_required` without `confirm`). Online only by nature.

### Links
- `POST /games/:id/tokens/:role/regenerate` (`role` = partner|spectator) → `{ url, version }`; old hash deleted.
- `DELETE /games/:id/tokens/:role` → 204 (link revoked until regenerated).

## Partner endpoints (`X-Game-Token`)

### `GET /p/game`
→ `{ language, status, title?, readOnly, questions: [{ id, rev, text, theme, order, isNew }], answers: { [qId]: { text, rev, questionRev } }, lastLoadedAt }`.
Hidden questions and host-supplied answers are never included.
Marks `partnerOpenedAt` on first call and updates the partner's last-load marker (defines "new").
Status `finished` → `readOnly: true`. 404 `link_unavailable` for an unknown, replaced or revoked link (the game's documents go with a deleted game, so its links answer 404 too).

### `PUT /p/answers/:qId`
Body `{ text, questionRev, baseRev }` → `{ rev, savedAt }`.
- 409 `question_changed` when `questionRev` is stale (page reloads the question).
- 409 `answer_conflict` with `{ current: { text, rev } }` when `baseRev` ≠ stored rev (two pages).
- 404 `question_not_found` when the question was deleted or hidden; 409 `game_closed` once the game is finished.

### `POST /p/report`
Body `{ reason: string ≤ 500 }` → 204. Written to the container log (`jr07 app logs bachelor`); no automated action.

## Spectator endpoint (`X-Game-Token`)

### `GET /s/summary`
Headers: `If-None-Match` supported → 304. Response `ETag: "<projection revision>"`, `Cache-Control: no-store`.
→ `{ language, title?, status, score: { correct, wrong, played, total }, live, rounds, revision, updatedAt }` where
- `live` is the round on the table or `null`: `{ n, question, theme?, penalty: { type, label, description }, doubled, answerRevealed, answer? }`.
  `answer` is present only when `answerRevealed` is true, that is after the organiser's `round.reveal` event.
- `rounds` are the last 100 marked rounds: `[{ n, question, theme?, answer, result, penalty: { type, label, description }, doubled, takenBy: string[] }]`.

Only the projection document is serialised (spec 002 FR-106). 404 for an unknown, replaced or revoked link and after
the game is deleted. Polling does not count as activity for retention.

## Store notifications

### `POST /internal/play/rtdn`
A Google Play real-time developer notification delivered as a Pub/Sub push (OIDC-verified, see Authentication).
For `oneTimeProductNotification` and `voidedPurchaseNotification` it re-verifies the purchase token and updates the
purchase and the owner's `premium` (refund → `revoked`). 204 once recorded; 503 `retry_later` when the store could
not be asked, so the sender delivers again. **Not in use:** no subscription exists and the box has no Pub/Sub.

## Housekeeping (no endpoint)

A timer in the API process runs 60 s after start and then every 6 hours: games idle for 83 days are flagged (the app
shows a badge), games idle for 90 days are deleted with everything that belongs to them, expired sessions are
dropped. Every 24 hours the database is backed up online to `/data/backups` (14 kept).

## Pages and their headers

The same server answers `/` (host app), `/partner.html`, `/spectator.html`, their assets, `/config.js` (runtime
settings from the environment: Google client id, ad unit ids) and `/healthz`.
All pages: `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` (production),
`Content-Security-Policy: default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https://*.googleusercontent.com; frame-ancestors 'none'`.
`partner.html`, `spectator.html`: also `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`; other files `Cache-Control: no-cache`.
