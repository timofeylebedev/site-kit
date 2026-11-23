// The browser part of `site-kit shots`: one page load per page and size, then a JPEG of each block.
// The page is loaded as the checks load it, so the pictures show what was measured:
//   - the built site served as GitHub Pages serves it (serve.mjs), with `cfg.checks.query` added to the address
//   - `cfg.checks.unstyle` rewrites applied to the served documents and stylesheets (a site's stylesheet may be inline)
//   - other hosts answered with nothing (204): nothing leaves the machine, no analytics, no third-party frames
//   - reduced motion: reveals and entrances settle at once, a moving block is caught at rest
//   - scrolled top to bottom once, so whatever comes in lazily (drawings, reveals, dots) has come in
// Headless Chromium has no GPU here or in CI: launched with SwiftShader, so WebGL still draws.
import * as playwright from "playwright";

const GL = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"];

export async function launch(engine = "chromium") {
  const chromium = engine === "chromium";
  return playwright[engine].launch(chromium ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: GL } : {});
}

const wait = (page, ms) => page.waitForTimeout(ms);

/** scroll top to bottom a screen-ish at a time (what loads in view loads), then back to the top */
async function warm(page) {
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H; y += 400) { await page.evaluate((y) => scrollTo(0, y), y); await wait(page, 50); }
  await page.evaluate(() => scrollTo(0, scrollY + innerHeight * 4));   // the end, even if the page grew on the way
  await wait(page, 300);
  await page.evaluate(() => scrollTo(0, 0)); await wait(page, 700);
}

/**
 * Pictures of `blocks` on one page at one size.
 * opts: { base (the served site's URL), path, query, unstyle: [[RegExp, string]], size: { w, h, touch }, maxWidth,
 *         quality, settle (ms after load), waitFor (ms a hidden block may take to show) }
 * Returns [{ id, ok, css: { w, h }, buffer? | frames?: [buffer], at?: [fraction], why? }].
 */
export async function shootPage(browser, blocks, opts) {
  const { base, path = "", query = "", unstyle = [], size, maxWidth = 1000, quality = 78, settle = 900, waitFor = 6000, tall = 4 } = opts;
  const chromium = browser.browserType().name() === "chromium";
  // the picture is at most maxWidth pixels wide: phones at 2× (sharp text), wide screens below 1× (a 1440 layout in
  // 1000 pixels), so no resizing step and no image library is needed
  const dpr = Math.min(2, maxWidth / size.w);
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h }, deviceScaleFactor: dpr, hasTouch: !!size.touch, isMobile: !!size.touch && chromium,
    bypassCSP: true, reducedMotion: "reduce",
  });
  try {
    await ctx.route((u) => !u.href.startsWith(base), (r) => r.fulfill({ status: 204, body: "" }));
    if (unstyle.length) {
      await ctx.route((u) => u.href.startsWith(base), async (route) => {
        const t = route.request().resourceType();
        if (t !== "document" && t !== "stylesheet") return route.fallback();
        try {
          const r = await route.fetch();
          let body = await r.text();
          for (const [from, to] of unstyle) body = body.replace(from, to);
          await route.fulfill({ response: r, body });
        } catch { await route.fallback().catch(() => {}); }
      });
    }
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(base + path + query, { waitUntil: "load" });
    await wait(page, settle);
    await warm(page);
    await page.addStyleTag({ content: "[data-sk-hide]{visibility:hidden!important}" });
    const out = [];
    for (const b of blocks) {
      const loc = page.locator(b.selector).first();
      if (!(await loc.count())) { out.push({ id: b.id, ok: false, why: "not on the page" }); continue; }
      // a block that shows late (a notice after a delay) gets until `waitFor` ms after the load
      try { await loc.waitFor({ state: "visible", timeout: Math.max(100, waitFor - (Date.now() - t0)) }); }
      catch { out.push({ id: b.id, ok: false, why: "not shown at this size" }); continue; }
      // whatever is fixed or sticky outside the block (a navbar, a notice, a bar) would cover it: hidden for its picture
      await loc.evaluate((el) => {
        for (const e of document.querySelectorAll("body *")) {
          if (el.contains(e) || e.contains(el)) continue;
          const p = getComputedStyle(e).position;
          if (p === "fixed" || p === "sticky") e.setAttribute("data-sk-hide", "");
        }
      });
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await wait(page, 600);
        const box = await loc.boundingBox();
        if (!box || box.width < 2 || box.height < 2) { out.push({ id: b.id, ok: false, why: "no size at this size" }); continue; }
        const css = { w: Math.round(box.width), h: Math.round(box.height) };
        // A block played by the scroll (a pinned stage, cards that come up one by one) is mostly empty space as a
        // whole: its picture is frames, screens taken as the page scrolls through it (`frames`: where, 0 = its top at
        // the top of the screen, 1 = its bottom at the bottom). Taller than `tall` screens without frames: 3 of them.
        const frames = b.frames || (box.height > size.h * tall ? [0, 0.5, 1] : null);
        if (!frames) {
          const buffer = await loc.screenshot({ type: "jpeg", quality, animations: "disabled", caret: "hide", timeout: 30000 });
          out.push({ id: b.id, ok: true, buffer, css });
          continue;
        }
        const top = await loc.evaluate((el) => el.getBoundingClientRect().top + scrollY);
        const travel = Math.max(0, box.height - size.h);
        const buffers = [];
        for (const f of frames) {
          await page.evaluate((y) => scrollTo(0, y), Math.round(top + f * travel));
          await wait(page, 700);
          buffers.push(await page.screenshot({ type: "jpeg", quality, animations: "disabled", caret: "hide", timeout: 30000 }));
        }
        out.push({ id: b.id, ok: true, frames: buffers, at: frames, css });
      } catch (e) {
        out.push({ id: b.id, ok: false, why: String(e.message || e).split("\n")[0].slice(0, 160) });
      } finally {
        await page.evaluate(() => { for (const e of document.querySelectorAll("[data-sk-hide]")) e.removeAttribute("data-sk-hide"); });
      }
    }
    return out;
  } finally {
    await ctx.close();
  }
}
