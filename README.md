# Bachelor Questionnaire

A "how well do you know your partner" party game. Before the party the **partner** answers a set of questions
about themselves through a private web link, no app needed. At the party the **host** runs the game in the
mobile app: asks the **guest of honour** the same questions, reveals the partner's answer, and a wrong answer
costs a drink or a dare. Guests follow along on a **live link**: the question on the table, the dare at stake, the
partner's answer from the moment the organiser reveals it, and the score.

The organiser can run everything from the Android app **or from a browser**; it is the same code.

Free: 20 curated questions in English, German, Spanish, Portuguese and Polish, banner ads plus at most one
interstitial per hour of use. Premium (one-off in-app purchase, about €1): up to 100 custom questions, penalty
schemes, strike back and double-or-nothing, no ads.

Full specification: `specs/001-bachelor-questionnaire/spec.md`. Project rules: `CLAUDE.md`, `../WORKFLOW.md`.

## Layout

| Path | What it is |
| --- | --- |
| `web/` | One codebase for three surfaces: the host app (`index.html`), the partner form (`partner.html`) and the spectator page (`spectator.html`). Capacitor wraps this folder; Firebase Hosting serves it. |
| `web/src/logic/` | Pure game logic: queue, scoring, penalties, extra rules, ad gate. Unit-tested. |
| `web/src/store/` | IndexedDB wrapper, append-only event journal, sync with the lease epoch. |
| `web/src/native/` | Capacitor bridges (auth, ads, purchases, device) with browser fallbacks. |
| `web/curated/`, `web/i18n/` | Curated question banks and UI catalogues per language. |
| `api/` | The API (Hono, Node 22) with a SQLite store: games, questions, partner answers, event upload, the guests' live projection, sign-in sessions, purchases, retention and backups. In production it also serves `web/`. |
| `Dockerfile` | The image built by `jr07 app up`: API plus pages, database on the `/data` volume. |
| `deploy/` | How it runs on the JR07 box: the deploy command, settings, backups and restore. |
| `android/` | Capacitor Android project (created by `npx cap add android`). |
| `specs/001-bachelor-questionnaire/` | Spec, plan, data model, API contract, quickstart, tasks, Codex reviews. |

## Run it locally

```bash
npm ci --legacy-peer-deps          # root: web tests + Capacitor
npm --prefix api ci --legacy-peer-deps

DEV_AUTH=1 npm --prefix api run dev                # API on :8080, SQLite file in api/data/ (REPO=memory for none)
npm run web                                        # web/ on :5173
```

With `DEV_AUTH=1` the API accepts `Authorization: Bearer dev:<uid>`, so the host app signs in with a prompt
instead of Firebase, ads render as a placeholder box and "buy premium" grants the entitlement locally. Open
`http://localhost:5173/` for the host app; the partner and spectator links it shows work in another tab.

## Tests

```bash
npm test                  # pure client logic (vitest + fake-indexeddb)
npm --prefix api test     # API against SQLite (TEST_REPO=memory for the in-memory store)
npm --prefix api run typecheck
```

CI runs all three on every push (`.github/workflows/ci.yml`). The manual checklist before a release is
`specs/001-bachelor-questionnaire/quickstart.md`.

## Deploy

**Live: https://bachelor.91-98-25-205.sslip.io** (JR07 box). One container serving the API and the pages, with the
database on a persistent volume:

```bash
jr07 app up bachelor --port 8080 --dir JR07/0003-bachelor-questionnaire -e NODE_ENV=production ...
```

Full command, settings, backups and restore: `deploy/README.md`.

Android: push a `v*` tag and `.github/workflows/android-release.yml` builds a signed APK and AAB and attaches them
to the GitHub Release. Repo secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`,
`ANDROID_KEY_ALIAS`. Repo variables: `API_BASE`, `GOOGLE_WEB_CLIENT_ID`, `AD_UNIT_BANNER`, `AD_UNIT_INTERSTITIAL`.

## Still to set up (Jacek)

- A Google OAuth client id (Web application) for sign-in, see `deploy/README.md`.
- Google Play Console account, then the app listing and the `premium_forever` product.
- AdMob: add the app, create one banner and one interstitial unit, put the ids in the repo variables.
- Apple developer account and a Mac (or a hosted Mac) for the iOS build.

Progress and open questions live in `STATUS.md` and on the JR07 dashboard.
