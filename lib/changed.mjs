// site-kit changed [--base <sha>] [--head <sha>]: did a design file change between two commits?
// Exit 0 when a changed file matches a glob of `cfg.checks.designPaths` (or when it cannot tell: then the checks run,
// they never get skipped by mistake), 1 when none does. Prints which files matched.
// CI (lighter checks, checks.yml): a pull request measures the design system only when this says so (or it has the
// label `checks`). Without --base/--head it reads the event (GITHUB_EVENT_PATH):
//   pull_request   the test merge commit (GITHUB_SHA) against its first parent: exactly what the pull request changes,
//                  even when main has moved on since the branch was made (base.sha of the event is the fallback)
//   push           before → after (a new branch, before = 000…: everything counts)
//   anything else  (a manual run, a schedule) exit 0: not a pull request, always measured
// The commits are fetched shallowly when the checkout does not have them (a diff of two trees needs no history).
// When GITHUB_OUTPUT is set it also writes `changed=true|false` and `files=<n>` there.
import { appendFileSync, readFileSync } from "node:fs";
import { options, siteIO } from "./config.mjs";

/** a glob as a RegExp: `**` any folders (also none), `*` anything but "/", `?` one character, `{a,b}` either */
export function globToRegExp(glob) {
  let re = "", i = 0, depth = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/", atStart = i === 0 || glob[i - 1] === "/";
        if (atStart && slashAfter) { re += "(?:.*/)?"; i += 3; continue; }      // "a/**/b", "**/b": any folders, or none
        re += ".*"; i += 2; continue;                                          // "a/**": everything under a
      }
      re += "[^/]*"; i++; continue;
    }
    if (c === "?") { re += "[^/]"; i++; continue; }
    if (c === "{") { re += "(?:"; depth++; i++; continue; }
    if (c === "}" && depth) { re += ")"; depth--; i++; continue; }
    if (c === "," && depth) { re += "|"; i++; continue; }
    re += /[.+^$()|[\]\\]/.test(c) ? "\\" + c : c;
    i++;
  }
  return new RegExp("^" + re + "$");
}

/** the changed files that match any of the globs (a glob without "/" matches a file of that name anywhere, as in .gitignore) */
export function matchFiles(files, globs) {
  const res = globs.map((g) => globToRegExp(g.includes("/") ? g.replace(/^\.?\//, "") : "**/" + g));
  return files.filter((f) => res.some((r) => r.test(f)));
}

const ZERO = /^0+$/;

/** which two commits to compare: from the command line, else from the GitHub event; null = cannot tell (run the checks) */
export function commitsOf(opt, env = process.env, readEvent = (p) => JSON.parse(readFileSync(p, "utf8"))) {
  if (opt("base") && opt("head")) return { base: opt("base"), head: opt("head"), why: "given" };
  if (opt("base")) return { base: opt("base"), head: "HEAD", why: "given" };
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return { none: "no --base and no GitHub event" };
  const ev = readEvent(path), name = env.GITHUB_EVENT_NAME || "";
  if (ev.pull_request) {
    const pr = ev.pull_request;
    // on `pull_request` GITHUB_SHA is the test merge commit: its first parent is the base it was merged onto
    const merge = name === "pull_request" && env.GITHUB_SHA && env.GITHUB_SHA !== pr.head.sha ? env.GITHUB_SHA : null;
    return { base: pr.base.sha, head: merge || pr.head.sha, merge: !!merge, why: `pull request #${pr.number}` };
  }
  if (name === "push" && ev.after) {
    if (!ev.before || ZERO.test(ev.before)) return { none: "a new branch (no commit before it)" };
    return { base: ev.before, head: ev.after, why: "push" };
  }
  return { none: `not a pull request (${name || "unknown event"})` };
}

export async function run(args, cfg) {
  const opt = options(args, ["base", "head"]), io = siteIO(cfg);
  const globs = cfg.checks?.designPaths;
  const out = (changed, n) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nfiles=${n}\n`); return changed ? 0 : 1; };
  if (!globs?.length) { console.log("changed: no checks.designPaths in the adapter: every change counts"); return out(true, 0); }
  const c = commitsOf(opt);
  if (c.none) { console.log(`changed: ${c.none}: the checks run`); return out(true, 0); }
  // the commits, fetched shallowly when this checkout does not have them
  const has = (sha) => io.tryGit("cat-file", "-e", `${sha}^{commit}`) !== null;
  const fetch = (sha, depth = 1) => io.tryGit("fetch", "--quiet", "--no-tags", `--depth=${depth}`, "origin", sha);
  if (c.merge) {
    // the merge commit's first parent: exactly the pull request's changes
    if (!io.tryGit("rev-parse", "--verify", "--quiet", `${c.head}^1`)) fetch(c.head, 2);
    const p = io.tryGit("rev-parse", "--verify", "--quiet", `${c.head}^1`);
    if (p) c.base = p.trim();
  }
  for (const sha of [c.base, c.head]) if (!has(sha)) fetch(sha);
  const diff = io.tryGit("diff", "--name-only", "--no-renames", c.base, c.head);
  if (diff === null) { console.log(`changed: cannot compare ${c.base.slice(0, 7)} and ${c.head.slice(0, 7)}: the checks run`); return out(true, 0); }
  const files = diff.split("\n").filter(Boolean);
  const hit = matchFiles(files, globs);
  const what = `${c.why}, ${c.base.slice(0, 7)}..${c.head.slice(0, 7)}`;
  if (!hit.length) {
    console.log(`changed: no design file changed (${files.length} file${files.length === 1 ? "" : "s"}; ${what})`);
    for (const f of files.slice(0, 20)) console.log("  - " + f);
    return out(false, 0);
  }
  console.log(`changed: ${hit.length} design file${hit.length === 1 ? "" : "s"} of ${files.length} changed (${what})`);
  for (const f of hit.slice(0, 20)) console.log("  + " + f);
  if (hit.length > 20) console.log(`  … and ${hit.length - 20} more`);
  return out(true, hit.length);
}
