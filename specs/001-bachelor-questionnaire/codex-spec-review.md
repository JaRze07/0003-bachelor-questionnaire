## Critical gaps and ambiguities

### Roles, ownership, and recovery

- “No account” conflicts with premium being unlocked “per device/account.” A device-only purchase can be lost after clearing browser data, changing phones, or reinstalling the PWA.
- There is no recovery flow if the host loses or replaces their phone. The host needs either a recovery code, magic-link email, or explicit warning that the game is unrecoverable.
- “Multiple simultaneous hosts” is out of scope, but leaked or duplicated host links can still create two writers. Define whether the server rejects a second host session, uses optimistic concurrency, or accepts last-write-wins.
- The spectator link’s contents are unspecified. Showing partner answers before their round would spoil the game. Define what becomes visible and when.
- Define whether host, partner, and spectator links can be revoked or regenerated independently.

### Partner scenarios

- There is no fallback when the partner never submits, submits only some answers, or loses the link.
- Specify whether every answer is required, whether blank answers are valid, maximum lengths, and whether progress is saved locally, server-side, or both.
- “One by one (or as a list)” is an unresolved UX decision.
- Define what “re-open” does: preserve answers, clear them, permit partial editing, and notify the host on resubmission.
- The host needs submission status beyond “answers received”: not opened, in progress, submitted, reopened, and updated.
- Starting with missing answers needs an explicit policy: block play, allow unanswered questions to be skipped, or let the host enter answers manually.

### Offline and device failure

“Works offline once answers have been loaded” needs acceptance criteria. Specify that:

- The PWA shell, questionnaire, answers, and current state are cached before departure.
- The host sees a clear “Ready for offline play” indicator after a successful cache/storage check.
- Playing, editing results, finishing, and exporting work without connectivity.
- Spectator updates and partner submission do not work offline and are clearly marked unavailable.
- Locally recorded rounds are uploaded after reconnection without overwriting newer server state.

Browser storage can be evicted. Consider automatic downloadable backup and periodic server snapshots, while retaining local state as the party-time source of truth.

### Security, privacy, and retention

A random game ID alone is not authorization. Use separate high-entropy tokens with narrowly scoped permissions. Store token hashes server-side, prevent tokens appearing in analytics/referrer logs, rate-limit requests, and allow revocation.

The spec should also define:

- Whether spectator access exposes question text, answers, penalties, names, and timestamps.
- Whether spectators can view a finished game indefinitely.
- Retention measured from creation, last activity, or completion.
- What happens to drafts and abandoned partner submissions.
- Immediate host deletion and export-before-deletion.
- Separation of payment records from game-content retention.
- Prohibition or moderation strategy for abusive custom questions and penalties.
- Privacy/consent language, especially for ads, analytics, alcohol-related content, and potentially underage users.

## Free/premium inconsistencies

- FR-006 says every baseline feature survives, including editing/add/delete questions. FR-020 says free questions are used “as-is,” while FR-031 reserves editing for premium. These cannot all be true.
- FR-033 implies only premium hosts may send the form “when finished,” although sending a partner form is essential to free play.
- Free hosts can enter free-text penalties every round, so premium “custom options” may feel like charging only for reusable labels. Explain the actual convenience benefit.
- “Unlimited questions” needs technical limits for payload size, abuse, storage, and form usability. Use a generous stated limit rather than unlimited.
- A €1 payment may be uneconomic after payment fees, VAT, refunds, and support. Decide whether it unlocks one game, the browser, or the purchaser permanently.
- Banner advertising at this scale may earn little while adding consent, privacy, layout, and ad-blocker complexity. A simpler free tier with a premium prompt may be less frustrating.
- Localisation cannot remain open if the curated set must be usable by launch users; define launch language and fallback behavior.

## Server-side alternatives

Do not use GitHub commits as an application database. They expose operational coupling, poor concurrency, repository growth, token risk, rate limits, and slow propagation.

The simplest sensible design is:

- Static PWA on Pages.
- Cloudflare Worker API.
- D1 for games, questions, submissions, and optional result snapshots.
- Local IndexedDB as the authoritative party-time state.
- Server-sent events, polling, or a Durable Object only for optional live spectators.

KV is acceptable for immutable questionnaires or coarse snapshots, but its eventual consistency is awkward for submission status and live scores. Supabase or Firebase is also reasonable if managed authentication/storage is preferred, but introduces another vendor SDK and pricing model. For an MVP, omit live spectator sync entirely and provide a host-generated summary/QR after the game.

## Prioritised changes

1. **Resolve the entitlement model.** Proposed wording: “Premium unlocks all future games for the purchaser. Purchase restoration uses email magic-link authentication. Hosts may play without an account, but purchasing requires one.” If accounts are unwanted, sell premium per game and issue a recovery code.

2. **Resolve the editing contradiction.** Change FR-006 to preserve only gameplay behavior. Proposed wording: “Baseline editing behavior is retained where allowed by the selected tier.” State explicitly that free hosts may preview but not modify the curated questions—or permit limited deletions to avoid unsuitable questions.

3. **Add host recovery.** “On game creation, display a recovery code once and allow download of an encrypted backup. A recovered game invalidates the previous host session.”

4. **Define incomplete-partner handling.** “The host may start with partial answers; unanswered questions are excluded by default. The host may manually supply missing answers or resend/reopen the form.”

5. **Specify token security and leakage response.** Add scoped host, partner, and spectator tokens; revocation/regeneration; hashed storage; rate limits; no token logging; and spectator answer embargo until each round is completed.

6. **Define concurrency.** “Only one active host lease is permitted. A second device opens read-only unless it explicitly takes over; takeover invalidates the first lease.”

7. **Make offline readiness testable.** Add a pre-party readiness check and define reconnect conflict behavior. Use IndexedDB rather than relying solely on `localStorage`.

8. **Define lifecycle and retention.** “Delete game content 90 days after last activity, warn seven days before deletion where contact information exists, and support immediate deletion. Payment records follow statutory retention separately.”

9. **Simplify launch scope.** Remove ads and live spectators from P1; validate creation, partner submission, offline play, recovery, and export first. Add them only after measuring demand.

10. **Replace ‘unlimited.’** Use a practical limit such as 100 questions, 2,000 characters per answer, and 200 characters per penalty label, with documented server payload limits.

11. **Add payment failure scenarios.** Cover cancellation, duplicate charges, refund, purchase restoration, unsupported countries/currencies, and premium availability while offline.

12. **Remove unresolved rules from committed scope.** Keep “strike back” out of FR-034 until its behavior, scoring effect, and UI are fully defined.