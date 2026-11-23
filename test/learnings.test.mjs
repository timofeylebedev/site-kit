// The lessons as rules (rules/learnings.mjs): a pass and a fail per rule, on snippets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { learningRules, scanJs } from "../rules/learnings.mjs";

const L = { scrollModule: "s/scroller.js", loadedModule: "s/loaded.js", boxScript: "s/box.js", entry: "s/main.js", consent: { module: "s/consent.js" } };
const run = ({ js = {}, css = {}, html = {}, learnings = L, media = "st/media.css", decisions = [] } = {}) => {
  const ctx = {
    cfg: { live: "https://me.example/", paths: { scripts: "s", styles: "st" }, css: { media }, rules: { learnings } },
    js: { "s/main.js": "await stylesReady();\n", ...js }, css, html,
    allowed: (id, file) => decisions.find((d) => d.rules.some((r) => r.rule === id && new RegExp(r.files).test(file))) || null,
  };
  return Object.fromEntries(learningRules(ctx).map((r) => [r.id, r]));
};
const fails = (r) => r.fails.map((f) => f.split(" ")[0]);

test("scanJs blanks comments and string insides, keeps lines", () => {
  const { code, text } = scanJs('a("x // y"); // c\nb(`t ${scrollY} u`); /re\\/x/.test(s)');
  assert.equal(code.split("\n").length, 2);
  assert.ok(!code.includes("// c") && !text.includes("// c"));
  assert.ok(code.includes("scrollY"), "code inside ${} stays code");
  assert.ok(!code.includes("y\")"), "string inside masked");
  assert.ok(text.includes('"x // y"'), "text keeps strings");
});

test("window-scroll", () => {
  const r = run({ js: {
    "s/scroller.js": "export const y = () => window.scrollY;",
    "s/ok.js": 'import { y as scrollY, onScroll } from "./scroller.js";\nonScroll(() => scrollY());\nel.addEventListener("scroll", f);\nconst o = { scrollY: 1 };\nbox.scrollTo({ top: 0 });\n// window.scrollY in a comment\nconst s = "scrollY";',
    "s/bad.js": 'const a = scrollY;\nwindow.addEventListener("scroll", f);\naddEventListener("scroll", g);\nwindow.scrollTo(0, 1);\ndocument.documentElement.scrollTop = 4;\nconst b = window.pageYOffset;',
  } })["learn.window-scroll"];
  assert.deepEqual(fails(r), ["s/bad.js:1", "s/bad.js:2", "s/bad.js:3", "s/bad.js:4", "s/bad.js:5", "s/bad.js:6"]);
});

test("window-scroll: a decision keeps a file aside", () => {
  const r = run({ js: { "s/debug.js": "const a = scrollY;" }, decisions: [{ id: "debug-tools", rules: [{ rule: "learn.window-scroll", files: "debug\\.js$" }] }] })["learn.window-scroll"];
  assert.equal(r.fails.length, 0);
  assert.match(r.note, /1 kept by decision debug-tools/);
});

test("io-root", () => {
  const r = run({ js: {
    "s/scroller.js": "",
    "s/a.js": "new IntersectionObserver((e) => go(e), { root: ioRoot, rootMargin: '100% 0px' });\nnew IntersectionObserver(f, { threshold: 0.5 });",
    "s/b.js": "const io = new IntersectionObserver((e) => {\n  go(e);\n}, { rootMargin: '200px' });",
  } })["learn.io-root"];
  assert.deepEqual(fails(r), ["s/b.js:1"]);
});

test("webgl-caveat", () => {
  const r = run({ js: {
    "s/ring.js": 'const gl = c.getContext("webgl2", { alpha: true, failIfMajorPerformanceCaveat: true });',
    "s/dust.js": 'const gl = c.getContext("webgl2", {});\nconst dbg = gl.getExtension("WEBGL_debug_renderer_info");\nif (/SwiftShader/.test(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))) few();',
    "s/opts.js": 'const opt = { failIfMajorPerformanceCaveat: true };\nconst gl = c.getContext("webgl", opt);',
    "s/flat.js": 'const x = c.getContext("2d");',
    "s/bad.js": 'const gl = c.getContext("webgl2", { alpha: true }) || c.getContext("webgl");\nconst r = new THREE.WebGLRenderer({ canvas: c });',
  } })["learn.webgl-caveat"];
  assert.deepEqual(fails(r), ["s/bad.js:1", "s/bad.js:1", "s/bad.js:2"]);
});

test("bare-load", () => {
  const r = run({ js: {
    "s/loaded.js": 'export function whenLoaded(fn) { if (document.readyState === "complete") fn(); else addEventListener("load", fn, { once: true }); }',
    "s/ok.js": 'img.addEventListener("load", f);\nlet loaded = document.readyState === "complete";\n\nif (!loaded) addEventListener("load", go);\ndocument.addEventListener("load", f, true);',
    "s/bad.js": 'addEventListener("load", go);\nwindow.addEventListener(\'load\', go);\nwindow.onload = go;',
  } })["learn.bare-load"];
  assert.deepEqual(fails(r), ["s/bad.js:1", "s/bad.js:2", "s/bad.js:3"]);
});

