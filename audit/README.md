# audit/: the built pages in a real browser

```sh
site-kit audit                       # Chromium (PLAYWRIGHT_CHROMIUM names its binary, else Playwright's own)
site-kit audit --engine webkit       # or SITE_KIT_ENGINE=webkit (FM_ENGINE still works)
```

Run after the site's build, in its root. It serves `paths.dist` as GitHub Pages does (a folder's `index.html`,
`x` → `x.html`, `404.html` with status 404), opens each page at each size, scrolls it through once (so every block has
come in and every pinned part has moved), then looks at every section on screen. It fails (exit 1) on:

- **sideways scroll**: the page wider than the screen at any point of the scroll;
- **text cut off**: a line of text outside a block that clips it, or outside the screen;
- **text under 12px** as it is drawn (scaling included);
- **a link or button under 24×24px** to tap (WCAG 2.2, 2.5.8; a stretched `::after` counts);
- **axe-core** rules, at the sizes marked `axe`;
- **text over a canvas** (dots, shaders: axe cannot see it): its contrast from the pixels behind it, the text hidden
  for a moment, the median of every pixel, at the axe sizes;
- **a script error** on the page;
- all of it again with the **browser's text made bigger** (sizes with `font: 24`): rem sizes grow and em steps give the
  layout of a narrower screen; nothing may then scroll sideways or be cut off.

Exit 2 when it cannot run (no build, an unknown engine). Engines other than Chromium have no phone emulation of
Chromium's kind (Firefox none at all): there the phone sizes are plain windows. The bigger text is set through DevTools
in Chromium and through settings in Firefox; WebKit leaves those sizes out. Headless Chromium without a GPU gets
`--use-gl=swiftshader --enable-unsafe-swiftshader` (WebGL drawn in software, so the canvases show).

## Kept as designed

An exception in `paths.decisions` (`kind: "exception"`) whose `audit` field names what it covers is not a failure, but
it is measured and printed under "Kept as designed" on every run, so it stays in sight:

```json
"audit": { "axe": "color-contrast", "target": "\\.stat__label" }      // an axe rule on matching targets
"audit": { "pixels": [".cta__lead"] }                                   // text over a canvas, by selector
```

## The adapter: `audit`

| Field | What | Default |
|---|---|---|
| `pages` | the pages (paths in dist, as `checks.pages` writes them; strings or `{ path }`) | `checks.pages` without a `status` |
| `sizes` | `[{ w, h, touch?, axe?, font? }]` | the nine below |
| `skip` | selectors left out of «text cut off» (drawings, sliding strips: cut off on purpose) | `.sprite` |
| `skipSmall` | selectors left out of «text under 12px» (`script, style` always are) | `.sprite` |
| `skipTargets` | selectors left out of the target size (a skip link off screen) | none |
| `sections` | what is scrolled to and looked at one by one | `main > section`, `body > footer` |
| `axeStyle` | CSS added before axe runs (a decoration outside the page that hides every background from axe) | none |
| `query` | added to every page's address (`?box=0`, say) | none |
| `launchArgs` | Chromium's flags | the SwiftShader pair |

The nine sizes: 320×568 (axe), 390×844, 768×1024, 844×390, 1024×768 (phones and tablets, touch), 1366×650,
1920×1080 (axe), and 390×844 and 1366×650 with 24px text. With more than one page, each line of the output starts with
the page's path.

Flow Medium's adapter keeps today's audit exactly: the home page only, its drawings, chips, logo strip, ID cards, card
stack, navbar and menu left out of «cut off», `.skip` out of the targets, the stack left out of the sections, and its
sand above the page (`body::before`) hidden for axe.

## The lessons it carries

- Measure in a browser, never from the CSS: numbers in a pull request come from here (or the design checks).
- Scroll the page through before measuring: drawings, dots and reveals mount lazily.
- axe cannot see text over a WebGL or stipple background: that contrast is measured from pixels, in the page as it is.
- `html { scrollbar-gutter: stable }` is filled like a classic 15px scrollbar in headless Chromium: the audit keeps it on
  purpose (the worst case); the design checks take it out (`checks.unstyle`).
- At most one browser at a time on a small machine: wrap the command in `flock` when other browser jobs may run.

## Files

- `audit.mjs`: `audit(cfg, { engine, log }) → { failures, exceptions, kept, engine }`, `settings(cfg)`, `serve(dist)`,
  `SIZES`.
- `cli.mjs`: the command (prints, sets the exit code).
- Tests (no browser): `test/audit.test.mjs` (settings, the server).
