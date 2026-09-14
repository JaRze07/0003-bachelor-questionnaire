# Bachelor Questionnaire

## Pending

- **Jacek:** decide the five open points in spec §11 (entitlement model, ads in v1, price scope, launch language, spectators in v1). Answers go into the spec via `/speckit-clarify`, then `/speckit-plan`.
- **Jacek:** `wrangler login` once in the dashboard terminal, then redeploy the Worker from `wrangler.toml` (`wrangler deploy`). This also fixes the deployed Worker's stale `REPO_NAME` var (the file already has the right name; only the hand-made dashboard deployment is wrong).
- Research how the "how well do you know the bride/groom" drinking game is normally played, especially strike-back / counter rules, so spec §10 extra rules can become committed scope. Do this in a default-permission session (web research = untrusted input).
- Strip the original party's names and seed rounds from the app, README and questions when the generic version is built (spec FR-010).

Done 2026-09-14: spec-kit scaffold added (`specify init` 1.0.6, bash scripts, claude skills), constitution v1.0.0 written (`.specify/memory/constitution.md`), `CLAUDE.md` refreshed from the workspace template.
Done 2026-09-13: spec v2 in `specs/001-bachelor-questionnaire/spec.md`, revised after the Codex critique (`codex-spec-review.md`).

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
