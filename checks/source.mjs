// The design system's rules read from the code: the scale (paths.scale), the decisions (paths.decisions), the
// stylesheets (paths.styles), the scripts (paths.scripts) and the page sources. Each rule lists what breaks it with the
// file and line ("<file>:<line> <what>", the file relative to the site's root). Used by `checks state` (the checks of
// every deploy), by `site-kit rules` (prints them) and by the report.
//
// sourceRules(cfg) → { results: [{ id, area, title, how, ok, n, fails, note }], relations, steps, customMedia, ladder }
// One context, then in order: the kit's generic design rules (below), the lessons (rules/learnings.mjs:
// learningRules(ctx)) and the site's own (cfg.rules.code(ctx)). A rule there is { id, area, title, how, fails, note? }.
// A fail that a decision allows for that rule is left out, and listed under `allowed`:
//   "rules": [{ "rule": "<id>", "files": "<regex>", "selectors": "<regex>" }]
// files: the fail's file (omitted: every file, the rule is allowed site-wide); selectors: the CSS rule the fail is in
// (only fails in a stylesheet have one; omitted: any).
//
// What the generic rules read from the adapter (all optional, a rule whose input is missing is not run):
//   css.tokens        the stylesheets where tokens are defined (the generated one first): token definitions may hold
//                     literal colours; every token they define must be used
//   css.media         the stylesheet of the page steps (@custom-media): the only place a width may be written in @media
//   rules.generated   a regex of generated stylesheets (default \.gen\.css$): not the site's own writing
//   rules.drawings    folders of pictures drawn in code (their own palettes, units and curves): left out of the colour,
//                     type, fluid-size and curve rules
//   rules.objectType  custom properties that size text as a part of an object scaled as a whole, or fitted to its box
//   rules.steps       { shared: ["22rem", …], own: [...] | (io) => [...] }: the layout steps container queries may use
//   rules.curves      { modules: ["src/scripts/motion.js"], tokens: "--ease" }: the one table of curves
//   rules.notes       { "<rule id>": "a note shown with the rule" }
//   rules.decisionFields  what every decision must have, and what each kind must have besides:
//                     ["id", "what", "why"] (the default), or { "*": [...], exception: ["rule", "fix"] }
import { dirname } from "node:path";
import { siteIO } from "../lib/config.mjs";

// the lessons are another part of the kit. When they cannot be loaded or throw, each of them is still a rule, one that
// could not run (status "error": its last findings are carried, rules/ids.mjs), never left out: their findings would
// count as fixed and come back as «new» on the next good run. Said once.
let learnings = null, learnWhy = null, lessons = [];
try { learnings = await import("../rules/learnings.mjs"); } catch (e) { learnWhy = String(e.message || e).split("\n")[0]; }
try { ({ LESSONS: lessons } = await import("../rules/ids.mjs")); } catch {}
let warned = false;
const warnOnce = (why) => { if (!warned) console.warn(`site-kit: the lessons (rules/learnings.mjs) could not run: ${why}`); warned = true; };
const notRun = (why) => lessons.map((l) => ({ id: l.id, area: "Code", title: l.title, how: "—", fails: [], error: why }));

const AREA = { ladder: "Type", relations: "Type", "no-swallowed-css": "Code", "colour-tokens": "Colour", "type-from-scale": "Type", "fluid-from-scale": "Space", "tokens-wired": "Code", "layout-steps": "Layout", "media-steps": "Layout", curves: "Motion", decisions: "Decisions" };

/** comments blanked, line numbers kept */
export const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
export const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
export const lineOf = (s, i) => s.slice(0, i).split("\n").length;

/** the selector of the CSS rule a line of a stylesheet is in (the nearest `selector {` above it), or null */
export function selectorIn(lines, line) {
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = lines[i].match(/^\s*([^{}/@][^{}]*?)\s*\{/);
    if (m) return m[1].trim().slice(0, 60);
    if (/^\s*\}/.test(lines[i]) && i < line - 1) return null;
  }
  return null;
}

/** the decision that allows a rule here, or null: an entry of its `rules` with this rule, whose `files` (omitted: any)
 *  matches the file and whose `selectors` (omitted: any) matches the CSS rule the place is in */
export function allowedBy(decisions, ruleId, file, selector = null) {
  return decisions.find((d) => (d.rules || []).some((r) => r.rule === ruleId &&
    (!r.files || new RegExp(r.files).test(file || "")) &&
    (!r.selectors || (selector != null && new RegExp(r.selectors).test(selector))))) || null;
}

