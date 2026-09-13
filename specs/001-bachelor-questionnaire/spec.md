# Feature Specification: Bachelor Questionnaire

**Feature branch**: `001-bachelor-questionnaire`
**Created**: 2026-09-13 · **Revised**: 2026-09-13 after Codex critique (`codex-spec-review.md`)
**Status**: Draft v2, awaiting Jacek's decisions (§11)
**Input**: Jacek's product direction (2026-09-13) plus the existing one-party game in this repo

---

## 1. Summary

A party game for bachelor and bachelorette parties. Before the party the **partner** answers a set of
questions about themselves through a private link. At the party the **host** asks the **player** (the guest
of honour) the same questions, reveals the partner's answer, and a wrong answer costs a drink or a dare.

The repo today holds a hand-built version for one party. This spec turns it into a product anyone can use:
a **free tier** with a curated question set and light ads, and a one-off **premium** unlock (target about €1)
for custom questions, penalty schemes and extra rules.

---

## 2. Baseline: what exists today

Built and working; the generalisation keeps the gameplay and replaces the plumbing.

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

Weaknesses to remove: hardcoded names, questions and seed rounds; partner cannot enter answers; GitHub repo
used as a database (token risk, rate limits, slow propagation, last-write-wins).

---

## 3. Roles

| Role | Device | Sees | Can do |
|---|---|---|---|
| **Host** | own phone | everything | create game, send links, run rounds, fix results, export, delete |
| **Partner** | own phone | only the questions and their own answers | answer, save progress, submit |
| **Player** | none | nothing | answers aloud |
| **Spectator** (optional) | any | live tally and completed rounds only | nothing |

---

## 4. Game lifecycle

```
draft ──► awaiting partner ──► ready ──► in progress ──► finished ──► (deleted after retention)
  │            │                              ▲
  └── host edits questions (tier permitting)  └── host may reopen partner form → back to awaiting partner
```

- **Draft**: host creates a game. Free: curated set loaded. Premium: curated set or blank.
- **Awaiting partner**: partner link sent. Host sees status: *not opened · in progress (n/N) · submitted · reopened*.
- **Ready**: partner submitted, or host chose to start with partial answers (§6.3).
- **In progress**: rounds are played; state is local-first (§7).
- **Finished**: scoreboard, export, optional share summary.

---

## 5. User scenarios

### 5.1 Free host runs a party (P1)
1. Opens the app, taps **New game**. Gets the curated set (20 questions, English at launch, §11).
2. Copies the **partner link**, sends it. Later sees "submitted 20/20".
3. Runs the **readiness check** before leaving (§7): "Ready for offline play".
4. At the party plays the rounds exactly as today. Scoreboard at the end, export or share summary.

### 5.2 Premium host customises (P2)
1. Unlocks premium (entitlement model: §11, decision pending).
2. Edits the curated set or starts blank: add, edit, reorder, delete; up to **100 questions**.
3. Sets the **penalty scheme**: drink or dare (default), drink only, dare only, or a custom list of up to 6 options
   (label ≤ 40 chars, optional description ≤ 200 chars).
4. Sends the partner form when the questions are final; may **reopen** it later (answers preserved, partner may edit, host notified).

### 5.3 Partner answers (P1)
- Opens the link on a phone, no account. Sees a progress bar and one question at a time with a *list view* toggle.
- Answers are free text, ≤ 500 chars, saved server-side on every change; blank answers allowed but flagged.
- **Submit** locks the form; a confirmation screen says nothing more is visible to them.
- If the form was reopened by the host, the partner sees which answers they may revise.

### 5.4 Host loses phone or link (P2)
- On game creation the host sees a **recovery code** once (and may download it). Entering it on another device
  restores the host role and **invalidates the previous host session**.
- Without the code the game is unrecoverable; the app says so at creation.

### 5.5 Spectators (P3, after launch)
- Spectator link shows the tally and each round **only after the host has marked it** (no answer spoilers).
- Read-only, refreshes every ~8 s while online; unavailable offline.

---

## 6. Functional requirements

### 6.1 Core (both tiers)
- **FR-001** Host and partner play without an account. A game has a random id; **authorisation is by scoped tokens**,
  not by the id (§8).
- **FR-002** A curated bank of 20 generic questions ships with the app (30 acceptable), usable by any couple.
- **FR-003** Host can generate, **revoke and regenerate** partner and spectator links independently.
- **FR-004** Partner view exposes only questions and the partner's own answers.
- **FR-005** Partner answers are stored server-side; the host device pulls them, no manual typing.
- **FR-006** Gameplay behaviour of the baseline is preserved: hide/re-hide answer, Correct/Wrong, penalty screen,
  random order, fix-up screen, scoreboard, export, refresh recovery. *Editing* is governed by tier (FR-020, FR-031).
- **FR-007** Default penalty scheme is drink or dare with a free-text description (≤ 200 chars) per round.
- **FR-008** The game works **offline** at the party (§7) and recovers from a refresh.
- **FR-009** Results export as JSON and as a shareable text/image summary.
- **FR-010** No names, questions or seed rounds from the original party remain in code, data or docs.
- **FR-011** Host sees partner status (not opened / in progress n/N / submitted / reopened) and may start with
  partial answers; unanswered questions are excluded by default or answered manually by the host.
