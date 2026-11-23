// site-kit rules [--strict] [--json out.json]: every code rule (the kit's design rules, the lessons, the site's own),
// printed like Flow Medium's `npm run rules`. --strict: exit 1 when one fails (CI, on every pull request).
import { writeFileSync } from "node:fs";
import { options } from "../lib/config.mjs";
import { learningRules } from "./learnings.mjs";
import { minimalContext } from "./context.mjs";

export async function all(cfg) {
  let source = null;
  try { source = await import("../checks/source.mjs"); } catch (e) { if (e.code !== "ERR_MODULE_NOT_FOUND") throw e; }
  if (source?.sourceRules) return { ...(await source.sourceRules(cfg)), from: "checks/source.mjs" };
  // checks/source.mjs not there: the lessons alone (and the site's own rules, on the same context)
  const ctx = minimalContext(cfg);
  const rules = [...learningRules(ctx), ...(typeof cfg.rules?.code === "function" ? cfg.rules.code(ctx) : [])];
  return { results: rules.map((r) => ({ ...r, ok: !r.error && r.fails.length === 0, n: r.error ? null : r.fails.length })), from: "rules/learnings.mjs only" };
}

export async function run(args, cfg) {
  const opt = options(args, ["json"]);
  const out = { when: new Date().toISOString(), ...(await all(cfg)) };
  if (typeof opt("json") === "string") writeFileSync(opt("json"), JSON.stringify(out, null, 1));
  for (const r of out.results) {
    if (r.error) { console.log(`ERR  ${r.id}: ${r.title}: could not run (${r.error})`); continue; }
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.id}: ${r.title} (${r.n})${r.note ? ` · ${r.note}` : ""}`);
    for (const x of r.fails.slice(0, 40)) console.log("       " + x);
    if (r.fails.length > 40) console.log(`       … and ${r.fails.length - 40} more`);
  }
  const failed = out.results.filter((r) => !r.ok).length;
  console.log(`\n${out.results.length} rules (${out.from}), ${failed} failing`);
  return opt("strict") && failed ? 1 : 0;
}
