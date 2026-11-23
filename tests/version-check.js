// Cache-busting guard. Run before every commit that touches the front end:
//   node tests/version-check.js            checks uncommitted changes against HEAD
//   node tests/version-check.js --commit   checks the last commit (HEAD vs HEAD~1)
// Fails if front-end files changed but APP_VERSION in index.html did not, or if
// any stylesheet/script bypasses the versioned loader.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const git = cmd => execSync(`git ${cmd}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures++; };

const VERSION_RE = /window\.APP_VERSION\s*=\s*"([^"]+)"/g;
const versionOf = html => { const m = [...(html || "").matchAll(VERSION_RE)]; return m.length === 1 ? m[0][1] : null; };
const isFrontEnd = f => f === "index.html" || f === "app.js" || f === "styles.css" ||
  /^(config|modules)\/[^/]+\.js$/.test(f);

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// 1. One APP_VERSION, in YYYY.MM.DD-N form.
const matches = [...html.matchAll(VERSION_RE)];
check(matches.length === 1, `APP_VERSION defined exactly once in index.html (found ${matches.length})`);
const version = versionOf(html);
check(/^\d{4}\.\d{2}\.\d{2}-\d+$/.test(version || ""), `APP_VERSION "${version}" has the form YYYY.MM.DD-N`);

// 2. Nothing loads outside the versioned loader.
check(!/<script[^>]*\ssrc=/i.test(html), "no static <script src> tags (all scripts go through versioned())");
check(!/<link[^>]*\shref=/i.test(html), "no static <link href> tags (styles.css goes through versioned())");

// 3. The loader list covers every front-end script, and every entry exists.
const listMatch = html.match(/\[\s*("[^\]]+?")\s*\]\.forEach/);
const listed = listMatch ? [...listMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : [];
const onDisk = ["app.js",
  ...fs.readdirSync(path.join(root, "config")).filter(f => f.endsWith(".js")).map(f => `config/${f}`),
  ...fs.readdirSync(path.join(root, "modules")).filter(f => f.endsWith(".js")).map(f => `modules/${f}`)];
const missing = onDisk.filter(f => !listed.includes(f));
const ghosts = listed.filter(f => !fs.existsSync(path.join(root, f)));
check(missing.length === 0, `every front-end script is in the loader list${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
check(ghosts.length === 0, `every loader entry exists on disk${ghosts.length ? ` (missing files: ${ghosts.join(", ")})` : ""}`);
check(listed[listed.length - 1] === "app.js", "app.js loads last");

// 4. Front-end changes come with a version bump.
const commitMode = process.argv.includes("--commit");
let changed, previousHtml;
try {
  if (commitMode) {
    changed = git("diff --name-only HEAD~1 HEAD").split("\n").filter(Boolean);
    previousHtml = git("show HEAD~1:index.html");
  } else {
    const tracked = git("diff --name-only HEAD").split("\n").filter(Boolean);
    const untracked = git("ls-files --others --exclude-standard").split("\n").filter(Boolean);
    changed = [...tracked, ...untracked];
    previousHtml = git("show HEAD:index.html");
  }
} catch (e) {
  changed = null;
}
if (changed === null) {
  console.log("skip  git comparison (no previous commit to compare with)");
} else {
  const frontEnd = changed.filter(isFrontEnd);
  const before = versionOf(previousHtml);
  const what = commitMode ? "last commit" : "uncommitted changes";
  if (!frontEnd.length) {
    console.log(`info  ${what}: no front-end files changed`);
  } else {
    check(before !== version,
      `${what} touch ${frontEnd.length} front-end file(s) and APP_VERSION changed (${before || "none"} → ${version})`);
    if (before === version) console.log(`      changed: ${frontEnd.join(", ")}\n      → bump APP_VERSION in index.html`);
  }
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nVERSION CHECK PASSED");
process.exit(failures ? 1 : 0);
