// The lessons learned on Tim's sites, as code rules that fail (SPEC.md «The lessons as rules»). Each was a bug that
// shipped once and was found late (by Tim on his iPhone, by an independent review, by a profile); each rule says why
// in its `how`, and the runtime helper that cures it is in runtime/ (README there).
//
//   learningRules(ctx) → [{ id, area, title, how, fails: ["file:line what"], note }]
//
// ctx is the context of checks/source.mjs (SPEC.md «Code rules: one shape»): cfg, io, css, js, html, allowed(id, file).
// The adapter's `rules.learnings` says which modules play which part (README.md here); a rule whose part is not set
// and cannot be found says so in its note and fails nothing. A site turns a rule off for a file only with a decision
// whose `rules` field names it: "rules": [{ "rule": "learn.window-scroll", "files": "src/scripts/debug\\.js" }].
import { dirname, join, normalize, basename } from "node:path";

const AREA = "Code";

// ── reading JavaScript: comments out, strings kept apart, line numbers kept ──

/** Scans JS once: `code` has comments blanked and the insides of strings, templates and regexes replaced by "x"
 *  (quotes kept, newlines kept), so brackets and names can be matched; `text` has only the comments blanked. */
export function scanJs(src) {
  const code = src.split(""), text = src.split("");
  const n = src.length;
  const blank = (arr, a, b) => { for (let k = a; k < b; k++) if (arr[k] !== "\n") arr[k] = " "; };
  const fill = (a, b) => { for (let k = a; k < b; k++) if (code[k] !== "\n") code[k] = "x"; };
  let i = 0, last = "";                       // last significant character (decides whether "/" starts a regex)
  const stack = [];                           // open template literals: the brace depth at which each ${ … } closes
  let depth = 0;
  const regexOk = () => !last || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /\b(return|typeof|case|in|of|void|delete|new|else|do|yield|await)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd());
  const template = () => {                    // from just after a backtick (or a closing } of ${…}) to its end or ${
    const start = i;
    while (i < n) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "`") { fill(start, i); i++; last = "`"; return; }
      if (src[i] === "$" && src[i + 1] === "{") { fill(start, i); i += 2; stack.push(depth); depth++; last = "{"; return; }
      i++;
    }
    fill(start, n);
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? n : e; blank(code, i, end); blank(text, i, end); i = end; continue; }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; blank(code, i, end); blank(text, i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      const start = ++i;
      while (i < n && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      fill(start, Math.min(i, n)); i++; last = c; continue;
    }
    if (c === "`") { i++; template(); continue; }
    if (c === "/" && regexOk()) {
      const start = ++i; let cls = false;
      while (i < n && src[i] !== "\n") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") cls = true; else if (src[i] === "]") cls = false; else if (src[i] === "/" && !cls) break;
        i++;
      }
      fill(start, i); i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      last = "/"; continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (stack.length && depth === stack[stack.length - 1]) { stack.pop(); i++; template(); continue; }
    }
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return { code: code.join(""), text: text.join("") };
}

/** Removes CSS comments, keeping line numbers. */
export const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const lineAt = (s, i) => { let k = 1; for (let j = 0; j < i; j++) if (s.charCodeAt(j) === 10) k++; return k; };

/** The index of the bracket that closes the one at `open` (in masked code), or the end. */
function closing(code, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" }, want = [];
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (pairs[c]) want.push(pairs[c]);
    else if (c === want[want.length - 1]) { want.pop(); if (!want.length) return i; }
  }
  return code.length;
}

// ── the adapter's parts ──

function parts(ctx) {
  const cfg = ctx.cfg || {}, L = cfg.rules?.learnings || {};
  const scripts = cfg.paths?.scripts || "src/scripts";
  const has = (p) => p && (ctx.js?.[p] != null || ctx.io?.exists?.(p));
  const list = (v) => (v == null ? [] : [].concat(v));
  const find = (names) => Object.keys(ctx.js || {}).find((f) => names.includes(basename(f)));
  const pick = (key, fallbackNames) => (key in L ? list(L[key]) : list(find(fallbackNames)));
  return {
    scroll: pick("scrollModule", ["scroller.js"]).filter(Boolean),
    loaded: pick("loadedModule", ["loaded.js"]).filter(Boolean),
    gpu: pick("gpuModule", ["gpu.js"]).filter(Boolean),
    box: pick("boxScript", ["box.js"]).filter(Boolean),
    entry: L.entry || null,
    consent: L.consent === false ? false : {
      module: L.consent?.module ?? find(["consent.js", "consent.mjs"]) ?? null,
      gate: L.consent?.gate || "onConsent",
      allowed: list(L.consent?.allowed),          // third-party addresses allowed before consent (regexes), e.g. a font CDN
    },
    media: cfg.css?.media || null,
    barGuard: L.barGuard || ".bar-guard",
    boxPage: L.boxPage || "[data-page]",
    scripts, has,
  };
}

