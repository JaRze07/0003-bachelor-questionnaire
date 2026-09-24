# Feature Specification: own server, web host app, live guest view

**Feature branch**: `002-hetzner-live-web`
**Created**: 2026-09-19
**Status**: In implementation
**Input**: Jacek, 2026-09-19: "move to hetzner"; "organizer has the app (but let's have a web version as well) with the
questions and filling out dares and all, but then the guests should have live tracking of what the current question
is, what the answer is, and also look at the score and all"; "they [the organiser] are the one scoring".
**Amends**: `specs/001-bachelor-questionnaire/spec.md` v3.1 (§3 roles, §5.5 spectators, FR-014, §8, §9, D1, D5).
Everything not mentioned here stays as specified there.

---

## 1. What changes

1. **One database on our own box.** The API and its data move from Google Cloud (Cloud Run + Firestore) to the JR07
   server (Hetzner CX33, Nuremberg), next to the dashboard. There was always exactly one shared database, never one
   per install; the copy on the host's phone is an offline cache of one game.
2. **The host app also runs in a browser.** Same screens, same code, no install. The organiser signs in with Google.
3. **Guests follow the game live.** The guest link shows the question being asked right now, the dare or drink that
   is at stake, the partner's answer from the moment the host reveals it, the score and every round played.
4. **The organiser scores.** One organiser runs the game and marks rounds, from the app or from the web version.
   Running the same game from a second device still needs an explicit takeover (001 §7).

---

## 2. Roles (replaces 001 §3 table)

| Role | Surface | Account | Sees | Can do |
|---|---|---|---|---|
| **Organiser** (host) | Android app **or the web app** | Google sign-in (Apple with iOS) | everything | create games, edit (tier permitting), send links, run and score rounds, fix results, export, delete, buy premium (in the app) |
| **Partner** | web link | none | the questions and their own answers | answer, also questions added later |
| **Player** | none | none | nothing | answers aloud |
| **Guest** | web link | none | live round, revealed answers, dares, score, history | nothing |

---

## 3. Live guest view (replaces 001 §5.5 and FR-014)

- **FR-101** The guest page shows the **current round** as soon as the organiser reveals the question: round number,
  theme, question text, penalty type, label and description, and the doubled flag.
- **FR-102** The partner's answer appears on the guest page **only after the organiser reveals it** on their own
  screen, or when the round is marked, whichever comes first. Before that the page says the answer is hidden. A guest
  can therefore never read an answer ahead of the room.
- **FR-103** After marking, the round moves into the history with question, partner's answer, penalty, result, the
  doubled flag and, when strike back was used, the nickname of the guest who took the penalty.
- **FR-104** The page shows the score (correct, wrong, played, total) and, when a game is finished, says so.
- **FR-105** Refresh: conditional polling every **2.5 s** while the page is visible (ETag, 304 when nothing changed),
  paused in the background, stale notice after 15 s without a response, cleared and replaced by "link no longer
  available" after deletion or revocation.
- **FR-106** The API still serialises **only a dedicated projection** for guests. It never contains answers of
  questions that were not played, answers of the current round before the reveal, hidden or deleted questions, the
  organiser's account, or anything about the partner beyond the answers shown.
- **FR-107** The organiser's app uploads the reveal as its own journal event (`round.reveal`), so the guest page
  follows the organiser's screen and not the clock.
- **FR-108** **Disclosure to the partner.** The partner form says, before the first question, that the answers will
  be read out and shown to the party guests. (Until now only the organiser could read them.)
- **FR-109** The organiser can switch the guest link off or replace it at any time (unchanged).

---

## 4. Web version of the host app

- **FR-120** The host app is served at the site root and works in any current mobile or desktop browser with the
  same screens as the Android app, including offline play after a readiness check (IndexedDB is per browser).
- **FR-121** Sign-in on the web uses **Google Identity Services**; the API exchanges the Google ID token once for its
  own **session token** (random, stored hashed, 30 days, revocable on sign-out). The Android app gets the same kind
  of session through the native Google sign-in. Every later request carries only our session token, so a game keeps
  working for the whole night without a fresh Google round trip. Apple sign-in plugs into the same exchange later.
- **FR-122** Premium bought in the Android app follows the account onto the web. The web version cannot sell it
  (store billing is app-only); it shows where to buy. No ads on the web version in this release.
- **FR-123** No Firebase. Account id = `g:<Google subject>`.

---

## 5. Server (replaces 001 §9 and D1)

| Layer | Choice |
|---|---|
| Box | JR07 server, Hetzner CX33 Nuremberg. Published with `jr07 app up` (WORKFLOW §4d): the provisioner builds the Dockerfile, runs the container in a fixed safe shape and routes `https://bachelor.91-98-25-205.sslip.io` to it |
| API | the same Hono service, one container, Node 22, on the provisioner's persistent `/data` volume |
| Storage | **SQLite** (WAL) in one file on the box, through the existing repository interface; every mutating request runs in **one transaction**, serialised in-process |
| Static pages | the same container serves them, so the pages and the API share one origin and need no cross-origin setup |
| Backups | nightly online backup of the database file, 14 copies kept, plus a copy before every deploy |
| Play verification | Google Play Developer API with a service-account key from the box's secret file |
| Removed | Cloud Run, Firestore, Firebase Auth, Firebase Hosting, Cloud Scheduler, Pub/Sub push (purchase notifications use a pull on a timer, retention runs on a timer inside the API) |

Why SQLite and not Postgres: one process, a few hundred games a month, and a repository interface that already
hides the store. It is testable in CI without a service, it has real transactions (which closes the transactional
debt recorded in 001 `codex-review-2.md`), and a backup is a file. If the app outgrows it, a Postgres repository is
a contained change.

What we give up: redundancy. If the box is down during a party the links stop; the organiser's device keeps
playing offline and syncs later.

---

## 6. Success criteria

- **SC-101** A guest sees a newly revealed question within 4 s and the answer within 4 s of the organiser's reveal,
  and never before it.
- **SC-102** A full game can be created, answered, played and followed using only browsers.
- **SC-103** The API test suite passes against the SQLite repository, including the concurrency tests of 001.
- **SC-104** Nothing in the repo depends on Google Cloud at run time except Google sign-in and Play verification.
- **SC-105** A database backup can be restored into a fresh container and serves the same games.

---

## 7. Status

Deployed 2026-09-24 at **https://bachelor.91-98-25-205.sslip.io** and checked end to end there
(`deploy/README.md`). Open: the Google **OAuth client id** (type Web) for the site's origin. Until it is passed,
nobody can sign in as an organiser; the sign-in screen says so and the partner and guest links work normally.
