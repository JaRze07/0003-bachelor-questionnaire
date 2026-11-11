# Feature Specification: Bachelor Questionnaire

**Feature branch**: `001-bachelor-questionnaire`
**Created**: 2026-09-13 · **Revised**: 2026-09-14 (v3.1: Codex critique v3 merged, see §15)
**Status**: Implemented: v1 merged to `main` on 2026-09-16, live on the JR07 box since 2026-09-24. Product decisions settled (§11, §12); operational prerequisites for Jacek are in `STATUS.md`
**Amended by**: `specs/002-hetzner-live-web/spec.md` (2026-09-19): own server instead of Google Cloud, the host app also in a browser, the live guest view, Google sign-in exchanged for our own session. The passages it changed (§3, §5.5, FR-014, §8, §9, D1, D5) were rewritten here on 2026-11-11 to say what runs today; where the code does less than this spec asks, the paragraph ends with an *As built* note
**Input**: Jacek's product direction (2026-09-13), Codex critiques (`codex-spec-review.md`, `codex-spec-review-v3.md`), Jacek's answers via the dashboard (2026-09-14), rules research (§10)

---

## 1. Summary

A party game for bachelor and bachelorette parties. Before the party the **partner** answers a set of
questions about themselves through a private web link (no app needed). At the party the **host** runs the
game from the **mobile app** (or, since 002, any browser): asks the **player** (the guest of honour) the same
questions, reveals the partner's answer, and a wrong answer costs a drink or a dare. Guests follow the game live on
a **guest link** (called the spectator link in this spec): the question on the table, the dare, the partner's answer
once the host reveals it, and the score.

The repo today holds a hand-built web version for one party. This spec turns it into a product on the
app stores: a **free tier** with curated question sets in five languages and light ads, and a one-off
**premium** purchase (about €1, in-app) for custom questions, penalty schemes and extra rules.

---

## 2. Baseline: the one-party app (retired 2026-09-16)

The hand-built game for one party was the starting point. Its gameplay is preserved in the new host app; its
plumbing (GitHub Pages, the Cloudflare Worker writing `results.json`, the single-file build) is gone, together
with the original party's names, questions and seed rounds. The table below is kept as the record of what had
to survive the rewrite.

| Area | Current behaviour |
|---|---|
| Hosting | Static HTML/CSS/JS on GitHub Pages, no backend needed at party time |
| Question bank | 39 questions with the partner's answers in one JSON file (5 answers missing) |
| Host flow | Next question → Drink or Dare + description → reveal question → reveal answer (hidden by default, re-hideable) → Correct / Wrong → on Wrong the penalty fills the screen until Done |
| Persistence | Every step in `localStorage`; refresh resumes mid-round |
| Editing | In-app editor (question, theme, answer), add/delete, JSON export |
| Fix-up screen | Unplayed / Correct / Wrong switch per question |
| Random order | Optional, decided once per round |
| Scoreboard | Tally, round table, filter, JSON export |
| Live sync (optional) | Cloudflare Worker with a personal GitHub token commits `results.json`; ~8 s polling; spectators read-only; party key for writes |
| Single-file build | One offline HTML file |

Weaknesses removed: hardcoded names, questions and seed rounds; the partner could not enter answers; the GitHub
repo was used as a database (token risk, rate limits, slow propagation, last-write-wins); the Cloudflare Worker
was deployed by hand without a reproducible login.

---

## 3. Roles and surfaces

| Role | Surface | Account | Sees | Can do |
|---|---|---|---|---|
| **Host** (organiser) | Android app **or the web app at the site root** (iOS when an Apple developer account exists) | yes: Google sign-in (Sign in with Apple with iOS) | everything | create games, edit (tier permitting), send links, run and score rounds, fix results, export, delete, buy premium (in the app) |
| **Partner** | web link on their phone | none | only the questions and their own answers | answer, save progress, answer questions added later |
| **Player** | none | none | nothing | answers aloud |
| **Spectator** (guest) | web link | none | the round on the table, the partner's answer once revealed, dares, score and the rounds played | nothing |

The host account is the anchor for premium (§6.3) and for running the same game from a replacement phone.
Partner and spectator surfaces are plain web pages served by the same server as the API; they never require an
install.

