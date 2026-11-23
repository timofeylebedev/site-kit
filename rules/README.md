# rules/: the lessons learned, as code rules

Each lesson below was a bug that shipped once and was found late (by Tim on his iPhone, by an independent review, by a
profile). Written as prose in a CLAUDE.md it was forgotten by the next session; as a rule it fails, with the file and
the line, in a second, on every pull request.

```sh
site-kit rules            # every code rule: the kit's design rules, these lessons, the site's own
site-kit rules --strict   # exit 1 when one fails (CI)
site-kit rules --json out.json
```

`learnings.mjs` exports `learningRules(ctx) → [{ id, area: "Code", title, how, fails: ["file:line what"], note }]`;
`checks/source.mjs` builds the context (SPEC.md «Code rules: one shape») and runs them with the kit's design rules and
the site's own. `cli.mjs` prints them all, like Flow Medium's old `npm run rules`; when `checks/source.mjs` is missing it
runs the lessons alone on `context.mjs`'s minimal context. A rule whose part of the site is not set and cannot be found
says so in its note and fails nothing (`learn.window-scroll` and `learn.io-root` without a scroll module: nothing to go
through, nothing to check). A rule that throws, or a `learnings.mjs` that cannot be loaded, is never left out: each
lesson then comes back as «could not run» (`error`; its ids and titles are in `ids.mjs`, which imports nothing), its
last findings carried by the state, so nothing counts as fixed and nothing comes back as «new».

## The rules

| id | Fails | Why |
|---|---|---|
| `learn.window-scroll` | (only when there is a scroll module) a read of `scrollY` / `scrollX` / `pageYOffset` / `pageXOffset` / the root's `scrollTop`, a `scroll` listener on the window or the document, `window.onscroll`, or `scrollTo` / `scrollBy` on the window, outside the scroll module. A name of the file's own (`import { y as scrollY }`) is not the window's | In Safari on a Mac the page scrolls in its own box (runtime/scroller.js): the window's scroll then never changes |
| `learn.io-root` | an `IntersectionObserver` with a `rootMargin` and no `root` (only when there is a scroll module) | The box clips what is in it: seen from the screen, nothing below it is ever "near", and nothing loads |
| `learn.webgl-caveat` | a `getContext("webgl" / "webgl2" / "experimental-webgl")` or a three.js `WebGLRenderer` that neither asks for `failIfMajorPerformanceCaveat` (in its options, or in the 15 lines above where the options are built) nor reads the renderer's name in the 15 lines after (`UNMASKED_RENDERER_WEBGL`, `isSoftware()`, `rendererOf()`); the gpu module is exempt | Without a GPU, Chrome copies a WebGL canvas back to the processor every frame (≈ 12 ms a frame for one ring of covers). Keeping software WebGL in a lighter form is allowed: that is what the renderer check is for |
| `learn.bare-load` | `addEventListener("load")` on the window (bare, `window.`, `self.`, `globalThis.`) or `window.onload =`, unless the line or the three above check `document.readyState`; the loaded module is exempt | A script that starts late (after the first frame, imported on demand) comes after `load`; the listener never runs and nothing says so |
| `learn.styles-first` | the entry script never waits for its stylesheets (`stylesReady()` or the same wait written out: `link[rel=stylesheet]` … `.sheet`), waits without `await` / `.then`, or calls something it imports before the wait | Safari may run a module before the stylesheet applies (WebKit bug 261655); what is measured then stays wrong (the card stack lost its strips "sometimes") |
| `learn.consent-first` | a script element created, an iframe created in a file that names another site, `import()` / `fetch()` / `sendBeacon()` of another site's address, `.src` / `.href =` another site's address — in a file that is not the consent module and never calls the gate (`onConsent(`); a `<script src>` / `<iframe src>` with another site's address in a page | Only an explicit «OK» is consent (152-ФЗ); nothing optional (analytics, a booking widget's preload) may run before it |
| `learn.lazy-media` | a stylesheet loaded on its own (a `<link rel=stylesheet>` of a page, an `import "x.css"` / `import("x.css")` of a script) whose `@import` closure uses a custom media (`@media (--phone)`) but never imports the media file | Lightning CSS (Vite) defines custom media per bundle, and fails on one it has not seen |
| `learn.bar-guard` | a rule for `.bar-guard` with a background, a backdrop filter, content, or `pointer-events: none` | Safari skips the guard as see-through only while it has nothing to show and takes taps; a backdrop filter painted the bar white |
| `learn.box-every-page` | a page with the box (`[data-page]`) whose `<head>` does not run the box script, or runs another script before it | Without it Safari on a Mac scrolls that page in the window (a glass bar) and the scroll module reads the wrong scroller |

"Another site" is any absolute `http(s)://` or `//` address whose host is not the adapter's `live` host and matches none
of `consent.allowed`.

## The adapter: `rules.learnings`

Every key is optional. A missing key means: look for the usual file name under `paths.scripts`.

| Key | What | Default |
|---|---|---|
| `scrollModule` | the module(s) that own the scroll (a list is allowed: the head script that cannot import it, say) | a `scroller.js` under the scripts |
| `loadedModule` | the module of `whenLoaded` | a `loaded.js` |
| `gpuModule` | the module of the GPU test | a `gpu.js` |
| `boxScript` | the `<head>` script of the box | a `box.js` |
| `boxPage` | the selector of the box in the pages (`[attr]` or `.class`) | `[data-page]` |
| `entry` | the entry script (`learn.styles-first`); not set: the rule is not run | — |
| `consent` | `{ module, gate, allowed: [regex] }`, or `false` for a site with no consent at all | a `consent.js`, gate `onConsent` |
| `barGuard` | the guard's selector | `.bar-guard` |

The media file is the adapter's `css.media`; the site's own host is `live`.

Flow Medium sets `scrollModule: ["src/scripts/scroller.js", "src/scripts/boot.js"]` (boot.js is inlined into `<head>`
before anything is drawn and cannot import scroller.js; it asks the box itself), the loaded, box and consent modules and
`entry: "src/scripts/main.js"`.

## Turning a rule off for a file

Only with a decision in decisions.json that names it (who, when, why), with a `rules` field:

```json
{ "id": "debug-tools", "kind": "exception", "what": "…", "decided": "Tim, 2026-11-23", "why": "…",
  "rules": [{ "rule": "learn.window-scroll", "files": "src/scripts/debug\\.js$" }] }
```

The rule then counts that file's fails as kept and says so in its note. `files` omitted: allowed site-wide; a
`selectors` regex: only places inside a CSS rule whose selector matches (a stylesheet's fails), e.g.
`{ "rule": "colour-tokens", "files": "\\.css$", "selectors": "^\\.card" }`.

## Tests

`node --test test/learnings.test.mjs`: a pass and a fail case per rule, on snippets.
