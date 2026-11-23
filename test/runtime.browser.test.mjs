// The browser helpers (runtime/) in a real Chromium. Needs a browser, so it runs only when asked:
//   SITE_KIT_BROWSER=1 node --test test/runtime.browser.test.mjs   (PLAYWRIGHT_CHROMIUM names the binary)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";

const RUNTIME = join(import.meta.dirname, "../runtime");
const on = process.env.SITE_KIT_BROWSER === "1";

const page = (q = "") => `<!doctype html><html data-box-param="fmbox"><head><meta charset="utf-8">
<script src="/runtime/box.js"></script>
<link rel="stylesheet" href="/runtime/safari.css"><link rel="stylesheet" href="/slow.css">
<style>body{margin:0} .tall{height:3000px}</style>
<script type="module">
  import { stylesReady } from "/runtime/styles.js";
  window.early = getComputedStyle(document.documentElement).getPropertyValue("--slow").trim();
  await stylesReady();
  window.late = getComputedStyle(document.documentElement).getPropertyValue("--slow").trim();
  const s = await import("/runtime/scroller.js"), g = await import("/runtime/gpu.js"), l = await import("/runtime/loaded.js");
  s.to(500);
  window.result = { early, late, boxed: document.documentElement.classList.contains("boxed"), box: !!s.box, y: s.y(), win: scrollY, gpu: g.realGPU(), renderer: g.rendererOf(document.createElement("canvas").getContext("webgl2")) };
  // a software context gpuContext turns down is let go (lost); with the caveat the browser may refuse it itself
  { const c = document.createElement("canvas"), got = g.gpuContext(c, "webgl2"), again = c.getContext("webgl2");
    const caveat = !document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    window.release = { refused: got === null, lost: again ? again.isContextLost() : null, caveat }; }
  l.whenLoaded(() => { window.loadedRan = true; });
</script></head><body><div class="page" data-page><div class="tall"></div><div class="bar-guard" aria-hidden="true"></div></div></body></html>`;

test("runtime helpers in Chromium", { skip: !on && "set SITE_KIT_BROWSER=1" }, async () => {
  const req = createRequire(join(process.cwd(), "package.json"));
  const { chromium } = req("playwright");
  const server = createServer((rq, rs) => {
    const u = new URL(rq.url, "http://x");
    if (u.pathname === "/slow.css") { setTimeout(() => { rs.writeHead(200, { "content-type": "text/css" }); rs.end(":root{--slow:yes}"); }, 600); return; }
    if (u.pathname.startsWith("/runtime/")) { rs.writeHead(200, { "content-type": u.pathname.endsWith(".css") ? "text/css" : "text/javascript" }); rs.end(readFileSync(join(RUNTIME, u.pathname.slice(9)))); return; }
    rs.writeHead(200, { "content-type": "text/html" }); rs.end(page(u.search));
  }).listen(0);
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const p = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const get = async (q) => { await p.goto(url + q); await p.waitForFunction(() => window.result && window.loadedRan, null, { timeout: 5000 }); return p.evaluate(() => window.result); };
    const plain = await get("");
    assert.equal(plain.late, "yes", "stylesReady waited for the slow stylesheet");
    assert.equal(plain.boxed, false);
    assert.equal(plain.y, 500); assert.equal(plain.win, 500);
    assert.equal(plain.gpu, false, `SwiftShader is not a real GPU (renderer: ${plain.renderer})`);
    const rel = await p.evaluate(() => window.release);
    assert.equal(rel.refused, true);
    assert.ok(rel.caveat || rel.lost === true, `a software context it turned down is lost (${JSON.stringify(rel)})`);
    const boxed = await get("?fmbox=1");
    assert.equal(boxed.boxed, true); assert.equal(boxed.box, true);
    assert.equal(boxed.y, 500, "the box scrolled"); assert.equal(boxed.win, 0, "the window did not");
    const box = await p.evaluate(() => { const s = getComputedStyle(document.querySelector("[data-page]")); return [s.position, s.overflowY, document.activeElement?.hasAttribute("data-page")]; });
    assert.deepEqual(box, ["fixed", "auto", true]);
  } finally { await browser.close(); server.close(); }
});
