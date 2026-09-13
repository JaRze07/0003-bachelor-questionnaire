# Results Worker — setup

A Cloudflare Worker that holds the GitHub token so the public page never has to.
It commits the game results to `results.json` in the repo.

- `GET /results` — public, no auth. Any device can read the live scoreboard.
- `POST /results` — needs the `X-Party-Key` header. Only the host can save.
- `GET /health` — public, says whether the secrets are set.

You need two things: a **GitHub token** (stored in Cloudflare, never in the repo)
and a **party key** (a passphrase you invent, typed into the app once).

The Worker URL ends up visible in the page source — that is fine and expected.
The party key is what stops strangers writing to your results.

---

## 1. Create the GitHub token

github.com → Settings → Developer settings → **Personal access tokens** →
**Fine-grained tokens** → Generate new token.

- Resource owner: **JaRze07**
- Repository access: **Only select repositories** → `0003-bachelor-questionnaire`
- Permissions → Repository permissions → **Contents: Read and write**
- Expiration: short is fine — a week covers the trip

Copy the token. You only see it once.

## 2. Deploy the Worker

### From a computer

```bash
npm install -g wrangler
wrangler login
cd worker
wrangler deploy
wrangler secret put GITHUB_TOKEN     # paste the GitHub token
wrangler secret put PARTY_KEY        # invent a passphrase
```

### From the Cloudflare dashboard (works on a phone)

dash.cloudflare.com → Workers & Pages → **Create** → **Create Worker** → deploy the
starter, then **Edit code** and paste in all of `worker.js`. Then:

- Settings → **Variables and Secrets** → add secrets `GITHUB_TOKEN` and `PARTY_KEY`
- Settings → **Variables** → add plain text vars:
  `REPO_OWNER=JaRze07`, `REPO_NAME=0003-bachelor-questionnaire`, `FILE_PATH=results.json`,
  `BRANCH=main`, `ALLOWED_ORIGIN=https://jarze07.github.io`

Save and deploy. Note the URL, e.g. `https://areeb-bachelor-results.<you>.workers.dev`.

## 3. Point the app at it

Open the game → **Sync settings**:

- **Worker URL** — the URL from step 2, no trailing slash
- **Party key** — the `PARTY_KEY` you chose
- Tap **Test connection** — it should say *Connected. Results will save to GitHub.*

Then **Save results to GitHub now** once, to push what is already on the phone.

## 4. Spectators

Give other people the site URL and the **Worker URL only** — no party key. They get
the live scoreboard, refreshing every 8 seconds, and cannot change anything.

---

## Checks and gotchas

- `curl https://<worker>/health` → `{"ok":true,"configured":true}`. If `configured`
  is false, a secret is missing.
- **401 from a save** means the party key does not match `PARTY_KEY`.
- **CORS errors** mean `ALLOWED_ORIGIN` does not match the site origin exactly.
  It must be `https://jarze07.github.io` with no path and no trailing slash. Use
  `*` only while testing.
- **Last write wins.** If the host phone and a laptop both edit, the later save
  overwrites. Fine for one host; do not run two hosts at once.
- The offline single-file build can sync too, but only if `ALLOWED_ORIGIN` is `*`,
  because a `file://` page sends a null origin. Left as-is it just runs local-only,
  which is the safer default.
- Every save is a commit, so `results.json` history in the repo doubles as a
  round-by-round audit trail.
