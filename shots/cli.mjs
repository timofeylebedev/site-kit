// site-kit shots [--changed|--all] [--blocks a,b] [--sizes 390x844,1440x900] [--out dir] [--base <ref>]
// Layer 3 of the report: a picture of each block of the page (cfg.report.blocks) at each size, with the fingerprints of
// the files that change its look, the date and the commit. Pictures cost a browser and minutes, and most of the time a
// block looks as it did, so:
//   --changed   only blocks whose files differ from their last kept pictures (the data branch's shots/index.json,
//               fetched shallowly; no index there → every block). CI: on main after the checks; on a PR with the
//               label `shots` (into the preview's report only).
//   --all       every block (the default; CI: the manual run's input `shots: all`, a round's end)
// Writes <cfg.paths.out>/shots/<id>/<w>x<h>.jpg and <out>/shots/index.json (only the blocks this run took a picture
// of; mergeShots() of index.mjs puts them into the kept index). A block found at no size is listed under the index's
// `missed` and gets no entry: its kept pictures stay, and the next run tries it again. Exits non-zero only when the tool
// itself fails, never because a block was not found.
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { options, siteIO, dataBranch } from "../lib/config.mjs";
import { fingerprints, whatChanged, parseSizes, entryOf } from "./index.mjs";

const DEFAULT_SIZES = "390x844,1440x900";

