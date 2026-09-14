# API contract: Bachelor Questionnaire (v1)

Base URL: `https://<cloud-run-service>/v1`. JSON in and out, UTF-8. All timestamps ISO-8601 UTC.
Every response carries `X-Request-Id`. Errors: `{ "error": { "code": string, "message": string, "details"?: object } }`
with HTTP 400 (validation), 401 (no/invalid auth), 403 (tier or role), 404 (unknown game/token, also used for
revoked tokens so probing learns nothing), 409 (conflict: revision, epoch, state), 410 (game deleted), 429 (rate
limit), 500.

## Authentication

| Role | Mechanism |
|---|---|
| Host | `Authorization: Bearer <Firebase ID token>`; the API verifies it with firebase-admin and uses `uid`. With `DEV_AUTH=1` (local only) `Bearer dev:<uid>` is accepted. |
| Partner | `X-Game-Token: <partner token>` (taken by the page from the URL fragment). |
| Spectator | `X-Game-Token: <spectator token>`. |
| Store notifications | Pub/Sub push with an OIDC token for the API's service account. |

Tokens are 32 random bytes, base64url; the API stores `sha256(token)` and the role. Rate limits: partner 60
writes/min per token, spectator 20 reads/min per token, host 300 requests/min per uid, unauthenticated 30/min
per IP; over the limit → 429 with `Retry-After`.

## Host endpoints

### `GET /me`
→ `{ uid, premium: { active, state: 'none'|'pending'|'active'|'revoked'|'unknown', since?, lastVerifiedAt? }, activeGames, limits: { activeGames: 10, questions: 100|20, hidden: 5 } }`

### `POST /me/purchases/verify`
Body `{ platform: 'play', productId, purchaseToken }` (iOS later: `{ platform: 'appstore', transactionId }`).
Verifies with the store, binds the token to `uid` (409 `purchase_bound_elsewhere` if bound to another uid),
records `purchases/{token}`, updates `users/{uid}.premium`. → same shape as `GET /me`.

### `POST /me/purchases/restore`
Body `{ platform, purchaseTokens: string[] }` → verifies each, → `GET /me` shape.

### `GET /games`
→ `{ games: [{ id, title, status, language, tier, counts, partner: { opened, answered, total, newUnanswered }, epoch, lastActivityAt, createdAt }] }`
(no finished games older than 30 days).

### `POST /games`
Body `{ language, title?, source: 'curated'|'blank' }` (`blank` needs premium). Copies the curated set for
`language` into `questions`. → `{ game, questions, tokens: { partner: { url }, spectator: { url } }, epoch }`
(plain tokens appear only here and in regenerate). 403 `active_game_limit` at 10.

### `GET /games/:id`
→ `{ game, questions: [{ id, text, theme, order, rev, source, hostAnswer?, hidden }], answers: { [qId]: { text, rev, updatedAt } }, rounds: [...], epoch, revision, serverTime }`.
Host only, must own the game.

### `PATCH /games/:id`
Body: any of `{ title, language (draft only, no answers, link not opened), settings, hiddenQuestionIds }`.
Tier rules enforced (403 `premium_required`). Body may include `ifRevision` → 409 `revision_mismatch`.

### `POST /games/:id/transition`
Body `{ to: 'awaiting_partner'|'in_progress'|'finished', allowPartial?: boolean, confirm?: true }`.
Rules from spec §4; 409 `invalid_transition`.

### `DELETE /games/:id`
Hard delete of the subtree, projection and token hashes. → 204.

### `GET /games/:id/export?omitGuests=true`
→ full JSON export (questions with revisions, answers, rounds, settings, events), `Content-Disposition: attachment`.

