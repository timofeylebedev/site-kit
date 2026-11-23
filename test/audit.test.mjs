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
});

test("serve: index, x → x.html, a folder's index, 404.html with 404", async () => {
  const dist = mkdtempSync(join(tmpdir(), "kit-audit-"));
  writeFileSync(join(dist, "index.html"), "home");
  writeFileSync(join(dist, "privacy.html"), "privacy");
  writeFileSync(join(dist, "404.html"), "lost");
  mkdirSync(join(dist, "docs")); writeFileSync(join(dist, "docs", "index.html"), "docs");
  const { server, url } = await serve(dist);
  try {
    const get = async (p) => { const r = await fetch(url + p); return [r.status, await r.text()]; };
    assert.deepEqual(await get(""), [200, "home"]);
    assert.deepEqual(await get("privacy"), [200, "privacy"]);
    assert.deepEqual(await get("docs"), [200, "docs"]);
    assert.deepEqual(await get("no-such-page"), [404, "lost"]);
    assert.equal((await get("missing.png"))[0], 404);
  } finally { server.close(); }
});