export async function run(args, cfg) {
  const opt = options(args, ["blocks", "sizes", "out", "base", "max-width"]), io = siteIO(cfg);
  const all = cfg.report?.blocks || [];
  if (!all.length) { console.log("shots: no report.blocks in the adapter: nothing to picture"); return 0; }
  const pick = typeof opt("blocks") === "string" ? opt("blocks").split(",").map((s) => s.trim()) : null;
  const unknown = (pick || []).filter((id) => !all.some((b) => b.id === id));
  if (unknown.length) { console.error(`shots: no block ${unknown.join(", ")} in report.blocks (${all.map((b) => b.id).join(", ")})`); return 2; }
  const blocks = pick ? all.filter((b) => pick.includes(b.id)) : all;
  const sizes = parseSizes(typeof opt("sizes") === "string" ? opt("sizes") : cfg.report?.shotSizes || DEFAULT_SIZES);
  const sizeKeys = sizes.map((s) => `${s.w}x${s.h}`);
  const outDir = io.abs(typeof opt("out") === "string" ? opt("out") : join(cfg.paths.out, "shots"));
  const changedOnly = !!opt("changed") && !opt("all");
  const dist = io.abs(cfg.paths.dist);
  if (!existsSync(join(dist, "index.html"))) { console.error(`shots: no ${cfg.paths.dist}/index.html — build the site first`); return 2; }

  // ── which blocks: their fingerprints now against the kept index ──
  const now = Object.fromEntries(blocks.map((b) => [b.id, fingerprints(io, b.files || [])]));
  let todo = blocks, kept = null, skipped = {};
  if (changedOnly) {
    const ref = typeof opt("base") === "string" ? opt("base") : `origin/${dataBranch(cfg)}`;
    // --base may also be an index.json on disk (an earlier local run: <out>/shots/index.json kept aside)
    const file = ref.endsWith(".json") && io.exists(ref);
    if (!file && ref.startsWith("origin/")) io.fetchBranch(ref.slice(7));
    const text = file ? io.read(ref) : io.tryGit("show", `${ref}:shots/index.json`);
    try { kept = text ? JSON.parse(text) : null; } catch { kept = null; }
    if (!kept) console.log(`shots: no kept pictures (${file ? ref : `${ref}:shots/index.json`}): every block`);
    else {
      todo = [];
      for (const b of blocks) {
        const why = whatChanged(kept.blocks?.[b.id], now[b.id], sizeKeys, b);
        if (why.length) { todo.push(b); console.log(`  ${b.id}: ${why.slice(0, 3).join("; ")}${why.length > 3 ? ` (+${why.length - 3})` : ""}`); }
        else skipped[b.id] = kept.blocks[b.id].taken;
      }
    }
  }
  const commit = (process.env.SITE_KIT_SHA || io.tryGit("rev-parse", "HEAD") || "").trim();
  const index = { generated: new Date().toISOString(), commit, mode: changedOnly ? "changed" : "all", sizes: sizeKeys, blocks: {}, upToDate: skipped };
  mkdirSync(outDir, { recursive: true });
  if (!todo.length) {
    writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 1));
    console.log(`shots: every block's pictures are up to date (${Object.keys(skipped).length} blocks)`);
    return 0;
  }

  // ── the pictures: one page load per page and size ──
  const { serve } = await import("../lib/serve.mjs");
  const { launch, shootPage } = await import("./shoot.mjs");
  const server = await serve(dist);
  const browser = await launch("chromium");
  const t0 = Date.now();
  const query = cfg.checks?.query || "";
  const unstyle = cfg.checks?.unstyle || [];
  const touchOf = (s) => { const c = (cfg.checks?.sizes || []).find((x) => x.w === s.w && x.h === s.h); return c ? !!c.touch : s.w < 820; };
  const results = Object.fromEntries(todo.map((b) => [b.id, { sizes: [], missed: [] }]));
  try {
    const pages = [...new Set(todo.map((b) => b.page || ""))];
    for (const path of pages) {
      const here = todo.filter((b) => (b.page || "") === path);
      for (const s of sizes) {
        const shots = await shootPage(browser, here, { base: server.url, path, query, unstyle, size: { ...s, touch: touchOf(s) }, maxWidth: +(opt("max-width") || cfg.report?.shotMaxWidth || 1000) });
        for (const r of shots) {
          const key = `${s.w}x${s.h}`;
          if (!r.ok) { results[r.id].missed.push({ w: s.w, h: s.h, why: r.why }); console.log(`  ${r.id} ${key}: ${r.why}`); continue; }
          if (r.buffer) results[r.id].sizes.push({ w: s.w, h: s.h, file: `${r.id}/${key}.jpg`, css: r.css, bytes: r.buffer.length, buffer: r.buffer });
          // frames of a block played by the scroll: the first is <w>x<h>.jpg, the next <w>x<h>-2.jpg …
          else r.frames.forEach((buffer, i) => results[r.id].sizes.push({ w: s.w, h: s.h, file: `${r.id}/${key}${i ? `-${i + 1}` : ""}.jpg`, frame: i + 1, at: r.at[i], css: r.css, bytes: buffer.length, buffer }));
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  // ── written: each block's folder replaced, so no picture of an old size stays behind; a block with no picture at
  // all keeps whatever is there (and gets no entry: entryOf) ──
  let n = 0, bytes = 0;
  const taken = new Date().toISOString();
  for (const b of todo) {
    const r = results[b.id];
    const entry = entryOf({ title: b.title || b.id, page: b.page || "", selector: b.selector, ...(b.frames ? { frames: b.frames } : {}), files: now[b.id], taken, commit }, r);
    if (!entry) { (index.missed ||= {})[b.id] = r.missed; continue; }
    rmSync(join(outDir, b.id), { recursive: true, force: true });
    mkdirSync(join(outDir, b.id), { recursive: true });
    for (const s of r.sizes) { writeFileSync(join(outDir, s.file), s.buffer); n++; bytes += s.bytes; delete s.buffer; }
    index.blocks[b.id] = entry;
  }
  writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 1));
  const missed = todo.filter((b) => !results[b.id].sizes.length).map((b) => b.id);
  console.log(`shots: ${n} pictures of ${todo.length - missed.length} blocks (${(bytes / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${io.rel(outDir)}` +
    (Object.keys(skipped).length ? `; ${Object.keys(skipped).length} up to date` : "") + (missed.length ? `; not found: ${missed.join(", ")}` : ""));
  return 0;
}