**Ownership and link authority.** Each game has exactly one owning host account; ownership is not transferable
in v1. Partner and spectator links are bearer credentials: whoever holds a valid link gets that link's scoped
access. Regenerating a link invalidates the previous token on its next request, including pages already open.
The host sees a token only at generation time and can only copy it then or replace it. The host may open the
partner link like anyone else; there is no separate "impersonate" feature.

---

## 4. Game lifecycle

```
draft ──► awaiting partner ──► ready ──► in progress ──► finished ──► (deleted after retention)
  │            ▲   │                          ▲
  └── host edits questions (tier permitting) ─┘   host may add questions at any time before "finished";
                                                  the partner link shows the new ones as "n new questions"
```

- **Draft**: only a transient state. Creating a game already issues both links, so a new game opens directly in *awaiting partner*; the host picks the language (default: device language, §6.5) and gets the curated set (premium: curated or blank), **copied into the game once** and never swapped afterwards.
- **Awaiting partner**: partner link sent. Host sees status: *not opened · in progress (n/N) · complete · n new unanswered*.
- **Ready**: all current questions answered, or host chose to start with partial answers (§6.1 FR-011).
- **In progress**: rounds are played; state is local-first (§7). Questions added now go to the partner link as well; a round can only use a question that has an answer (or a host-supplied one).
- **Finished**: scoreboard, export, share summary; the partner link becomes read-only ("the game has been played").

**Transition rules.** The path draft → awaiting partner → ready → in progress → finished is monotonic, except
that an unfinished game moves between *awaiting partner* and *ready* as answer completeness changes. Adding an
unanswered question to an *in progress* game does not move it backwards; it adds a future question. **Finish**
requires confirmation and is irreversible in v1. The fix-up screen is available before finishing and for 24 hours
afterwards, without reopening play. Draft, awaiting-partner, ready and in-progress games count toward the
10-game limit; finished games do not. Only host mutations and partner answer writes reset the retention clock;
spectator polling, failed requests and token probes do not.

**Deletion.** Online: the game subtree, its spectator projection and its token hashes are removed and both links
return a generic "link no longer available". Offline: the local playable copy is removed at once, the server
deletion is queued, and the UI says "deletion pending" until acknowledged.

There is no separate "submit" step for the partner: every answer is saved shortly after it is typed (debounce
and on blur); the form stays open until the game is finished. "Complete" means every current question has a
non-blank answer.

---

## 5. User scenarios

### 5.1 Free host runs a party (P1)
1. Installs the app, signs in with the store account, taps **New game**. Gets the curated set in the device language (20 questions).
2. Copies the **partner link**, sends it. Later sees "complete 20/20".
3. Runs the **readiness check** before leaving (§7): "Ready for offline play".
4. At the party plays the rounds exactly as today. Shares the **spectator link** with the table. Scoreboard at the end, export or share summary.
5. A banner ad sits at the bottom of the home and scoreboard screens; at most one video interstitial per 60 minutes of use, only between games or after the scoreboard (§6.2).

### 5.2 Premium host customises (P2)
1. Buys **Premium** in the app (store purchase, about €1, one-off, tied to the store + app account; restorable).
2. Edits the curated set or starts blank: add, edit, reorder, delete; up to **100 questions**.
3. Sets the **penalty scheme**: drink or dare (default), drink only, dare only, or a custom list of up to 6 options
   (label ≤ 40 chars, optional description ≤ 200 chars).
4. Turns on extra rules (§10): **strike back**, **double or nothing**.
5. Adds three more questions the night before; the partner opens the same link and sees "3 new questions".

### 5.3 Partner answers (P1)
- Opens the link on a phone, no account, no install. Sees a progress bar and one question at a time with a *list view* toggle, in the game's language.
- Answers are free text, ≤ 500 chars, saved server-side after a short debounce and on blur; blank answers allowed but flagged. The page shows **Saving · Saved · Offline, not saved** per answer; **Done** is enabled only when every write is acknowledged (or the partner confirms leaving with unsaved changes).
- **Done** shows a confirmation ("nothing else is visible to you; you can come back if new questions are added").
- If questions were added later, the link opens on the new ones first (see FR-013 for what "new" means).
- Two open partner pages editing the same answer: the second write is rejected with the current value; that page reloads and the partner picks which to keep. No silent last-write-wins.

