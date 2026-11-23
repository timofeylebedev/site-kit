// Measures the built site (paths.dist) in a real browser and writes one record: every number the checks need.
//   site-kit checks measure [--engine chromium|webkit] [--quick] [--only sweep,sizes,…] [--out <file>]
// --quick: the full sizes and the pages' health only (no width/height sweep, no modes, no scenarios), for a second
// engine. In CI it runs on every deploy; locally after the site's build.
// What it does, in order:
//   sweep      every 10px of width (320–1920, 1100 tall) and every 25px of height (400–1100, 1440 wide): the probes of
//              the adapter (checks.probes: the report's responsive picture and map)
//   sizes      at each size of checks.sizes: the collector (collect.js) on the whole page, reduced motion, after a
//              scroll top to bottom (so every block has come in); the home page and the pages marked `measure: true`
//   modes      at 390×844 and 1440×900: no scripts, no WebGL, forced colours, fonts that never arrive, reduced motion
//   privacy    a first visit: requests to other hosts, cookies and storage before consent, and after (a site with no
//              consent: the hosts it calls, no split)
//   scenarios  the logic table of checks.scenarios
//   pages      every page: head, outline, anchors, links, sideways scroll; robots.txt, sitemap.xml, the manifest
//   weight     the bytes of a first visit by kind (as sent: Brotli for text)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { siteIO, options, env } from "../lib/config.mjs";
import { serve } from "../lib/serve.mjs";

export const DEFAULTS = {
  // what the sweep hides: canvases make every resize slow (WebGL) and say nothing about the layout
  sweepStyle: "canvas{display:none!important}",
  // where the collector stops: the top of each, and a screen at a time through the tall ones
  sections: "main > section, body > footer",
  // the texts whose width and lines are compared with the fallback font
  boxes: "main h1, main h2, main h3, main p, button",
  // the files a browser or a search engine asks for
  files: ["robots.txt", "sitemap.xml", "site.webmanifest", "favicon.ico", "apple-touch-icon.png"],
};

/** the version of the consent the site asks for now (a stored answer of an older version does not count) */
export const consentVersion = (cfg, io) => {
  const c = cfg.checks.consent;
  if (!c) return null;
  return typeof c.version === "function" ? c.version(io) : c.version ?? 1;
};

/** the addresses measured at the full sizes: the home page, then every page marked `measure: true` (README.md) */
export const measuredPages = (pages = [], base, q = "") => [base + q, ...pages.filter((p) => p.measure && !p.main && p.path).map((p) => base + p.path + q)];

/** a snapshot of a page other than the home page, its places named with the page's path ("catalog/ .card__name"), so a
 *  finding there says on which page it is and a decision can bind to it (an unanchored `match` still finds the class) */
export function tagShot(shot, path) {
  if (!path) return shot;
  const at = (w) => `${path} ${w}`;
  const item = (x) => (x && typeof x === "object" ? { ...x, ...(Array.isArray(x.where) ? { where: x.where.map(at) } : {}), ...(typeof x.sel === "string" ? { sel: at(x.sel) } : {}) } : x);
  const out = { ...shot };
  for (const [k, v] of Object.entries(shot)) if (Array.isArray(v) && k !== "components") out[k] = v.map(item);
  if (shot.edges) out.edges = { ...shot.edges, near: (shot.edges.near || []).map(item) };
  return out;
}

