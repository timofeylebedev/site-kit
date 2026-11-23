// The audit's settle() in a real Chromium: a colour that glides is read once it has settled, an endless animation is
// not waited for. Needs a browser, so it runs only when asked:
//   SITE_KIT_BROWSER=1 node --test test/audit.browser.test.mjs   (PLAYWRIGHT_CHROMIUM names the binary)
import { test } from "node:test";
import assert from "node:assert/strict";
import { settle } from "../audit/audit.mjs";

const on = process.env.SITE_KIT_BROWSER === "1";

const html = `<!doctype html><meta charset="utf-8"><style>
  .bar { background: rgb(255, 255, 255); transition: background-color 600ms linear; }
  .bar.dark { background: rgb(45, 47, 51); }
  .spin { animation: spin 1s linear infinite; } @keyframes spin { to { rotate: 1turn; } }
</style><div class="bar">bar</div><div class="spin">spin</div>`;

test("settle waits for a transition to end, and not for an endless animation", { skip: !on && "SITE_KIT_BROWSER=1" }, async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => document.querySelector(".bar").classList.add("dark"));
    const mid = await page.evaluate(() => getComputedStyle(document.querySelector(".bar")).backgroundColor);
    const t0 = Date.now();
    await settle(page);
    const took = Date.now() - t0;
    const end = await page.evaluate(() => getComputedStyle(document.querySelector(".bar")).backgroundColor);
    assert.notEqual(mid, "rgb(45, 47, 51)", "the colour should still be gliding right after the change");
    assert.equal(end, "rgb(45, 47, 51)");
    assert.ok(took < 1500, `waited ${took} ms: the endless spin must not hold it to the 2 s limit`);
  } finally { await browser.close(); }
});