### 5.4 Host changes phone (P2)
- Signs in on the new phone (online); games and premium follow the account. The game opens read-only with the last server sync time and a **Take over** button. Taking over is an explicit, confirmed action, never a side effect of signing in; the confirmation warns that rounds not yet synced from the old phone will be missing and that an old phone still offline can keep playing locally until it reconnects (§7 lease epoch).

### 5.5 Spectators (P1)
Replaced by 002 §3 (live guest view). What runs:
- The link shows the **round on the table** as soon as the host starts it (number, theme, question, penalty, doubled flag), the partner's answer **only from the moment the host reveals it** on their own screen or marks the round, the score, and every marked round with question, answer, result, penalty, doubled flag and the nickname of a guest who took a strike back. **Never an answer of a question not played yet, the current answer before the reveal, hidden questions or anything about the host's account.**
- Read-only, polls every 2.5 s while the page is visible (paused in the background), sends an ETag, shows when it was last updated and a stale notice after 15 s without a successful response. Fix-up corrections appear on the next poll. After deletion or revocation the page clears what it showed and says "link no longer available".

---

## 6. Functional requirements

### 6.1 Core (both tiers)
- **FR-001** Host signs in with the store account (Google on Android, Apple on iOS). Partner and spectator use links without accounts. A game has a random id; **authorisation is by scoped tokens** for partner and spectator and by the host's account for the host (§8).
- **FR-002** Curated banks of 20 generic questions ship with the app in **English, German, Spanish, Portuguese and Polish** (§6.5), usable by any couple.
- **FR-003** Host can generate, **revoke and regenerate** partner and spectator links independently.
- **FR-004** Partner view exposes only questions and the partner's own answers.
- **FR-005** Partner answers are stored server-side; the host app pulls them, no manual typing.
- **FR-006** Gameplay behaviour of the baseline is preserved: hide/re-hide answer, Correct/Wrong, penalty screen,
  random order, fix-up screen, scoreboard, export, refresh recovery. *Editing* is governed by tier (FR-020, FR-031).
- **FR-007** Default penalty scheme is drink or dare with a free-text description (≤ 200 chars) per round.
- **FR-008** The game works **offline** at the party (§7) and recovers from a refresh or app restart.
- **FR-009** Results export as JSON and as a shareable text/image summary.
- **FR-010** No names, questions or seed rounds from the original party remain in code, data or docs.
- **FR-011** Host sees partner status (not opened / in progress n/N / complete / n new unanswered) and may start with
  partial answers; unanswered questions are excluded by default or answered manually by the host. A host-supplied
  answer is used only while no partner answer exists; when the partner later answers, the partner's answer replaces
  it for rounds not yet started and the host is told. Rounds already started keep the answer they were revealed with.
- **FR-012** Host may delete a game immediately; export is offered first.
- **FR-013** Questions have a stable id and a content **revision**. Reordering keeps the revision; editing the text
  creates a new revision and, after the host confirms, invalidates the partner's previous answer; deleting removes
  the question from the partner form at once (an in-flight partner edit gets a conflict, not a re-attach). "New
  questions" on the partner link are unanswered revisions created since the partner last loaded the form; the link
  opens on them first. A question added by an offline host is local-only, marked "not yet visible to partner", until
  the server acknowledges it. Answered new questions are appended to the end of the unplayed queue with a notice
  ("3 new questions added to the queue"); with random order on they simply join the unplayed pool. The 100-question
  limit counts current, non-deleted questions; played rounds keep their own frozen copy.
- **FR-014** (as amended by 002 FR-101 to FR-106) Spectator link served from a **dedicated projection** the API
  maintains: language, title, status, score, the round on the table (its answer only once revealed), and the last
  100 marked rounds with question, answer, result, penalty, doubled flag and strike-back nicknames, plus a revision.
  Answers of questions not played, the current answer before the reveal, voided rounds, hidden questions and the
  host's account are never part of that projection (§5.5, §8).
- **FR-015** Game language controls question content and all game-specific text on host, partner and spectator
  surfaces. The device language is used only for the host app before a game is loaded (home, sign-in, settings).
  Game language can be changed until the partner opens the link, as long as no answer
  exists and the game has not started; the change replaces the curated bank after confirmation. Custom questions are not translated automatically.

### 6.2 Free tier
- **FR-020** Free hosts use the curated set; they may **preview** it and **hide up to 5** unsuitable questions,
  but not edit text, add or reorder.
