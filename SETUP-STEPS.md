# Setup — do these in order

Three parts: upload files, set up Cloudflare, connect the app.
Nothing changes for players until Part 3, so Parts 1 and 2 are safe to do anytime.

---

## Part 0 — back up first (1 min)

If the phone still has rounds from the last session, save them before anything else.
Once sync is switched on, the first save overwrites whatever is in the repo.

1. Open the game, tap **Scoreboard**
2. Screenshot it
3. Tap **Download results as JSON**, then message the file to yourself

---

## Part 1 — upload the files (5 min)

Go to **https://github.com/JaRze07/0003-bachelor-questionnaire** → **Add file** → **Upload files**.

Upload these **6 files** to the repo root:

| File | New or overwrite |
| --- | --- |
| `index.html` | overwrite |
| `app.js` | overwrite |
| `styles.css` | overwrite |
| `hasina-game-single-file.html` | overwrite |
| `README.md` | overwrite |
| `debug.html` | new |

**Overwriting is automatic — same filename replaces the old file.** You do not
delete anything first.

> **Watch the filenames.** If your phone saved a copy as `app (1).js` or
> `app-2.js`, that will NOT overwrite `app.js` — it adds a junk file and the site
> keeps running the old code. Rename to the exact original name before uploading.

Then **Commit changes**. Wait about a minute for Pages to rebuild, open the site
and confirm the home screen now shows a **Random order** toggle and a
**Backend — set results** button. If it doesn't, you're seeing a cached page —
pull down to refresh, or check the filenames above.

You do **not** need to upload `questions.json` (unchanged) or the `worker/` files
(they go to Cloudflare, not GitHub — though keeping a copy in the repo is tidy).

At this point the app works exactly as before, plus the backend screen and random
order. Sync is off until Part 3.

---

## Part 2 — Cloudflare (10 min)

### 2a. Make a GitHub token

github.com → **Settings** → **Developer settings** → **Personal access tokens** →
**Fine-grained tokens** → **Generate new token**

- Token name: anything, e.g. `bachelor-results`
- Resource owner: **JaRze07**
- Expiration: a week is plenty
- Repository access: **Only select repositories** → `0003-bachelor-questionnaire`
- Permissions → **Repository permissions** → find **Contents** → set to **Read and write**
- Generate, then **copy the token** — GitHub shows it once and never again

### 2b. Create the Worker

**dash.cloudflare.com** → sign up if you need to (free) →
**Workers & Pages** → **Create** → **Create Worker**

- Give it a name, e.g. `areeb-bachelor-results`
- **Deploy** the default starter (you replace the code next)
- **Edit code** → select all the starter code, delete it, paste in all of
  `worker.js` → **Deploy**

### 2c. Add the secrets and variables

Worker → **Settings** → **Variables and Secrets**.

Add these two as type **Secret**:

| Name | Value |
| --- | --- |
| `GITHUB_TOKEN` | the token from 2a |
| `PARTY_KEY` | a passphrase you invent — you type this into the app |

Add these five as type **Text**:

| Name | Value |
| --- | --- |
| `REPO_OWNER` | `JaRze07` |
| `REPO_NAME` | `0003-bachelor-questionnaire` |
| `FILE_PATH` | `results.json` |
| `BRANCH` | `main` |
| `ALLOWED_ORIGIN` | `https://jarze07.github.io` |

Save, then **Deploy** again so the changes take effect.

`ALLOWED_ORIGIN` must be exactly that — no trailing slash, no path. Get it wrong
and the browser silently blocks the app with a CORS error.

### 2d. Copy the Worker URL

Shown on the Worker's page, like `https://areeb-bachelor-results.<something>.workers.dev`.

Quick check — open `<your-worker-url>/health` in a browser. You want:

```json
{"ok":true,"configured":true}
```

`configured: false` means a secret is missing or misspelled.

---

## Part 3 — connect the app (2 min)

Open the game → **Sync settings**:

1. **Worker URL** — paste it, no trailing slash
2. **Party key** — the `PARTY_KEY` from 2c
3. Tap **Test connection**

You want: **"Connected. Results will save to GitHub."**

4. Tap **Save results to GitHub now** — pushes what's on the phone up
5. Go back to the home screen — the top strip should read **"Live · saving to GitHub"**

A `results.json` file now appears in your repo and updates after every round.

---

## Spectators

Give them the site URL and the **Worker URL only** — never the party key. In their
Sync settings they paste just the URL, leave the key blank, and get a live
scoreboard that refreshes every 8 seconds and that they cannot change.

---

## If something breaks

| What you see | What it means |
| --- | --- |
| "Could not reach the Worker" | URL typo, or the Worker isn't deployed |
| `configured: false` at `/health` | `GITHUB_TOKEN` or `PARTY_KEY` missing in Cloudflare |
| 401 / "wrong party key" | The app's key doesn't match `PARTY_KEY` |
| CORS error in the console | `ALLOWED_ORIGIN` doesn't exactly match `https://jarze07.github.io` |
| Sync works, repo doesn't update | GitHub token lacks **Contents: Read and write**, or expired |
| Site looks unchanged after upload | Cached page, or a filename like `app (1).js` |
| Scoreboard looks stale | Open `debug.html` on the device to see what's actually stored |

**Only run one host at a time.** Last write wins — two devices editing means the
later save overwrites, it does not merge.
