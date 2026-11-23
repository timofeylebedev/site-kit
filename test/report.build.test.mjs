// The review page built from a minimal site (test/fixtures/report/site: no rounds, no aliases, no checks yet), in a git
// repository of its own with a data branch: the pictures of blocks the last run did not take again come from the data
// branch, the others from the run's folder. No browser (report.browser.test.mjs opens the page).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildReport } from "../report/build.mjs";
import { fixtureSite } from "./fixtures/report/make.mjs";

test("a minimal site builds a report (no rounds, aliases, checks or pictures)", async () => {
  const { root, cfg } = await fixtureSite();
  const { report } = await buildReport(cfg, { out: join(root, "dist/report"), quiet: true });
  assert.equal(report.checks, null);
  assert.equal(report.meta.reportPath, "report", "under dist: its path there");
  assert.equal(report.system.scale.aliases, undefined);
  assert.deepEqual(report.shots.blocks.hero, { sizes: [] });
  for (const f of ["index.html", "report.js", "report.css", "data.js", "site.css"]) assert.ok(existsSync(join(root, "dist/report", f)), f);
  assert.equal((await buildReport(cfg, { out: join(root, "elsewhere"), quiet: true, path: "design/report" })).report.meta.reportPath, "design/report");
  rmSync(root, { recursive: true, force: true });
});

test("after `shots --changed`: the blocks taken again from the run's folder, the others from the data branch", async () => {
  const kept = { blocks: {
    hero: { files: {}, taken: "2026-11-01T00:00:00Z", commit: "c1", sizes: [{ w: 390, h: 844, file: "hero/390x844.jpg" }] },
    foot: { files: {}, taken: "2026-11-01T00:00:00Z", commit: "c1", sizes: [{ w: 390, h: 844, file: "foot/390x844.jpg" }] },
  } };
  const { root, cfg } = await fixtureSite({ data: {
    "shots/index.json": JSON.stringify(kept), "shots/hero/390x844.jpg": "kept hero", "shots/foot/390x844.jpg": "kept foot",
    "latest/state.json": JSON.stringify({ commit: "c1", generated: "2026-11-01T00:00:00Z", summary: { fail: 0, warn: 0 }, rules: [], findings: [], needs: [], questions: [], decisions: [], engines: {} }),
  } });
  // the local run took the hero again, and missed the footer (no entry for it)
  const local = join(root, cfg.paths.out, "shots");
  mkdirSync(join(local, "hero"), { recursive: true });
  writeFileSync(join(local, "hero/390x844.jpg"), "new hero");
  writeFileSync(join(local, "index.json"), JSON.stringify({ blocks: { hero: { ...kept.blocks.hero, taken: "2026-11-23T00:00:00Z", commit: "c2" } }, missed: { foot: [{ w: 390, h: 844, why: "not on the page" }] } }));
  // an old local state of another commit gives way to main's last deploy
  writeFileSync(join(root, cfg.paths.out, "state.json"), JSON.stringify({ commit: "0000000old", summary: { fail: 9, warn: 9 } }));
  const out = join(root, "dist/report");
  const { report } = await buildReport(cfg, { out, quiet: true });
  assert.equal(readFileSync(join(out, "blocks/hero/390x844.jpg"), "utf8"), "new hero");
  assert.equal(readFileSync(join(out, "blocks/foot/390x844.jpg"), "utf8"), "kept foot");
  assert.equal(report.shots.from, "both");
  assert.equal(report.shots.blocks.hero.taken, "2026-11-23T00:00:00Z");
  assert.equal(report.shots.blocks.foot.sizes[0].from, "data");
  assert.equal(report.checks.commit, "c1");
  assert.equal(report.checks.from, "the last deploy of main");
  rmSync(root, { recursive: true, force: true });
});