- **FR-021** Ads ship from day one and are **light and never disruptive**:
  - banner on the home and scoreboard screens only;
  - one non-rewarded **interstitial** (static or video creative) at most once per **60 minutes of active use** (foreground time with the host interacting; background time and partner/spectator use do not count; the counter persists across restarts), shown only at a natural break (after the scoreboard is closed or before a new game starts), never between "reveal question" and "penalty done";
  - never on the partner or spectator web pages; never audio-only; no rewarded-ad gates on core play;
  - consent via a Google-certified consent platform (UMP) for EEA/UK users and the App Tracking Transparency prompt on iOS; ads still show (non-personalised) when consent is declined;
  - ads and consent **fail closed**: any SDK error leaves an empty slot and never blocks home, scoreboard, readiness or play.
- **FR-022** Ad network: **Google AdMob** (only network that serves both stores natively; mediation can be added later). Ad unit ids live in config, not in code paths that differ per tier.

### 6.3 Premium tier
- **FR-030** One-off **non-consumable in-app purchase** (Play Billing / StoreKit), target price tier about €1, unlocks premium **forever**. The host account (our account id, `g:<Google subject>`) and the purchasing store account are different identities: a validated purchase token is bound idempotently to the signed-in host account at purchase or restore time; a token already bound to another host account is not rebound automatically (the app shows a recovery hint without revealing the other account). Restore is guaranteed on devices with the same store ecosystem and store account; cross-store portability (Android ↔ iOS) is **not supported in v1**. The UI never claims that app sign-in proves ownership of the store account.
- **FR-031** Create, edit, reorder, delete questions, up to 100 per game.
- **FR-032** Penalty schemes: drink or dare, drink only, dare only, custom options (≤ 6).
- **FR-033** Add questions at any time before "finished"; the partner answers them through the existing link (FR-013).
- **FR-034** Extra rules as opt-in toggles: **strike back** and **double or nothing**, mechanics in §10. Strike-back guest names are nicknames; since 002 (FR-103) the guest page shows who took the penalty. The export says it contains them and can omit them (`?omitGuests=true`). *As built:* the app has no switch for that parameter yet.
- **FR-035** No ads.
- **FR-036** Entitlement is a server-side state machine: `pending → active → revoked` (plus `unknown` when verification fails), keyed by store, product id and purchase token / original transaction id, processed idempotently (duplicate callbacks never create a second entitlement). Pending purchases do not unlock premium. Google real-time developer notifications (and App Store server notifications later) update the state server-side; the app refreshes entitlement on sign-in, on foregrounding while online, after purchase or restore, and before a premium mutation when its cached state is older than 24 h. **Refund or chargeback** → revoked: on the next successful sync, premium creation and editing are disabled and ads return; games already ready stay playable and exportable with their premium configuration read-only; nothing is deleted. **Cancel** = dismissal, no change. **Unsupported country** = product unavailable, not an error. **Offline** = "connect to complete the purchase"; no synthetic transaction is recorded; product loading retries only on a user action. *As built:* the app refreshes the entitlement at start/sign-in and after a purchase or restore, not on foregrounding or by the 24 h rule; the notification route exists (`POST /v1/internal/play/rtdn`) but nothing delivers to it on the box, so a refund is noticed only when the purchase is verified again; and no Play credential is configured yet, so verification answers "the store could not confirm this yet" (STATUS Pending).

### 6.4 Limits
| Item | Limit |
|---|---|
| Questions per game | 100 (premium), 20 curated (free, up to 5 hidden) |
| Question text | 300 chars |
| Partner answer | 500 chars |
| Penalty label / description | 40 / 200 chars |
| Custom penalty options | 6 |
| Active games per host account | 10 |
| Spectator page | shows the last 100 rounds |

### 6.5 Languages
- Launch languages: **en, de, es, pt, pl**. The curated set exists in each language as a native-quality set (not a word-for-word translation: cultural references such as food, holidays and sports are localised).
- Translations are produced with Codex (read-only, token-heavy work) from the English master with the context of each question (what a good answer looks like, tone: cheeky but not crude), then reviewed by Claude and stored in `web/curated/<lang>.json` (question bank) and `web/i18n/<lang>.json` (UI strings).
- UI strings live in one message catalogue per language; missing keys fall back to English and are logged.
- Game language defaults to the device language if supported, else English; the host can change it in draft.

