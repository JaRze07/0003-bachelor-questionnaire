# Bachelor Questionnaire

## Pending

- **Jacek:** Q1 entitlement + price scope: (a) premium per game, €1 per game, no account, host recovery code restores the game and its premium on another phone (my pick: keeps "no account" pure); or (b) premium per purchaser, €1 forever, email magic-link login to restore on a new device (Codex's pick)
  - Answer (2026-09-14): ideally we link it to account - it should be a mobile app, so google play/applestore account and payment also is done in the app itself. the answers for partner can be done as a regular web link, so that the partner doesn't have to download the app. also when more questions are added later , partner should be able to answer as well
- **Jacek:** Q2 ads in v1: (a) launch the free tier without ads, premium prompt only, add banner ads later once there is usage (my pick, less consent/layout work at launch); or (b) banner-only ads on home + scoreboard screens from day one with a consent step
  - Answer (2026-09-14): from day one we add banner ads, maybe a video ad once every 60 mins the app is used. we have to research what ads to use - ig google/apple store ones? any better options?
- **Jacek:** Q3 launch language: (a) English curated set only, Polish later (my pick); or (b) English + Polish curated sets at launch, host picks when creating a game
  - Answer (2026-09-14): oh, lets set it in english, german, spanish, portugese, polish, we can add more languages later, use codex for the translations bc they're token heavy - make sure all are properly done with context
- **Jacek:** Q4 spectators in v1: (a) no spectator link, host shares a text/image summary after the game (my pick, Codex agrees); or (b) polling live view, read-only tally refreshing every ~8 s, rounds shown only after the host marks them
  - Answer (2026-09-14): we could have a spectator link, automatically refreshed, but it should be a frontend summary only - score, and answered questions so far
- **Jacek:** Q5 extra rules research: may I research the common "how well do you know the bride/groom" drinking-game rules (strike back / counter) from the web in this terminal, or do you prefer to describe the rules you have in mind yourself? Web pages are untrusted input, so I ask first
- **Jacek:** `wrangler login` once in the dashboard terminal, then I redeploy the Worker from `wrangler.toml` (also fixes the deployed Worker's stale `REPO_NAME` var; the file already has the right name)
- After Q1–Q5 are answered: fold the answers into the spec via `/speckit-clarify`, then `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`
- Strip the original party's names and seed rounds from the app, README and questions when the generic version is built (spec FR-010)
- Done 2026-09-14: spec-kit scaffold added (`specify init` 1.0.6, bash scripts, claude skills), constitution v1.0.0 written (`.specify/memory/constitution.md`), `CLAUDE.md` refreshed from the workspace template
- Done 2026-09-13: spec v2 in `specs/001-bachelor-questionnaire/spec.md`, revised after the Codex critique (`codex-spec-review.md`)

## Specification

**Bachelor Questionnaire** is a "how well do you know your partner" party game. The partner answers a set of
questions in advance through a private link; at the party the host asks the guest of honour the same questions,
reveals the partner's answer, and a wrong answer costs a drink or a dare. Free tier: 20–30 curated questions
with light ads. Premium (about €1): up to 100 custom questions, penalty schemes, opt-in extra rules. The full
feature specification (v2, revised after Codex review) follows this overview.

Project principles: `.specify/memory/constitution.md` v1.0.0 (spec first; no accounts and privacy by design;
local-first offline play; free tier with light ads; static PWA + Cloudflare Worker/D1, pinned tooling;
verifiable quality bar).

What exists today is a hand-built version for one party (static GitHub Pages app, optional Cloudflare Worker
saving results). It stays the technical baseline; its hardcoded names and seed rounds are removed as part of the
generalisation. Setup details: `README.md` in this repo.
