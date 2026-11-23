// Makes a copy of the minimal fixture site (site/) in a git repository of its own, for the report's tests.
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const FIX = join(import.meta.dirname, "site");
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

/** the fixture site copied into a git repository of its own; `data`: files of its data branch (refs/remotes/origin/…) */
export async function fixtureSite({ data = null, dataBranch = "report-data" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kit-report-"));
  cpSync(FIX, root, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: root, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-q", "-m", "site");
  if (data) {
    git("checkout", "-q", "--orphan", dataBranch); git("rm", "-rfq", ".");
    for (const [f, body] of Object.entries(data)) { mkdirSync(join(root, f, ".."), { recursive: true }); writeFileSync(join(root, f), body); }
    git("add", "-A"); git("commit", "-q", "-m", "data");
    git("update-ref", `refs/remotes/origin/${dataBranch}`, dataBranch);
    git("checkout", "-q", "-f", "main"); git("branch", "-q", "-D", dataBranch);
  }
  const { loadConfig } = await import("../../../lib/config.mjs");
  return { root, cfg: await loadConfig(root), git };
}

