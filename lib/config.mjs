// The site's adapter: `site-kit.config.mjs` at the root of the site (the folder the command runs in).
// Everything the kit knows about a site comes from it; the kit's own code never names a site.
// See SPEC.md for every field.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { env } from "./env.mjs";

export { env };

export const KIT = resolve(import.meta.dirname, "..");

const DEFAULT_PATHS = {
  dist: "dist",
  scale: "design/scale.json",
  decisions: "design/decisions.json",
  questions: "design/questions.json",
  styles: "src/styles",          // a folder, or a list of folders and files
  scripts: "src/scripts",        // a folder, or a list of folders and files (QQ: ["src/scripts", "src/templates", "public/vt.js"])
  fonts: "src/assets/fonts",
  out: ".site-kit/out",          // records and state of the checks (not committed)
  report: ".site-kit/report",    // the built review page (not committed)
  rounds: null,                  // a site's review rounds (data.json of typed blocks), optional
  shots: null,                   // the rounds' pictures, optional
};

// what the checks measure when the adapter does not say: the home page and the not-found page, at eight screens
// (phones and tablets both ways, laptops, a wide screen; phones with their pixel ratio, for the pictures)
export const DEFAULT_CHECKS = {
  pages: [{ path: "", title: "Home", main: true }, { path: "no-such-page", title: "Not found", status: 404 }],
  sizes: [
    { w: 320, h: 568, dpr: 2, touch: true }, { w: 390, h: 844, dpr: 3, touch: true }, { w: 844, h: 390, dpr: 3, touch: true },
    { w: 768, h: 1024, dpr: 2, touch: true }, { w: 1024, h: 768, dpr: 2, touch: true }, { w: 1366, h: 650, dpr: 1 },
    { w: 1440, h: 900, dpr: 2 }, { w: 1920, h: 1080, dpr: 1 },
  ],
  dataBranch: "report-data",
};

/** the branch that is the live site: SITE_KIT_MAIN (the workflows set it from their input main-branch), else the
 *  adapter's mainBranch, else "main" */
export const mainBranch = (cfg) => env("MAIN") || cfg?.mainBranch || "main";
/** the branch the checks keep their records and pictures on (checks.dataBranch, else "report-data") */
export const dataBranch = (cfg) => cfg?.checks?.dataBranch || DEFAULT_CHECKS.dataBranch;

/** A clear stop for something a command needs and the adapter does not give: the command prints the message (no stack)
 *  and exits 2. `need("report", "paths.scale", io.exists(cfg.paths.scale), "the scale of sizes (scale.json)")` */
export class NeedError extends Error {}
export function need(step, field, ok, what) {
  if (!ok) throw new NeedError(`site-kit ${step}: needs ${what} — set ${field} in site-kit.config.mjs (SPEC.md «The adapter»)`);
}

let cached = null;

/** Loads the site's config from `root` (default: the current folder) and fills the defaults. */
export async function loadConfig(root = process.env.SITE_KIT_ROOT || process.cwd()) {
  if (cached && cached.root === resolve(root)) return cached;
  root = resolve(root);
  const file = join(root, "site-kit.config.mjs");
  if (!existsSync(file)) throw new Error(`site-kit: no site-kit.config.mjs in ${root}`);
  const raw = (await import(pathToFileURL(file).href)).default;
  const paths = { ...DEFAULT_PATHS, ...(raw.paths || {}) };
  const cfg = {
    tag: raw.name,
    owner: "the owner",
    lang: "en",
    report: {},
    rules: {},
    images: null,
    typeset: {},
    ...raw,
    checks: { ...DEFAULT_CHECKS, ...(raw.checks || {}) },
    paths,
    root,
  };
  cfg.mainBranch = mainBranch(raw);
  cached = cfg;
  return cfg;
}

/** Helpers every module gets for reading the site (paths relative to the site's root). */
export function siteIO(cfg) {
  const root = cfg.root;
  const abs = (p) => resolve(root, p);
  const exists = (p) => p != null && existsSync(abs(p));
  const read = (p) => readFileSync(abs(p), "utf8");
  const json = (p, fallback) => (exists(p) ? JSON.parse(read(p)) : fallback);
  /** every file under a folder (relative paths), optionally filtered by extension; `dir` may be a list of folders and
   *  files (a file named in it is taken as it is, if its extension fits) */
  const files = (dir, ext) => {
    const out = [], fits = (f) => !ext || [].concat(ext).some((e) => f.endsWith(e));
    const walk = (d) => {
      if (!existsSync(abs(d))) return;
      if (!statSync(abs(d)).isDirectory()) { if (fits(d)) out.push(join(d)); return; }
      for (const f of readdirSync(abs(d)).sort()) {
        const p = join(d, f);
        if (f === "node_modules" || f.startsWith(".")) continue;
        if (statSync(abs(p)).isDirectory()) walk(p);
        else if (fits(f)) out.push(p);
      }
    };
    for (const d of [].concat(dir ?? [])) walk(d);
    return [...new Set(out)];
  };
  const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  const tryGit = (...a) => { try { return git(...a); } catch { return null; } };
  const rel = (p) => relative(root, resolve(root, p));
  /** a branch of origin fetched shallowly into refs/remotes/origin/<branch>, quietly (no remote, no network: false).
   *  Always tried before the branch is read, so a local copy is never older than the remote's (a ref fetched hours ago
   *  would show an old state as main's latest). */
  const fetchBranch = (branch) => {
    try {
      execFileSync("git", ["fetch", "--quiet", "--no-tags", "--depth=1", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
        { cwd: root, stdio: "ignore", timeout: 30000 });
      return true;
    } catch { return false; }
  };
  return { root, abs, exists, read, json, files, git, tryGit, rel, fetchBranch };
}

/** `--key value` / `--flag` options of a command line. Keys in `valued` take a value: given without one (at the end, or
 *  before another --option) they stop the command with a clear message instead of reading as `true`. */
export function options(args, valued = []) {
  return (k, d) => {
    const i = args.indexOf("--" + k);
    if (i < 0) return d;
    const v = args[i + 1];
    const has = v != null && !v.startsWith("--");
    if (!has && valued.includes(k)) throw new NeedError(`site-kit: --${k} needs a value (--${k} <value>)`);
    return has ? v : true;
  };
}
