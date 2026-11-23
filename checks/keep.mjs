// Keeps this run's record and state on the site's report-data branch (cfg.checks.dataBranch, made on the first run),
// so every number has a history:
//   latest/                     main's last deploy: state.json, record-chromium.json (record-webkit.json)
//   history/<date>-<sha7>/      each deploy of main: state.json, record-chromium.json.gz
//   history/index.json          one line per deploy of main: commit, date, summary, the main numbers (for trends)
//   pr/<n>/                     a pull request's last run (replaced on every push; compared with main's latest)
//   branch/<name>/              a manual run on another branch (never main's baseline)
//   broken/<date>-<sha7>/       a run of main whose measuring failed
//   shots/                      the pictures of the blocks (site-kit shots): <block>/<w>x<h>.jpg and index.json
// site-kit checks keep [--pr <n>]      (CI, after the checks; it needs push rights to the repository)
// site-kit checks keep --forget <n>    a closed pull request: its pr/<n>/ is removed
// latest/, history/ and shots/ are written only from main (GITHUB_REF refs/heads/<cfg.mainBranch>: SITE_KIT_MAIN, the
// workflows' main-branch), and latest/ and history/ never from a run whose measuring failed: a broken run must not
// become the baseline the next ones are compared with. Only the first engine counts for that (Chromium in CI): a second
// engine that fails (WebKit) only marks its own results as not measured.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { siteIO, options, mainBranch, dataBranch } from "../lib/config.mjs";
import { mergeShots } from "../shots/index.mjs";

