# Bachelor Questionnaire

## Pending

- Research how the "how well do you know the bride/groom" drinking game is normally played, especially strike-back / counter rules, before writing the spec
- **Jacek:** decide the five open points in spec §11 (entitlement model, ads in v1, price scope, launch language, spectators in v1)
- Spec v2 is in `specs/001-bachelor-questionnaire/spec.md`, revised after the Codex critique (`codex-spec-review.md`); next: `/speckit-clarify`, then plan
- Set up a proper Cloudflare connection (wrangler login) and redeploy the Worker from wrangler.toml
- Fix the Worker `REPO_NAME` var (still the pre-rename repo name, works only via GitHub redirect)
- Strip the original party's names and seed rounds from the app, README and questions when the generic version is built
- Add spec-kit scaffold (`tools\new-project.ps1 -Id 0003-bachelor-questionnaire -ExistingOnly`)

## Specification

**Bachelor Questionnaire** is a "how well do you know your partner" party game. The partner answers a set of
questions in advance through a private link; at the party the host asks the guest of honour the same questions,
reveals the partner's answer, and a wrong answer costs a drink or a dare. Free tier: 20–30 curated questions
with light ads. Premium (about €1): up to 100 custom questions, penalty schemes, opt-in extra rules. The full
feature specification (v2, revised after Codex review) follows this overview.

What exists today is a hand-built version for one party (static GitHub Pages app, optional Cloudflare Worker
saving results). It stays the technical baseline; its hardcoded names and seed rounds are removed as part of the
generalisation. Setup details: `README.md` in this repo.
