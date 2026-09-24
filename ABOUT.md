# Bachelor Questionnaire — at a glance

**What:** a "how well do you know your partner" party game for bachelor and bachelorette parties. The partner
answers questions about themselves beforehand on a private web link. At the party the organiser asks the guest of
honour the same questions, reveals the partner's answer, and a wrong guess costs a drink or a dare. Guests follow
the whole thing live on their own phones.

**Three surfaces, one codebase:** the organiser's app (Android, or any browser), the partner's form (a link, no
account, no install), and the guests' live page (a link, read-only).

**Stack:** plain HTML/CSS/JS, no framework · Capacitor for Android · Node 22 + Hono + SQLite on the JR07 Hetzner
box, one container serving the API and the pages · IndexedDB event journal on the organiser's device for offline
play · Google sign-in exchanged for our own session · AdMob · Play Billing.

**Highlights:** the game works with no signal at the party and syncs afterwards; guests see the question and the
dare as it happens, and the partner's answer only from the moment the organiser reveals it; five languages
(English, German, Spanish, Portuguese, Polish) with question banks localised, not translated word for word;
premium rules (strike back, double or nothing) and up to 100 custom questions; a second phone can take the game
over, and the first one cannot then contradict it.

**Status:** live at https://bachelor.91-98-25-205.sslip.io. Organiser sign-in waits on a Google OAuth client id;
the partner and guest links work today. Android build ready in CI, not yet on the Play Store.

**Run it locally:**

```bash
npm ci --legacy-peer-deps && npm --prefix api ci --legacy-peer-deps
DEV_AUTH=1 npm --prefix api run dev     # API on :8080
npm run web                             # pages on :5173
```

**Tests:** `npm test` (49, client) and `npm --prefix api test` (64, API, against SQLite and the in-memory store).

**Specs:** `specs/001-bachelor-questionnaire/` (the game) and `specs/002-hetzner-live-web/` (own server, web
organiser app, live guest view). Rules of the workspace: `../WORKFLOW.md`.