export async function measure(cfg, args = []) {
  const io = siteIO(cfg), opt = options(args, ["engine", "only", "out"]), C = { ...DEFAULTS, ...cfg.checks };
  const DIST = io.abs(cfg.paths.dist);
  const ENGINE = opt("engine", env("ENGINE") || "chromium");
  const QUICK = !!opt("quick", false);
  // --only sweep,sizes,…: only these steps (for working on the checks)
  const ONLY = typeof opt("only") === "string" ? opt("only").split(",") : null;
  const OUT = io.abs(opt("out", join(cfg.paths.out, `record-${ENGINE}.json`)));
  const COLLECT = readFileSync(join(import.meta.dirname, "collect.js"), "utf8");
  const CONSENT = C.consent || null, CONSENT_VERSION = consentVersion(cfg, io);
  const t0 = Date.now();
  const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
  if (!io.exists(join(cfg.paths.dist, "index.html"))) { console.error(`measure: no ${cfg.paths.dist}/index.html — build the site first`); return 2; }
  const playwright = await import("playwright");

  // ── the built site, served as GitHub Pages serves it (lib/serve.mjs: addresses without .html; 404.html for anything
  // missing; 127.0.0.1 only, never outside dist) ──
  const server = await serve(DIST);
  const URL0 = server.url;

  // ── the browser ──
  const chromium = ENGINE === "chromium";
  const exe = chromium ? process.env.PLAYWRIGHT_CHROMIUM || undefined : undefined;
  // no GPU in CI or the cloud: software WebGL (judge motion by its curves, never by frame timing)
  const GL = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"];
  const launch = (extra = []) => playwright[ENGINE].launch(chromium ? { executablePath: exe, args: [...GL, ...extra] } : {});
  const browser = await launch();
  const version = browser.version();
  log(`engine ${ENGINE} ${version}${QUICK ? " (quick)" : ""}`);

  // checks.unstyle: rewrites in the served documents and stylesheets, so the page is measured as it is meant to be seen
  // (FM: html has scrollbar-gutter: stable, which headless Chromium fills like a classic 15px scrollbar; the checks
  // measure as on a Mac or a phone, with overlay scrollbars). Documents too: a build may put a stylesheet inside a page.
  const UNSTYLE = C.unstyle || [];
  const unstyle = async (route) => {
    const t = route.request().resourceType();
    if (!route.request().url().startsWith(URL0) || (t !== "document" && t !== "stylesheet")) return route.fallback();
    try { const r = await route.fetch(); let body = await r.text(); for (const [re, to] of UNSTYLE) body = body.replace(re, to); await route.fulfill({ response: r, body }); } catch { await route.fallback().catch(() => {}); }
  };
  // checks.query: added to every address the checks load (FM: ?fmbox=0, so Safari's own scroll box stays off and the
  // window scrolls: Playwright's WebKit presents itself as Safari on a Mac)
  const Q = C.query || "", PAGE = URL0 + Q;
  // nothing leaves this machine: other hosts are answered with nothing, but every request is recorded
  const offline = (ctx, seen) => ctx.route((u) => !u.href.startsWith(URL0), (route) => { seen?.push(route.request().url()); return route.fulfill({ status: 204, body: "" }); });
  async function context(b, { w, h, dpr = 1, touch = false, ...more } = {}) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch && chromium, bypassCSP: true, ...more });
    if (UNSTYLE.length) await ctx.route("**/*", unstyle);
    return ctx;
  }
  const wait = (page, ms) => page.waitForTimeout(ms);
  // drawings, dots and reveals mount lazily: scroll top to bottom once before measuring
  async function warm(page) {
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += 400) { await page.evaluate((y) => scrollTo(0, y), y); await wait(page, 50); }
    await page.evaluate(() => scrollTo(0, 0)); await wait(page, 700);
  }
  const withCollector = (page) => page.addScriptTag({ content: COLLECT });
  const collectCfg = { skip: C.skip, align: C.align, cards: C.cards, typeObjects: C.typeObjects, paragraphs: C.paragraphs, notIcons: C.notIcons };
  const git = (...a) => io.tryGit(...a)?.trim() || null;
  const record = {
    schema: 1, site: cfg.name, engine: ENGINE, version, quick: QUICK, when: new Date().toISOString(),
    commit: (env("SHA") || process.env.GITHUB_SHA || git("rev-parse", "HEAD") || "").slice(0, 40),
    ref: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git("rev-parse", "--abbrev-ref", "HEAD"),
    pr: env("PR") || null, at: {}, timings: {},
  };
  const step = async (name, fn) => { if (ONLY && !ONLY.includes(name)) return; const s = Date.now(); try { await fn(); } catch (e) { record.errors = [...(record.errors || []), `${name}: ${String(e.message || e).split("\n")[0]}`]; log(`${name} FAILED: ${e.message}`); } record.timings[name] = Math.round((Date.now() - s) / 1000); log(`${name} done`); };

  try {
    // ── sweep ──
    if (!QUICK && C.probes) await step("sweep", async () => {
      const probes = `(${C.probes.toString()})()`;
      const run = async (sizes, axis) => {
        const ctx = await context(browser, { w: sizes[0][0], h: sizes[0][1] }), page = await ctx.newPage();
        await offline(ctx); await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(PAGE, { waitUntil: "load" });
        if (C.sweepStyle) await page.addStyleTag({ content: C.sweepStyle });
        await wait(page, 800); await warm(page);
        const out = [];
        for (const [w, h] of sizes) {
          await page.setViewportSize({ width: w, height: h }); await wait(page, 420);
          const d = await page.evaluate(probes); d[axis] = axis === "w" ? w : h; out.push(d);
        }
        await ctx.close();
        return out;
      };
      const W = []; for (let w = 320; w <= 1920; w += 10) W.push([w, 1100]);
      const H = []; for (let h = 400; h <= 1100; h += 25) H.push([1440, h]);
      const [width, height] = await Promise.all([run(W, "w"), run(H, "h")]);
      record.sweep = { width, height };
    });

    // ── sizes ──
    // the home page, and every page of checks.pages marked `measure: true` (a site whose system lives on more pages
    // than its home: a catalog, a product page); their snapshots are joined into one record per size
    const MEASURED = measuredPages(C.pages, URL0, Q);
    await step("sizes", async () => {
      for (const s of C.sizes) {
        const shots = [], errors = [];
        let n = 0;
        for (const [i, address] of MEASURED.entries()) {
          // the home page as it always was; another page's places and errors carry its path
          const path = i ? address.slice(URL0.length, Q ? -Q.length : undefined) : "";
          const ctx = await context(browser, s), page = await ctx.newPage();
          await offline(ctx); page.on("pageerror", (e) => errors.push((path ? path + ": " : "") + String(e.message || e).slice(0, 200)));
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.goto(address, { waitUntil: "load" }); await wait(page, 900); await warm(page);
          await withCollector(page);
          // what shows only in view (cards that come in, pinned blocks) is measured where it shows: at the top of every
          // section, and a screen at a time through the ones taller than the screen; the snapshots are joined
          const stops = await page.evaluate(([h, sel]) => { const ys = new Set([0]); for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(), top = r.top + scrollY; ys.add(Math.max(0, Math.round(top - 80))); for (let y = top + h; y < top + r.height - h / 2; y += h) ys.add(Math.round(y)); } return [...ys].sort((a, b) => a - b); }, [s.h, C.sections]);
          for (const y of stops) { await page.evaluate((y) => scrollTo(0, y), y); await wait(page, 450); shots.push(tagShot(await page.evaluate(async (c) => await window.__dsCollect(c), collectCfg), path)); }
          n += stops.length;
          await ctx.close();
        }
        const m = merge(shots);
        m.errors = errors; m.stops = n;
        if (MEASURED.length > 1) m.pages = MEASURED.length;
        record.at[`${s.w}x${s.h}`] = m;
      }
    });

    // ── modes ──
    if (!QUICK) await step("modes", async () => {
      record.modes = {};
      const sizes = [{ w: 390, h: 844, dpr: 2, touch: true }, { w: 1440, h: 900, dpr: 1 }];
      for (const s of sizes) {
        const key = `${s.w}x${s.h}`, out = (record.modes[key] = {});
        const one = async (name, b, opts, prep) => {
          const ctx = await context(b, { ...s, ...opts }), page = await ctx.newPage(), errors = [];
          await offline(ctx); page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 200)));
          if (prep) await prep(ctx, page);
          await page.goto(PAGE, { waitUntil: "load" }); await wait(page, 1200); await warm(page); await wait(page, 1500);
          const r = await page.evaluate(pageText); r.errors = errors;
          if (name === "fonts" || name === "normal") {
            // the texts as drawn: their width and their lines (the line boxes of the text itself); pictures
            // (checks.boxSkip) and fitted titles (checks.typeObjects) left out
            r.boxes = await page.evaluate(([sel, skip, objects]) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && !(skip && e.closest(skip)) && !(objects && e.closest(objects)))
              .map((e) => { const b = e.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(e); const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top / 4))); return { sel: e.tagName.toLowerCase() + "." + (e.className.toString().split(" ")[0] || ""), w: Math.round(b.width), h: Math.round(b.height), lines: tops.size, text: (e.getAttribute("aria-label") || e.textContent).trim().replace(/\s+/g, " ").slice(0, 24) }; }), [C.boxes, C.boxSkip || null, C.typeObjects || null]);
          }
          out[name] = r; await ctx.close();
        };
        await one("normal", browser, {});
        await one("calm", browser, { reducedMotion: "reduce" });
        await one("nojs", browser, { javaScriptEnabled: false });
        if (chromium) await one("forced", browser, { forcedColors: "active" });
        await one("fonts", browser, {}, (ctx) => ctx.route("**/*.woff2", (r) => r.abort()));
        if (chromium) { const b2 = await launch(["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"]); await one("nowebgl", b2, {}); await b2.close(); }
      }
    });

    // ── privacy ──
    if (!QUICK) await step("privacy", async () => {
      const ctx = await context(browser, { w: 1440, h: 900 }), page = await ctx.newPage();
      const before = [], after = [];
      let phase = before;
      await ctx.route((u) => !u.href.startsWith(URL0), (route) => { phase.push(route.request().url()); return route.fulfill({ status: 204, body: "" }); });
      // a visit: the page, pointer moves, a scroll, a pointer over what may preload a third party (consent.hover)
      const hover = CONSENT?.hover;
      await page.goto(PAGE, { waitUntil: "load" }); await wait(page, 1500);
      await page.mouse.move(400, 300); await page.mouse.move(700, 500); await warm(page);
      if (hover) await page.hover(hover).catch(() => {});
      await wait(page, 3500);
      const pre = { requests: [...new Set(before)], cookies: (await ctx.cookies()).map((c) => c.name), storage: await page.evaluate(() => Object.keys(localStorage)) };
      if (!CONSENT) {
        // a site that asks for no consent: the hosts it calls, nothing to split
        record.privacy = { consent: false, hosts: [...new Set(before.map((u) => new URL(u).host))], ...pre };
        await ctx.close(); return;
      }
      phase = after;
      const ok = await page.locator(CONSENT.button).count();
      if (ok) { await page.click(CONSENT.button).catch(() => {}); await wait(page, 1500); await page.mouse.move(500, 400); if (hover) await page.hover(hover).catch(() => {}); await wait(page, 4000); }
      record.privacy = { before: pre, after: { requests: [...new Set(after)].map((u) => new URL(u).host), cookies: (await ctx.cookies()).map((c) => c.name), storage: await page.evaluate(() => Object.keys(localStorage)) }, consentButton: !!ok };
      await ctx.close();
    });

    // ── scenarios ──
    if (!QUICK && C.scenarios?.length) await step("scenarios", async () => {
      record.scenarios = [];
      for (const sc of C.scenarios) {
        const [w, h] = sc.size || [1440, 900], ctx = await context(browser, { w, h, touch: w < 900, dpr: 1 }), page = await ctx.newPage(), errors = [];
        await offline(ctx); page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 160)));
        // consent given before the page loads: the answer stored as the site stores it (consent.stored, else { v, at })
        if (sc.consent && CONSENT) {
          const value = CONSENT.stored ? CONSENT.stored(CONSENT_VERSION) : null;
          await ctx.addInitScript(([k, v, val]) => localStorage.setItem(k, val ?? JSON.stringify({ v, at: Date.now() })), [CONSENT.storage, CONSENT_VERSION, value]);
        }
        const helpers = { url: PAGE, wait: (ms) => wait(page, ms), vis: (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && +c.opacity > 0.05 && r.bottom > 0 && r.top < innerHeight; }, sel) };
        let res;
        try { res = await Promise.race([sc.run(page, helpers), new Promise((_, no) => setTimeout(() => no(new Error("timed out after 40 s")), 40000))]); } catch (e) { res = String(e.message || e).split("\n")[0]; }
        record.scenarios.push({ id: sc.id, ok: res === true, note: res === true ? "" : String(res), errors, size: `${w}×${h}` });
        await ctx.close();
      }
    });

    // ── pages, links, files ──
    await step("pages", async () => {
      record.pages = [];
      const links = new Set();
      for (const p of C.pages) {
        for (const s of [{ w: 390, h: 844, touch: true, dpr: 2 }, { w: 1440, h: 900 }]) {
          const ctx = await context(browser, s), page = await ctx.newPage(), errors = [];
          await offline(ctx); page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 160)));
          const res = await page.goto(URL0 + p.path + Q, { waitUntil: "load" }); await wait(page, 800);
          await withCollector(page);
          const head = s.w === 1440 ? await page.evaluate(() => window.__dsHead()) : null;
          const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
          if (head) head.links.forEach((l) => links.add(JSON.stringify([p.path, l])));
          record.pages.push({ path: p.path, title: p.title, size: `${s.w}x${s.h}`, status: res?.status(), want: p.status || 200, overflow, errors, ...(head ? { head } : {}) });
          await ctx.close();
        }
      }
      // every link that stays on the site must lead somewhere (the anchors of other pages too)
      const checked = [];
      for (const j of links) {
        const [from, href] = JSON.parse(j);
        if (/^(mailto:|tel:|javascript:|#)/.test(href)) continue;
        const u = new URL(href, URL0 + from);
        if (!u.href.startsWith(URL0)) continue;
        const r = await fetch(u.href.split("#")[0]); let ok = r.status === 200, why = r.status === 200 ? "" : String(r.status);
        if (ok && u.hash) { const html = await r.text(); ok = new RegExp(`id=["']?${u.hash.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\\s>]`).test(html); if (!ok) why = "no " + u.hash; }
        checked.push({ from: from || "/", href, ok, why });
      }
      record.links = checked;
      const file = async (p) => { const r = await fetch(URL0 + p); return { path: p, status: r.status, body: r.status === 200 ? (await r.text()).slice(0, 4000) : "" }; };
      record.files = await Promise.all(C.files.map(file));
      record.files.forEach((f) => { if (/\.(ico|png|jpe?g|webp|avif)$/.test(f.path)) f.body = ""; });
    });

    // ── weight ──
    if (!QUICK) await step("weight", async () => {
      const ctx = await context(browser, { w: 1440, h: 900, dpr: 2 }), page = await ctx.newPage(), got = [];
      await offline(ctx);
      page.on("response", async (r) => { if (!r.url().startsWith(URL0)) return; try { const b = await r.body(); got.push({ url: r.url().slice(URL0.length) || "index.html", type: r.request().resourceType(), raw: b.length, sent: /text|javascript|json|xml|svg|css|html/.test(r.headers()["content-type"] || "") ? brotliCompressSync(b).length : b.length }); } catch {} });
      await page.goto(PAGE, { waitUntil: "load" }); await wait(page, 1500); await warm(page); await wait(page, 1500);
      const by = {}; for (const g of got) { const k = g.type === "stylesheet" ? "css" : g.type === "script" ? "js" : g.type === "font" ? "fonts" : g.type === "image" ? "images" : g.type === "document" ? "html" : "other"; (by[k] ||= { files: 0, sent: 0, raw: 0 }); by[k].files++; by[k].sent += g.sent; by[k].raw += g.raw; }
      record.weight = { by, total: Object.values(by).reduce((a, b) => a + b.sent, 0), files: got.length, top: got.sort((a, b) => b.sent - a.sent).slice(0, 12) };
      await ctx.close();
    });
  } finally {
    await browser.close().catch(() => {}); await server.close();
  }

  record.seconds = Math.round((Date.now() - t0) / 1000);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(record));
  log(`wrote ${io.rel(OUT)} (${Math.round(JSON.stringify(record).length / 1024)} KB)`);
  // a step that failed is in the record (its rules become «could not run»), not a failure of this command
  return 0;
}