test("styles-first", () => {
  const ok1 = run({ js: { "s/main.js": 'import { init } from "./a.js";\nimport { stylesReady } from "site-kit/runtime/styles.js";\nawait stylesReady();\ninit();' } });
  assert.equal(ok1["learn.styles-first"].fails.length, 0);
  const ok2 = run({ js: { "s/main.js": 'import { init } from "./a.js";\nawait Promise.all([...document.querySelectorAll(\'link[rel="stylesheet"]\')].filter((l) => !l.sheet).map(wait));\ninit();' } });
  assert.equal(ok2["learn.styles-first"].fails.length, 0);
  const early = run({ js: { "s/main.js": 'import { init, other } from "./a.js";\nother.start();\nawait stylesReady();\ninit();' } });
  assert.deepEqual(fails(early["learn.styles-first"]), ["s/main.js:2"]);
  const never = run({ js: { "s/main.js": 'import { init } from "./a.js";\ninit();' } });
  assert.deepEqual(fails(never["learn.styles-first"]), ["s/main.js:1"]);
  const noAwait = run({ js: { "s/main.js": "stylesReady();\n" } });
  assert.equal(noAwait["learn.styles-first"].fails.length, 1);
  const off = run({ learnings: { ...L, entry: undefined } });
  assert.match(off["learn.styles-first"].note, /not checked/);
});

test("consent-first", () => {
  const r = run({
    js: {
      "s/consent.js": 'const s = document.createElement("script"); s.src = "https://counter.example/tag.js";',
      "s/metrics.js": 'import { onConsent } from "./consent.js";\nonConsent(() => { const s = document.createElement("script"); s.src = "https://mc.example/tag.js"; document.head.append(s); });',
      "s/own.js": 'fetch("https://me.example/data.json");\nfetch("/api");',
      "s/bad.js": 'const s = document.createElement("script");\nfetch("https://track.example/hit");\nimport("https://cdn.example/x.js");',
    },
    html: { "index.html": '<head>\n<script src="./s/main.js"></script>\n<script async src="https://www.googletagmanager.com/gtag/js"></script>\n<!-- <script src="https://old.example/x.js"></script> -->\n</head>' },
  })["learn.consent-first"];
  assert.deepEqual(fails(r), ["index.html:3", "s/bad.js:1", "s/bad.js:2", "s/bad.js:3"]);
});

test("lazy-media", () => {
  const css = {
    "st/media.css": "@custom-media --phone (width < 48em);",
    "st/main.css": '@import "./media.css";\n@import "./part.css";',
    "st/part.css": ".a { color: red }\n@media (--phone) { .a { color: blue } }",
    "st/good-lazy.css": '@import "./media.css";\n@media (--phone) { .b {} }',
    "st/bad-lazy.css": ".c {}\n\n@media (--phone) { .c {} }",
  };
  const r = run({ css, html: { "index.html": '<link rel="stylesheet" href="./st/main.css">' }, js: {
    "s/a.js": 'import "../st/good-lazy.css";', "s/b.js": 'import("../st/bad-lazy.css");',
  } })["learn.lazy-media"];
  assert.deepEqual(fails(r), ["st/bad-lazy.css:3"]);
});

test("bar-guard", () => {
  const ok = run({ css: { "st/base.css": ".bar-guard { display: none; }\n@supports (-webkit-touch-callout: none) { .bar-guard { position: fixed; width: 64px; background: transparent; } }" } });
  assert.equal(ok["learn.bar-guard"].fails.length, 0);
  const bad = run({ css: { "st/base.css": ".bar-guard {\n  position: fixed;\n}\n.page .bar-guard { backdrop-filter: blur(8px); }\n.bar-guard { pointer-events: none; background-color: var(--paper) }" } });
  assert.deepEqual(fails(bad["learn.bar-guard"]), ["st/base.css:4", "st/base.css:5", "st/base.css:5"]);
});

test("box-every-page", () => {
  const head = (s) => `<html><head>\n${s}\n</head><body><div class="page" data-page></div></body></html>`;
  const r = run({ html: {
    "a.html": head('<script data-inline src="./s/box.js"></script>\n<script type="module" src="./s/main.js"></script>'),
    "b.html": head('<script type="module" src="./s/main.js"></script>'),
    "c.html": head('<script type="module" src="./s/main.js"></script>\n<script src="./s/box.js"></script>'),
    "d.html": "<html><head></head><body>no box</body></html>",
  } })["learn.box-every-page"];
  assert.deepEqual(fails(r), ["b.html:1", "c.html:2"]);
  assert.match(r.note, /3 pages with the box/);
});
