// The site's pictures from their originals: what cfg.images lists, made in every size and format it names, at the
// settings written there (found by `site-kit images search` and kept with their scores in the adapter's comments).
// A picture whose output is newer than its original is skipped (--force makes everything again); after replacing an
// original, run it and commit the new files.
import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join, parse, dirname, resolve, relative } from "node:path";
import { createRequire } from "node:module";

// sharp and svgo are the site's own packages (peer dependencies), resolved from its root
export const peer = (root, name) => createRequire(join(root, "package.json"))(name);

// quality per format when a job names none: AVIF and WebP at about the same look as the originals
export const QUALITY = { avif: { quality: 55, effort: 9 }, webp: { quality: 80, effort: 6 }, png: { compressionLevel: 9, palette: true } };

// an AVIF setting: a quality, or [quality, bit depth] (10-bit keeps fine grain at a smaller size than 8-bit)
export const avif = (q) => (Array.isArray(q) ? { quality: q[0], bitdepth: q[1] } : { quality: q });

// the outputs of one job: [{ file, width, format, options }] (files are <name>-<width>.<format>, or <name>.<format>
// when the job has one width; a width of null is the original's own)
export function outputs(job, meta, quality = QUALITY) {
  const name = job.name || parse(job.src).name, out = [];
  for (const w of job.widths) {
    const width = w || meta.width;
    for (const format of job.formats) {
      const file = job.widths.length > 1 ? `${name}-${width}.${format}` : `${name}.${format}`;
      const options = job.lossless ? { lossless: true, effort: 6 }
        : Object.assign({}, quality[format], job.quality ? { quality: job.quality } : {}, (typeof job.options === "function" ? job.options(width) : job.options)?.[format]);
      out.push({ file, width, format, options });
    }
  }
  return out;
}

export async function make(cfg, { force = false, dry = false, only = null, log = console.log } = {}) {
  const im = cfg.images, root = cfg.root;
  if (!im) { log("images: no `images` in site-kit.config.mjs"); return { made: 0, skipped: 0, would: [] }; }
  const sharp = peer(root, "sharp");
  const SRC = resolve(root, im.from), OUT = resolve(root, im.to);
  const quality = { ...QUALITY, ...(im.quality || {}) };
  const pick = (name) => !only || name.includes(only);

  const newer = async (out, src) => {
    if (force) return false;
    try { return (await stat(out)).mtimeMs >= (await stat(src)).mtimeMs; } catch { return false; }
  };
  let made = 0, skipped = 0, bytesIn = 0, bytesOut = 0;
  const would = [];
  // each output: skipped when up to date; with dry, only listed
  const step = async (out, src, build) => {
    if (await newer(out, src)) { skipped++; return; }
    if (dry) { would.push(relative(root, out)); return; }
    const data = await build();
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, data);
    made++;
    bytesOut += data.length;
    bytesIn += (await stat(src)).size;
  };

  for (const job of im.jobs || []) {
    if (!pick(job.name || job.src)) continue;
    const src = join(SRC, job.src);
    const meta = await sharp(src).metadata();
    for (const o of outputs(job, meta, quality))
      await step(join(OUT, o.file), src, () => sharp(src).resize({ width: o.width, withoutEnlargement: true })[o.format](o.options).toBuffer());
  }

  // SVG files: cleaned up and minified. Their size and viewBox are kept (they are used as pictures).
  if (im.svg) {
    const { optimize } = peer(root, "svgo");
    const test = typeof im.svg === "function" ? im.svg : (f) => im.svg.test(f);
    for (const file of (await readdir(SRC)).filter((f) => f.endsWith(".svg") && test(f) && pick(f))) {
      const src = join(SRC, file);
      await step(join(OUT, file), src, async () => Buffer.from(optimize(await readFile(src, "utf8"), {
        multipass: true, floatPrecision: 2,
        plugins: ["preset-default", { name: "removeAttrs", params: { attrs: ["data-name"] } }]
      }).data));
    }
  }

  // --- the site's icons and the picture for links (fixed addresses, every path relative to the site's root) ---
  // Every PNG is lossless: the smallest of an exact palette and full colour whose pixels are identical to the resized
  // picture (checked on every run; the command stops otherwise).
  const { exactPng, icoFile, circle } = helpers(sharp);
  if (im.icons && pick(im.icons.src)) {
    const src = join(SRC, im.icons.src), bg = im.icons.background || "#ffffff";
    const opaque = () => sharp(src).flatten({ background: bg });
    for (const job of im.icons.out) {
      await step(resolve(root, job.out), src, async () => {
        const pic = sharp(await opaque().resize({ width: job.width, kernel: "lanczos3" }).png().toBuffer()).removeAlpha();
        return exactPng(pic, job.out);
      });
    }
  }

  if (im.og && pick(im.og.src)) {
    const { src: name, out, width: W, height: H, background = "#ffffff" } = im.og, src = join(SRC, name);
    await step(resolve(root, out), src, async () => {
      const { width, height } = await sharp(src).metadata();
      if (width !== W || height !== H) throw new Error(`images: ${name} is ${width} × ${height}, not ${W} × ${H}`);
      return exactPng(sharp(src).flatten({ background }).removeAlpha(), out);
    });
  }

  if (im.ico && pick(im.ico.src)) {
    const { src: name, out, sizes = [16, 32], circle: round = false, background = "#ffffff" } = im.ico, src = join(SRC, name);
    await step(resolve(root, out), src, async () => {
      const entries = [];
      for (const size of sizes) {
        const square = await sharp(src).flatten({ background }).resize({ width: size, kernel: "lanczos3" }).removeAlpha().toBuffer();
        const pic = round ? await sharp(square).joinChannel(await sharp(circle(size)).extractChannel("alpha").toBuffer()).png().toBuffer() : await sharp(square).png().toBuffer();
        entries.push({ size, data: await exactPng(sharp(pic), `${out} ${size}`, { rgba: true }) });
      }
      return icoFile(entries);
    });
  }

  if (im.favicon && pick(im.favicon.src)) {
    // favicon.svg: the mark, square viewBox (centred), one colour, another when the browser is dark
    const { optimize } = peer(root, "svgo");
    const { src: name, out, light = "#000", dark = "#fff" } = im.favicon, src = join(SRC, name);
    await step(resolve(root, out), src, async () => {
      const svg = await readFile(src, "utf8");
      const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
      const side = Math.max(w, h);
      const square = svg
        .replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(w - side) / 2} ${(h - side) / 2} ${side} ${side}"><style>path{fill:${light}}@media (prefers-color-scheme:dark){path{fill:${dark}}}</style>`)
        .replace(/\s*fill="[^"]*"/g, "");
      const { data } = optimize(square, { multipass: true, floatPrecision: 3, plugins: [{ name: "preset-default", params: { overrides: { inlineStyles: false, minifyStyles: false } } }] });
      return Buffer.from(data);
    });
  }

  const kb = (b) => (b / 1024).toFixed(0) + " KB";
  if (dry) log(`images: ${would.length} to make, ${skipped} up to date${would.length ? "\n  " + would.join("\n  ") : ""}`);
  else log(`images: ${made} made (${kb(bytesIn)} of originals → ${kb(bytesOut)}), ${skipped} up to date`);
  return { made, skipped, would };
}

