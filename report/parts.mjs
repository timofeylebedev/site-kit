// The pure parts of the report's build: reading stylesheets, text and records into the shapes the page draws.
// No file system, no git: build.mjs hands them text. Tested in test/report.test.mjs.

export const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── the rounds' texts: the system shows only what is now ──────────────────────────────────────────────────────────
// old values and relative dates out of the measured texts of a round
export const nowOnly = (html) => typeof html !== "string" ? html : html
  .replace(/<span class='was'>[^<]*<\/span>\s*/g, "")
  .replace(/\s*\((?:was|before:?) [^()]*\)/g, "")                     // «(was 0.8s / 18%)»
  .replace(/,\s*was [\d.]+(?:px)?(?=[,;.)]|$)/g, "")                    // «31 at 390, was 36»
  .replace(/\s*\((?:today|since today)\)/g, "")
  .replace(/;\s*[^;()]*\bbefore\)/g, ")")                               // «(…; Pragmatica 700, 24 → 32 before)»
  .replace(/\s+since today(?=[.,;)])/g, "")
  .replace(/\btoday's\b/g, "the")
  .replace(/\b[Ss]ince today,?\s*/g, "");
export const cleanAll = (o) => {
  if (Array.isArray(o)) return o.map(cleanAll);
  if (o && typeof o === "object") { for (const k of Object.keys(o)) if (k !== "sweep") o[k] = cleanAll(o[k]); return o; }
  return nowOnly(o);
};

// ── stylesheets ───────────────────────────────────────────────────────────────────────────────────────────────────
/** walks a stylesheet, keeping the selector each declaration is in (nesting included) and its line */
export function walk(file, text, onDecl, onAt) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const stack = [], recs = [];                                            // recs: what onAt returned for each level
  let buf = "", bufLine = 1, line = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\n") line++;
    if (c === "{") {
      const head = buf.trim().replace(/\s+/g, " ");
      let rec = null;
      if (head.startsWith("@")) rec = onAt ? onAt({ file, line: bufLine, head, inside: stack.filter((s) => !s.startsWith("@")).at(-1) || "" }) || null : null;
      else if (recs.at(-1) && !recs.at(-1).first) recs.at(-1).first = head;   // the first rule inside an at-rule
      stack.push(head); recs.push(rec); buf = ""; bufLine = line;
    } else if (c === "}") {
      if (buf.trim()) onDecl(buf.trim(), stack, bufLine);
      stack.pop(); recs.pop(); buf = ""; bufLine = line;
    } else if (c === ";") {
      onDecl(buf.trim(), stack, bufLine); buf = ""; bufLine = line;
    } else {
      if (!buf.trim() && c.trim()) bufLine = line;
      buf += c;
    }
  }
}
export const selectorOf = (stack) => {
  const sels = stack.filter((s) => !s.startsWith("@"));
  return sels.reduce((acc, s) => (acc ? s.replace(/&/g, acc.split(",")[0].trim()) : s), "") || ":root";
};
const mediaOfStack = (stack) => stack.filter((s) => s.startsWith("@")).join(" ");
// a path as the page shows it: relative to the styles folder
const short = (f, stylesDir) => f.startsWith(stylesDir + "/") ? f.slice(stylesDir.length + 1) : f;

/** every box-shadow, text-shadow and drop-shadow filter: [{ prop, value, sel, media, file, line }] */
export function shadowsOf(files, get, stylesDir = "src/styles") {
  const out = [];
  for (const f of files) {
    const text = get(f);
    if (!text) continue;
    walk(f, text, (decl, stack, line) => {
      const m = decl.match(/^(box-shadow|text-shadow|filter)\s*:\s*([\s\S]+)$/);
      if (!m) return;
      if (m[1] === "filter" && !/drop-shadow/.test(m[2])) return;
      const value = m[2].replace(/\s+/g, " ").trim();
      if (/^none$/.test(value)) return;
      out.push({ prop: m[1], value, sel: selectorOf(stack), media: mediaOfStack(stack), file: short(f, stylesDir), line });
    });
  }
  return out;
}

