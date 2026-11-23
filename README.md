# AutoChannel

AutoChannel decides what should be on every TV in a sports bar. It scores live games (ChannelScore) and assigns them to anchor and secondary TVs. The algorithm is in [`AutoChannel_Algorithm_Spec_V1.md`](AutoChannel_Algorithm_Spec_V1.md).

The dashboard is a static site with no build step, served by GitHub Pages from `main`. Live scores come from ESPN through the Cloudflare Worker in [`proxy/`](proxy/README.md).

## Layout

| Path | What it is |
|---|---|
| `index.html` | Page shell, **`APP_VERSION`**, and the versioned loader for every CSS/JS file |
| `app.js` | Dashboard UI: setup panel, Live/Mock toggle, TV cards |
| `styles.css` | All styles |
| `config/` | Venue presets, market tables, national lists, live-feed settings (`live.js` holds `PROXY_BASE_URL`) |
| `modules/` | Fetcher/normalizer, scorer, venue builder, TV assignment engine |
| `proxy/` | Cloudflare Worker that proxies ESPN scoreboards (deployed separately) |
| `tests/` | Node checks (see below) |

## Releasing a front-end change: bump `APP_VERSION`

Browsers cache `app.js`, `styles.css` and the module files. To make a new deploy show up on a normal reload, every stylesheet and script is requested as `file?v=APP_VERSION`. A new version is a new URL, so the old cached file is never used.

**`APP_VERSION` lives in exactly one place: near the top of `index.html`.**

```js
window.APP_VERSION = "2026.11.23-1";
```

**Rule:** any commit that changes `index.html`, `app.js`, `styles.css`, `config/*.js` or `modules/*.js` must bump it.
- Format: `YYYY.MM.DD-N`, where the date is the day of the change and `N` counts up from 1 within that day (`2026.11.23-1`, `2026.11.23-2`, then `2026.11.24-1`).
- It's a date build number rather than the commit hash, because a commit can't contain its own hash.

The version shows in small text in the dashboard footer ("AutoChannel build 2026.11.23-1"), so you can confirm on a phone which build is loaded.

**Before committing, run:**
```bash
node tests/validate.js && node tests/version-check.js
```
`version-check.js` fails if front-end files changed but `APP_VERSION` didn't. It also fails if a `<script>` or `<link>` tag skips the versioned loader, or if a new file in `config/` or `modules/` is missing from the loader list. After committing, `node tests/version-check.js --commit` checks the last commit the same way.

**Adding a new script:** add it to the list at the bottom of `index.html`, in load order, with `app.js` last. Don't add a plain `<script src>` tag.

**Why this works on a normal reload:** GitHub Pages lets browsers cache files for about 10 minutes. On reload the browser re-checks `index.html` with the server, picks up the new `APP_VERSION`, and requests the new `?v=` URLs. If a phone still shows the old build number in the footer, it's holding a cached `index.html`. Wait a few minutes for the Pages cache to expire, or pull to refresh again.

## Tests

| Command | What it checks |
|---|---|
| `node tests/validate.js` | Algorithm: lock list, saturation table, anchor rules, diehard/demotion, market tables |
| `node tests/version-check.js` | Cache busting: `APP_VERSION` bumped, every file goes through the versioned loader |
| `node tests/proxy.test.mjs` | Worker allowlist, CORS and caching against a stubbed ESPN |
| `NODE_USE_ENV_PROXY=1 node tests/live-check.js [market]` | Live feed through the deployed Worker: games per league, normalization failures, team-name matches |

## Live data

Set `PROXY_BASE_URL` in `config/live.js` to the Worker URL. An empty string means mock data only. To deploy the Worker, see [`proxy/README.md`](proxy/README.md).
