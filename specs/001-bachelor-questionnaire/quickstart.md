# Quickstart and validation: Bachelor Questionnaire

## Prerequisites
- Node 22, npm 10 (this terminal has them).
- API: nothing to set up locally. It stores its data in a SQLite file (`api/data/bachelor.db`, created on first
  run) or, with `REPO=memory`, in memory. The deployed copy runs on the JR07 box (`deploy/README.md`).
- Android build: GitHub Actions (JDK 21, SDK 36) or a PC with the same; secrets `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS` in the repo.

## Run locally
```bash
npm ci --legacy-peer-deps            # root: web tests + capacitor
npm --prefix api ci --legacy-peer-deps
DEV_AUTH=1 npm --prefix api run dev  # API on http://localhost:8080, SQLite file in api/data/ (REPO=memory for none)
npm run web                          # static server for web/ on http://localhost:5173 (API_BASE=http://localhost:8080)
```
With `DEV_AUTH=1` the API accepts `Authorization: Bearer dev:<uid>` so the host app can be exercised in a
browser without a Google client; native plugins fall back to browser stubs (ads: placeholder box; purchases: "Buy"
grants premium locally; auth: prompt for a dev uid).

## Automated checks
```bash
npm test                    # 65: game logic, storage journal, sync, API client, purchases, ads, translations, guest page
npm --prefix api test       # 71: routes, events, sessions, entitlement, retention, transactions, guest view (SQLite)
TEST_REPO=memory npm --prefix api test   # the same suite against the in-memory repository
npm --prefix api run typecheck
```

## Manual regression checklist (SC-006, run before every release)
Baseline (spec §2), on a phone-sized viewport in the app:
1. New game (free, en) → partner link copied → open link in another browser → answer 20 questions → host sees "complete 20/20".
2. Readiness check shows "Ready for offline play"; enable airplane mode.
3. Next question → Drink + description → reveal question → answer hidden → show answer → re-hide → Correct: penalty discarded, round logged.
4. Wrong: penalty fills the screen; Done returns home; tally updates.
5. Random order toggle picks an unplayed question and keeps it across an app restart mid-round.
6. Fix-up screen: mark a round Unplayed → question returns to the queue; mark another Wrong with penalty "none".
7. Kill and reopen the app mid-round → resumes on the same screen.
8. Reconnect → the journal uploads; the guest page shows the rounds within a few seconds. While a round is on the table the guest page shows its question but not the answer until "show answer" is tapped on the host's screen.
9. Scoreboard: tally, table, All/Correct/Wrong filter, Download JSON, Share summary.
10. Free tier: banner visible on home and scoreboard only; no ad between reveal and penalty done; interstitial appears only after the scoreboard is closed and not again within 60 min of use.
11. Premium (dev stub): add/edit/reorder/delete questions, custom penalties, strike back (correct → hand to a guest → penalty screen shows the guest), double or nothing (wrong → "×2").
12. Add 3 questions after the link was sent → partner link opens on "3 new questions" → host sees them answered.
13. Second device signs in → game opens read-only with last sync time → Take over (confirm) → first device becomes read-only on its next request; rounds it plays offline afterwards land in "divergent export", not in the game.
13b. Two partner pages edit the same answer → the second gets a conflict and shows both values.
14. Delete game (confirm) → game gone, partner and guest links show "this link is no longer available".
15. Language: create a game in pl → partner page and spectator page are in Polish; host UI follows the device.
16. A search for the original couple's first names over the repo returns nothing (SC-007); the names are kept out of the repo on purpose, so run it from your notes.