### Questions (premium for create/update/delete/reorder; hidden toggle is free)
- `POST /games/:id/questions` `{ text, theme?, afterId? }` → question (rev 1). 403 at 100.
- `PATCH /games/:id/questions/:qId` `{ text?, theme?, confirmInvalidate?: true }` → new rev when text changes; 409 `answer_would_be_invalidated` unless `confirmInvalidate`.
- `POST /games/:id/questions/reorder` `{ orderedIds: string[] }` → 204 (revisions unchanged).
- `DELETE /games/:id/questions/:qId` → 204 (played rounds keep their frozen copy).
- `PUT /games/:id/questions/:qId/host-answer` `{ text }` → 204 (FR-011; ignored for rounds already started).

### Rounds and events (host device journal upload)
`POST /games/:id/events`
Body `{ epoch, deviceId, events: [{ id, seq, type, at, payload }] }` where `type` ∈ `round.start | round.penalty |
round.reveal | round.mark | round.strikeBack | round.double | round.fixup | game.finish | snapshot`.
- 409 `stale_epoch` when `epoch` < current (payload kept client-side as divergent export).
- Idempotent by event `id`; already-known ids are acknowledged again.
- Applies rounds, updates `counts`, rewrites the spectator projection for marked/fixed rounds.
→ `{ acknowledged: string[], epoch, revision, partnerAnswers: { [qId]: { text, rev } } }` (the server piggybacks any new partner answers).

### Lease
- `POST /games/:id/lease` `{ deviceId, label }` → `{ epoch, holder: { deviceId, label, updatedAt }, lastSyncAt, isHolder }`.
- `POST /games/:id/lease/takeover` `{ deviceId, label, confirm: true }` → increments epoch → same shape. Online only by nature.

### Links
- `POST /games/:id/tokens/:role/regenerate` (`role` = partner|spectator) → `{ url, version }`; old hash deleted.
- `DELETE /games/:id/tokens/:role` → 204 (link revoked until regenerated).

### Snapshots
- `POST /games/:id/snapshots` `{ snapshot }` → 201 (keeps last 20, min 30 s apart → 429 otherwise).

## Partner endpoints (`X-Game-Token`)

### `GET /p/game`
→ `{ language, status, title?, questions: [{ id, rev, text, theme, order, isNew }], answers: { [qId]: { text, rev } }, lastLoadedAt }`.
Marks `partnerOpenedAt` on first call and updates the partner's last-load marker (defines "new").
Status `finished` → questions read-only. 404 for unknown/revoked, 410 after deletion.

### `PUT /p/answers/:qId`
Body `{ text, questionRev, baseRev }` → `{ rev, savedAt }`.
- 409 `question_changed` when `questionRev` is stale (page reloads the question).
- 409 `answer_conflict` with `{ current: { text, rev } }` when `baseRev` ≠ stored rev (two pages).
- 404 when the question was deleted.

### `POST /p/report`
Body `{ reason: string ≤ 500 }` → 204. Logged for Jacek; no automated action.

## Spectator endpoint (`X-Game-Token`)

### `GET /s/summary`
Headers: `If-None-Match` supported → 304. Response `ETag: "<projection revision>"`, `Cache-Control: no-store`.
→ `{ language, title?, status, score: { correct, wrong, played, total }, rounds: [{ n, question, result, penalty: { type, label }, doubled }], revision, updatedAt }`.
Only the projection document is serialised. 404 for unknown/revoked, 410 after deletion.

## Store notifications

### `POST /internal/play/rtdn`
Pub/Sub push (OIDC-verified). Decodes the Play notification; for `oneTimeProductNotification` re-verifies the
purchase token and updates `purchases/{token}` and `users/{uid}.premium` (refund → `revoked`). Always 204 to Pub/Sub
after recording; failures are retried by Pub/Sub.

## Internal jobs

### `POST /internal/jobs/retention`
Invoked by Cloud Scheduler (OIDC). Warns games idle for 83 days (flag read by the app), deletes at 90 days
(subtree, projection, token hashes). Returns counts.

## Headers on static pages (Firebase Hosting)
`partner.html`, `spectator.html`: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`,
`Content-Security-Policy: default-src 'self'; connect-src 'self' https://<api>; img-src 'self' data:`.
