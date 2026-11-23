# shots: pictures of the blocks (layer 3 of the report)

A JPEG of each block of the page at each size, with the fingerprints of the files that change its look, the date and
the commit. The review page shows each picture with its date and marks it "may be out of date" when one of those
files has changed since (SPEC.md, «Three layers»).

```sh
site-kit shots                      # every block (same as --all)
site-kit shots --changed            # only blocks whose files differ from their last kept pictures
site-kit shots --blocks hero,nav    # only these blocks
site-kit shots --sizes 390x844,1440x900 --out some/dir --max-width 1000
site-kit shots --changed --base origin/report-data   # where the kept index is (a git ref; default: origin/<checks.dataBranch>)
```

Run it after the build (`paths.dist`). Headless Chromium (`PLAYWRIGHT_CHROMIUM` picks the binary).

## What it reads (the adapter)

| Field | Use |
|---|---|
| `report.blocks` | `[{ id, title, selector, files, page?, frames? }]`: the first element matching `selector` on `page` (a path in `dist`, default the home page) is pictured; `files` (paths from the site's root) are its fingerprint; `frames` see below |
| `report.shotSizes` | default sizes, `"390x844,1440x900"` when missing |
| `report.shotMaxWidth` | the widest picture in pixels (1000) |
| `checks.query` | added to every address (as the checks load pages, e.g. `?fmbox=0`) |
| `checks.unstyle` | `[[RegExp, string]]` rewrites of the served documents and stylesheets (e.g. `scrollbar-gutter`) |
| `checks.sizes` | a size listed there with `touch: true` is loaded as a touch phone; other sizes are touch under 820px |
| `paths.dist`, `paths.out` | the built site; where the pictures go |

## What it writes

- `<paths.out>/shots/<id>/<w>x<h>.jpg` (frames: `<w>x<h>.jpg`, `<w>x<h>-2.jpg`, …)
- `<paths.out>/shots/index.json`:
  `{ generated, commit, mode, sizes, upToDate: { id: taken }, missed?: { <id>: [{ w, h, why }] }, blocks: { <id>: { title, page, selector, files: { path: blobSha }, taken, commit, sizes: [{ w, h, file, css: { w, h }, bytes, frame?, at?, old?, taken? }], missed?: [{ w, h, why }] } } }`
  Only the blocks shot by this run are in `blocks`; `upToDate` lists the ones `--changed` left alone.

`index.mjs` has the pure parts for the other tools: `fingerprints(io, files)`, `whatChanged(entry, now, sizes)`,
`staleFiles(entry, now)` (the report's "may be out of date"), `mergeShots(kept, fresh, ids)` (the keeper: a block shot
now replaces its entry and its folder; blocks gone from the adapter are dropped).

## How a page is pictured (and why)

- **Served as GitHub Pages serves it** (`lib/serve.mjs`, shared with the checks and the audit: no ".html" in addresses, 404.html for anything missing, 127.0.0.1 only), with
  the adapter's `checks.query` and `checks.unstyle`: the pictures show the page the checks measured.
- **Other hosts answered with nothing** (204): nothing leaves the machine; no analytics, no third-party frames.
- **Reduced motion**, and `animations: "disabled"` for the picture: reveals and entrances settle at once, so a
  block is caught at rest, not halfway in.
- **Scrolled top to bottom once** before the first picture: drawings, dots and reveals mount lazily, in view.
- **A block that shows late** (a cookie notice after a delay) gets until 6 s after the load.
- **Whatever is fixed or sticky outside the block** (the navbar, a notice, a bottom bar) is hidden for its picture,
  or it would cover the block's top or bottom.
- **At most 1000 pixels wide, no image library**: the page is drawn at a pixel ratio of `min(2, 1000 / width)`
  (a phone at 2×, a 1440 screen at 0.69×), so the browser makes the JPEG (quality 78) at its final size.
- **Blocks played by the scroll** (a pinned stage whose cards come up one by one) are mostly empty space as a whole:
  their picture is screens taken as the page scrolls through them, at `frames` (0 = the block's top at the top of the
  screen, 1 = its bottom at the bottom). A block taller than 4 screens without `frames` gets `[0, 0.5, 1]`.
- **The fingerprint is the git blob sha** of each file (`git hash-object`): the same content gives the same sha on
  any machine, committed or not, so `--changed` compares with the kept index without any history.
- **Only a block's own files** are its fingerprint: a change to shared files (tokens, base styles, the page's HTML)
  does not mark every picture stale. Take all again with `--all` (CI: the manual run's `shots: all`) after such a
  change, or at a round's end.
- **Never fails the build**: the command exits non-zero only when it cannot run (no build, an unknown block).
- **A miss never loses a picture.** A block found at no size gets no entry (it is listed under the index's own
  `missed`): its kept entry and pictures stay, and since its files still differ the next `--changed` run tries it
  again. A size the block is hidden at by design ("not shown at this size", "no size at this size") goes into the
  entry's `missed` and is not asked for again until the block's files change; a size that failed for another reason
  (an error, a time-out) is left out, so it is tried again, and its kept picture stays meanwhile, marked `old` with its
  own date (`mergeShots`, `entryOf` in index.mjs; `keep` leaves such files in the block's folder).

## In CI (`.github/workflows/checks.yml`)

- main: `site-kit shots --changed` after the checks; `site-kit checks keep` puts the pictures on the data branch
  (`checks.dataBranch`, default report-data) (`shots/<id>/…`, `shots/index.json` merged with `mergeShots`).
- a pull request with the label `shots`: `site-kit shots --changed` (against main's pictures) into its preview's
  review page only; nothing is kept.
- the manual run's input `shots: all`: every block again.
