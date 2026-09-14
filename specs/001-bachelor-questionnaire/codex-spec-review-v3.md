# 1. Missing requirements and ambiguities

## Roles and authority

The role table does not fully define ownership or bearer-link behavior.

Missing points:

- Whether a game can have exactly one host account and whether ownership can be transferred.
- Whether anyone possessing a partner token can overwrite answers.
- What happens when the partner link is open on two browsers.
- Whether regenerating a link immediately invalidates already-open sessions.
- Whether optional guest names from “Strike back” are uploaded, exported, or visible to spectators.
- Whether the host may impersonate the partner through the partner link.

Proposed wording:

> **Game ownership and link authority.** Each game has exactly one owning app-account ID. Ownership is not transferable in v1. Partner and spectator links are bearer credentials: anyone holding a valid link receives that link’s scoped access. Regenerating a link invalidates the previous token on its next API request and prevents further writes or reads from already-open pages. The host cannot retrieve either token after generation, only copy it at generation time or replace it.

> **Concurrent partner sessions.** Partner answers use per-question revisions. If two partner pages edit the same answer, the API accepts only a write based on the current revision; the rejected page must reload and explicitly choose which value to keep. Silent last-write-wins is forbidden.

> **Guest labels.** Strike-back recipients are optional nicknames, not identities. They are never shown on the spectator page. The export must disclose that it contains them and allow the host to omit them.

## Lifecycle

The diagram and prose do not define several important transitions:

- Adding or editing a question after “ready.”
- What “finished” means and whether it can be undone.
- Whether fix-up remains available after finishing.
- Whether finished games count toward the ten-active-game limit.
- Which activity resets the 90-day retention clock.
- What happens locally when deletion is requested offline.
- What happens to an in-progress game when premium is refunded.

Proposed wording:

> **Lifecycle transitions.** `draft → awaiting_partner → ready → in_progress → finished` is monotonic except that an unfinished game may move between `awaiting_partner` and `ready` as answer completeness changes. Adding an unanswered question does not move an `in_progress` game backward; it adds an unanswered future question. “Finish game” requires confirmation and is irreversible in v1. Fix-up is allowed before finishing and for 24 hours afterward, without reopening gameplay.

> **Active-game limit.** Draft, awaiting-partner, ready and in-progress games count toward the ten-game limit. Finished games do not.

> **Retention activity.** Only authenticated host mutations and partner answer writes update `lastActivityAt`. Spectator reads, polling, failed requests and token probes do not extend retention.

> **Offline deletion.** An offline deletion request immediately removes the local playable copy and is queued for the server. The UI must say that server deletion is pending until acknowledged. On acknowledgement, all server content and link-token hashes are deleted and both links return a generic unavailable response.

Whether an offline deletion should remove the only local copy before server acknowledgement is a product decision; if recoverability is preferred, mark it inaccessible and cryptographically erase it after acknowledgement instead.

## Partner “new questions” flow

“New” is not defined, and edits create harder cases than additions:

- Is a question new because it is unanswered or because it was added since the partner’s last visit?
- Does changing question text invalidate an existing answer?
- What happens if the partner is typing while the host edits or deletes the question?
- Does reordering make questions appear new?
- Which answer wins when the host supplies one and the partner later responds?
- A host who adds a question while offline cannot make it appear on the web link until sync.

Proposed wording:

> **Question revisions.** Every question has a stable ID and content revision. Reordering does not change its revision. Changing its text creates a new revision and invalidates the previous partner answer after host confirmation. Deleting a question immediately removes it from the partner form; an in-progress edit receives a conflict response and is not attached to another question.

> **Meaning of new.** “New questions” means unanswered question revisions created since the partner last successfully loaded the form. The partner page opens on those revisions first. The progress total always refers to the current, non-deleted revisions.

> **Host-supplied answers.** A host-supplied answer and a partner answer have separate provenance. A later partner answer never silently replaces an answer already downloaded for a round. For an unplayed question, the host is shown both versions and explicitly selects the round answer.

> **Offline additions.** A question added by an offline host is local-only until the app reconnects. The app must not claim that the partner can see it until the server acknowledges publication.

