# Quickstart and validation: Bachelor Questionnaire

## Prerequisites
- Node 22, npm 10 (this terminal has them).
- API: a Google Cloud project `jr07-0003-bachelor-questionnaire` with Firestore (native), Firebase Auth (Google
  provider), Cloud Run enabled. Local runs use the Firestore emulator (`FIRESTORE_EMULATOR_HOST`) or the
  in-memory repository (`REPO=memory`).
- Android build: GitHub Actions (JDK 21, SDK 36) or a PC with the same; secrets `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS` in the repo.

## Run locally
```bash
npm ci                              # root: web tests + capacitor
npm --prefix api ci
REPO=memory npm --prefix api run dev # API on http://localhost:8080 with in-memory storage and DEV_AUTH=1
npm run web                          # static server for web/ on http://localhost:5173 (API_BASE=http://localhost:8080)
```
With `DEV_AUTH=1` the API accepts `Authorization: Bearer dev:<uid>` so the host app can be exercised in a
browser without Firebase; native plugins fall back to browser stubs (ads: placeholder box; purchases: "Buy"
grants premium locally; auth: prompt for a dev uid).

## Automated checks
```bash
npm test                    # web/src/logic + store (vitest, jsdom + fake-indexeddb)
npm --prefix api test       # API with in-memory repo; emulator suite runs if FIRESTORE_EMULATOR_HOST is set
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
8. Reconnect → outbox drains; spectator page shows the rounds within 10 s; no partner answers visible on it.
9. Scoreboard: tally, table, All/Correct/Wrong filter, Download JSON, Share summary.
10. Free tier: banner visible on home and scoreboard only; no ad between reveal and penalty done; interstitial appears only after the scoreboard is closed and not again within 60 min of use.
11. Premium (dev stub): add/edit/reorder/delete questions, custom penalties, strike back (correct → hand to a guest → penalty screen shows the guest), double or nothing (wrong → "×2").
12. Add 3 questions after the link was sent → partner link opens on "3 new questions" → host sees them answered.
13. Second device signs in → game opens read-only with last sync time → Take over (confirm) → first device becomes read-only on its next request; rounds it plays offline afterwards land in "divergent export", not in the game.
13b. Two partner pages edit the same answer → the second gets a conflict and shows both values.
14. Delete game → export offered → game gone, partner link shows "this game no longer exists".
15. Language: create a game in pl → partner page and spectator page are in Polish; host UI follows the device.
16. `grep -ri "hasina\|areeb" --exclude-dir=.git .` returns nothing (SC-007).
