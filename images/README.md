# Images: the site's pictures from their originals

`site-kit images` turns the originals (`cfg.images.from`) into the files the site uses (`cfg.images.to`): every
width and format the adapter lists, at the setting written there; the site's icons, the picture for shared links,
`favicon.ico` and `favicon.svg`. The settings are not guessed: `site-kit images search` finds, for each output, the
lowest one whose SSIMULACRA2 against the original at that width is at least 90 (no visible loss at 1:1), and the
adapter keeps it with its score and size in a comment. It was Flow Medium's `build/images.mjs` (Oct 2026); on FM it
decides and encodes exactly as that did (below).

## Commands

Run in the site's root. Encoding is CPU-heavy: on a shared machine run it under the browser lock
(`flock /home/claude/.browser.lock site-kit images …`), never beside a browser run.

```
site-kit images                     make what is new or changed (an output newer than its original is skipped)
site-kit images --force             make everything again
site-kit images --dry               list what would be made, make nothing
site-kit images --only cover-home   only the jobs whose name (or source) contains this
site-kit images score [--only …]    each committed output scored against its original: score and size (! under the target)
site-kit images search --only hero [--target 90] [--format avif|webp] [--bits 8|10] [--chroma 420|444]
                                    the lowest setting of each output that reaches the target; prints it to paste
```

After replacing an original: run `site-kit images`, commit the outputs. After a new picture or a changed look:
`search` it, write the settings into the adapter with the score and size, run `site-kit images --only <name>`.

## The adapter: `images` in `site-kit.config.mjs`

