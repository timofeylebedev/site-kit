# runtime/: browser helpers

Small plain ES modules (and one stylesheet) that a site imports from its own scripts. No dependencies, no build step:
Vite resolves them like any package file (`site-kit/runtime/<file>`). Each one carries a lesson that cost a bug on
Flow Medium; the comment at its top tells the whole story. A site can adopt them one at a time: none needs another,
except `scroller.js`, which reads what `box.js` decided.

| File | What | The lesson | The rule that guards it |
|---|---|---|---|
| `loaded.js` | `whenLoaded(fn)`: now if the page has loaded, else on `load` | A script that starts late comes after `load`; a bare listener never runs (four found at once, Oct 25, 2026) | `learn.bare-load` |
| `styles.js` | `await stylesReady()`: every linked stylesheet has applied | Safari may run a module before the stylesheet (WebKit bug 261655); what is measured then stays wrong | `learn.styles-first` |
| `gpu.js` | `realGPU()`, `gpuContext(canvas, kind, attrs, { force })`, `isSoftware(gl)`, `rendererOf(gl)` | Without a GPU, Chrome copies a WebGL canvas back to the processor every frame (≈ 12 ms a frame) | `learn.webgl-caveat` |
| `box.js` | a classic `<head>` script: on Safari 26+ on a Mac, `<html class="boxed">` | Safari's top bar is solid only when the window does not scroll | `learn.box-every-page` |
| `scroller.js` | what scrolls: `y()`, `to()`, `by()`, `max()`, `height()`, `onScroll()`, `offScroll()`, `watchSize()`, `ioRoot`, `box`, `paper()` | In the box the window's scroll never changes | `learn.window-scroll`, `learn.io-root` |
| `safari.css` | the box's CSS and `.bar-guard` (iPhone's bottom bar stays plain glass) | Safari's bottom bar takes the colour of anything fixed or sticky at the bottom edge | `learn.bar-guard` |

## Wiring

```js
// the entry module (main.js)
import { stylesReady } from "site-kit/runtime/styles.js";
import { whenLoaded } from "site-kit/runtime/loaded.js";
import { y, onScroll, ioRoot, box } from "site-kit/runtime/scroller.js";
await stylesReady();                         // before anything is started or measured
if (box) ScrollTrigger.defaults({ scroller: box });   // GSAP watches the box
whenLoaded(() => measureAgain());
new IntersectionObserver(load, { root: ioRoot, rootMargin: "100% 0px" });

// a decorative WebGL canvas
import { gpuContext } from "site-kit/runtime/gpu.js";
const gl = gpuContext(canvas, "webgl2", { alpha: true }, { force: /[?&]ring=gl/.test(location.search) });
if (!gl) drawStill(document.createElement("canvas"));   // a canvas asked for WebGL can never draw 2D
```

```css
/* the site's base stylesheet */
@import "site-kit/runtime/safari.css";
:root { --box-bg: var(--paper); --box-pad-top: var(--nav-h); }
html.boxed:has(> body > [data-page]) body::before { display: none; }   /* a decoration on body: none in the box */
```

```html
<html lang="ru" data-box-param="fmbox">          <!-- options of box.js / scroller.js, all optional -->
<head>
  <script data-inline src="site-kit/runtime/box.js"></script>   <!-- inlined by the build, before every other script -->
  …
<body>
<div class="page" data-page>                     <!-- the box: everything of the page is in it -->
  <div class="bar-guard" aria-hidden="true"></div>
```

`box.js` must run before anything is drawn, so the build puts it inside each page (Flow Medium's `inlineScripts()` in
`build/plugins.js` replaces `<script data-inline src="…">` with the minified script). That plugin resolves the `src`
next to the page; to inline the kit's copy it must also resolve a package path
(`createRequire(root + "/package.json").resolve("site-kit/runtime/box.js")`).

Options of `box.js` and `scroller.js`, as attributes of `<html>` (defaults in brackets): `data-box-class` ["boxed"],
`data-box-page` ["[data-page]"], `data-box-param` ["box": `?box=1` / `?box=0` force the box on or off in any browser],
`data-box-from` ["26": the first Safari version that tints its bar]. `safari.css` is written for the defaults; a site
with other names writes its two selectors with them.

## Flow Medium: what each of its files becomes

FM keeps its own copies for now; the move is a later step. Then:

| FM file | Replaced by | The change at the call |
|---|---|---|
| `src/scripts/loaded.js` | `runtime/loaded.js` (same code) | `import { whenLoaded } from "site-kit/runtime/loaded.js"` in main.js, nav.js, nav-pill.js and tint.js |
| the `await Promise.all([...link[rel=stylesheet]…])` at the top of `src/scripts/main.js` | `runtime/styles.js` | `import { stylesReady } from "site-kit/runtime/styles.js"; await stylesReady();` (the comment above it can shrink to one line) |
| `tryGL()`'s two tests in `src/scripts/ring-gl.js` | `gpuContext()` | `const ctx = gpuContext(canvas, "webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" }, { force: FORCE_GL });` |
| the renderer test in `init()` of `src/scripts/stipple.js` | `isSoftware(gl)` | `if (isSoftware(gl) && !/[?&]fmdust=full/.test(location.search)) { MAX_SPECKS = 6000; … }` |
| `src/scripts/scroller.js` | `runtime/scroller.js` (same API; the box is found by `[data-page]`, which FM's `.page` has) | `import … from "site-kit/runtime/scroller.js"` in the 14 modules that import `./scroller.js` |
| `src/scripts/box.js` | `runtime/box.js` | `<html lang="ru" data-box-param="fmbox">` in the four pages; `<script data-inline src="site-kit/runtime/box.js">` (the inliner resolving package paths, above) |
| the box block and `.bar-guard` of `src/styles/base/base.css` | `runtime/safari.css` | `@import "site-kit/runtime/safari.css";` in main.css, doc.css, 404.css; `:root { --box-bg: var(--paper); --box-pad-top: var(--nav-h); }`; FM keeps `html.boxed:has(> body > .page) body::before { display: none }` (its sand) |
| `src/scripts/boot.js` | stays FM's own | its box-aware `scrollY_` / `scrollTo_` are the head's twin of scroller.js; it reads the same class |
