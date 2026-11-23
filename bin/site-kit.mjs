#!/usr/bin/env node
// site-kit <command> [...]: run in the root of a site (the folder with site-kit.config.mjs).
// Each command is a module that exports `run(args, cfg)`; `site-kit help` lists them.
import { loadConfig } from "../lib/config.mjs";

const COMMANDS = {
  checks: ["../checks/cli.mjs", "the design system's checks: measure, state, keep, answer (site-kit checks help)"],
  rules: ["../rules/cli.mjs", "the rules read from the code only (fast; exits 1 when a hard rule fails with --strict)"],
  report: ["../report/cli.mjs", "build the review page of the system"],
  shots: ["../shots/cli.mjs", "pictures of the blocks: only those whose files changed (--changed) or all (--all)"],
  typeset: ["../typeset/cli.mjs", "where lines may break; --lint lists what a proofreader would fix"],
  images: ["../images/cli.mjs", "source pictures -> AVIF/WebP at the lowest quality that still looks the same"],
  audit: ["../audit/cli.mjs", "the built pages in a real browser at the sizes that matter (FM_ENGINE / --engine)"],
  changed: ["../lib/changed.mjs", "exit 0 when the design files changed between two commits (CI: lighter checks)"],
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === "help" || !COMMANDS[cmd]) {
  console.log("site-kit <command>\n");
  for (const [k, [, what]] of Object.entries(COMMANDS)) console.log(`  ${k.padEnd(9)} ${what}`);
  process.exit(cmd && cmd !== "help" ? 2 : 0);
}
const cfg = await loadConfig();
const mod = await import(new URL(COMMANDS[cmd][0], import.meta.url));
const code = await mod.run(args, cfg);
if (typeof code === "number") process.exitCode = code;
