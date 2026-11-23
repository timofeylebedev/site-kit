// The review page of a minimal site (no rounds, no aliases, line heights or tracking, no checks yet) in a real
// Chromium: every page of the sidebar and every tab of the system is drawn without a script error. Needs a browser:
//   SITE_KIT_BROWSER=1 node --test test/report.browser.test.mjs   (PLAYWRIGHT_CHROMIUM names the binary)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { buildReport } from "../report/build.mjs";
import { fixtureSite } from "./fixtures/report/make.mjs";

const on = process.env.SITE_KIT_BROWSER === "1";
const TABS = ["colour", "type", "space", "layout", "shadows", "motion", "icons", "components", "behaviour", "health", "responsive", "blocks", "grammar", "decisions"];

test("the report of a minimal site: every tab without an error", { skip: !on && "set SITE_KIT_BROWSER=1" }, async () => {
  const { root, cfg } = await fixtureSite();
  const out = join(root, "dist/report");
  await buildReport(cfg, { out, quiet: true });
  const { chromium } = createRequire(join(process.cwd(), "package.json"))("playwright");
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(`${page.url().split("#")[1]}: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error") errors.push(`${page.url().split("#")[1]}: ${m.text()}`); });
      await page.route(/^https?:\/\//, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>live</title>" }));
      await page.goto("file://" + join(out, "index.html") + "#needs");
      await page.waitForTimeout(300);
      const side = await page.evaluate(() => [...document.querySelectorAll("#side-nav a")].map((a) => a.getAttribute("href")));
      const hashes = [...new Set([...side, ...TABS.map((t) => "#system/" + t), "#blocks/hero", "#blocks/foot"])];
      for (const hash of hashes) {
        await page.evaluate((x) => { location.hash = x; }, hash);
        await page.waitForTimeout(hash === "#system/type" ? 500 : 200);
        const drawn = await page.evaluate(() => document.querySelector("#main").innerText.length);
        assert.ok(drawn > 100, `${hash} at ${w}: drawn (${drawn} characters)`);
      }
      assert.deepEqual(errors, [], `at ${w}×${h}`);
      await page.close();
    }
  } finally { await browser.close(); rmSync(root, { recursive: true, force: true }); }
});