/** the shadows grouped by value, each marked new against the baseline's; `name(s)` gives { name, painter, ground, … } */
export function groupShadows(now, then, describe = () => ({})) {
  const shadows = [];
  for (const s of now) {
    let g = shadows.find((x) => x.prop === s.prop && x.value === s.value);
    if (!g) shadows.push((g = { prop: s.prop, value: s.value, uses: [], isNew: !then.some((t) => t.value === s.value) }));
    g.uses.push({ sel: s.sel, media: s.media, file: s.file, line: s.line, isNew: !then.some((t) => t.value === s.value && t.sel === s.sel) });
  }
  shadows.forEach((s) => {
    const d = describe(s) || {};
    s.painter = !!d.painter;
    s.name = d.name || s.uses[0].sel;
    s.ground = d.ground || "paper";
    for (const k of ["shape", "text", "bg"]) if (d[k] != null) s[k] = d[k];
  });
  return shadows;
}

/** every @container query: [{ container, cond, file, line, inside, first }] */
export function stepsOf(files, get, stylesDir = "src/styles") {
  const out = [];
  for (const f of files) {
    const text = get(f);
    if (!text) continue;
    walk(f, text, () => {}, (at) => {
      if (!at.head.startsWith("@container")) return;
      const m = at.head.match(/^@container\s+([\w-]+\s+)?(.+)$/);
      const rec = { container: (m[1] || "").trim() || "(nearest)", cond: m[2].trim(), file: short(f, stylesDir), line: at.line, inside: at.inside, first: "" };
      out.push(rec);
      return rec;
    });
  }
  return out;
}

/** the container steps now, each named (shared step or own) and marked new against the baseline's */
export function containerSteps(stepsNow, stepsThen, shared = {}) {
  const taken = new Set();                                                  // a step it replaced is named once
  return stepsNow.map((s) => {
    const v = (s.cond.match(/([\d.]+(?:rem|em|px))/) || [])[1] || "";
    const isNew = !stepsThen.some((t) => t.cond === s.cond && t.container === s.container);
    // a step that replaced one: the baseline had another condition for the same container there, gone now
    const was = isNew ? stepsThen.find((t) => t.file === s.file && t.container === s.container && t.first === s.first &&
      !taken.has(t) && !stepsNow.some((n) => n.cond === t.cond && n.container === t.container)) : null;
    if (was) taken.add(was);
    return { ...s, value: v, px: /rem$/.test(v) ? parseFloat(v) * 16 : /px$/.test(v) ? parseFloat(v) : null, em: /\dem$/.test(v), step: shared[v] || "own",
      isNew, was: was ? was.cond : null };
  });
}

/** the page's own steps (custom media), with the comment after each */
export const mediaOf = (text) => [...(text || "").matchAll(/@custom-media\s+(--[\w-]+)\s+([^;]+);\s*(?:\/\*\s*([^*]*?)\s*\*\/)?/g)]
  .map((m) => ({ name: m[1], cond: m[2].trim(), note: (m[3] || "").trim() }));

/** the colours the stylesheets name: { "ink-60": "rgb(0 0 0 / 0.6)" } (the first definition wins) */
export function cssColours(texts, seed = {}) {
  const out = { ...seed };
  for (const t of texts) for (const m of (t || "").matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*;/g)) out[m[1]] ??= m[2];
  return out;
}

// ── motion read from the code (when no round has described it) ──────────────────────────────────────────────────────
const num = (s) => parseFloat(s);
/** `linear(0, 0.18 0.2%, …, 1)` → [[t, v]] (stops without a place are spread evenly, as CSS does) */
export function linearPoints(args) {
  const parts = args.split(",").map((p) => p.trim().split(/\s+/));
  const pts = parts.map(([v, at]) => [at != null ? num(at) / 100 : null, num(v)]);
  if (pts.length && pts[0][0] == null) pts[0][0] = 0;
  if (pts.length && pts.at(-1)[0] == null) pts.at(-1)[0] = 1;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] == null) {
    let j = i; while (pts[j][0] == null) j++;
    const a = pts[i - 1][0], b = pts[j][0];
    for (let k = i; k < j; k++) pts[k][0] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  return pts;
}
const curveOf = (value) => {
  const b = value.match(/cubic-bezier\(\s*([^)]*)\)/);
  if (b) { const bez = b[1].split(",").map(num); return bez.length === 4 && bez.every(Number.isFinite) ? { bez } : null; }
  const l = value.match(/linear\(\s*([^)]*)\)/);
  if (l && l[1].includes(",")) return { linear: linearPoints(l[1]) };
  return null;
};
const secs = (v) => { const m = String(v).match(/^(-?[\d.]+)(m?s)$/); return m ? (m[2] === "ms" ? num(m[1]) / 1000 : num(m[1])) : null; };