---

## 7. Offline and state model

- **Local event journal.** Gameplay on the host device is an append-only journal of events (round started, penalty chosen, answer revealed, marked correct/wrong, strike back, doubled, fix-up, finished) with a monotonic local sequence, plus periodic local snapshots, in **IndexedDB**. The UI advances only after the event transaction commits; a failed write stops the action with an explicit error instead of showing a completed round. Event and round ids are unique, so uploads are idempotent.
- **Rounds are frozen at reveal.** When the host reveals a question, the round snapshots the question revision, the answer to be shown, the penalty configuration and the active rule toggles. Partner answers or edits arriving later affect only rounds not yet started.
- **Sync authority.** Conflicts are decided by server revisions, the host **lease epoch** and per-entity revisions, never by device clocks. The server acknowledges uploaded event ids, may add partner-answer events, and never replaces accepted gameplay events from the current epoch.
- **Host lease epoch.** The server holds one current epoch per game. **Take over** (explicit, confirmed, online only) increments it. The previous device becomes read-only the next time it contacts the server; uploads from an old epoch are rejected and kept locally as a recoverable divergent export, never merged automatically. An offline old device can keep playing locally; the takeover confirmation says so (§5.4).
- **Readiness check.** *(As built: the check covers the hash over build, revision, language, rules, questions and answers, the IndexedDB read-back, the loaded catalogue and "at least one playable question"; the conflict scan and the simulated reload are not implemented.)* Before the party the host runs a check bound to the app build and the game revision: current questions and chosen answers, penalty configuration and rule logic, the message catalogue for the game language, a writable IndexedDB with a read-back test, no unresolved question/answer conflicts, and a simulated reload from the cached snapshot. Result: **Ready for offline play**, or **Needs refresh** after any change to questions, answers, language, rules or the app version (the cached game stays playable from its last ready snapshot), or an explicit failure.
- **Offline guarantees.** A ready game is playable, fixable, scoreable and exportable without refreshing authentication, entitlement, consent, ads, the lease or any API token. Network-dependent actions (links, partner status, spectator updates, purchase, delete acknowledgement) are shown as unavailable.
- **Recovery.** The app recovers after a WebView reload, process termination, OS restart and a normal app upgrade; a failed upgrade never erases the last compatible snapshot; IndexedDB schema migrations are versioned and tested.
- **Backup.** Local snapshot after each round; an opportunistic server snapshot while online (at most one per 30 s); **Export backup** is a user action that produces a file. No automatic downloads. *As built:* the API stores `snapshot` events (last 20 per game) but the app does not send them; the server-side safety net is the nightly database backup (§9).

---

## 8. Security, privacy, retention

