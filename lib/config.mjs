// The site's adapter: `site-kit.config.mjs` at the root of the site (the folder the command runs in).
// Everything the kit knows about a site comes from it; the kit's own code never names a site.
// See SPEC.md for every field.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

export const KIT = resolve(import.meta.dirname, "..");

const DEFAULT_PATHS = {
  dist: "dist",
  scale: "design/scale.json",
  decisions: "design/decisions.json",
  questions: "design/questions.json",
  styles: "src/styles",
  scripts: "src/scripts",
  fonts: "src/assets/fonts",
  out: ".site-kit/out",          // records and state of the checks (not committed)
  report: ".site-kit/report",    // the built review page (not committed)
  rounds: null,                  // a site's review rounds (data.json of typed blocks), optional
  shots: null,                   // the rounds' pictures, optional
};

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
    checks: {},
    report: {},
    rules: {},
    images: null,
    typeset: {},
    ...raw,
    paths,
    root,
  };
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
  /** every file under a folder (relative paths), optionally filtered by extension */
  const files = (dir, ext) => {
    const out = [];
    const walk = (d) => {
      if (!existsSync(abs(d))) return;
      for (const f of readdirSync(abs(d)).sort()) {
        const p = join(d, f);
        if (f === "node_modules" || f.startsWith(".")) continue;
        if (statSync(abs(p)).isDirectory()) walk(p);
        else if (!ext || [].concat(ext).some((e) => f.endsWith(e))) out.push(p);
      }
    };
    walk(dir);
    return out;
  };
  const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  const tryGit = (...a) => { try { return git(...a); } catch { return null; } };
  const rel = (p) => relative(root, resolve(root, p));
  return { root, abs, exists, read, json, files, git, tryGit, rel };
}

/** `--key value` / `--flag` options of a command line */
export function options(args) {
  return (k, d) => {
    const i = args.indexOf("--" + k);
    if (i < 0) return d;
    const v = args[i + 1];
    return v != null && !v.startsWith("--") ? v : true;
  };
}