export async function keep(cfg, args = []) {
  const io = siteIO(cfg), opt = options(args, ["pr", "forget"]), ROOT = io.root;
  const OUT = io.abs(cfg.paths.out);
  const BRANCH = dataBranch(cfg);
  const pr = typeof opt("pr") === "string" ? opt("pr") : null;
  const forget = typeof opt("forget") === "string" ? opt("forget") : null;
  // the bot's name on the commits (and on a rebase when another run pushed first)
  Object.assign(process.env, { GIT_AUTHOR_NAME: "github-actions[bot]", GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com", GIT_COMMITTER_NAME: "github-actions[bot]", GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com" });
  const ref = process.env.GITHUB_REF || "";
  const onMain = ref === `refs/heads/${mainBranch(cfg)}`;
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (!forget && !existsSync(join(OUT, "state.json"))) { console.error(`keep: no ${io.rel(join(OUT, "state.json"))} — run \`site-kit checks\` first`); return 2; }
  const state = forget ? null : JSON.parse(readFileSync(join(OUT, "state.json"), "utf8"));
  const sha = state ? (state.commit || "unknown").slice(0, 7) : "", day = state ? (state.generated || new Date().toISOString()).slice(0, 10) : "";
  const broken = state && isBroken(state);
  const shotsIndex = join(OUT, "shots", "index.json");

  const dir = mkdtempSync(join(tmpdir(), "report-data-"));
  try {
    const has = (() => { try { git(ROOT, "ls-remote", "--exit-code", "--heads", "origin", BRANCH); return true; } catch { return false; } })();
    if (has) { git(ROOT, "fetch", "--depth=1", "origin", `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`); git(ROOT, "worktree", "add", "--detach", dir, `origin/${BRANCH}`); }
    else { git(ROOT, "worktree", "add", "--detach", dir); git(dir, "checkout", "--orphan", BRANCH); git(dir, "rm", "-rf", "--quiet", "--ignore-unmatch", "."); writeFileSync(join(dir, "README.md"), `# ${BRANCH}\n\nWritten by the checks (\`site-kit checks keep\`): the measured state of the site's design system on every deploy of main (history/, latest/), the last run of each pull request (pr/) and the pictures of the blocks (shots/). Not code: do not merge into main.\n`); }

    const put = (to, from, gz = false) => { mkdirSync(join(dir, to, ".."), { recursive: true }); if (gz) writeFileSync(join(dir, to), gzipSync(readFileSync(from))); else copyFileSync(from, join(dir, to)); };
    const records = ["record-chromium.json", "record-webkit.json"].filter((f) => existsSync(join(OUT, f)));
    const what = [];
    if (forget) { rmSync(join(dir, "pr", String(forget)), { recursive: true, force: true }); what.push(`pr/${forget} removed`); }
    else if (pr || !onMain || broken) {
      // a pull request, a run on another branch, or a broken run of main: kept apart, never main's baseline
      const to = pr ? `pr/${pr}` : !onMain ? `branch/${(process.env.GITHUB_REF_NAME || "local").replace(/[^\w.-]+/g, "-")}` : `broken/${day}-${sha}`;
      put(`${to}/state.json`, join(OUT, "state.json"));
      for (const f of records) put(`${to}/${f}`, join(OUT, f));
      what.push(to + (broken ? " (the measuring failed: main's baseline left as it was)" : ""));
      if (broken) console.log(`::warning title=Checks::the measuring failed (${(state.errors || []).join("; ")}): latest/ and history/ not updated`);
    } else {
      put("latest/state.json", join(OUT, "state.json"));
      for (const f of records) put(`latest/${f}`, join(OUT, f));
      if (!records.includes("record-webkit.json")) rmSync(join(dir, "latest/record-webkit.json"), { force: true });
      const h = `history/${day}-${sha}`;
      put(`${h}/state.json`, join(OUT, "state.json"));
      for (const f of records) put(`${h}/${f}.gz`, join(OUT, f), true);
      // the index: the numbers worth a trend line
      const idxFile = join(dir, "history/index.json");
      const idx = existsSync(idxFile) ? JSON.parse(readFileSync(idxFile, "utf8")) : [];
      const rec = existsSync(join(OUT, "record-chromium.json")) ? JSON.parse(readFileSync(join(OUT, "record-chromium.json"), "utf8")) : {};
      const line = { commit: state.commit, sha, day, when: state.generated, summary: state.summary,
        weight: rec.weight ? { total: rec.weight.total, js: rec.weight.by?.js?.sent || 0, images: rec.weight.by?.images?.sent || 0 } : null,
        rules: Object.fromEntries(state.rules.filter((r) => r.kind !== "inventory").map((r) => [r.id, [r.status, r.value ?? null]])) };
      const at = idx.findIndex((x) => x.commit === state.commit);
      if (at >= 0) idx[at] = line; else idx.push(line);
      writeFileSync(idxFile, JSON.stringify(idx.slice(-500)));
      // the full records of the last 200 deploys are kept; older ones live on in the index (and in git history)
      const dirs = readdirSync(join(dir, "history")).filter((d) => /^\d{4}-\d\d-\d\d-/.test(d)).sort();
      for (const d of dirs.slice(0, Math.max(0, dirs.length - 200))) rmSync(join(dir, "history", d), { recursive: true, force: true });
      what.push(`latest/ and ${h}`);
    }
    // the pictures (layer 3; schema in SPEC.md «Three layers»): only from main. Each block this run took replaces its
    // kept entry and its folder shots/<id>/ (no picture of an old size stays behind); the other blocks stay; a block no
    // longer in report.blocks goes
    if (!forget && onMain && existsSync(shotsIndex)) {
      const keptFile = join(dir, "shots/index.json");
      const kept = existsSync(keptFile) ? JSON.parse(readFileSync(keptFile, "utf8")) : null, fresh = JSON.parse(readFileSync(shotsIndex, "utf8"));
      const ids = (cfg.report?.blocks || []).map((b) => b.id);
      const index = mergeShots(kept, fresh, ids.length ? ids : null);
      for (const id of Object.keys(kept?.blocks || {})) if (!index.blocks[id]) rmSync(join(dir, "shots", id), { recursive: true, force: true });
      // a block this run took: its folder holds exactly its merged entry's pictures (this run's, and kept ones of sizes
      // it could not take); a block it took none of (no entry, or an empty one from an older run) is left as it was
      const took = Object.keys(fresh.blocks || {}).filter((id) => index.blocks[id] && (fresh.blocks[id].sizes || []).length);
      for (const id of took) {
        const want = new Set(index.blocks[id].sizes.map((s) => s.file));
        const folder = join(dir, "shots", id);
        if (existsSync(folder)) for (const f of readdirSync(folder)) if (!want.has(`${id}/${f}`)) rmSync(join(folder, f), { recursive: true, force: true });
        if (existsSync(join(OUT, "shots", id))) cpSync(join(OUT, "shots", id), folder, { recursive: true });
      }
      mkdirSync(join(dir, "shots"), { recursive: true });
      writeFileSync(keptFile, JSON.stringify(index, null, 1));
      if (took.length) what.push(`shots of ${took.join(", ")}`);
    }
    git(dir, "add", "-A");
    try { git(dir, "diff", "--cached", "--quiet"); console.log("keep: nothing new"); }
    catch {
      git(dir, "commit", "--quiet", "-m", forget ? `Forget PR #${forget} (closed)` : `Checks of ${sha} (${pr ? "PR #" + pr : onMain ? mainBranch(cfg) : ref || "local"})`);
      // other runs push too (pull requests, a merge): fetch, put this commit on top, try again
      for (let i = 0; ; i++) {
        try { git(dir, "push", "origin", `HEAD:refs/heads/${BRANCH}`); break; }
        catch (e) {
          if (i >= 4) throw e;
          git(dir, "fetch", "--depth=20", "origin", `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`);
          git(dir, "rebase", `origin/${BRANCH}`);
        }
      }
      console.log(`keep: ${what.join("; ")} on ${BRANCH}`);
    }
  } finally {
    try { git(ROOT, "worktree", "remove", "--force", dir); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
  return 0;
}

/** a run whose measuring failed: an error of the first engine's record, or a measured rule that could not run. The
 *  second engine's errors (prefixed with its name in state.errors) and code rules that could not run do not count. */
export function isBroken(state) {
  const first = Object.values(state.engines || {})[0];
  const errors = first ? first.errors || [] : state.errors || [];
  return errors.length > 0 || (state.rules || []).some((r) => r.status === "error" && !String(r.id).startsWith("code."));
}