/** the context every code rule gets (SPEC.md «Code rules: one shape») */
export function context(cfg) {
  const io = siteIO(cfg);
  const P = cfg.paths;
  const read = (files) => Object.fromEntries(files.map((f) => [f, io.read(f)]));
  const css = read(io.files(P.styles, ".css"));
  const js = read(io.files(P.scripts, [".js", ".mjs"]));
  // the page sources: paths.pages, else the folder above the (first) styles folder
  const pages = P.pages ?? dirname([].concat(P.styles)[0]);
  const html = read(io.files(pages, ".html").filter((f) => !f.startsWith(P.dist + "/")));
  const scale = io.json(P.scale, null);
  const decisions = io.json(P.decisions, { decisions: [] }).decisions || [];
  const lines = new Map();
  const selectorAt = (file, line) => {
    if (!/\.css$/.test(file || "")) return null;
    if (!lines.has(file)) lines.set(file, (css[file] ?? (io.exists(file) ? io.read(file) : "")).split("\n"));
    return selectorIn(lines.get(file), line);
  };
  const allowed = (ruleId, file, selector = null) => allowedBy(decisions, ruleId, file, selector);
  return { cfg, io, css, js, html, scale, decisions, strip, stripJs, lineOf, allowed, selectorAt };
}

export function sourceRules(cfg) {
  const ctx = context(cfg);
  const { io, css, js: jsFiles, html: htmlFiles, scale, decisions } = ctx;
  const R = cfg.rules || {}, notes = R.notes || {};
  const generated = new RegExp(R.generated || "\\.gen\\.css$");
  const own = (f) => !generated.test(f);
  const drawings = [].concat(R.drawings || []);
  const art = (f) => drawings.some((d) => f.startsWith(d.replace(/\/?$/, "/")));
  const tokenFiles = [].concat(cfg.css?.tokens || []).filter((f) => f in css);
  const mediaFile = cfg.css?.media && cfg.css.media in css ? cfg.css.media : null;

  const results = [];
  const rule = (id, title, how, fails, note = "") => results.push({ id, title, how, fails, note: note || notes[id] || "" });
  const extra = {};

  // 1. ladder: both ends of every role on the ladder (block sizes excepted)
  if (scale?.ladder) {
    const ladder = [0];
    for (const [step, to] of scale.ladder.steps) while (ladder.at(-1) < to) ladder.push(ladder.at(-1) + step);
    const roles = { ...scale.type?.roles, ...scale.space?.roles };
    const off = [];
    for (const [k, r] of Object.entries(roles)) if (!r.size) for (const v of r.px) if (!ladder.includes(v)) off.push(`${k}: ${v}`);
    const show = (() => { const marks = []; let last = null; for (const [step, to] of scale.ladder.steps) { marks.push(`${(last ?? 0) + step}`, "…"); marks.push(String(to)); last = to; } return marks.join(" "); })();
    rule("ladder", "Every size ends on the ladder", `${Object.keys(roles).length} roles of scale.json, both ends, against 0 ${show}`, off);
    extra.ladder = ladder;
  }

  // 2. relations at both ends
  if (scale?.type?.relations) {
    const min = scale.type.relations.min, close = [];
    const rel = scale.type.relations.pairs.map(([a, b]) => {
      const A = scale.type.roles[a].px, B = scale.type.roles[b].px, k0 = A[0] / B[0], k1 = A[1] / B[1];
      if (k0 < min - 1e-9 || k1 < min - 1e-9) close.push(`${a}/${b}: ×${k0.toFixed(3)} at 320, ×${k1.toFixed(3)} at 1440`);
      return { label: `${a.slice(5)} / ${b.slice(5)}`, k0, k1 };
    });
    rule("relations", "Neighbouring text levels at least ×" + min + " apart", `${rel.length} pairs of type.relations at 320 and 1440 (a ratio of two lines moves only between its two ends)`, close);
    extra.relations = rel;
  }

  // 3. no CSS inside a comment: an unclosed /* swallows everything to the next */
  const swallowed = [];
  for (const [f, s] of Object.entries(css)) {
    for (const m of s.matchAll(/\/\*([\s\S]*?)\*\//g)) if (/[{};]\s*\n\s*[.#:@a-z-][^\n]*\{/i.test(m[1]) && /\}\s*$/m.test(m[1])) swallowed.push(`${f}:${lineOf(s, m.index)}`);
    const left = strip(s);   // comments do not nest: what is left after taking them out must hold no comment marks
    for (const m of left.matchAll(/\/\*|\*\//g)) swallowed.push(`${f}:${lineOf(left, m.index)} a comment mark outside a comment (unclosed or stray)`);
  }
  rule("no-swallowed-css", "No CSS hidden inside a comment", "every comment of " + Object.keys(css).length + " stylesheets: rules inside, unbalanced marks", swallowed);

  // 4. colours from tokens only (the drawings excepted: they are pictures with their own palettes)
  const lit = [];
  for (const [f, s0] of Object.entries(css)) {
    if (!own(f) || art(f)) continue;
    const s = strip(s0);
    for (const m of s.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)/gi)) {
      const line = s.split("\n")[lineOf(s, m.index) - 1];
      if (/^\s*--[\w-]+\s*:/.test(line) && tokenFiles.includes(f)) continue;   // token definitions
      lit.push(`${f}:${lineOf(s, m.index)} ${m[0]}`);
    }
  }
  rule("colour-tokens", "Colours from the tokens only", `literal #hex / rgb() / hsl() / oklch() in the page's stylesheets (token definitions${drawings.length ? " and the drawings" : ""} left out)`, lit);

  // 5. type from the scale: every font-size is a type role, an em/% of one, or a listed object/fit size
  const OBJECT_TYPE = [].concat(R.objectType || []);
  const badType = [];
  for (const [f, s0] of Object.entries(css)) {
    if (!own(f) || art(f)) continue;
    const s = strip(s0);
    for (const m of s.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (/var\(--type-|^\d*\.?\d+(em|%)$|^inherit$|^1em$/.test(v) || OBJECT_TYPE.some((o) => v.includes(`var(${o}`))) continue;
      badType.push(`${f}:${lineOf(s, m.index)} ${v}`);
    }
  }
  rule("type-from-scale", "Text sizes from the scale", `every font-size: a --type-* role, em or %${OBJECT_TYPE.length ? `, or an object's own size (${OBJECT_TYPE.join(", ")})` : ""}`, badType);

  // 6. no own fluid values for spacing, radii and type (vw / cq / clamp only in the generated tokens or in block measures)
  const SPACE_PROPS = /^(margin|padding|gap|row-gap|column-gap|border-radius|font-size|letter-spacing|inset)/;
  const fluid = [];
  for (const [f, s0] of Object.entries(css)) {
    if (!own(f) || art(f)) continue;
    const s = strip(s0);
    for (const m of s.matchAll(/(^|[;{\s])([a-z-]+)\s*:\s*([^;}]+)/g)) {
      const [, , prop, v] = m;
      if (!SPACE_PROPS.test(prop)) continue;
      if (/\d(vw|vh|svh|dvh|cqw|cqi|cqh|vmin|vmax)\b|clamp\(/.test(v)) fluid.push(`${f}:${lineOf(s, m.index)} ${prop}: ${v.trim().slice(0, 70)}`);
    }
  }
  rule("fluid-from-scale", "Spacing, radii and type never own vw/cq/clamp()", "margin, padding, gaps, radii, font-size and inset declarations in every stylesheet", fluid);

  // 7. every var() used is defined, every token defined is used
  if (tokenFiles.length) {
    const defined = new Set(), used = new Map();
    const pageCss = Object.entries(css).map(([f, s]) => [f, strip(s)]);
    for (const [, s] of pageCss) for (const m of s.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
    const js = Object.values(jsFiles).join("\n"), html = Object.values(htmlFiles).join("\n");
    for (const m of js.matchAll(/["'`](--[\w-]+)["'`]|setProperty\(\s*["'`](--[\w-]+)/g)) defined.add(m[1] || m[2]);
    // set inside an inline style written by a script ('…;--i:' + i, `--turn:${x}`)
    for (const m of js.matchAll(/["'`;\s](--[\w-]+)\s*:/g)) defined.add(m[1]);
    // every custom property an inline style sets (style="--i: 1; --turn: 2"), not only the first
    for (const m of html.matchAll(/style="([^"]*)"/g)) for (const d of m[1].matchAll(/(--[\w-]+)\s*:/g)) defined.add(d[1]);
    for (const [f, s] of pageCss) for (const m of s.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      if (!used.has(m[1])) used.set(m[1], []);
      used.get(m[1]).push({ f, fallback: m[2] === "," });
    }
    for (const m of (js + html).matchAll(/var\(\s*(--[\w-]+)/g)) if (!used.has(m[1])) used.set(m[1], [{ f: "js/html", fallback: true }]);
    const undef = [...used].filter(([k, u]) => !defined.has(k) && !u.every((x) => x.fallback)).map(([k, u]) => `${k} (${[...new Set(u.map((x) => x.f))].join(", ")})`);
    const tokenNames = [...new Set(tokenFiles.flatMap((f) => [...strip(css[f]).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])))];
    const usedAnywhere = (k) => used.has(k) || js.includes(k) || html.includes(k);
    const unused = tokenNames.filter((k) => !usedAnywhere(k));
    rule("tokens-wired", "Every var() defined, every token used", `${used.size} custom properties used, ${tokenNames.length} tokens in ${tokenFiles.map((f) => f.split("/").pop()).join(" + ")}`,
      [...undef.map((x) => "used, never defined: " + x), ...unused.map((x) => "defined, never used: " + x)]);
  }

  // 8. layout steps: container queries only at the shared steps or a declared own step
  if (R.steps) {
    const own_ = typeof R.steps.own === "function" ? R.steps.own(io) : R.steps.own || [];
    const ownSteps = new Set(own_), shared = new Set(R.steps.shared || []);
    const steps = [], strays = [];
    for (const [f, s0] of Object.entries(css)) {
      const s = strip(s0);
      for (const m of s.matchAll(/@container\s*([\w-]*)\s*\(([^)]*)\)/g)) {
        const v = (m[2].match(/(\d+(?:\.\d+)?(?:rem|px|em))/) || [])[1];
        if (!v) continue;   // a style or aspect query
        steps.push({ f, at: lineOf(s, m.index), name: m[1], v });
        if (!shared.has(v) && !ownSteps.has(v)) strays.push(`${f}:${lineOf(s, m.index)} @container ${m[1]} (${m[2].trim()})`);
      }
    }
    rule("layout-steps", "Layouts change only at the shared steps or a declared own step", `${steps.length} width container queries against ${[...shared].join(", ")} and the declared own steps (${[...ownSteps].join(", ")})`, strays);
    extra.steps = steps;
  }

  // 9. page-level media steps (screen widths): the steps of the media stylesheet only
  if (mediaFile) {
    const media = strip(css[mediaFile]);
    const customMedia = [...media.matchAll(/@custom-media\s+(--[\w-]+)\s+([^;]+);/g)].map((m) => ({ name: m[1], q: m[2].trim() }));
    const rawMedia = [];
    for (const [f, s0] of Object.entries(css)) {
      const s = strip(s0);
      if (f === mediaFile) continue;
      for (const m of s.matchAll(/@media\s*([^{]+)\{/g)) if (/\d+(px|em|rem)/.test(m[1])) rawMedia.push(`${f}:${lineOf(s, m.index)} @media ${m[1].trim()}`);
    }
    rule("media-steps", `Screen steps only from ${mediaFile.split("/").pop()}`, `${customMedia.length} custom media (${customMedia.map((c) => c.name).join(", ")}); raw width queries elsewhere`, rawMedia);
    extra.customMedia = customMedia;
  }

  // 10. one table of curves: no literal cubic-bezier or named ease outside it (and the curve tokens)
  if (R.curves) {
    const modules = new Set([].concat(R.curves.modules || [])), prefix = R.curves.tokens || "--ease";
    const tokenLine = new RegExp("^\\s*" + prefix.replace(/[-]/g, "\\-"));
    const curves = [];
    for (const [f, s0] of Object.entries(css)) {
      if (art(f)) continue;
      const s = strip(s0);
      for (const m of s.matchAll(/cubic-bezier\([^)]*\)|(?<![-\w])(ease-in-out|ease-in|ease-out|ease|linear)(?![-\w(])/g)) {
        const line = s.split("\n")[lineOf(s, m.index) - 1];
        if (tokenFiles.includes(f) && tokenLine.test(line)) continue;
        if (/transition-timing-function:\s*linear|animation[^;]*linear/.test(line) && m[0] === "linear") continue;   // loops at an even speed
        curves.push(`${f}:${lineOf(s, m.index)} ${m[0]}`);
      }
    }
    for (const [f, t] of Object.entries(jsFiles)) {
      if (modules.has(f) || art(f)) continue;
      const s = stripJs(t);
      // literal curves, GSAP eases by name (ease: "…" or ease = "…"; "none" is the even scrub of scroll-linked motion), own CustomEases
      for (const m of s.matchAll(/cubic-bezier\(\s*[\d.]+[^)]*\)|ease\s*[:=]\s*["'](power\d|sine|expo|circ|back|elastic)[^"']*["']|CustomEase\.create\(\s*["'][^"']+["']\s*,\s*["'][\d.,\s]+["']/g))
        curves.push(`${f}:${lineOf(s, m.index)} ${m[0]}`);
    }
    rule("curves", `Curves from one table (${[...modules].map((m) => m.split("/").pop()).join(", ") || "the curve tokens"})`, `cubic-bezier() and named eases in the page's stylesheets and scripts, outside ${[...modules].join(", ") || "the curve module"} and the ${prefix} tokens`, curves);
  }

  // 11. decisions complete: the fields every decision must have, and those of each kind (rules.decisionFields)
  {
    const F = R.decisionFields || ["id", "what", "why"];
    const need = Array.isArray(F) ? F : F["*"] || [], byKind = Array.isArray(F) ? {} : Object.fromEntries(Object.entries(F).filter(([k]) => k !== "*"));
    const missingOf = (kind, k) => kind === "exception" && k === "rule" ? "an exception without the rule it departs from"
      : kind === "exception" && k === "fix" ? "an exception without a fix" : `${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind} without «${k}»`;
    const word = (k) => ({ rule: "the rule", fix: "a fix" }[k] || k);
    const incomplete = [];
    for (const d of decisions) {
      for (const k of need) if (!d[k]) incomplete.push(`${d.id || "?"}: no ${k}`);
      for (const [kind, fields] of Object.entries(byKind)) if (d.kind === kind) for (const k of fields) if (!d[k]) incomplete.push(`${d.id}: ${missingOf(kind, k)}`);
      for (const r of d.rules || []) if (!r.rule) incomplete.push(`${d.id}: an entry of «rules» without the rule it allows`);
    }
    const ids = decisions.map((d) => d.id), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    const kinds = Object.entries(byKind).map(([kind, fields]) => `; ${fields.map(word).join(" and ")} for each ${kind}`).join("");
    rule("decisions", "Every decision complete", `${decisions.length} entries: ${need.join(", ")}${kinds}; ids unique`, [...incomplete, ...dup.map((d) => "duplicate id " + d)]);
  }

  // the lessons, then the site's own
  const more = [];
  const failed = (why) => { warnOnce(why); more.push(...notRun(why)); };
  if (learnings?.learningRules) {
    try { const got = learnings.learningRules(ctx); if (Array.isArray(got)) more.push(...got); else failed("learningRules(ctx) did not return a list"); }
    catch (e) { failed(String(e.message || e).split("\n")[0]); }
  } else failed(learnWhy || "no learningRules() in it");
  if (typeof R.code === "function") more.push(...(R.code(ctx) || []));
  for (const r of more) results.push({ id: r.id, area: r.area, title: r.title, how: r.how, fails: r.fails || [], note: r.note || notes[r.id] || "", ...(r.error ? { error: r.error } : {}) });

  // a decision may allow a rule in some files, some CSS rules, or everywhere ("rules": [{ "rule", "files", "selectors" }]):
  // those fails are left out
  const placeOf = (fail) => { const m = String(fail).match(/^(\S+?):(\d+)(\s|$)/); return m ? [m[1], +m[2]] : [null, 0]; };
  const out = results.map((r) => {
    const kept = [], allowed = [];
    for (const f of r.fails) { const [file, line] = placeOf(f), d = ctx.allowed(r.id, file, file ? ctx.selectorAt(file, line) : null); if (d) allowed.push(`${f} (${d.id})`); else kept.push(f); }
    if (r.error) return { id: r.id, area: r.area || "Code", title: r.title, how: r.how, ok: false, n: null, fails: [], note: r.note, error: r.error };
    return { id: r.id, area: r.area || AREA[r.id] || "Code", title: r.title, how: r.how, ok: kept.length === 0, n: kept.length, fails: kept, note: r.note, ...(allowed.length ? { allowed } : {}) };
  });
  return { results: out, relations: extra.relations || [], steps: extra.steps || [], customMedia: extra.customMedia || [], ladder: extra.ladder || [] };
}