// a rule's fails, with what decisions keep aside
function rule(ctx, id, title, how, found, note = "") {
  const fails = [], kept = new Map();
  const key = (f) => { const [, file, line] = f.match(/^([^:]*):(\d+)/) || [, f, 0]; return [file, +line]; };
  found = [...new Set(found)].sort((x, y) => { const [a, i] = key(x), [b, j] = key(y); return a < b ? -1 : a > b ? 1 : i - j; });
  for (const f of found) {
    const file = f.split(":")[0];
    const d = ctx.allowed?.(id, file);
    if (d) kept.set(d.id, (kept.get(d.id) || 0) + 1);
    else fails.push(f);
  }
  const keptNote = [...kept].map(([d, k]) => `${k} kept by decision ${d}`).join("; ");
  return { id, area: AREA, title, how, fails, note: [note, keptNote].filter(Boolean).join(" · ") };
}

const scanned = new WeakMap();
function jsFiles(ctx) {
  if (scanned.has(ctx)) return scanned.get(ctx);
  const out = Object.entries(ctx.js || {}).map(([file, src]) => ({ file, src, ...scanJs(src) }));
  scanned.set(ctx, out);
  return out;
}

const WINDOW = String.raw`(?:window|self|globalThis)`;

// matches of a pattern that names a string ("scroll", "load") on the text, kept only where they start in code
const inCode = (code, text, re) => [...text.matchAll(re)].filter((m) => code[m.index] === text[m.index]);