function helpers(sharp) {
  // The smallest lossless PNG of a picture: an exact palette if the picture has 256 colours or fewer, else full colour.
  // Each candidate is decoded and compared with the picture pixel by pixel; one that differs is never used.
  // { rgba: true } skips the palette (the PNGs inside favicon.ico: some ICO readers only take 32-bit RGBA there).
  async function exactPng(pipeline, name, { rgba = false } = {}) {
    const ref = await pipeline.clone().ensureAlpha().raw().toBuffer();
    const tries = [
      ...(rgba ? [] : [pipeline.clone().png({ palette: true, colours: 256, dither: 0, effort: 10, compressionLevel: 9 })]),
      pipeline.clone().png({ palette: false, compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
    ];
    // identical, except that a fully transparent pixel may carry any colour
    const same = (a, b) => {
      for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] !== b[i + 3]) return false;
        if (a[i + 3] && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])) return false;
      }
      return a.length === b.length;
    };
    let best = null;
    for (const t of tries) {
      const data = await t.toBuffer();
      const back = await sharp(data).ensureAlpha().raw().toBuffer();
      if (same(back, ref) && (!best || data.length < best.length)) best = data;
    }
    if (!best) throw new Error(`images: no lossless PNG for ${name}`);
    return best;
  }

  // favicon.ico with PNG entries (every browser since IE 11 / Windows Vista reads them)
  function icoFile(entries) {
    const head = Buffer.alloc(6 + 16 * entries.length);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
    let offset = head.length;
    entries.forEach(({ size, data }, i) => {
      const e = 6 + 16 * i;
      head.writeUInt8(size % 256, e); head.writeUInt8(size % 256, e + 1);   // 0 means 256
      head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
      head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
      head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
      offset += data.length;
    });
    return Buffer.concat([head, ...entries.map((x) => x.data)]);
  }

  // a smooth circle filling the square, as an alpha mask
  const circle = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/></svg>`);

  return { exactPng, icoFile, circle };
}
