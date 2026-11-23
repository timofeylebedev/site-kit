// lib/: the adapter's defaults, the options of a command line, the environment, the files of a list of paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, siteIO, options, mainBranch, dataBranch, NeedError, DEFAULT_CHECKS, env } from "../lib/config.mjs";

test("options: flags, values, and a value-taking option without its value stops clearly", () => {
  const opt = options(["--all", "--out", "x", "--since"], ["out", "since"]);
  assert.equal(opt("all"), true); assert.equal(opt("out"), "x"); assert.equal(opt("none", "d"), "d");
  assert.throws(() => opt("since"), (e) => e instanceof NeedError && /--since needs a value/.test(e.message));
  assert.throws(() => options(["--out", "--all"], ["out"])("out"), NeedError);
  assert.equal(options(["--out"])("out"), true, "an option not declared as taking a value stays a flag");
});

test("env: SITE_KIT_* first, Flow Medium's old names for one version", () => {
  const keep = { ...process.env };
  try {
    delete process.env.SITE_KIT_SHA; process.env.FM_HEAD_SHA = "old";
    assert.equal(env("SHA"), "old");
    process.env.SITE_KIT_SHA = "new";
    assert.equal(env("SHA"), "new");
    delete process.env.SITE_KIT_MAIN; assert.equal(mainBranch({}), "main"); assert.equal(mainBranch({ mainBranch: "trunk" }), "trunk");
    process.env.SITE_KIT_MAIN = "live"; assert.equal(mainBranch({ mainBranch: "trunk" }), "live");
    assert.equal(env("NOPE"), undefined);
  } finally { process.env = keep; }
  assert.equal(dataBranch({}), "report-data"); assert.equal(dataBranch({ checks: { dataBranch: "data" } }), "data");
});

test("loadConfig: sensible checks defaults, the adapter's own win", async () => {
  const root = mkdtempSync(join(tmpdir(), "kit-config-"));
  writeFileSync(join(root, "site-kit.config.mjs"), "export default { name: 'X', checks: { query: '?a' } };");
  const cfg = await loadConfig(root);
  assert.deepEqual(cfg.checks.pages, DEFAULT_CHECKS.pages);
  assert.equal(cfg.checks.sizes.length, 8);
  assert.equal(cfg.checks.query, "?a"); assert.equal(cfg.checks.dataBranch, "report-data");
  assert.equal(cfg.mainBranch, process.env.SITE_KIT_MAIN || "main");
});

test("siteIO.files: a folder, or a list of folders and files", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-files-"));
  mkdirSync(join(root, "src/scripts/x"), { recursive: true }); mkdirSync(join(root, "src/templates")); mkdirSync(join(root, "public"));
  for (const f of ["src/scripts/a.js", "src/scripts/x/b.mjs", "src/scripts/c.css", "src/templates/t.mjs", "public/vt.js", "public/other.js"]) writeFileSync(join(root, f), "");
  const io = siteIO({ root });
  assert.deepEqual(io.files("src/scripts", [".js", ".mjs"]), ["src/scripts/a.js", "src/scripts/x/b.mjs"]);
  assert.deepEqual(io.files(["src/scripts", "src/templates", "public/vt.js", "missing"], [".js", ".mjs"]),
    ["src/scripts/a.js", "src/scripts/x/b.mjs", "src/templates/t.mjs", "public/vt.js"]);
  assert.deepEqual(io.files(["public/vt.js"], ".css"), [], "a named file still has to fit the extension");
});
