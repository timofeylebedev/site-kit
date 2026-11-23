// The lowest setting that still looks the same: for each output of cfg.images, the encode whose SSIMULACRA2 against
// the original at that width is at least the target (90: no visible loss at 1:1), found by trying settings instead of
// guessing them. What Flow Medium learned doing this by hand (Oct 2026), kept as the search's defaults:
// - Score against the original resized to the output's width, on the colour it is seen on (a transparent picture is
//   flattened on `background` first: on the card's white, the hero's sand). A picture only ever asked for at a higher
//   density (a 2650 px hero is fetched at 1.25× at most) is scored as seen there: both scaled down by that density
//   (`seen`), and its score at 1:1 is shown beside.
// - AVIF: try 8-bit and 10-bit, and full colour (4:4:4) as well as halved (4:2:0). 10-bit keeps film grain and fine
//   scans at a smaller size than 8-bit (FM's Home cover: 10-bit 86, 100 KB, against 8-bit 92, 136 KB); coloured marks
//   on white never reach 90 with halved colour (FM's tool cards). The smallest file that reaches the target wins.
// - WebP: lossy first (smartSubsample); if even 100 does not get there (it halves the colour), near-lossless, the
//   smallest level that does. Flat colour and letters are often smaller near-lossless than any AVIF that keeps them.
// - Scores are not perfectly monotonic in quality: after the halving search the next two settings below are tried too.
import { resolve } from "node:path";
import { stat, readFile } from "node:fs/promises";
import { peer, outputs, QUALITY } from "./make.mjs";
import { score as ssimulacra2 } from "./ssimulacra2.mjs";

const AVIF_MODES = [{ bitdepth: 8, chromaSubsampling: "4:2:0" }, { bitdepth: 8, chromaSubsampling: "4:4:4" }, { bitdepth: 10, chromaSubsampling: "4:2:0" }, { bitdepth: 10, chromaSubsampling: "4:4:4" }];
const NEAR = [0, 20, 40, 60, 80];

function scorer(sharp, src, width, { background, seen = 1 }) {
  // 8 bits per channel, as a browser shows even a 10-bit AVIF (and as FM's scores were taken: decoding to 16 bits
  // gives about 0.3 less); the original is resized first and flattened after, like the page draws it
  const raw = async (pipe) => {
    if (background) pipe = pipe.flatten({ background });
    const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels, max: 255 };
  };
  const down = async (buf, w) => (seen === 1 ? sharp(buf) : sharp(await sharp(buf).resize({ width: Math.round(w / seen), kernel: "lanczos3" }).png().toBuffer()));
  let ref = null, ref1 = null;
  return {
    async ref() {
      if (!ref) {
        const resized = await sharp(src).resize({ width, withoutEnlargement: true }).png().toBuffer();
        const w = (await sharp(resized).metadata()).width;
        ref1 = await raw(sharp(resized));
        ref = seen === 1 ? ref1 : await raw(await down(resized, w));
      }
      return ref;
    },
    // { seen, flat }: the score as seen (at `seen`) and at 1:1
    async score(buf) {
      await this.ref();
      const png = await sharp(buf).png().toBuffer();            // decoded once (AVIF decoding is slow)
      const w = ref1.width, s = ssimulacra2(ref, await raw(await down(png, w)));
      return { seen: s, flat: seen === 1 ? s : ssimulacra2(ref1, await raw(sharp(png))) };
    },
  };
}

const seenAt = (job, width) => (typeof job.seen === "number" ? job.seen : job.seen?.[width] || 1);
const kb = (n) => (n / 1024).toFixed(1) + " KB";
const fmt = (s) => s.toFixed(1);

// every output of the listed jobs: its committed file scored as it is now
export async function scoreAll(cfg, { only = null, log = console.log } = {}) {
  const im = cfg.images, sharp = peer(cfg.root, "sharp"), target = im.search?.target ?? 90, rows = [];
  for (const job of im.jobs || []) {
    if (only && !(job.name || job.src).includes(only)) continue;
    const src = resolve(cfg.root, im.from, job.src), meta = await sharp(src).metadata();
    for (const o of outputs(job, meta, { ...QUALITY, ...(im.quality || {}) })) {
      if (job.lossless || o.options.lossless) continue;
      const file = resolve(cfg.root, im.to, o.file);
      let buf;
      try { buf = await readFile(file); } catch { log(`  ${o.file}: missing (site-kit images)`); continue; }
      const seen = seenAt(job, o.width), s = await scorer(sharp, src, o.width, { background: job.background, seen }).score(buf);
      const row = { file: o.file, size: buf.length, score: s.seen, flat: s.flat, seen, ok: s.seen >= target };
      rows.push(row);
      log(`  ${row.ok ? " " : "!"} ${o.file.padEnd(34)} ${fmt(s.seen).padStart(5)}${seen !== 1 ? ` at ${seen}× / ${fmt(s.flat)} at 1:1` : ""}  ${kb(buf.length)}`);
    }
  }
  const low = rows.filter((r) => !r.ok);
  log(`images score: ${rows.length} files, ${low.length} under ${target}${low.length ? " (marked !; a written exception is fine: say it in the adapter's comment)" : ""}`);
  return rows;
}