// ── 1. the scroll goes through one module ──
function windowScroll(ctx, P) {
  const found = [];
  const reads = new RegExp(String.raw`(?<![\w$.])(?:${WINDOW}\s*\.\s*)?(scrollY|scrollX|pageYOffset|pageXOffset)\b`, "g");
  const rootTop = /\bdocument\s*\.\s*(?:documentElement|scrollingElement|body)\s*\.\s*scrollTop\b/g;
  const listen = new RegExp(String.raw`(?<![\w$.])(?:(?:${WINDOW}|document)\s*\.\s*)?addEventListener\s*\(\s*["'\`]scroll["'\`]`, "g");
  const onscroll = new RegExp(String.raw`(?<![\w$.])(?:(?:${WINDOW}|document)\s*\.\s*)?onscroll\s*=(?!=)`, "g");
  const moves = new RegExp(String.raw`(?<![\w$.])(?:(?:${WINDOW}\s*\.\s*)(scrollTo|scrollBy|scroll)|(scrollTo|scrollBy))\s*\(`, "g");
  for (const { file, code, text } of jsFiles(ctx)) {
    if (P.scroll.includes(file)) continue;
    // a name of the file's own (`import { y as scrollY }`, `const scrollY = …`) is not the window's
    const own = new Set([...code.matchAll(/\b(?:as|const|let|var|function)\s+(scrollY|scrollX|pageYOffset|pageXOffset|scrollTo|scrollBy)\b/g)].map((m) => m[1]));
    const at = (m, what) => found.push(`${file}:${lineAt(code, m.index)} ${what}`);
    for (const m of code.matchAll(reads)) {
      const bare = !/^(window|self|globalThis)/.test(m[0]);
      if (bare && own.has(m[1])) continue;
      if (bare && /[{,]\s*$/.test(code.slice(Math.max(0, m.index - 40), m.index)) && /^\s*:/.test(code.slice(m.index + m[0].length))) continue;   // a key
      at(m, `reads the window's ${m[1]}`);
    }
    for (const m of code.matchAll(rootTop)) at(m, "uses the root's scrollTop");
    for (const m of inCode(code, text, listen)) at(m, `listens to the ${/document/.test(m[0]) ? "document's" : "window's"} scroll`);
    for (const m of code.matchAll(onscroll)) at(m, "sets onscroll on the window");
    for (const m of code.matchAll(moves)) {
      const name = m[1] || m[2];
      if (!m[1] && own.has(name)) continue;
      at(m, `scrolls the window (${name})`);
    }
  }
  const where = P.scroll.length ? P.scroll.join(", ") : null;
  return rule(ctx, "learn.window-scroll", "The scroll goes through one module",
    "No script reads window.scrollY / scrollX / pageYOffset or the root's scrollTop, listens to the window's (or document's) scroll, or scrolls the window, outside the scroll module" +
    (where ? ` (${where})` : "") + ". In Safari on a Mac the page may scroll in its own box (runtime/scroller.js): the window's scroll then never changes. Ask the module: y(), to(), onScroll().",
    found, where ? "" : "no scroll module set or found (rules.learnings.scrollModule): every window scroll counts");
}

// ── 2. an IntersectionObserver that looks ahead watches from the scroller ──
function ioRoot(ctx, P) {
  const found = [];
  if (!P.scroll.length) return rule(ctx, "learn.io-root", "Observers that look ahead watch from the scroller", "—", [], "no scroll module: nothing to check");
  for (const { file, code } of jsFiles(ctx)) {
    for (const m of code.matchAll(/\bnew\s+IntersectionObserver\s*\(/g)) {
      const open = m.index + m[0].length - 1, args = code.slice(open, closing(code, open) + 1);
      if (/\brootMargin\b/.test(args) && !/\broot\s*:/.test(args)) found.push(`${file}:${lineAt(code, m.index)} rootMargin without root`);
    }
  }
  return rule(ctx, "learn.io-root", "Observers that look ahead watch from the scroller",
    "Every IntersectionObserver with a rootMargin also names its root (the scroll module's ioRoot): in the box the box clips what is in it, so seen from the screen nothing below it would ever be \"near\" and nothing loads.",
    found);
}

// ── 3. WebGL only on a real GPU ──
function webglCaveat(ctx, P) {
  const found = [];
  for (const { file, code, text } of jsFiles(ctx)) {
    if (P.gpu.includes(file)) continue;
    const lines = text.split("\n");
    const calls = [...code.matchAll(/\.getContext\s*\(\s*(["'`])x*\1/g)].map((m) => ({ m, kind: text.slice(m.index, m.index + m[0].length).match(/["'`]([\w-]+)["'`]/)?.[1] }))
      .filter((c) => /^(webgl2?|experimental-webgl)$/.test(c.kind));
    for (const m of code.matchAll(/\bnew\s+(?:[\w$]+\.)?WebGL(?:1)?Renderer\s*\(/g)) calls.push({ m, kind: "WebGLRenderer" });
    for (const { m, kind } of calls) {
      const line = lineAt(code, m.index);
      const open = code.indexOf("(", m.index), args = text.slice(open, closing(code, open) + 1);
      const before = lines.slice(Math.max(0, line - 16), line).join("\n");   // options built just above the call
      const after = lines.slice(line - 1, line + 15).join("\n");             // the renderer read just after it
      if (/failIfMajorPerformanceCaveat/.test(args) || /failIfMajorPerformanceCaveat/.test(before)) continue;
      if (/UNMASKED_RENDERER_WEBGL|\bisSoftware\s*\(|\brendererOf\s*\(/.test(after)) continue;
      found.push(`${file}:${line} ${kind} without failIfMajorPerformanceCaveat or a renderer check`);
    }
  }
  return rule(ctx, "learn.webgl-caveat", "WebGL only on a real GPU",
    "Every getContext(\"webgl\"/\"webgl2\") (and three.js WebGLRenderer) asks for failIfMajorPerformanceCaveat or reads the renderer's name right after (software: SwiftShader, llvmpipe), or goes through runtime/gpu.js" +
    (P.gpu.length ? ` (${P.gpu.join(", ")})` : "") + ". Without a GPU, Chrome copies a WebGL canvas back to the processor every frame (≈ 12 ms a frame for one ring of covers).",
    found);
}

// ── 4. no bare load listener ──
function bareLoad(ctx, P) {
  const found = [];
  const re = new RegExp(String.raw`(?<![\w$.])(?:${WINDOW}\s*\.\s*)?addEventListener\s*\(\s*["'\`]load["'\`]`, "g");
  for (const { file, code, text } of jsFiles(ctx)) {
    if (P.loaded.includes(file)) continue;
    const lines = code.split("\n");
    for (const m of inCode(code, text, re)) {
      const line = lineAt(code, m.index);
      // guarded: the same check as whenLoaded, on the line or just above it (if (document.readyState …) addEventListener)
      if (/readyState/.test(lines.slice(Math.max(0, line - 4), line).join("\n"))) continue;
      found.push(`${file}:${line} addEventListener("load") on the window without a readyState check`);
    }
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.])(?:${WINDOW}\s*\.\s*)?onload\s*=(?!=)`, "g"))) found.push(`${file}:${lineAt(code, m.index)} window.onload`);
  }
  return rule(ctx, "learn.bare-load", "Nothing waits for a load that has passed",
    "No addEventListener(\"load\") on the window unless the line or the three above check document.readyState: a script that starts late (after the first frame, imported on demand) comes after the load, and the listener never runs. Use whenLoaded(fn) (runtime/loaded.js" +
    (P.loaded.length ? `; here ${P.loaded.join(", ")}` : "") + ").",
    found);
}

// ── 5. the start-up waits for the stylesheets ──
function stylesFirst(ctx, P) {
  const id = "learn.styles-first", title = "The start-up waits for the stylesheets";
  const how = "The entry script waits for every stylesheet (runtime/styles.js stylesReady(), or the same wait written out) before its first call of anything it imports: Safari may run a module before the stylesheet applies (WebKit bug 261655), and what is measured then stays wrong.";
  if (!P.entry) return rule(ctx, id, title, how, [], "no entry script set (rules.learnings.entry): not checked");
  const src = ctx.js?.[P.entry] ?? (ctx.io?.exists?.(P.entry) ? ctx.io.read(P.entry) : null);
  if (src == null) return rule(ctx, id, title, how, [`${P.entry}:1 the entry script does not exist`]);
  const { code, text } = scanJs(src);
  const wait = [/\bstylesReady\s*\(/.exec(code), /link\[rel=["']?stylesheet/.test(text) ? /\.sheet\b/.exec(code) : null].filter(Boolean).sort((a, b) => a.index - b.index)[0];
  const found = [];
  if (!wait) found.push(`${P.entry}:1 never waits for the stylesheets`);
  else {
    const stmt = code.slice(Math.max(0, code.lastIndexOf(";", wait.index) + 1, code.lastIndexOf("\n\n", wait.index)), wait.index);
    const then = /^[^;]*?\)\s*\.then\s*\(/.test(code.slice(wait.index));
    if (!/\bawait\b/.test(stmt) && !then) found.push(`${P.entry}:${lineAt(code, wait.index)} waits for the stylesheets without await (or .then)`);
    const names = new Set();
    for (const m of code.matchAll(/\bimport\s*(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+))?\s*from\s*["']x*["']/g)) {
      if (m[1]) names.add(m[1]);
      if (m[3]) names.add(m[3]);
      for (const p of (m[2] || "").split(",")) { const k = p.trim().split(/\s+as\s+/).pop(); if (k) names.add(k); }
    }
    names.delete("stylesReady");
    let first = null;
    for (const k of names) {
      const m = new RegExp(String.raw`(?<![\w$.])${k.replace(/\$/g, "\\$")}\s*(?:\.\s*[\w$]+\s*)*\(`, "g");
      for (const c of code.matchAll(m)) {
        if (c.index >= wait.index) break;
        if (/\bimport\b[^;]*$/.test(code.slice(code.lastIndexOf(";", c.index) + 1, c.index))) continue;   // inside the import line
        if (!first || c.index < first.index) first = { index: c.index, name: k };
        break;
      }
    }
    if (first) found.push(`${P.entry}:${lineAt(code, first.index)} calls ${first.name}() before the stylesheets are in (line ${lineAt(code, wait.index)})`);
  }
  return rule(ctx, id, title, how, found);
}

// ── 6. third parties start only from consent ──
function consentFirst(ctx, P) {
  const id = "learn.consent-first", title = "Third parties start only after consent";
  if (P.consent === false) return rule(ctx, id, title, "—", [], "turned off by the adapter (rules.learnings.consent: false)");
  const { module, gate, allowed } = P.consent;
  const ok = (url) => allowed.some((a) => new RegExp(a).test(url));
  const live = ctx.cfg?.live ? new URL(ctx.cfg.live).host : null;
  const host = (url) => { try { return new URL(url, "https://x").host; } catch { return null; } };
  const external = (url) => /^(https?:)?\/\//.test(url) && !(live && host(url) === live) && !ok(url);
  const found = [];
  for (const { file, code, text } of jsFiles(ctx)) {
    if (file === module) continue;
    const urls = [...text.matchAll(/["'`]((?:https?:)?\/\/[^"'`\s]+)/g)].map((m) => m[1]).filter(external);
    const loads = [];
    const add = (m, what) => loads.push(`${file}:${lineAt(code, m.index)} ${what}`);
    for (const m of code.matchAll(/\bcreateElement\s*\(\s*["'`]x*["'`]\s*\)/g)) {
      const tag = text.slice(m.index, m.index + m[0].length).match(/["'`](\w+)["'`]/)?.[1]?.toLowerCase();
      if (tag === "script") add(m, "creates a script element");
      else if (tag === "iframe" && urls.length) add(m, `creates an iframe (${urls[0]})`);
    }
    for (const m of code.matchAll(/\b(?:import|fetch|sendBeacon|importScripts)\s*\(\s*["'`]x*["'`]/g)) {
      const url = text.slice(m.index, m.index + m[0].length).match(/["'`]([^"'`]*)["'`]/)?.[1] || "";
      if (external(url)) add(m, `loads ${url}`);
    }
    for (const m of code.matchAll(/\.(?:src|href)\s*=\s*["'`]x*["'`]/g)) {
      const url = text.slice(m.index, m.index + m[0].length).match(/["'`]([^"'`]*)["'`]/)?.[1] || "";
      if (external(url)) add(m, `points at ${url}`);
    }
    if (!loads.length) continue;
    if (new RegExp(String.raw`\b${gate}\s*\(`).test(code)) continue;      // started from the gate (onConsent(start))
    for (const l of loads) found.push(`${l}, not from ${gate}()${module ? "" : " (no consent module)"}`);
  }
  for (const [file, src] of Object.entries(ctx.html || {})) {
    const s = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
    for (const m of s.matchAll(/<(script|iframe)\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) {
      if (external(m[2])) found.push(`${file}:${lineAt(s, m.index)} <${m[1].toLowerCase()} src="${m[2]}"> in the page, before any consent`);
    }
  }
  return rule(ctx, id, title,
    `Anything that loads a third party (a script element, an iframe or a request to another site, a <script>/<iframe> with another site's address in a page) starts only from ${gate}() of the consent module${module ? ` (${module})` : ""}: only an explicit «OK» is consent, and nothing optional may run before it.`,
    found, module ? "" : "no consent module set or found (rules.learnings.consent.module)");
}

// ── 7. a stylesheet loaded on its own brings the custom media it uses ──
function lazyMedia(ctx, P) {
  const id = "learn.lazy-media", title = "A stylesheet loaded on its own imports the custom media";
  const how = `Every stylesheet the pages or the scripts load (an entry) has, in its @import closure, the file of the custom media (${P.media || "css.media"}) when any file of that closure uses one: Lightning CSS (Vite) defines a custom media per bundle, and fails on (or drops) one it has not seen.`;
  if (!P.media) return rule(ctx, id, title, how, [], "no media file (css.media): not checked");
  const css = ctx.css || {};
  const media = normalize(P.media);
  const imports = (file) => {
    const s = stripCss(css[file] || "");
    return [...s.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)].map((m) => m[1]).filter((p) => p.startsWith(".")).map((p) => normalize(join(dirname(file), p)));
  };
  const closure = (file) => { const seen = new Set(), go = (f) => { if (seen.has(f)) return; seen.add(f); imports(f).forEach(go); }; go(file); return seen; };
  const entries = new Map();      // entry → where it is loaded from
  for (const [file, src] of Object.entries(ctx.html || {})) {
    for (const m of src.matchAll(/<link\b[^>]*rel=["']?stylesheet[^>]*>/gi)) {
      const href = m[0].match(/href=["']?([^"'\s>]+)/)?.[1];
      if (href && !/^(https?:)?\/\//.test(href)) entries.set(normalize(join(dirname(file), href.replace(/^\//, ""))), file);
    }
  }
  for (const { file, code, text } of jsFiles(ctx)) {
    for (const m of code.matchAll(/\bimport\s*(?:\(\s*)?["'`]x*["'`]/g)) {
      const p = text.slice(m.index, m.index + m[0].length).match(/["'`]([^"'`]+)["'`]/)?.[1]?.replace(/\?.*$/, "");
      if (p?.startsWith(".") && p.endsWith(".css")) entries.set(normalize(join(dirname(file), p)), file);
    }
  }
  const found = [];
  for (const [entry, from] of entries) {
    if (!(entry in css)) continue;
    const all = closure(entry);
    if (all.has(media) || [...all].some((f) => /@custom-media\b/.test(stripCss(css[f] || "")))) continue;
    for (const f of all) {
      const s = stripCss(css[f] || ""), m = /@media[^{;]*\(\s*--[\w-]+\s*\)/.exec(s);
      if (m) found.push(`${f}:${lineAt(s, m.index)} uses custom media, but ${entry} (loaded by ${from}) never imports ${media}`);
    }
  }
  return rule(ctx, id, title, how, found, `${entries.size} stylesheets loaded on their own`);
}

// ── 8. the guard of Safari's bottom bar stays empty ──
function barGuard(ctx, P) {
  const id = "learn.bar-guard", title = "The bottom bar's guard stays empty";
  const how = `No rule for ${P.barGuard} gives it a background, a backdrop filter, content or pointer-events: none: Safari skips it as see-through only while it has nothing to show and takes taps (a backdrop filter made the bar white; runtime/safari.css).`;
  const found = [];
  let seen = 0;
  const sel = P.barGuard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [file, src] of Object.entries(ctx.css || {})) {
    const s = stripCss(src);
    for (const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!new RegExp(sel + String.raw`(?![\w-])`).test(m[1])) continue;
      seen++;
      for (const d of m[2].split(";")) {
        const [prop, ...v] = d.split(":"), p = (prop || "").trim().toLowerCase(), val = v.join(":").trim().toLowerCase();
        if (!val) continue;
        const bad = /^(background(-color|-image)?|(-webkit-)?backdrop-filter)$/.test(p) ? !/^(none|transparent)$/.test(val)
          : p === "content" ? !/^(none|normal)$/.test(val) : p === "pointer-events" ? val === "none" : false;
        if (bad) found.push(`${file}:${lineAt(s, m.index + m[1].length)} ${p}: ${val} on ${m[1].trim()}`);
      }
    }
  }
  return rule(ctx, id, title, how, found, seen ? "" : `no ${P.barGuard} in the styles`);
}

// ── 9. every page with the box runs the box script first ──
function boxEveryPage(ctx, P) {
  const id = "learn.box-every-page", title = "Every page with the box runs the box script first";
  const how = `Every page that has the page's box (${P.boxPage}) runs the box script (${P.box.join(", ") || "box.js"}) in its <head>, before any other script: else Safari on a Mac scrolls that page in the window (a glass bar), and scripts that ask the scroll module read the wrong scroller.`;
  if (!P.box.length) return rule(ctx, id, title, how, [], "no box script set or found (rules.learnings.boxScript)");
  const attr = P.boxPage.match(/^\[([\w-]+)\]$/)?.[1], cls = P.boxPage.match(/^\.([\w-]+)$/)?.[1];
  const hasBox = (s) => attr ? new RegExp(String.raw`<\w+\b[^>]*\s${attr}(?=[\s=>])`).test(s) : cls ? new RegExp(String.raw`class=["'][^"']*\b${cls}\b`).test(s) : false;
  const found = [];
  let pages = 0;
  for (const [file, src] of Object.entries(ctx.html || {})) {
    const s = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
    if (!hasBox(s)) continue;
    pages++;
    const head = s.slice(0, Math.max(0, s.search(/<\/head>/i)));
    const scripts = [...head.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/type=["']?application\/(ld\+)?json/i.test(m[1]));
    const i = scripts.findIndex((m) => P.box.some((b) => (m[1].match(/src=["']?([^"'\s>]+)/)?.[1] || "").endsWith(basename(b))));
    if (i < 0) found.push(`${file}:1 has the box but its <head> does not run ${P.box.map((b) => basename(b)).join(" / ")}`);
    else {
      const earlier = scripts.slice(0, i).filter((m) => /\bsrc=|type=["']?module/.test(m[1]));
      if (earlier.length) found.push(`${file}:${lineAt(s, earlier[0].index)} a script runs before the box script`);
    }
  }
  return rule(ctx, id, title, how, found, `${pages} pages with the box`);
}

/** The lessons as rules, in order. */
export function learningRules(ctx) {
  const P = parts(ctx);
  return [windowScroll, ioRoot, webglCaveat, bareLoad, stylesFirst, consentFirst, lazyMedia, barGuard, boxEveryPage].map((r) => r(ctx, P));
}
