# AutoChannel ESPN proxy

The dashboard runs in a browser, and browsers block it from calling ESPN directly (CORS). This small Cloudflare Worker sits in between. It fetches ESPN's scoreboard and hands it back with the header the browser needs.

- `GET /scoreboard/{sport}/{league}` returns `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard`.
- Only these 6 leagues are allowed. Every other path is refused, so this is not an open proxy:

  | Path | League |
  |---|---|
  | `/scoreboard/football/nfl` | NFL |
  | `/scoreboard/hockey/nhl` | NHL |
  | `/scoreboard/baseball/mlb` | MLB |
  | `/scoreboard/basketball/nba` | NBA |
  | `/scoreboard/football/college-football` | College football |
  | `/scoreboard/basketball/mens-college-basketball` | Men's college basketball |

- Only 3 query parameters pass through, and each is checked for format: `dates` (`20261124` or `20261124-20261130`), `groups` (a number, e.g. `80` for all FBS games) and `limit` (a number). Anything else gets a `400`.
- Responses include `Access-Control-Allow-Origin: *` and are cached at Cloudflare's edge for 30 seconds.
- `GET /` returns a small health check that lists the routes. Use it to confirm the deploy worked.

It runs on Cloudflare's **free plan**, which allows 100,000 requests a day. One open dashboard refreshing 6 leagues every 60 seconds makes about 8,600 a day.

---

## Deploy it (first time, about 15 minutes)

You need a **computer** (Mac, Windows or Linux), not a phone, because step 4 opens a browser login from the terminal. If you only have a phone or tablet, use [Option B](#option-b-no-install-paste-into-the-cloudflare-dashboard) below.

### 1. Create a free Cloudflare account
1. Go to <https://dash.cloudflare.com/sign-up>.
2. Enter an email and password and click **Sign up**.
3. Open the verification email from Cloudflare and click the link.
4. If Cloudflare asks what you want to do first, you can skip it. You don't need a domain or a credit card.

### 2. Install Node.js (once)
1. Go to <https://nodejs.org> and download the **LTS** version (20 or newer).
2. Run the installer and accept the defaults.
3. Open a terminal:
   - **Mac:** press ⌘ Space, type `Terminal`, press Enter.
   - **Windows:** press the Windows key, type `PowerShell`, press Enter.
4. Check that it worked:
   ```bash
   node --version
   ```
   It should print something like `v22.x.x`.

### 3. Get the proxy folder onto your computer
Until Phase 4 is merged into `main`, the `proxy` folder only exists on the branch `claude/peaceful-babbage-xr614k`.

- **Easiest:** while signed in to GitHub, download
  <https://github.com/colinfwilcox-creator/autochannel/archive/refs/heads/claude/peaceful-babbage-xr614k.zip>
  and unzip it.
- **Or with git:**
  ```bash
  git clone -b claude/peaceful-babbage-xr614k https://github.com/colinfwilcox-creator/autochannel.git
  ```

In the terminal, move into the `proxy` folder. Adjust the path to wherever you unzipped or cloned it, for example:
```bash
cd ~/Downloads/autochannel-claude-peaceful-babbage-xr614k/proxy
```
A quick way to get the path: type `cd ` (with a space), then drag the `proxy` folder from Finder or File Explorer into the terminal window, then press Enter.

### 4. Log in to Cloudflare from the terminal
```bash
npx wrangler login
```
- The first time, npx asks `Need to install the following packages: wrangler … Ok to proceed? (y)`. Type `y` and press Enter.
- A browser tab opens asking you to allow Wrangler to access your Cloudflare account. Click **Allow**.
- When the terminal says `Successfully logged in`, you're done with this step.

### 5. Deploy
```bash
npx wrangler deploy
```
- **First deploy only:** Cloudflare may ask you to register a `workers.dev` subdomain, e.g. `Would you like to register a workers.dev subdomain now?`. Answer `y` and type a name such as `colin-autochannel`. It becomes part of your URL and can't easily be changed later.
- When it finishes, the output ends with something like:
  ```
  Uploaded autochannel-proxy
  Deployed autochannel-proxy triggers
    https://autochannel-proxy.colin-autochannel.workers.dev
  ```
  **That `https://…workers.dev` line is your proxy URL.**

### 6. Check it works
Open these in any browser, replacing the URL with yours:
- `https://autochannel-proxy.YOUR-SUBDOMAIN.workers.dev/` should show `{"ok":true,"service":"autochannel-proxy",…}`
- `https://autochannel-proxy.YOUR-SUBDOMAIN.workers.dev/scoreboard/football/nfl` should show a large block of ESPN JSON.
- `https://autochannel-proxy.YOUR-SUBDOMAIN.workers.dev/scoreboard/soccer/eng.1` should show `Unknown route`. That's correct: it proves the allowlist works.

A brand-new `workers.dev` URL can take a minute or two to start working. If you get an error right after deploying, wait and reload.

### 7. Send the URL
Send the URL with **no trailing slash**, e.g. `https://autochannel-proxy.colin-autochannel.workers.dev`.

### Where to find the URL later
1. Log in at <https://dash.cloudflare.com>.
2. In the left sidebar, open **Workers & Pages** (under Compute on some accounts).
3. Click **autochannel-proxy**. The `workers.dev` URL is shown on the overview page and under **Settings → Domains & Routes**.

Cloudflare renames menu items from time to time, so the labels may differ slightly.

---

## Option B: no install, paste into the Cloudflare dashboard
This works from any browser, including a tablet. Do step 1 above first.
1. At <https://dash.cloudflare.com>, open **Workers & Pages** and click **Create** (sometimes shown as **Create application**).
2. Choose **Start with Hello World** (or **Create Worker**), name it `autochannel-proxy`, and click **Deploy**.
3. Click **Edit code**. Delete everything in the editor and paste the full contents of [`worker.js`](./worker.js).
4. Click **Deploy** (top right).
5. The URL is shown at the top of the editor and on the Worker's overview page. Continue from step 6 above.

---

## Updating, logs and removing
- **After changing `worker.js`:** run `npx wrangler deploy` again from the `proxy` folder. The URL stays the same.
- **To see live requests and errors:** run `npx wrangler tail`. Press Ctrl+C to stop.
- **To check the edge cache:** look at the `X-Upstream-Cache` response header in your browser's dev tools. It reads `HIT` when the response came from Cloudflare's 30-second cache.
- **To remove the proxy:** run `npx wrangler delete`.

## Troubleshooting
| Problem | Fix |
|---|---|
| `npx: command not found` | Node.js isn't installed or the terminal was opened before installing it. Close and reopen the terminal. |
| `Missing entry-point` or `Could not find wrangler.toml` | You're not in the `proxy` folder. `cd` into it (step 3). |
| `You need to register a workers.dev subdomain` | Answer `y` at the prompt, or set one in the dashboard under **Workers & Pages**, then deploy again. |
| `Authentication error` | Run `npx wrangler login` again. |
| Browser shows `Unknown route` for a league | Check the path is spelled exactly as in the table at the top. |
| Status `502` | ESPN didn't answer. Try again in a minute. |

## Files
- `worker.js`: the Worker script (the only code).
- `wrangler.toml`: Worker name, entry file and compatibility date used by `wrangler deploy`.

The repo's `tests/proxy.test.mjs` runs the Worker against a stubbed ESPN. Run it with `node tests/proxy.test.mjs` from the repo root.
