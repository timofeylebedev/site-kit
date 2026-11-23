// site-kit changed: the glob matching and which commits are compared (no git, no network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { globToRegExp, matchFiles, commitsOf } from "../lib/changed.mjs";
import { options } from "../lib/config.mjs";

const m = (glob, file) => globToRegExp(glob).test(file);

test("** reaches any depth, also none", () => {
  assert.ok(m("design/**", "design/scale.json"));
  assert.ok(m("design/**", "design/checks/out/state.json"));
  assert.ok(!m("design/**", "designs/x.json"));
  assert.ok(!m("design/**", "src/design/x.json"));
  assert.ok(m("src/**/*.css", "src/a.css"));
  assert.ok(m("src/**/*.css", "src/styles/base/tokens.css"));
  assert.ok(!m("src/**/*.css", "src/styles/base/tokens.js"));
  assert.ok(m("**/*.css", "a.css"));
  assert.ok(m("**/*.css", "x/y/a.css"));
});

test("* and ? stay inside one folder", () => {
  assert.ok(m("src/*.html", "src/index.html"));
  assert.ok(!m("src/*.html", "src/pages/index.html"));
  assert.ok(m("file?.txt", "file1.txt"));
  assert.ok(!m("file?.txt", "file12.txt"));
});

test("{a,b} and literal dots", () => {
  assert.ok(m("src/**/*.{css,js}", "src/x/y.js"));
  assert.ok(m("src/**/*.{css,js}", "src/x/y.css"));
  assert.ok(!m("src/**/*.{css,js}", "src/x/y.json"));
  assert.ok(!m("vite.config.js", "viteXconfigXjs"));
  assert.ok(m("vite.config.js", "vite.config.js"));
});

test("matchFiles: a name without a folder matches anywhere; a leading ./ is ignored", () => {
  const files = ["README.md", "docs/notes.md", "package.json", "src/styles/a.css", "tools/package.json", "build/x.mjs"];
  assert.deepEqual(matchFiles(files, ["package.json"]), ["package.json", "tools/package.json"]);
  assert.deepEqual(matchFiles(files, ["./src/**", "build/**"]), ["src/styles/a.css", "build/x.mjs"]);
  assert.deepEqual(matchFiles(["README.md", ".github/workflows/x.yml"], ["design/**", "src/**"]), []);
});

test("Flow Medium's design paths: docs and workflows do not count, code does", () => {
  const fm = ["design/**", "src/**", "public/**", "build/**", "vite.config.js", "package.json", "package-lock.json", "site-kit.config.mjs"];
  assert.deepEqual(matchFiles(["README.md", "CLAUDE.md", ".github/workflows/deploy.yml"], fm), []);
  assert.deepEqual(matchFiles(["README.md", "src/scripts/nav.js"], fm), ["src/scripts/nav.js"]);
  assert.deepEqual(matchFiles(["package-lock.json"], fm), ["package-lock.json"]);
});

test("commitsOf: arguments, a pull request (merge commit), a push, a manual run", () => {
  const opt = (a) => options(a);
  assert.deepEqual(commitsOf(opt(["--base", "a1", "--head", "b2"]), {}), { base: "a1", head: "b2", why: "given" });
  assert.ok(commitsOf(opt([]), {}).none);
  const pr = { pull_request: { number: 7, base: { sha: "base1" }, head: { sha: "head1" } } };
  const read = (ev) => () => ev;
  assert.deepEqual(commitsOf(opt([]), { GITHUB_EVENT_PATH: "x", GITHUB_EVENT_NAME: "pull_request", GITHUB_SHA: "merge1" }, read(pr)),
    { base: "base1", head: "merge1", merge: true, why: "pull request #7" });
  // pull_request_target and the like: GITHUB_SHA is not the merge commit
  assert.deepEqual(commitsOf(opt([]), { GITHUB_EVENT_PATH: "x", GITHUB_EVENT_NAME: "pull_request_target", GITHUB_SHA: "main1" }, read(pr)),
    { base: "base1", head: "head1", merge: false, why: "pull request #7" });
  assert.deepEqual(commitsOf(opt([]), { GITHUB_EVENT_PATH: "x", GITHUB_EVENT_NAME: "push" }, read({ before: "c1", after: "c2" })), { base: "c1", head: "c2", why: "push" });
  assert.ok(commitsOf(opt([]), { GITHUB_EVENT_PATH: "x", GITHUB_EVENT_NAME: "push" }, read({ before: "0000000", after: "c2" })).none);
  assert.ok(commitsOf(opt([]), { GITHUB_EVENT_PATH: "x", GITHUB_EVENT_NAME: "workflow_dispatch" }, read({})).none);
});