“Saved on every change” should also be made implementable:

> Partner input is saved after a short debounce and on blur/navigation. The page distinguishes **Saving**, **Saved**, and **Offline—not saved to the game**. “Done” is enabled only when all writes have been acknowledged or the user confirms leaving with unsaved changes.

## Spectator page

The spectator contract needs an explicit server-side projection. Merely hiding fields in the page is insufficient.

Proposed wording:

> **Spectator projection.** The spectator endpoint is backed by a dedicated summary representation containing only game language, aggregate score, marked-round question text, result, public penalty label and publication revision. Partner answers, host notes, guest nicknames, unmarked rounds and deleted questions must never be serialized by this endpoint.

Also specify:

> Corrections made through fix-up publish a new spectator-summary revision. A spectator must see the corrected result on its next successful poll.

> The page polls every eight seconds while visible, pauses while backgrounded, sends an entity version/ETag, and displays stale status after two failed poll intervals or 20 seconds without a successful response. After game deletion or token revocation it clears previously rendered game data before showing “Link no longer available.”

The link also needs leakage controls:

> Partner and spectator pages use `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, no third-party scripts, and tokens in URL fragments or another mechanism that prevents them from appearing in ordinary server access logs.

The last point must be reconciled with whichever static-page routing design is chosen.

## Offline model and conflict rules

“Server never overwrites newer local state” is not precise enough. There is no global definition of “newer,” and wall-clock timestamps are unsafe.

The readiness check also lacks a pass contract. It should verify at least:

- App shell and exact build version.
- Current questions and selected answer revisions.
- Penalty configuration and extra-rule logic.
- Message catalogue for the game language.
- Writable IndexedDB and a read-back test.
- No unresolved partner-answer or question conflicts.
- Sufficient active host authority for offline use.
- A simulated reload from cached state.

Proposed wording:

> **Local event journal.** Gameplay is recorded as an append-only local event journal with a monotonically increasing local sequence and periodic local snapshots. Completing a user action and advancing the UI occur only after the event transaction commits to IndexedDB. Round IDs and action IDs are unique, making uploads idempotent.

> **Sync authority.** Server revisions, host-lease epochs and per-entity revisions determine conflicts; device clocks do not. The server acknowledges uploaded action IDs. It may add remote partner-answer events, but it must never replace accepted gameplay events from the current lease epoch.

> **Round immutability.** When a round starts, it snapshots the question revision, selected answer, penalty configuration and applicable rule toggles. Remote edits or answers arriving later affect only rounds not yet started.

> **Readiness validity.** Readiness applies to a specific game revision and app build. It becomes “needs refresh” after a question, answer, language, rule or application-version change, but the previously cached game remains playable with its last ready snapshot.

The specification promises “refresh recovery,” but the host is a Capacitor app rather than a browser page. Replace it with:

> The app must recover after WebView reload, process termination, OS restart and normal application upgrade. A failed upgrade must not erase the last compatible game snapshot.

“Automatic downloadable backup after each round” is ambiguous and likely to create downloads, permission prompts, duplicate files, and sensitive artifacts. It also conflicts with the otherwise clean local/server model.

Proposed replacement:

> The app maintains a local snapshot after each round and uploads an encrypted/authenticated server snapshot opportunistically while online. A user-initiated **Export backup** action creates a downloadable file; automatic downloads are not performed.

## Host lease and two-device behavior

The lease model currently promises more than an offline system can guarantee. An old phone that is offline cannot learn that another phone took over. Both devices can therefore continue locally.

Proposed wording:

> **Host lease epoch.** The server issues one current host-lease epoch per game. Explicit takeover increments the epoch. The previous device becomes read-only when it next contacts the server; its later uploads from the old epoch are rejected and retained locally as a recoverable divergent export, never merged automatically.

> **Offline limitation.** A ready device may continue offline using its cached epoch. Consequently, physical simultaneous play cannot be prevented while a previous device remains offline. The takeover confirmation must warn about this. Only events from the current server epoch are accepted into the canonical server game.

> **Takeover safety.** Before takeover, the new device shows the last server-sync time and warns that unsynced rounds on the former device may be absent. Takeover requires online connectivity.

SC-005 should say the first phone drops to read-only **when online or on its next reconnect**.

## Entitlement synchronization

“Store account,” “Firebase app account,” and “same account” are treated as interchangeable, but they are not:

- Google sign-in can use a different Google account from the active Play Store purchaser.
- Apple and Google do not expose a universal shared store identity.
- A store purchase must be bound to a Firebase UID without allowing receipt reuse across arbitrary accounts.
- Cross-platform entitlement is not defined.
- Family sharing, account unlinking, reinstall, and authentication-provider changes are omitted.

Proposed wording:

> **Account model.** The host account is a Firebase UID authenticated with Google on Android or Apple on iOS. The purchasing store account is separate and may not match the chosen Firebase identity. A validated purchase token/original transaction ID is bound idempotently to the authenticated Firebase UID at purchase or restore time. The UI must not claim that Firebase sign-in proves ownership of the store account.

> **Entitlement scope.** Restoration is guaranteed on devices using the same store ecosystem and purchasing store account. Cross-store Android-to-iOS entitlement portability is [supported through the bound Firebase UID / not supported in v1]. This choice must be explicit before implementation.

> **Binding protection.** A purchase already bound to another Firebase UID cannot be rebound automatically. The app shows a recovery path without revealing the other account. Product IDs, purchase tokens and original transaction IDs are unique and processed idempotently.

If cross-platform mirroring is intended, account-linking behavior between Google and Apple credentials must be specified, including collision and lost-access recovery.

## Refunds and purchase states

FR-036 lists cases but does not state behavior. “Refund revoked on next sync” could mean the app never learns about a refund unless manually restored.

Proposed wording:

> **Entitlement states.** The server stores `pending`, `active`, `revoked` and `unknown` states with the store, product ID, original transaction ID, validation time and revocation reason. Pending purchases do not unlock premium. Duplicate callbacks are idempotent and never create another entitlement.

> **Store synchronization.** Google real-time developer notifications and App Store server notifications update entitlements server-side. The app refreshes entitlement on sign-in, foregrounding while online, purchase completion, restore, and before a premium mutation when the cached status is stale.

> **Refund behavior.** A refund or chargeback marks the server entitlement revoked. On the app’s next successful entitlement sync, new premium creation and editing are disabled and ads return. Existing locally ready games remain playable and exportable so a party is not destroyed; their premium configuration becomes read-only. No questions or results are deleted because of a refund.

> **Offline purchase.** Purchases cannot complete offline. The app records no synthetic transaction and shows “Connect to complete purchase”; it retries product loading when online only after a user action.

Also define cancellation as dismissal with no entitlement change, unsupported countries as an unavailable product rather than an application error, and restoration as validation rather than trust in a client flag.

# 2. Edge cases likely to break at a party

## Offline

- A readiness check passes, then the host changes a question, language, answer, or rule while offline. The badge may remain misleadingly green.
- IndexedDB writes can fail because of storage pressure, WebView corruption, or quota. Gameplay must stop before the UI advances, not after a round appears completed.
- An app update may change the IndexedDB schema immediately before the party.
- Sign-in or entitlement tokens may expire while offline. A ready game must not become unplayable merely because authentication cannot refresh.
- Ads and UMP must fail closed without blocking home, scoreboard, readiness, or gameplay.
- Partner additions made by the offline host cannot reach the partner page.
- A queued server deletion, refund, or link revocation cannot be observed offline.

Add:

> A successfully ready game remains playable offline without refreshing authentication, entitlement, consent, ad, lease or API tokens. Network-dependent actions are visibly unavailable, while core play, fix-up, scoreboard and export continue.

## Two devices

- The old phone may play several rounds offline after the new phone takes over.
- The new phone may start from an old server snapshot because the old phone has unsynced work.
- Both devices may produce the same next-round position if queue state is represented only as a mutable counter.
- A user may accidentally take over merely by opening the game.
- Rejected old-epoch events need a recovery/export path rather than silent loss.

Takeover must be an explicit confirmed mutation, never an automatic consequence of signing in.

## Partner answers arriving mid-game

- An answer can arrive while its question is currently displayed.
- The partner may revise an answer after the player has answered aloud but before the host reveals it.
- A host-entered fallback and partner answer can conflict.
- Random-order queues may already include or exclude the question.
- The spectator must not receive an unmarked question due to the update.

The round snapshot rule should freeze the answer no later than **Reveal question**. Later answers should be offered only for future unstarted rounds.

## Questions added or edited mid-game

- A new answered question could unexpectedly enter the middle of a randomized queue.
- Changing text after the partner answered may pair a new question with an old answer.
- Deleting the current or already-played question could corrupt history.
- Hitting the 100-question limit is ambiguous if deleted questions remain in history.
- A question added online by one host while the active playing device is offline creates divergent content.

Add:

> Added questions never enter the active queue automatically. Once answered and synced, the host explicitly chooses **Add to remaining rounds**; insertion is at the end unless the host explicitly reshuffles only the unplayed queue. Played and current round snapshots are immutable. The limit counts current non-deleted questions, while historical round snapshots remain retained.

## Language mismatch

- Device language is not necessarily the partner’s language.
- A game-language change after answers exist may replace the curated set with non-equivalent localized questions.
- Custom questions have no automatic translation.
- Partner and spectator pages may use browser-language UI while the question is in another language unless precedence is defined.
- Localized curated sets are culturally equivalent collections, not necessarily stable one-to-one revisions.

Proposed wording:

> Game language controls question content and all game-specific UI on host, partner and spectator surfaces. Browser or device language is used only before a game is loaded and for an optional “View controls in my language” selector. Question text remains in the game language.

> Changing game language is permitted only in draft before the partner link is opened and before any answer exists. It replaces the curated bank after confirmation. Custom questions are not translated automatically in v1.

# 3. Simpler alternatives

These retain every decided feature.

1. **Use one local event journal plus one server summary**, rather than mutable game state, periodic snapshots, and automatic downloaded backups as separate mechanisms. Derive the scoreboard and spectator projection from the accepted events.

2. **Remove automatic file downloads.** Keep transactional local snapshots, opportunistic server backup, and one explicit export action.

3. **Freeze a round when it starts.** Snapshot its question, answer, rules and penalty. This eliminates most mid-round races without removing late partner answers or mid-game additions.

4. **Make mid-game additions opt-in to the remaining queue.** Publishing a question, receiving its answer, and adding it to play should be three visible states. This preserves the feature without silently changing a random order.

5. **Use one static web bundle with partner and spectator routes**, sharing catalogues, styling and token handling. Each route still calls a separately scoped API projection; do not ship host-only or partner-answer data to the spectator client.

6. **Use ordinary conditional polling with ETags.** There is no need for Firestore listeners, WebSockets, push notifications, or another live-sync service for an eight-second spectator target.

7. **Replace heartbeat-style lease complexity with a server epoch.** Takeover increments the epoch and stale uploads are rejected. This is easier to test and honestly represents the offline limitation.

8. **Implement purchases behind a tiny internal entitlement interface.** Android can use the selected direct purchase plugin first; StoreKit support can implement the same interface later. The server remains the only authority.

9. **Use store server notifications plus validation-on-demand.** Avoid a separate scheduled reconciliation service initially; provide an administrative/manual reconciliation procedure for notification outages.

10. **Do not dynamically swap curated banks after creation.** Copy the selected localized set into the game once. This makes exports, partner answers, revisions and offline readiness deterministic.

11. **Publish a dedicated spectator document/projection.** This is safer and simpler than filtering a full game object in every request.

12. **Treat readiness as a versioned snapshot, not a permanent game flag.** One hash of the app build plus playable game revision can determine whether the badge is current.

# 4. Assumptions A1–A5

## A1 Hosting

Change it from an assumption to a settled constraint. The constitution already mandates the Google Cloud project, Cloud Run, Firestore, Firebase Authentication and Firebase Hosting.

Proposed replacement:

> **D1 Platform:** The constitution fixes Firebase Hosting, Firebase Authentication, Firestore and one Cloud Run API in project `jr07-0003-bachelor-questionnaire`. Pending operational confirmations are project availability, deployment region, budget alert values and kill-switch procedure; the stack itself is not open.

## A2 Mobile wrapper

Also change this from an assumption to a settled constraint. Capacitor, Android-first and iOS-second are already constitutional choices. Only delivery prerequisites remain uncertain.

Proposed replacement:

> **D2 Mobile delivery:** Capacitor is fixed. Android ships first. iOS implementation may proceed, but public release is blocked until the Apple developer account and an approved macOS build/signing environment exist.

## A3 Purchases plumbing

Keep this open, but resolve it before planning purchase tasks. I would choose direct store integration to preserve the one-vendor architecture, provided a maintained pinned plugin is explicitly approved.

Proposed wording:

> **Decision required — purchase integration:**  
> **Option A:** one pinned Capacitor purchase plugin, Google Play Developer API, App Store Server API, and store server notifications, with entitlement authority in Cloud Run.  
> **Option B:** RevenueCat for SDK, receipt verification and restore. This adds a processor/vendor and requires an explicit constitutional dependency approval.  
> Default recommendation: Option A, implemented Android-first behind an internal entitlement interface.

The decision should include the exact plugin, maintenance status, pinned version, notification path and privacy/data-processing impact.

## A4 Interstitial format

Change it to a settled requirement and remove “video” as a guaranteed creative type unless that is intentionally required. A standard AdMob interstitial may supply static or video creative.

Proposed replacement:

> **D4 Interstitials:** Use non-rewarded AdMob interstitials; creative format may be static or video. Frequency is at most one impression per 60 minutes of active foreground use, persisted across app restarts, and only at the natural breaks listed in FR-021.

Define active use:

> Active use counts elapsed foreground time while the host is interacting with the app; background time and partner/spectator use do not count.

## A5 Required host sign-in

Change it from an assumption to a settled constitutional requirement. Add the offline boundary.

Proposed replacement:

> **D5 Host authentication:** Online sign-in is required to create, restore, delete or take over a game. No guest mode exists. Once a game passes readiness, temporary inability to refresh authentication must not prevent offline gameplay, fix-up, scoreboard or export. Partner and spectators never sign in.

# 5. Prioritised changes

1. **Define the host lease epoch and unavoidable offline split-brain behavior**, including rejected stale uploads, takeover warnings, and recovery export.

2. **Specify the transactional local event journal and versioned readiness contract**, including IndexedDB failure behavior, schema upgrades and authentication-independent offline play.

3. **Define entitlement identity and scope**, distinguishing the Firebase UID from the Play/App Store purchaser and deciding whether cross-store portability exists.

4. **Replace FR-036’s list with state-machine behavior for pending, restore, duplicate, refund and offline purchase**, including server notifications and preservation of already-ready games.

5. **Freeze question and answer revisions at round start**, preventing partner edits or remote changes from altering an active or completed round.

6. **Fully define the late-question workflow**: stable IDs, revision invalidation, “new” semantics, offline publication, partner conflicts and explicit addition to the remaining queue.

7. **Define a dedicated spectator projection and token-safe delivery**, including correction revisions, revocation, cache clearing, logging and referrer controls.

8. **Complete lifecycle transition rules**, especially partial readiness, finish irreversibility, fix-up, active-game counting, deletion and retention activity.

9. **Replace automatic per-round downloads with local snapshots, opportunistic server sync and user-initiated export.**

10. **Resolve language-change and display precedence**, particularly after links are opened or answers exist and for untranslated custom questions.

11. **Convert A1, A2, A4 and A5 from assumptions into settled decisions**, leaving only operational prerequisites pending; resolve A3 before implementation planning.

12. **Add explicit constitutional acceptance requirements**:

> Every behavioral implementation commit updates `spec.md`, `STATUS.md` and `README.md`; API and pure game-logic tests cover sync, lease, queue, scoring, refunds and rule combinations; the baseline manual checklist and Codex read-only diff review pass before release.