| field | what |
|---|---|
| `from`, `to` | the originals and the outputs (relative to the site's root) |
| `quality` | defaults per format, merged over the kit's (`avif` 55 effort 9, `webp` 80 effort 6, `png` level 9 palette) |
| `search.target` | the score `search` and `score` aim at (default 90) |
| `jobs` | `[{ src, name?, widths: [px \| null], formats: ["avif", "webp", "png"], options?, quality?, lossless?, background?, seen? }]` |
| `svg` | a RegExp (or a function of the file name): the `.svg` originals cleaned and minified (svgo) into `to` |
| `icons` | `{ src, background, out: [{ out, width }] }`: opaque square icons (apple-touch-icon, the manifest's) |
| `og` | `{ src, out, width, height }`: the picture for shared links, at its own size (the command stops if it is not) |
| `ico` | `{ src, out, sizes: [16, 32], circle }`: `favicon.ico` of PNG entries, optionally cut to a circle |
| `favicon` | `{ src, out, light, dark }`: the mark in a square viewBox, `light` fill, `dark` under `prefers-color-scheme: dark` |

A job: files are `<name>-<width>.<format>`, or `<name>.<format>` with one width; a width of `null` is the
original's own; `name` defaults to the source's. `options` is `{ avif: {…}, webp: {…} }` (sharp's options) or a
function of the width returning that; `quality` overrides the quality of every format; `lossless` makes lossless
WebP (effort 6). For the search: `background` is the colour the picture is seen on (a transparent one is flattened
on it before scoring), `seen` a density it is only ever fetched at (a number, or `{ width: density }`).

The icons' and links' outputs (`out`) are paths from the site's root (they live at fixed addresses, often `public/`).

## What it carries (FM, Oct 2026)

- **Score, don't guess.** Each setting is the lowest that scores SSIMULACRA2 ≥ 90 against the original *at that
  width*: earlier files at «quality 55» scored 75–79. `ssimulacra2.mjs` is a port of the reference (libjxl), with no
  binary to install. On FM's committed files it gives FM's recorded scores (Home cover 90.62 against 90.6, M cover
  90.24 against 90.0, Litmus 420 90.12 against 90.1; within 0.5 on the others). Pictures are decoded to 8 bits, as a
  browser shows them, 10-bit AVIF included (that is how FM's scores were taken).
- **On the colour it is seen on.** A transparent picture is scored flattened on its card's colour (`background`).
- **As it is seen.** A file only ever fetched at a higher density (the 2650 px hero, asked for only at 1.25×) is
  scored as seen there, both scaled down by the density (`seen`); `search` prints the 1:1 score beside it.
- **10-bit AVIF for grain.** Film grain and fine scans keep their look at a smaller size in 10-bit (FM's Home
  cover: 10-bit 86, 100 KB, against 8-bit 92, 136 KB). `search` tries 8- and 10-bit.
- **Full colour for coloured marks.** Halved colour (4:2:0) never reaches 90 on small coloured marks on white (FM's
  tool cards): `search` tries 4:4:4 too, and keeps the smallest file that passes.
- **WebP for browsers without AVIF.** Lossy WebP halves the colour; where even 100 does not reach the target,
  near-lossless does, and on flat colour and letters it can beat any AVIF (FM's First steps cover: 14 KB at 92.8
  against 31 KB at 91.3), so such a picture may have no AVIF at all.
- **Exceptions are written.** A picture that cannot reach 90 at a sensible size (FM's Home icon in the hero chips:
  83, 90 would take 60 KB) keeps a lower setting, said in the adapter's comment; `score` marks it `!`.
- **Icons are lossless and checked.** Every PNG is the smallest of an exact palette and full colour whose decoded
  pixels are identical to the resized picture (a fully transparent pixel may carry any colour); the PNGs inside
  `favicon.ico` are 32-bit RGBA (some ICO readers take nothing else).
- **Skip by time.** An output newer than its original is up to date, so the command is cheap to run. Git does not
  keep times: in a fresh clone an output may look older than its original and be made again; with the same sharp
  the bytes come out identical, so git shows no change. A changed setting is not seen: `--force` (or `--only`) then.

## On Flow Medium (Nov 23, 2026)

- `site-kit images` decides as `build/images.mjs` did: both report 119 outputs up to date, none made, git clean.
- With `--force` the kit's encodes are byte-identical to FM's committed files (41 files checked: AVIF 8- and 10-bit,
  WebP lossy, near-lossless and lossless, the icons, og.png, favicon.ico, favicon.svg, the SVGs).
- `search --only cover-m --format avif --bits 8 --chroma 420` finds 64 (90.2, 14.2 KB), FM's setting; 98 s for
  that one output (each try is an effort-9 encode). A full search of every mode of a big picture takes many minutes.
- `score`: every tuned output is at 90 or more. The 29 under it are the ones FM never searched: the WebP fallbacks
  beside an AVIF «at the usual setting», and small WebP-only pictures (faces, the author's 48 px photo, the drawings'
  pictures, the royalty fallbacks). Very small pictures score low by construction (fewer than six scales).

## Files

| file | what |
|---|---|
| `cli.mjs` | `site-kit images [score \| search]` |
| `make.mjs` | the pipeline: jobs, SVG, icons, og, ico, favicon (`make(cfg, { force, dry, only })`, `outputs(job, meta)`) |
| `search.mjs` | `scoreAll(cfg)` and `search(cfg)` |
| `ssimulacra2.mjs` | `score(a, b)` on raw sRGB pixels (8 or 16 bits), no dependencies |
| `../test/images.test.mjs` | the metric and the output names (no encoding) |

Packages: `sharp` and `svgo` from the site's own node_modules (peer dependencies).

## Fonts

Flow Medium's `build/fonts.py` (subsets of the originals to WOFF2 for Russian and English pages, every OpenType
feature kept, hinting kept for Windows; then the numbers of Arial stand-ins so nothing moves when the font arrives)
stays in the site for now. It is close to generic, but not yet: the font list, the character ranges and the sample
text are written in the file, it is Python (fonttools, brotli) where the kit is Node, and the stand-in numbers are
printed to copy into a stylesheet by hand. To join the kit it would read `fonts: { from, to, files: { src: out },
unicodes, sample, standIns }` from the adapter and stay a Python script the command calls.
