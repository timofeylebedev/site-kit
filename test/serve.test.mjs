// lib/serve.mjs: the built site as GitHub Pages serves it, for the checks, the audit and the pictures (no browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { serve, inside } from "../lib/serve.mjs";

// a raw request: fetch() and URL() take ".." out of a path before it is sent; an attacker's client does not
const raw = (port, path) => new Promise((ok, fail) => {
  const r = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok([res.statusCode, b, res.headers])); });
  r.on("error", fail); r.end();
});

test("serve: GitHub Pages' rules, 127.0.0.1 only, never outside dist", async () => {
  const top = mkdtempSync(join(tmpdir(), "kit-serve-"));
  const dist = join(top, "dist");
  mkdirSync(join(dist, "docs"), { recursive: true });
  writeFileSync(join(top, "secret.txt"), "secret");
  writeFileSync(join(dist, "index.html"), "home");
  writeFileSync(join(dist, "privacy.html"), "privacy");
  writeFileSync(join(dist, "404.html"), "lost");
  writeFileSync(join(dist, "docs", "index.html"), "docs");
  const s = await serve(dist);
  try {
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(s.server.address().address, "127.0.0.1");
    assert.deepEqual((await raw(s.port, "/")).slice(0, 2), [200, "home"]);
    assert.deepEqual((await raw(s.port, "/privacy")).slice(0, 2), [200, "privacy"]);
    assert.deepEqual((await raw(s.port, "/privacy.html")).slice(0, 2), [200, "privacy"]);
    assert.deepEqual((await raw(s.port, "/docs/")).slice(0, 2), [200, "docs"]);
    const [st, , h] = await raw(s.port, "/docs?x=1");
    assert.equal(st, 301); assert.equal(h.location, "/docs/?x=1");
    assert.deepEqual((await raw(s.port, "/no-such-page")).slice(0, 2), [404, "lost"]);
    assert.deepEqual((await raw(s.port, "/privacy/")).slice(0, 2), [404, "lost"]);
    assert.match((await raw(s.port, "/index.html")).at(2)["content-type"], /text\/html/);
    // out of the folder: every spelling ends at 404.html, never at the file above it
    for (const p of ["/../secret.txt", "/..%2Fsecret.txt", "/%2e%2e/secret.txt", "/docs/..%2F..%2Fsecret.txt", "/..%5Csecret.txt", "/%00", "/%E0%A4%A"])
      assert.deepEqual((await raw(s.port, p)).slice(0, 2), [404, "lost"], p);
  } finally { await s.close(); }
});

test("inside: a path is kept under the root", () => {
  assert.equal(inside("/srv/dist", "/a/b.html"), "/srv/dist/a/b.html");
  assert.equal(inside("/srv/dist", "/"), "/srv/dist");
  assert.equal(inside("/srv/dist", "/..%2F..%2Fetc%2Fpasswd"), null);
  assert.equal(inside("/srv/dist", "/../dist2/x"), null);
  assert.equal(inside("/srv/dist", "/%zz"), null);
});