- **FR-012** Host may delete a game immediately; export is offered first.

### 6.2 Free tier
- **FR-020** Free hosts use the curated set; they may **preview** it and **hide up to 5** unsuitable questions,
  but not edit text, add or reorder.
- **FR-021** Ads are **light and never disruptive**: banner only, on the home and scoreboard screens; never between
  "reveal question" and "penalty done", never on the partner or spectator views, never audio or interstitial.
  Ads require a consent step where the law demands it. *(Whether ads ship in v1 is Jacek's call, §11.)*

### 6.3 Premium tier
- **FR-030** One-off purchase, target price about €1. Entitlement model per §11 (per purchaser with restore,
  or per game with a recovery code).
- **FR-031** Create, edit, reorder, delete questions, up to 100 per game.
- **FR-032** Penalty schemes: drink or dare, drink only, dare only, custom options (≤ 6).
- **FR-033** Reopen the partner form with answers preserved.
- **FR-034** Extra rules as opt-in toggles. *Strike back is not in committed scope until its mechanics are defined (§10).*
- **FR-035** No ads.
- **FR-036** Payment edge cases handled: cancel, duplicate charge, refund, restore on a new device, unsupported
  country, purchase attempted offline.

### 6.4 Limits
| Item | Limit |
|---|---|
| Questions per game | 100 (premium), 20–30 curated (free) |
| Question text | 300 chars |
| Partner answer | 500 chars |
| Penalty label / description | 40 / 200 chars |
| Custom penalty options | 6 |
| Active games per host device | 10 |

---

## 7. Offline and state model

- **Local-first at party time.** Game state lives in **IndexedDB** on the host device (not `localStorage`); every
  action is written locally first.
- **Readiness check.** Before the party the host runs a check that caches the PWA shell, questions, answers and
  state, then shows "Ready for offline play". Failure states are explicit.
- **Reconnect.** Locally recorded rounds upload on reconnect; the server never overwrites a newer local state.
- **Single host lease.** One active host session per game. A second device opens read-only unless it explicitly
  takes over (recovery code); takeover invalidates the first lease.
- **Backup.** Automatic downloadable backup after each round while online; periodic server snapshots.

---

## 8. Security, privacy, retention

- **Tokens.** Three scoped, high-entropy tokens per game: host (write), partner (answer own form), spectator (read
  completed rounds). Stored hashed server-side, never logged, rate-limited, revocable and regenerable.
- **Spectator embargo.** Answers and penalties of a round become visible to spectators only after the host marks it.
- **Retention.** Content deleted **90 days after last activity**; host warned in-app 7 days before where a session
  exists; immediate deletion on request. Payment records kept separately per statutory rules.
- **Abuse.** Custom questions and penalties are private to the game; a report link on the partner view; no public
  gallery in v1.
- **Consent.** Age notice (alcohol), privacy notice, ad consent where required.

---

## 9. Server side

| Layer | Choice |
|---|---|
| Client | Static PWA on GitHub Pages (as today) |
| API | Cloudflare Worker (replaces the GitHub-commit Worker) |
| Storage | Cloudflare **D1** for games, questions, submissions, snapshots; **KV** only for immutable curated sets |
| Live spectators | polling in v1; Durable Object or SSE later if demand |
| Payments | web one-off (Stripe-style) or Play Billing when wrapped, per §11 |

The current GitHub-repo-as-database Worker is retired once the new API is live.

---

## 10. Game rules

**Round.** Reveal question → choose and describe penalty → player answers aloud → host reveals partner's answer →
Correct or Wrong → if Wrong, penalty screen until Done.

**Scoring.** Correct/wrong tally; round log with question, partner answer, penalty, result, timestamp.

**Extra rules (premium toggles, off by default).** Candidates: *strike back* (a correct answer lets the player
hand the prepared penalty to a guest) and *double or nothing*. Each becomes committed scope only once research
(pending task) defines mechanics, scoring effect and UI.

---

## 11. Decisions for Jacek

1. **Entitlement**: (a) premium tied to a lightweight email magic-link account, restorable on any device; or
   (b) premium per game with a recovery code, no account at all. Codex recommends (a); (b) keeps "no account" pure.
2. **Ads in v1**: keep the banner-only free tier as planned, or launch without ads and add them after measuring
   demand (Codex's recommendation, given fees and consent overhead at €1 price points).
3. **Price and scope of purchase**: €1 per game vs €1 forever.
4. **Launch language**: English only, or English + Polish curated sets.
5. **Spectators in v1**: include polling-based live view, or ship the shareable summary only.

---

## 12. Out of scope

Accounts beyond §11(a), social features, multiple simultaneous hosts, native iOS, team variants, public question gallery.

---

## 13. Success criteria

- **SC-001** New host creates a game and sends the partner link within 5 minutes, no instructions.
- **SC-002** Partner completes 20 questions on a phone in under 10 minutes unaided.
- **SC-003** Readiness check passes and a full game is playable in airplane mode.
- **SC-004** Free-tier play shows no ad between "reveal question" and "penalty done".
- **SC-005** Host recovers a game on a second device with the recovery code in under 1 minute.
- **SC-006** Manual regression checklist for the baseline features (§2) passes.
- **SC-007** Zero references to the original party in code, data or docs.
