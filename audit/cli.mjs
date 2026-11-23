// site-kit audit [--engine chromium|firefox|webkit]: the built pages in a real browser (audit.mjs says what fails).
// The engine: --engine, else SITE_KIT_ENGINE (lib/env.mjs), else chromium.
// Exit 1 when a problem is found, 2 when it cannot run (no build, an unknown engine).
import { options, env } from "../lib/config.mjs";
import { audit } from "./audit.mjs";

export async function run(args, cfg) {
  const opt = options(args, ["engine"]);
  const engine = (typeof opt("engine") === "string" && opt("engine")) || env("ENGINE") || "chromium";
  let r;
  try { r = await audit(cfg, { engine }); }
  catch (e) { if (e.code === "NO_DIST" || e.code === "BAD_ENGINE") { console.error(e.message); return 2; } throw e; }
  console.log(`\nKept as designed (${cfg.paths.decisions}): ${r.exceptions.length} exception(s), not counted as problems`);
  for (const d of r.exceptions) {
    console.log(`  · ${d.id}: ${d.what}\n      ${d.rule ? d.rule + " — " : ""}${d.decided}; why: ${d.why}${d.fix ? `; fix if reconsidered: ${d.fix}` : ""}`);
    const seen = r.kept.get(d.id);
    if (seen) seen.forEach((l) => console.log(`      this run: ${l}`)); else if (d.audit) console.log("      this run: not met at the sizes checked");
  }
  if (r.failures.length) { console.log(`\n${r.failures.length} problem(s):`); r.failures.forEach((f) => console.log("  " + f)); return 1; }
  console.log("\nAll checks passed.");
  return 0;
}
