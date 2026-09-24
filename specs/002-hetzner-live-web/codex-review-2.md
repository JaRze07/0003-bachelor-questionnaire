- **`web/src/native/auth.js`** — `signIn()` falls through to development authentication for both `web` and `unconfigured` modes. If the GIS script fails or the fallback button is exposed, a production organiser is prompted for a user ID and a persistent `dev:` session is created, although the production API will reject it. Restrict this branch to `signInMode() === 'dev'`; reject `web`/`unconfigured`, and keep the local button hidden when GIS is unavailable.

- **`web/src/main.js`** — `boot()` accepts a cached IndexedDB session before checking whether browser sign-in is configured. With no Google client ID, such a browser bypasses the promised “sign-in is not set up” screen and may continue into the organiser UI or fail with the generic startup page. Check `signInMode() === 'unconfigured'` before restoring the session and route directly to `showSignIn()`; also only suppress genuinely offline errors from `refreshMe()`, clearing rejected sessions instead of continuing.
---

## What Claude did with this review (2026-09-24)

Both findings were real and are fixed, with tests.

- **Development sign-in could run against a real server.** `signIn()` fell through to the prompt for any
  non-native mode, so a browser on the box (or one whose Google script failed to load) could store a `dev:`
  session: the app would look signed in and every API call would fail with 401. It now returns without doing
  anything unless the mode is `dev` (localhost), and the fallback button is hidden when sign-in is unconfigured.
- **A cached session was trusted before checking configuration.** Boot now treats an unconfigured server as signed
  out whatever is in IndexedDB, `currentUser()` discards a `dev:` session that this server cannot accept, and a
  401 from the account call signs the organiser out and returns to the sign-in screen instead of continuing into
  an app that cannot work. Only genuine offline errors keep the cached entitlement.

`signInMode(hostname)` and `currentUser(mode)` take an explicit argument so the rules can be tested; the callers
use the defaults.