- **Host auth.** Google sign-in (the native sheet in the app, Google Identity Services in a browser; Apple with iOS). The API verifies the Google ID token **once**, against its own OAuth client ids, and answers with its own session token: 32 random bytes, stored only as a sha256 hash, valid 30 days, deleted on sign-out. Every later host call carries that session token (002 FR-121).
- **Tokens.** Two scoped, high-entropy tokens per game: partner (answer own form) and spectator (read the guest view). Stored hashed server-side, never logged, rate-limited, revocable and regenerable.
- **Spectator embargo.** Guests see a round's question once the host starts it and its answer only once the host reveals it or marks the round (002 FR-102); the spectator endpoint serialises only the dedicated projection (FR-014).
- **Token delivery.** Partner and spectator pages carry the token in the URL **fragment** (`partner.html#t=…`), which browsers never send to servers, and pass it to the API in a header; pages are served with `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, a Content-Security-Policy and (in production) HSTS, and load no third-party scripts. Tokens never appear in access logs.
- **Retention.** Content deleted **90 days after last activity**; host warned in-app 7 days before; immediate deletion on request. Payment records kept separately per statutory rules (store receipts stay with the stores).
- **Abuse.** Custom questions and penalties are private to the game; a report link on the partner view; no public gallery in v1.
- **Consent and notices.** Age notice (alcohol), privacy notice, ad consent (UMP / ATT), store-required data-safety declarations.

---

## 9. Platform and server side

| Layer | Choice (D1, §12) |
|---|---|
| Mobile app | **Capacitor** wrapper around the web app (committed `android/` project, GitHub Actions signed build), Play Store first, App Store when an Apple developer account exists |
| Web surfaces | host app, partner form and spectator page are static files in `web/`, served by the API container from the same origin as the API |
| API | one Node 22 container (Hono) on the **JR07 box** (Hetzner), built from the root `Dockerfile` and published with `jr07 app up bachelor`; live at `https://bachelor.91-98-25-205.sslip.io` (`deploy/README.md`) |
| Storage | **SQLite** (WAL), one file on the container's persistent `/data` volume, behind the repository interface; every mutating request is one transaction on a single in-process writer |
| Auth | Google ID tokens verified by the API itself (`google-auth-library`) and exchanged for our own 30-day session (§8) |
| Google | only as an identity provider (an OAuth client id, in the workspace's one remaining Google Cloud project `jr07-0000-dashboard`), for AdMob, and for the Play Developer API. Nothing of this app is hosted on Google Cloud; its project was deleted on 2026-09-27 |
| Ads | AdMob via a Capacitor AdMob plugin + UMP consent |
| Payments | Play Billing / StoreKit through a Capacitor purchases plugin; entitlement verified server-side and stored per app account (plugin choice: D3, §12) |
| Live spectators | conditional polling (ETag) every 2.5 s against the read-only projection endpoint |
| Purchase notifications | **open.** The API has a route for Google Play real-time developer notifications as a Pub/Sub push, but no subscription is set up and Pub/Sub is not part of the box; until a path is chosen a refund is seen only on the next verification of that purchase (STATUS Pending) |
| Retention | a timer inside the API process, every 6 hours: warn at 83 days idle, delete at 90; the same timer drops expired sessions |
| Backups | online backup of the database file inside the container every 24 hours, 14 kept (`deploy/README.md` has the manual copy and the restore) |

The Cloudflare Worker and the GitHub-repo-as-database sync are **retired**: no new Cloudflare account, the old
Worker is deleted from the Cloudflare dashboard, and `worker.js`, `wrangler.toml` and `worker-README.md` are
removed from the repo when the new API lands.

---

## 10. Game rules

**Round.** Reveal question → choose and describe penalty → player answers aloud → host reveals partner's answer →
Correct or Wrong → if Wrong, penalty screen until Done.

**Scoring.** Correct/wrong tally; round log with question, partner answer, penalty, result, who served the penalty, timestamp.

**Research (2026-09-14).** The traditional "Mr & Mrs" / "how well do you know the bride" quiz collects the
partner's answers before the party (10–30 questions), the guest of honour answers the same questions in front of
the guests, every wrong answer costs a forfeit (a shot or a dare), and in the common variant **a correct answer
lets the guest of honour nominate someone else to take the forfeit**. Other variants: guests drink on every
correct answer, forfeits as challenges for non-drinkers, the partner's answers played back on video. Sources are
listed in `research.md` in this folder.

**Extra rules (premium toggles, off by default).**
- **Strike back.** On a *correct* answer the player may hand the prepared penalty to one guest. The host taps
  **Strike back**, enters the guest's name (≤ 40 chars, remembered for the game), and the penalty screen shows
  "<guest>: <penalty>" until Done. Round log records the recipient (nickname, host-only). Score unchanged (still a correct answer).
  With the toggle off, a correct answer discards the penalty as today.
- **Double or nothing.** Before revealing the partner's answer the host may mark the round as doubled (once
  per round). Wrong: the penalty is served twice (or the screen says "×2"). Correct: the player may strike back
  at up to two guests if strike back is on, otherwise the round simply counts as correct. Round log records the
  doubling.

---

## 11. Decisions (settled by Jacek, 2026-09-14)

| # | Question | Decision |
|---|---|---|
| 1 | Entitlement and price scope | Mobile app on the stores; premium is an in-app purchase tied to the store account and mirrored to the host's app account; €1-tier, one-off, forever. Partner answers on a plain web link, no install. Questions added later are answerable by the partner through the same link. |
| 2 | Ads in v1 | Banner ads from day one plus at most one video interstitial per 60 minutes of use. Network research: AdMob (§6.2, FR-022). |
| 3 | Launch languages | English, German, Spanish, Portuguese, Polish; more later; Codex does the translations with context. |
| 4 | Spectators in v1 | Yes: auto-refreshing spectator link, summary only (score and the questions played so far). |
| 5 | Extra-rules research | Done by Claude on the web (§10). |
| 6 | Cloudflare | Abandoned. Google Cloud was chosen instead on 2026-09-14 and was itself replaced by the JR07 box on 2026-09-19 (spec 002; §9, D1). |