// the page's text in a mode: how much of it is shown, the headings, what still moves
function pageText() {
  const seen = (e) => { for (let x = e; x && x !== document.documentElement; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === "none" || s.visibility === "hidden" || +s.opacity < 0.05) return false; } return true; };
  const walker = document.createTreeWalker(document.querySelector("main") || document.body, NodeFilter.SHOW_TEXT); let all = 0, vis = 0;
  for (let n; (n = walker.nextNode()); ) { const t = n.textContent.trim().length; if (!t || !n.parentElement || n.parentElement.closest("template, script, style, [hidden]")) continue; all += t; if (seen(n.parentElement)) vis += t; }
  const heads = [...document.querySelectorAll("main h1, main h2")];
  return { chars: all, shown: vis, headings: heads.length, headingsShown: heads.filter(seen).length, h1: !!document.querySelector("h1") && seen(document.querySelector("h1")),
    running: (document.getAnimations?.() || []).filter((a) => a.playState === "running").map((a) => ({ name: a.animationName || a.constructor.name, target: a.effect?.target?.className?.toString?.().split(" ")[0] || a.effect?.target?.tagName || "?", infinite: a.effect?.getTiming?.().iterations === Infinity })).slice(0, 20) };
}

// snapshots of the collector at several scroll positions, joined: a thing counts once (by its key), with the most
// copies seen at one time and every place it was seen
export function merge(shots) {
  const by = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x), y = m.get(k); if (!y) m.set(k, { ...x, where: [...(x.where || [])] }); else { y.n = Math.max(y.n || 0, x.n || 0); for (const w of x.where || []) if (y.where.length < 6 && !y.where.includes(w)) y.where.push(w); if (x.props) for (const [p, v] of Object.entries(x.props)) y.props[p] = Math.max(y.props[p] || 0, v); } } return [...m.values()]; };
  const uniq = (list) => { const m = new Map(); for (const x of list) m.set(JSON.stringify(x), x); return [...m.values()]; };
  const all = (k) => shots.flatMap((s) => s[k] || []);
  const first = shots[0];
  const comps = new Map(); for (const c of all("components")) { const y = comps.get(c.name); if (!y || c.n > y.n) comps.set(c.name, c); }
  return {
    vw: first.vw, vh: first.vh, dpr: first.dpr, n: Math.max(...shots.map((s) => s.n)),
    text: by(all("text"), (t) => `${t.px}|${t.family}|${t.weight}|${t.lh}|${t.object}`), colours: by(all("colours"), (c) => c.rgba.join(",")), fills: by(all("fills"), (f) => f.kind),
    radii: by(all("radii"), (r) => `${r.sel}|${r.px}`), borders: by(all("borders"), (b) => String(b.px)), shadows: by(all("shadows"), (x) => x.prop + x.value),
    effects: uniq(all("effects")), layers: uniq(all("layers")), z: by(all("z"), (x) => String(x.z)), contexts: Math.max(...shots.map((s) => s.contexts)),
    icons: uniq(all("icons")), images: by(all("images").map((i) => ({ ...i, where: [i.sel] })), (i) => i.sel + i.src).map(({ where, ...i }) => i), ratios: uniq(all("ratios")),
    edges: { lines: first.edges.lines, near: uniq(all("edges").flatMap((e) => e.near)), n: Math.max(...shots.map((s) => s.edges.n)) },
    typo: uniq(all("typo")), components: [...comps.values()], interact: by(all("interact"), (x) => String(x.ms)), overflow: Math.max(...shots.map((s) => s.overflow)),
  };
}
