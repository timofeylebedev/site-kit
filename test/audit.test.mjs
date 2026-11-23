// The audit's parts that need no browser: its settings from the adapter, and the static server (as GitHub Pages serves).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settings, serve, SIZES } from "../audit/audit.mjs";

test("settings: defaults, and the adapter's audit section over them", () => {
  const d = settings({ checks: { pages: [{ path: "" }, { path: "about" }, { path: "nope", status: 404 }] } });
  assert.deepEqual(d.pages.map((p) => p.path), ["", "about"], "every page of the checks but the error page");
  assert.equal(d.sizes, SIZES);
  assert.equal(SIZES.length, 9);
  assert.deepEqual(d.sections, ["main > section", "body > footer"]);
  const fm = settings({ audit: { pages: [""], skip: ".a", sections: ["main > section:not(.stack)"] } });
  assert.deepEqual(fm.pages, [{ path: "" }]);
  assert.equal(fm.skip, ".a");
  assert.equal(fm.skipSmall, ".sprite");
  // Flow Medium's audit as it was: whole-content text boxes, links and buttons as targets, a stretched link's grown
  // area counted, no storage, no probe, every canvas's text measured from pixels
  assert.equal(fm.texts, "h1, h2, h3, p, a, button, dt, dd, span");
  assert.equal(fm.targets, "a[href], button");
  assert.deepEqual([fm.textBox, fm.unseen, fm.stretched, fm.storage, fm.probe, fm.canvases], ["content", null, "grow", null, null, "canvas"]);
});

test("settings: a shop's audit (QQ): its own text boxes, a bag in the browser, its own checks, no canvas text", () => {
  const probe = () => ["navbar: too tight"];
  const qq = settings({ audit: { textBox: "nodes", unseen: ".sr", stretched: "skip", targets: "a[href], button, select", storage: { "bag": [{ slug: "x", qty: 1 }] }, probe, canvases: null } });
  assert.equal(qq.textBox, "nodes");
  assert.equal(qq.unseen, ".sr");
  assert.equal(qq.stretched, "skip");
  assert.equal(qq.targets, "a[href], button, select");
  assert.deepEqual(qq.storage, { bag: [{ slug: "x", qty: 1 }] });
  assert.equal(qq.probe, probe);
  assert.equal(qq.canvases, null, "null turns the pixel contrast off");
  // the probe goes into the page as its source: an arrow function survives that
  assert.deepEqual(new Function(`return (${qq.probe.toString()})()`)(), ["navbar: too tight"]);
});

test("serve: index, x → x.html, a folder's index, 404.html with 404", async () => {
  const dist = mkdtempSync(join(tmpdir(), "kit-audit-"));
  writeFileSync(join(dist, "index.html"), "home");
  writeFileSync(join(dist, "privacy.html"), "privacy");
  writeFileSync(join(dist, "404.html"), "lost");
  mkdirSync(join(dist, "docs")); writeFileSync(join(dist, "docs", "index.html"), "docs");
  const { close, url } = await serve(dist);
  try {
    const get = async (p) => { const r = await fetch(url + p); return [r.status, await r.text()]; };
    assert.deepEqual(await get(""), [200, "home"]);
    assert.deepEqual(await get("privacy"), [200, "privacy"]);
    assert.deepEqual(await get("docs"), [200, "docs"]);
    assert.deepEqual(await get("no-such-page"), [404, "lost"]);
    assert.equal((await get("missing.png"))[0], 404);
  } finally { await close(); }
});