// the lowest passing setting of one output, per mode; returns the smallest
async function lowest(encode, score, target, lo, hi) {
  const tried = new Map();
  const at = async (q) => {
    if (!tried.has(q)) { const buf = await encode(q); const s = await score(buf); tried.set(q, { q, size: buf.length, ...s }); }
    return tried.get(q);
  };
  if ((await at(hi)).seen < target) return { best: null, tried };
  let a = lo, b = hi;                                          // b passes
  while (b - a > 1) { const m = (a + b) >> 1; if ((await at(m)).seen >= target) b = m; else a = m; }
  if ((await at(a)).seen >= target) b = a;
  for (let q = b - 1; q >= Math.max(lo, b - 2); q--) if ((await at(q)).seen >= target) b = q;
  return { best: tried.get(b), tried };
}

export async function search(cfg, { only = null, target, format = null, modes = null, log = console.log } = {}) {
  const im = cfg.images, sharp = peer(cfg.root, "sharp");
  target ??= im.search?.target ?? 90;
  const quality = { ...QUALITY, ...(im.quality || {}) }, found = [];
  for (const job of im.jobs || []) {
    if (only && !(job.name || job.src).includes(only)) continue;
    const src = resolve(cfg.root, im.from, job.src), meta = await sharp(src).metadata();
    for (const o of outputs(job, meta, quality)) {
      if (job.lossless || o.options.lossless || (format && o.format !== format)) continue;
      const seen = seenAt(job, o.width), sc = scorer(sharp, src, o.width, { background: job.background, seen });
      const score = (buf) => sc.score(buf);
      const resized = () => sharp(src).resize({ width: o.width, withoutEnlargement: true });
      const base = { ...o.options };
      delete base.quality; delete base.bitdepth; delete base.chromaSubsampling; delete base.nearLossless; delete base.smartSubsample;
      const results = [];
      if (o.format === "avif") {
        for (const mode of modes || AVIF_MODES) {
          const { best } = await lowest((q) => resized().avif({ ...base, ...mode, quality: q }).toBuffer(), score, target, 1, 100);
          if (best) results.push({ options: { quality: best.q, ...mode }, ...best });
          log(`    ${o.file} ${mode.bitdepth}-bit ${mode.chromaSubsampling}: ${best ? `${best.q} → ${fmt(best.seen)}, ${kb(best.size)}` : `never ${target}`}`);
        }
      } else if (o.format === "webp") {
        const { best } = await lowest((q) => resized().webp({ ...base, quality: q, smartSubsample: true }).toBuffer(), score, target, 1, 100);
        if (best) results.push({ options: { quality: best.q, smartSubsample: true }, ...best });
        else for (const level of NEAR) {
          const buf = await resized().webp({ ...base, nearLossless: true, quality: level }).toBuffer(), s = await score(buf);
          if (s.seen >= target) results.push({ options: { nearLossless: true, quality: level }, q: level, size: buf.length, ...s });
        }
      } else continue;
      results.sort((a, b) => a.size - b.size);
      const best = results[0], now = await sc.score(await resized()[o.format](o.options).toBuffer());
      found.push({ file: o.file, best, now });
      log(`  ${o.file}: ${best ? `${JSON.stringify(best.options)}  ${fmt(best.seen)}${seen !== 1 ? ` at ${seen}× / ${fmt(best.flat)} at 1:1` : ""}  ${kb(best.size)}` : `nothing reaches ${target}: keep lossless`}` +
        `   (now ${JSON.stringify(o.options)}: ${fmt(now.seen)})`);
    }
  }
  log(`images search: ${found.length} outputs, target ${target}; write the settings into cfg.images with their score and size`);
  return found;
}