/**
 * The curves and durations the code names: custom properties holding a curve or a time (with the comment after them as
 * their use), curves kept in a script's constant, and the times written in transitions and animations.
 * → [{ type: "curves", items }, { type: "durations", rows }]
 */
export function motionFromCode(css, js) {
  const curves = [], rows = [], seen = new Set();
  for (const [file, text] of Object.entries(css)) {
    // custom properties first: they are the named curves and times
    for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);[ \t]*(?:\/\*\s*([\s\S]*?)\s*\*\/)?/g)) {
      const [, name, value, note] = m, c = curveOf(value);
      if (c && !seen.has(name)) { seen.add(name); curves.push({ name: name.replace(/^--/, ""), ...c, use: (note || "").replace(/\s+/g, " "), code: `${name}: ${value.trim().length > 60 ? value.trim().slice(0, 57) + "…" : value.trim()}` }); }
      const s = secs(value.trim());
      if (s != null && !seen.has(name)) { seen.add(name); rows.push({ group: "tokens", name, s, kind: "transition" }); }
    }
    walk(file, text, (decl, stack) => {
      const m = decl.match(/^(transition|animation|transition-duration|animation-duration)\s*:\s*([\s\S]+)$/);
      if (!m) return;
      for (const part of m[2].split(/,(?![^(]*\))/)) {
        const t = part.trim().split(/\s+/).map(secs).find((v) => v != null);
        if (t == null || t <= 0) continue;                                   // 0s: a switch, not a motion
        const what = m[1].startsWith("animation") ? "animation" : part.trim().split(/\s+/)[0];
        const key = `${selectorOf(stack)} ${what} ${t}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ group: file, name: `${selectorOf(stack).slice(0, 40)} · ${what}`, s: t, kind: m[1].startsWith("animation") && /infinite/.test(part) ? "loop" : "transition" });
      }
    });
  }
  for (const [file, text] of Object.entries(js)) {
    for (const m of text.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*["'`](cubic-bezier\([^)]*\))["'`];?[ \t]*(?:\/\/\s*(.*))?/g)) {
      const c = curveOf(m[2]);
      if (c && !seen.has(m[1])) { seen.add(m[1]); curves.push({ name: m[1], ...c, use: (m[3] || "").trim(), code: `${file}: ${m[2]}` }); }
    }
  }
  rows.sort((a, b) => (a.group === "tokens" ? -1 : b.group === "tokens" ? 1 : a.group.localeCompare(b.group)));
  return [
    { type: "curves", title: "Curves", sub: "Every curve the stylesheets name in a custom property or a script keeps in a constant.", items: curves },
    { type: "durations", title: "Durations", sub: "Times named in custom properties, and every time written in a transition or an animation.", rows, max: Math.max(1, Math.min(2, ...rows.map((r) => r.s).filter((s) => s > 0).concat(2))) },
  ].filter((b) => (b.items || b.rows).length);
}

// ── the measured parts from a record of the checks ─────────────────────────────────────────────────────────────────
/** the responsive map from the record's sweep: one row per layout state (`mapRows`: { "@nav": "Navbar" }) */
export function mapFromSweep(widthRows, mapRows = {}) {
  const rows = widthRows.slice().sort((a, b) => a.w - b.w);
  return Object.entries(mapRows).map(([key, label]) => {
    const now = [];
    for (const r of rows) { const v = r[key]; if (v == null) continue; const last = now.at(-1); if (last && last.label === String(v)) last.to = r.w + 10; else { if (last) last.to = r.w; now.push({ from: r.w, to: r.w + 10, label: String(v) }); } }
    if (now.length) now.at(-1).to = Math.max(now.at(-1).to, 1920);
    return { label, now };
  }).filter((r) => r.now.length);
}

