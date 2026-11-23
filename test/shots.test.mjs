// site-kit shots: which blocks need new pictures, and how a run's index goes into the kept one (no browser)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { whatChanged, staleFiles, mergeShots, parseSizes, fingerprints } from "../shots/index.mjs";
import { siteIO } from "../lib/config.mjs";

const entry = { files: { "a.css": "111", "b.js": "222" }, taken: "2026-11-01T00:00:00Z", commit: "c1", sizes: [{ w: 390, h: 844, file: "x/390x844.jpg" }, { w: 1440, h: 900, file: "x/1440x900.jpg" }] };

test("whatChanged: up to date, a file changed, added, dropped, a size missing, no picture yet", () => {
  assert.deepEqual(whatChanged(entry, { "a.css": "111", "b.js": "222" }, ["390x844", "1440x900"]), []);
  assert.deepEqual(whatChanged(entry, { "a.css": "999", "b.js": "222" }), ["a.css changed"]);
  assert.deepEqual(whatChanged(entry, { "a.css": "111", "b.js": "222", "c.css": "333" }), ["c.css is new to the block"]);
  assert.deepEqual(whatChanged(entry, { "a.css": "111" }), ["b.js is no longer the block's"]);
  assert.deepEqual(whatChanged(entry, { "a.css": "111", "b.js": "222" }, ["320x568"]), ["no picture at 320x568"]);
  assert.deepEqual(whatChanged(undefined, {}), ["no picture yet"]);
  // a size where the block was not shown last time is not asked for again
  assert.deepEqual(whatChanged({ ...entry, missed: [{ w: 320, h: 568, why: "not shown" }] }, { "a.css": "111", "b.js": "222" }, ["320x568"]), []);
});

test("whatChanged: a new selector or other frames in the adapter take the picture again", () => {
  const e = { ...entry, selector: ".x" }, now = { "a.css": "111", "b.js": "222" };
  assert.deepEqual(whatChanged(e, now, [], { selector: ".x" }), []);
  assert.deepEqual(whatChanged(e, now, [], { selector: ".y" }), ["its selector changed"]);
  assert.deepEqual(whatChanged(e, now, [], { selector: ".x", frames: [0, 1] }), ["its frames changed"]);
  assert.deepEqual(whatChanged({ ...e, frames: [0, 1] }, now, [], { selector: ".x", frames: [0, 1] }), []);
});

test("staleFiles: the files whose fingerprint differs now", () => {
  assert.deepEqual(staleFiles(entry, { "a.css": "111", "b.js": "999" }), ["b.js"]);
  assert.deepEqual(staleFiles(null, { "a.css": "1" }), ["a.css"]);
});

test("mergeShots: a block shot now replaces its entry; the others stay; blocks gone from the adapter are dropped", () => {
  const kept = { blocks: { nav: { taken: "old" }, hero: { taken: "old" }, gone: { taken: "old" } } };
  const fresh = { commit: "c2", blocks: { hero: { taken: "new" } } };
  assert.deepEqual(mergeShots(kept, fresh, ["nav", "hero"]), { commit: "c2", blocks: { nav: { taken: "old" }, hero: { taken: "new" } } });
  assert.deepEqual(mergeShots(null, fresh).blocks, { hero: { taken: "new" } });
});

test("parseSizes", () => {
  assert.deepEqual(parseSizes("390x844, 1440×900"), [{ w: 390, h: 844 }, { w: 1440, h: 900 }]);
  assert.throws(() => parseSizes("390"));
});

test("fingerprints: git's blob sha of the content, committed or not; missing files say so", () => {
  const root = mkdtempSync(join(tmpdir(), "shots-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "a.css"), "a{}\n");
  const io = siteIO({ root });
  const sha = execFileSync("git", ["hash-object", "a.css"], { cwd: root, encoding: "utf8" }).trim();
  assert.deepEqual(fingerprints(io, ["a.css", "nope.js"]), { "a.css": sha, "nope.js": "missing" });
});