---

## 12. Settled platform decisions and what is still open

Settled by the constitution (now v3.1.0) and this spec (Codex recommended turning the former assumptions into decisions);
only operational prerequisites remain for Jacek and are tracked in `STATUS.md`.

- **D1 Platform:** one container on the JR07 box serving the API and the pages, SQLite on its data volume, Google
  only for sign-in, ads and Play verification (§9; decided in 002, replacing the original Google Cloud choice).
  Open: the OAuth client id for sign-in (`STATUS.md`).
- **D2 Mobile delivery:** Capacitor around the plain HTML/JS app; Android ships first; iOS work may proceed but
  release waits for an Apple developer account and a macOS signing environment. Open: Play Console account.
- **D3 Purchases plumbing (open, default A):** (A) one pinned Capacitor purchase plugin + Google Play Developer API
  (+ App Store Server API later) + store server notifications, entitlement authority in the API; (B) RevenueCat.
  Work proceeds with A behind an internal entitlement interface so B stays possible.
- **D4 Interstitials:** non-rewarded AdMob interstitials, static or video creative, at most one impression per 60
  minutes of active foreground use, persisted across restarts, only at the natural breaks in FR-021. Open: AdMob
  account and ad unit ids (test ids until then).
- **D5 Host authentication:** online sign-in is required to create, restore, delete or take over a game; no guest
  mode; a ready game never needs a fresh sign-in to be played (the session lasts 30 days and an open game keeps
  playing from the device if it lapses). Partner and spectators never sign in.

## 13. Out of scope

Social features, multiple simultaneous hosts, team variants, public question gallery, ad mediation in v1. (A web version of the host app was out of scope here and was added by 002.)

---

## 14. Success criteria

- **SC-001** New host installs, signs in, creates a game and sends the partner link within 5 minutes, no instructions.
- **SC-002** Partner completes 20 questions on a phone in under 10 minutes unaided, in each launch language.
- **SC-003** Readiness check passes and a full game is playable in airplane mode.
- **SC-004** Free-tier play shows no ad between "reveal question" and "penalty done"; at most one interstitial per 60 minutes.
- **SC-005** Host signs in on a second phone, takes over and continues the same game in under 1 minute; the first phone drops to read-only when online or on its next reconnect.
- **SC-006** Manual regression checklist for the baseline features (§2) passes.
- **SC-007** Zero references to the original party in code, data or docs.
- **SC-008** Premium bought on one device is active on a second device with the same store account after "Restore purchases".
- **SC-009** Spectator page shows a marked round within 10 seconds while the host is online and never shows a partner answer before the host has revealed it (tightened by 002 SC-101: question and answer within 4 s).
- **SC-010** Automated tests cover sync (idempotent uploads, epoch rejection), queue and random order, scoring, penalties, rule combinations and entitlement transitions including refund.

---

## 15. Codex critique v3: what was merged and what was not

Merged (see `codex-spec-review-v3.md`): ownership and bearer-link rules (§3); lifecycle transitions, active-game
counting, retention activity, offline deletion (§4); partner save states and conflict handling (§5.3); explicit
takeover (§5.4); spectator projection, polling and revocation behaviour (§5.5, FR-014); question revisions and the
meaning of "new" (FR-013); host-answer precedence (FR-011); game-language precedence and change rules (FR-015);
ad fail-closed and active-use definition (FR-021, D4); entitlement identity, states, notifications and refund
behaviour (FR-030, FR-036); guest-name privacy (FR-034); event journal, frozen rounds, lease epoch, versioned
readiness, offline guarantees, recovery and no automatic downloads (§7); token delivery via URL fragment (§8);
assumptions A1/A2/A4/A5 promoted to decisions D1/D2/D4/D5, A3 kept open as D3 (§12); SC-005 and SC-010.

Not merged: the opt-in **Add to remaining rounds** step for late questions. Answered new questions are appended to
the end of the unplayed queue with a notice instead; because the random pick happens once per round at reveal, a
changing pool between rounds cannot alter a round in progress, and one fewer screen keeps the host flow simple.
Also not merged: "encrypted" server snapshots (they are ordinary API-written documents behind the host's auth).