/** a responsive picture when no round described one: every number the probes measured, by the adapter's groups */
export function pictureFromSweep(sweep, spec = {}) {
  const keys = [...new Set(sweep.width.flatMap((r) => Object.keys(r)))].filter((k) => !k.startsWith("@") && k !== "w" && k !== "h" && k !== "overflow" && sweep.width.some((r) => typeof r[k] === "number"));
  const groups = spec.groups || { measured: { label: "Measured", keys } };
  return {
    type: "picture", groups, order: spec.order || Object.keys(groups), labels: spec.labels || {},
    axes: {
      width: { label: "By width", x: "w", note: "Screen width (px)", tip: "{x}px wide", ticks: [320, 390, 768, 1024, 1440, 1920], solid: [320, 1440] },
      height: { label: "By height", x: "h", note: "Screen height (px)", tip: "× {x}", ticks: [400, 600, 800, 920, 1100], solid: [] },
    },
    sweep: { after: { width: sweep.width, height: sweep.height } },
  };
}

/** how a screen's height maps to the size it counts as, from the scale's range (when no round drew it) */
export const heightLineOf = (range) => ({
  type: "heightLine", title: "The screen's size",
  from: { h: range.height.from, v: range.from, label: `${range.height.from} tall · ${range.from}` },
  to: { h: range.height.to, v: range.to, label: `${range.height.to} tall · ${range.to}` },
  range: [Math.max(0, range.height.from - 60), range.height.to + 180], vTicks: [range.from, range.to],
  note: `Screen size by its height, for a wide window. Flat below ${range.height.from} and above ${range.height.to}.`,
});

// ── the typesetter's rules, as its README writes them (one table per language) ───────────────────────────────────
export function typesetRules(readme) {
  const rulesBy = {};
  let lang = null;
  for (const ln of (readme || "").split("\n")) {
    const h = ln.match(/^### (.+)/);
    if (h) { lang = /Any/.test(h[1]) ? "*" : /Russian/.test(h[1]) ? "ru" : /English/.test(h[1]) ? "en" : null; continue; }
    if (/^## /.test(ln)) lang = null;
    const m = lang && ln.match(/^\| ([\w-]+(?: \(join\))?) \| ([^|]+) \| (.+) \|$/);
    if (m && m[1] !== "rule") (rulesBy[lang] ||= []).push({ name: m[1].replace(" (join)", ""), join: / \(join\)/.test(m[1]), strength: m[2].trim(), example: m[3].trim() });
  }
  return rulesBy;
}

// ── whose measurements these are (layer 2) ──────────────────────────────────────────────────────────────────────────
/**
 * where the checks' state came from, in plain words. `local`: the state was in the checks' out folder; `commit` the
 * commit it measured; `head` the commit being built; `ref` the branch being built.
 * → { from, whose, own }
 */
export function whoseState({ local, commit = "", head = "", ref = "" }) {
  const c = commit.slice(0, 7), h = head.slice(0, 7);
  const own = !!(c && h && c === h);
  if (local) return own ? { from: "this build", whose: `measured on this commit (${c})`, own }
    : { from: `a local run of ${c || "an unknown commit"}`, whose: `measured in a local run on ${c || "an unknown commit"}, not on this commit (${h})`, own };
  const onMain = !ref || ref === "main";
  return { from: "the last deploy of main", whose: own ? `measured on this commit (${c})` : onMain ? `measured on main at ${c}, an earlier commit than this one (${h})` : `measured on main at ${c}, before this change (${ref} at ${h})`, own };
}

// ── pictures of the blocks (layer 3) ─────────────────────────────────────────────────────────────────────────────────
/**
 * The pictures of the blocks for the page: the adapter's blocks, each with its latest pictures (if any) and the files
 * that changed since they were taken. `index`: shots/index.json; `hashNow(path)`: the file's git blob sha now.
 */
export function blockShots(blocks = [], index, hashNow) {
  const out = {};
  for (const b of blocks) {
    const e = index?.blocks?.[b.id];
    if (!e) { out[b.id] = { sizes: [] }; continue; }
    const changed = Object.entries(e.files || {}).filter(([p, sha]) => hashNow(p) !== sha).map(([p]) => p);
    out[b.id] = { taken: e.taken || null, commit: e.commit || null, changed,
      sizes: (e.sizes || []).map((s) => ({ w: s.w, h: s.h, file: String(s.file).replace(/^shots\//, "") })) };
  }
  return out;
}
