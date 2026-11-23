// Builds the review page of a site's design system into one folder that opens straight from the disk (file://) and
// from any host: no module scripts and no fetch on the page, so everything it shows is written into data.js.
//
//   index.html, report.css, report.js   the page itself (report/page/ of the kit; index.html takes the site's title)
//   site.css     the site's fonts (@font-face) and accent, so the specimens are drawn in the site's own faces
//   data.js      window.REPORT: the rounds (paths.rounds, optional) and the system as it is now, read from the site's own
//                sources (scale, colours, decisions, the stylesheets' shadows and layout steps), each item marked new or
//                changed against the baseline commit (report.since, else the rounds' meta.since; none: no marks)
//   typeset.js   the kit's typeset/core.js + lint.js bundled for the browser (window.Typeset): the demo runs the real code
//   fonts/       the site's fonts
//   shots/       the rounds' pictures (paths.shots: the rounds point to them as "shots/…")
//   blocks/      the latest pictures of the blocks (layer 3: `site-kit shots`): the data branch's kept ones, with this
//                run's (the checks' out folder: only the blocks it took again) put in
//   state.json   the checks' state the page shows (for agents and anything else that reads it), and history.json
//
// The three layers (SPEC.md): what is read from the code is rebuilt every time; the measured state is this commit's
// when the checks just ran on it, else the last deploy of main's (the data branch, fetched afresh each time), and the
// page says whose it is; the pictures are the latest ones, each marked "may be out of date" when a file it was taken
// from has changed since.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { KIT, siteIO, env, mainBranch, dataBranch } from "../lib/config.mjs";
import { mergeShots, freshFile } from "../shots/index.mjs";
import {
  clone, same, cleanAll, shadowsOf, groupShadows, stepsOf, containerSteps, mediaOf, cssColours, motionFromCode,
  mapFromSweep, pictureFromSweep, heightLineOf, typesetRules, whoseState, blockShots,
} from "./parts.mjs";

const PAGE = path.join(KIT, "report/page");

export async function buildReport(cfg, opts = {}) {
  const io = siteIO(cfg), R = cfg.report || {}, P = cfg.paths;
  const OUT = path.resolve(cfg.root, opts.out || P.report);
  // where the page is served under the site (its frame shows "this build" from there): --path, SITE_KIT_REPORT_PATH,
  // else where --out puts it under paths.dist (dist/report → "report"), else "report"
  const underDist = path.relative(io.abs(P.dist), OUT);
  const REPORT_PATH = (opts.path || env("REPORT_PATH") || (underDist && !underDist.startsWith("..") && !path.isAbsolute(underDist) ? underDist.split(path.sep).join("/") : "report")).replace(/^\/+|\/+$/g, "");
  const DATA = dataBranch(cfg), MAIN = mainBranch(cfg);
  const git = io.git, tryGit = io.tryGit;
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  // ── the rounds (optional) ─────────────────────────────────────────────────────────────────────────────────────────
  const data = P.rounds && io.exists(P.rounds) ? io.json(P.rounds) : null;
  const sec = Object.fromEntries((data?.sections || []).map((s) => [s.id, s]));
  const blockOf = (s, type) => s?.blocks?.find((b) => b.type === type);

  // ── the baseline: what the system page marks new against ──────────────────────────────────────────────────────────
  const SINCE = opts.since || R.since || data?.meta?.since || null;
  const SINCE_LABEL = data?.meta?.sinceLabel || R.sinceLabel || (SINCE ? SINCE.slice(0, 7) : null);
  // a shallow clone (GitHub's checkout) has no baseline commit: fetch that one commit, or nothing can be marked new
  const haveBase = () => !!SINCE && tryGit("cat-file", "-e", `${SINCE}^{commit}`) != null;
  if (SINCE && !haveBase()) tryGit("fetch", "--depth=1", "origin", SINCE);
  const NO_BASE = !haveBase();
  if (SINCE && NO_BASE) console.warn(`site-kit report: commit ${SINCE} is not here and could not be fetched: the page is built without "new" marks`);
  const atBase = (p) => (NO_BASE || !p ? null : tryGit("show", `${SINCE}:${p}`));
  // with no baseline nothing is marked (rather than everything)
  const unmark = (o) => { if (NO_BASE && o) { o.isNew = false; o.was = null; o.changed = false; } return o; };

  // ── the rounds: each a page of its own ────────────────────────────────────────────────────────────────────────────
  const rounds = (data?.meta?.rounds || []).map((r) => ({ ...r, sections: r.sections.map((id) => clone(sec[id])).filter(Boolean) }));

  // ── colour ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const colour = colourGroups(cfg, io, atBase);

  // ── type and space: the scale ─────────────────────────────────────────────────────────────────────────────────────
  const scale = io.json(P.scale);
  const scaleThen = JSON.parse(atBase(P.scale) || "{}");
  const roleDiff = (kind, name, r) => {
    const was = scaleThen[kind]?.roles?.[name];
    if (!was) return { isNew: true, was: null };
    const pick = (x) => ({ px: x.px, per: x.per || null, by: x.by || null });
    return { isNew: false, was: same(pick(was), pick(r)) ? null : pick(was) };
  };
  const SPEC = R.typeRoles || {};
  const typeRoles = Object.entries(scale.type.roles).map(([name, r]) => ({ name, ...r, ...(SPEC[name] || {}), ...roleDiff("type", name, r) }));
  const spaceRoles = Object.entries(scale.space?.roles || {}).map(([name, r]) => ({ name, ...r, ...roleDiff("space", name, r) }));
  const removedRoles = (kind) => Object.keys(scaleThen[kind]?.roles || {}).filter((n) => !scale[kind]?.roles?.[n]);

  // ── the stylesheets: shadows and layout steps (now and at the baseline) ─────────────────────────────────────────
  // paths.styles: a folder or a list of folders and files; the page names files from the first
  const stylesList = [].concat(P.styles).map((x) => x.replace(/\/$/, "")), styles = stylesList[0];
  const isCss = (f) => f.endsWith(".css") && !f.endsWith(".gen.css");
  const cssFilesNow = (tryGit("ls-files", "--", ...stylesList)?.split("\n").filter(isCss)) || io.files(stylesList, ".css").filter(isCss);
  const cssFilesThen = NO_BASE ? [] : (tryGit("ls-tree", "-r", "--name-only", SINCE, "--", ...stylesList) || "").split("\n").filter(isCss);
  const shNow = shadowsOf(cssFilesNow, (f) => io.read(f), styles);
  const shThen = shadowsOf(cssFilesThen, (f) => atBase(f), styles);
  const shadows = groupShadows(shNow, shThen, R.shadow);

  const containers = containerSteps(stepsOf(cssFilesNow, (f) => io.read(f), styles), stepsOf(cssFilesThen, (f) => atBase(f), styles), R.steps || {});
  // the page's own steps (custom media), with the comment after each
  const mediaFile = cfg.css?.media;
  const mediaThen = mediaOf(atBase(mediaFile));
  const pageSteps = mediaFile && io.exists(mediaFile) ? mediaOf(io.read(mediaFile)).map((m) => ({ ...m, isNew: !mediaThen.some((t) => t.name === m.name), was: (mediaThen.find((t) => t.name === m.name && t.cond !== m.cond) || {}).cond || null })) : [];

  // ── decisions ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const decisions = io.json(P.decisions, { decisions: [] }).decisions || [];
  const decThen = (JSON.parse(atBase(P.decisions) || "{\"decisions\":[]}").decisions) || [];
  decisions.forEach((d) => {
    const was = decThen.find((t) => t.id === d.id);
    d.isNew = !was;
    d.changed = !!was && !same({ ...was, audit: 0 }, { ...d, audit: 0, isNew: undefined, changed: undefined }) && (was.what !== d.what || was.decided !== d.decided || was.measured !== d.measured);
  });

  // ── motion: the latest round's reading, marked against the round before; without rounds, read from the code ─────
  let motion, motionCards = null, curves = [];
  if (sec.motion) {
    const prevData = (R.motionBase && io.json(R.motionBase, null)) || { sections: [] };
    const prevMotion = prevData.sections.find((s) => s.id === "motion") || { blocks: [] };
    motion = clone(sec.motion);
    const prevCurves = blockOf(prevMotion, "curves")?.items || [];
    const curvePart = (c) => ({ bez: c.bez, path: c.path, linear: c.linear, wave: c.wave, fn: c.fn });
    curves = blockOf(motion, "curves")?.items || [];
    curves.forEach((c) => {
      const was = prevCurves.find((p) => p.name === c.name);
      c.isNew = !was; c.changed = !!was && !same(curvePart(was), curvePart(c));
    });
    // durations: their names and notes were rewritten between rounds, so no text comparison can tell a real change
    // from a new wording; the round lists what changed (meta.motionChanged: name → what)
    const MOTION_CHANGED = data.meta.motionChanged || {};
    (blockOf(motion, "durations")?.rows || []).forEach((r) => { if (MOTION_CHANGED[r.name]) { r.changed = true; r.what = MOTION_CHANGED[r.name]; } });
    motion.blocks = motion.blocks.filter((b) => b.type !== "cards");
    cleanAll(motion.blocks);
    const cards = blockOf(sec.motion, "cards");
    motionCards = cards ? cleanAll(clone(cards)) : null;
  } else {
    const css = Object.fromEntries(io.files(stylesList, ".css").map((f) => [f, io.read(f)]));
    const js = Object.fromEntries(io.files(P.scripts || "src/scripts", [".js", ".mjs"]).map((f) => [f, io.read(f)]));
    motion = { id: "motion", fromCode: true, blocks: motionFromCode(css, js) };
  }

  // ── the typesetter: its rules as the kit's README writes them (one table per language) ──────────────────────────
  const readme = path.join(KIT, "typeset/README.md");
  const rulesBy = fs.existsSync(readme) ? typesetRules(fs.readFileSync(readme, "utf8")) : {};
  const typesetDecision = decisions.find((d) => d.id === (R.typesetDecision || "typeset")) || null;

  [...colour.flatMap((g) => g.tokens), ...typeRoles, ...spaceRoles, ...containers, ...pageSteps, ...shadows, ...shadows.flatMap((x) => x.uses), ...decisions, ...curves].forEach(unmark);

  // the colours the stylesheets name (the shadow tiles are drawn with them)
  const cssVars = cssColours((cfg.css?.tokens || []).filter((f) => io.exists(f)).map((f) => io.read(f)), R.cssVars || {});

  // ── the checks: this commit's (just run), else the last deploy of main's (the data branch) ──────────────────────
  const outDir = io.abs(P.out);
  const local = (f) => (fs.existsSync(path.join(outDir, f)) ? fs.readFileSync(path.join(outDir, f), "utf8") : null);
  const headFull = (env("SHA") || tryGit("rev-parse", "HEAD") || "").trim();
  // the branch it was built from (GitHub's checkout of a pull request has no branch of its own)
  const ref = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || (tryGit("rev-parse", "--abbrev-ref", "HEAD") || "").trim();
  // the data branch, fetched afresh (quietly; no remote or no network: whatever copy is here)
  io.fetchBranch(DATA);
  const fromData = (f) => tryGit("show", `origin/${DATA}:${f}`);
  const commitOf = (text) => { try { return JSON.parse(text).commit || ""; } catch { return ""; } };
  let checksState = local("state.json"), checksRecord = local("record-chromium.json"), whose = null;
  // a local run is «this build» only when it measured this very commit; an older local run gives way to main's last
  // deploy, and is shown (labelled with its commit) only when there is none
  const localOwn = checksState && headFull && commitOf(checksState).slice(0, 7) === headFull.slice(0, 7);
  const dataState = localOwn ? null : fromData("latest/state.json");
  if (dataState) {
    checksState = dataState; checksRecord = fromData("latest/record-chromium.json");
    whose = whoseState({ local: false, commit: commitOf(checksState), head: headFull, ref, main: MAIN });
  } else if (checksState) whose = whoseState({ local: true, commit: commitOf(checksState), head: headFull });
  const historyIdx = fromData("history/index.json");
  const checks = checksState ? JSON.parse(checksState) : null;
  const record = checksRecord ? JSON.parse(checksRecord) : null;
  if (checks) Object.assign(checks, { from: whose.from, whose: whose.whose, own: whose.own });

  // ── measured: the responsive picture and the map, now only ──────────────────────────────────────────────────────
  let picture = clone(blockOf(sec.picture, "picture")) || null;
  if (picture?.sweep) delete picture.sweep.before;
  let map = clone(blockOf(sec.map, "map")) || null;
  map?.rows?.forEach((r) => delete r.before);
  // from the record's sweep (every 10px of width, every 25px of height) when there is one
  if (record?.sweep) {
    const measured = { commit: record.commit, when: record.when, engine: `${record.engine} ${record.version}` };
    if (picture) picture.sweep = { after: { width: record.sweep.width, height: record.sweep.height } };
    else picture = pictureFromSweep(record.sweep, R.picture);
    picture.measured = measured;
    const remade = mapFromSweep(record.sweep.width, cfg.checks?.mapRows || {});
    if (remade.length) {
      if (!map) map = { type: "map", range: [320, 1920], ticks: [320, 390, 768, 1024, 1440, 1920], steps: [], page: [] };
      map.rows = remade; map.measured = measured;
    }
  }
  // the measured sections of the latest round (the system's Blocks tab), with the adapter's line under each title
  const blocks = Object.entries(R.roundBlocks || {}).filter(([id]) => sec[id]).map(([id, sub]) => {
    const s = clone(sec[id]);
    s.sub = sub;
    cleanAll(s.blocks);
    s.blocks.forEach((b) => { if (b.title === "At real screen sizes") b.sub = (b.sub || "").replace(/\s*Old values struck through\.?/i, ""); });
    return s;
  });
  const sysRound = sec.system?.blocks || [];

  // ── the pictures of the blocks (layer 3): the data branch's, with this run's put in ─────────────────────────────────
  // (after `shots --changed` the local index holds only the blocks taken again: the others keep their kept pictures)
  const shotsLocal = path.join(outDir, "shots");
  const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
  const localIdx = fs.existsSync(path.join(shotsLocal, "index.json")) ? parse(fs.readFileSync(path.join(shotsLocal, "index.json"), "utf8")) : null;
  const keptIdx = parse(fromData("shots/index.json"));
  const ids = (R.blocks || []).map((b) => b.id);
  const shotsIndex = localIdx || keptIdx ? mergeShots(keptIdx, localIdx, ids.length ? ids : null) : null;
  const isFresh = freshFile(localIdx);
  const hashes = new Map();
  const hashNow = (p) => { if (!hashes.has(p)) hashes.set(p, io.exists(p) ? (tryGit("hash-object", p) || "").trim() : null); return hashes.get(p); };
  const shots = { from: null, dataBranch: DATA, blocks: blockShots(R.blocks || [], shotsIndex, hashNow, isFresh) };
  const froms = new Set(Object.values(shots.blocks).flatMap((b) => b.sizes.map((s) => s.from)));
  shots.from = froms.size > 1 ? "both" : froms.has("local") ? "local" : froms.has("data") ? "report-data" : null;

  // ── write ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const head = headFull.slice(0, 7);
  const built = (tryGit("log", "-1", "--format=%cs") || new Date().toISOString().slice(0, 10)).trim();
  const REPORT = {
    meta: { ...(data?.meta || {}), built, head, ref, main: MAIN, reportPath: REPORT_PATH, noBase: NO_BASE, since: SINCE, sinceLabel: SINCE_LABEL },
    rounds,
    system: {
      colour, colourWhere: clone(sysRound.find((b) => b.title === "Colour")) || null,
      scale: { range: scale.range, ladder: scale.ladder, relations: scale.type.relations, lineHeight: scale.type.lineHeight, tracking: scale.type.tracking, aliases: scale.type.aliases },
      type: typeRoles, space: spaceRoles, removed: { type: removedRoles("type"), space: removedRoles("space") },
      heightLine: clone(sysRound.find((b) => b.type === "grid")?.blocks?.find((b) => b.title === "The screen's size")) || (scale.range?.height ? heightLineOf(scale.range) : null),
      containers, pageSteps, map, shadows, cssVars, motion, motionCards, picture, blocks,
      grammar: sec.grammar ? cleanAll(clone(sec.grammar)) : null, decisions,
      column: R.column || null,
    },
    typeset: { rules: rulesBy, decision: typesetDecision },
    checks,
    history: historyIdx ? JSON.parse(historyIdx) : [],
    // the questions as written (the checks' state adds whether each is open; without checks they are shown as written)
    questions: io.json(P.questions, { questions: [] }).questions || [],
    live: cfg.live || null,
    site: siteOf(cfg),
    shots,
  };
  fs.mkdirSync(OUT, { recursive: true });
  // the blocks' pictures (a picture that cannot be copied is marked missing in the data)
  fs.rmSync(path.join(OUT, "blocks"), { recursive: true, force: true });       // no picture left from an older build
  let pics = 0;
  for (const b of Object.values(shots.blocks)) for (const s of b.sizes) {
    const to = path.join(OUT, "blocks", s.file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (s.from === "local") {
      if (fs.existsSync(path.join(shotsLocal, s.file))) { fs.copyFileSync(path.join(shotsLocal, s.file), to); pics++; } else s.missing = true;
    } else {
      try { fs.writeFileSync(to, execFileSync("git", ["show", `origin/${DATA}:shots/${s.file}`], { cwd: cfg.root, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] })); pics++; } catch { s.missing = true; }
    }
  }

  const json = JSON.stringify(REPORT).replace(/<\/(script)/gi, "<\\/$1");
  fs.writeFileSync(path.join(OUT, "data.js"), "/* generated by site-kit report: do not edit */\nwindow.REPORT = " + json + ";\n");

  // the page itself
  for (const f of ["report.css", "report.js"]) fs.copyFileSync(path.join(PAGE, f), path.join(OUT, f));
  fs.writeFileSync(path.join(OUT, "index.html"), indexHtml(fs.readFileSync(path.join(PAGE, "index.html"), "utf8"), cfg));
  fs.writeFileSync(path.join(OUT, "site.css"), siteCss(cfg));

  // the typesetter for the browser
  const tsOk = await bundleTypeset(cfg, path.join(OUT, "typeset.js"));

  // the fonts
  fs.mkdirSync(path.join(OUT, "fonts"), { recursive: true });
  if (io.exists(P.fonts)) for (const f of fs.readdirSync(io.abs(P.fonts))) if (f.endsWith(".woff2")) fs.copyFileSync(path.join(io.abs(P.fonts), f), path.join(OUT, "fonts", f));

  // the rounds' pictures
  if (P.shots && io.exists(P.shots) && path.resolve(io.abs(P.shots)) !== path.join(OUT, "shots")) fs.cpSync(io.abs(P.shots), path.join(OUT, "shots"), { recursive: true });

  // for the AI agents and anything else that reads it: the same state as a file (…/report/state.json)
  if (checks) fs.writeFileSync(path.join(OUT, "state.json"), JSON.stringify(checks, null, 1)); else fs.rmSync(path.join(OUT, "state.json"), { force: true });
  if (historyIdx) fs.writeFileSync(path.join(OUT, "history.json"), historyIdx); else fs.rmSync(path.join(OUT, "history.json"), { force: true });

  const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + " KB";
  log(`${path.relative(process.cwd(), OUT) || "."}/data.js ${kb("data.js")} · typeset.js ${tsOk ? kb("typeset.js") : "not bundled"} · ${SINCE ? `since ${SINCE.slice(0, 7)}` : "no baseline"} · rounds ${rounds.length} · checks ${checks ? `of ${checks.commit.slice(0, 7)} (${whose.whose}): ${checks.summary.fail} fail, ${checks.summary.warn} warn` : "none yet"} · pictures of ${Object.values(shots.blocks).filter((b) => b.sizes.length).length} blocks${shots.from ? ` (${shots.from === "both" ? `this run's and ${DATA}'s` : shots.from})` : ""}`);
  if (SINCE && !NO_BASE) log(`  new since ${SINCE.slice(0, 7)}: colours ${colour.flatMap((g) => g.tokens).filter((t) => t.isNew || t.was).length}, type ${typeRoles.filter((r) => r.isNew || r.was).length}, space ${spaceRoles.filter((r) => r.isNew || r.was).length}, steps ${containers.filter((c) => c.isNew).length + pageSteps.filter((p) => p.isNew).length}, shadows ${shadows.filter((s) => s.isNew).length}, decisions ${decisions.filter((d) => d.isNew).length} new / ${decisions.filter((d) => d.changed).length} changed, curves ${curves.filter((c) => c.isNew || c.changed).length}`);
  return { out: OUT, report: REPORT };
}

/** the colour tokens in the adapter's groups, each marked new or changed against the baseline's file */
function colourGroups(cfg, io, atBase) {
  const C = cfg.colours;
  if (!C) return [];
  let now, then = [];
  if (typeof C === "function") now = C(io);                              // a function of the site: no baseline to read
  else {
    now = C.read(io.json(C.file));
    const t = atBase(C.file);
    if (t) then = C.read(JSON.parse(t));
  }
  const groups = C.groups || [...new Set(now.map((t) => t.group))].map((g) => [g, g, ""]);
  return groups.map(([key, label, about, contrast]) => ({
    key, label, about, ...(contrast ? { contrast } : {}),
    tokens: now.filter((t) => t.group === key).map((t) => {
      const was = then.find((x) => x.name === t.name);
      return { name: t.name, value: t.value, web: t.css ? (t.css.startsWith("--") ? `var(${t.css})` : t.css) : null, description: t.use || "",
        isNew: !was, was: was && was.value !== t.value ? was.value : null };
    }),
  })).filter((g) => g.tokens.length);
}

/** what the page needs to know about the site (names, links, fonts, texts) */
function siteOf(cfg) {
  const R = cfg.report || {}, f = R.fonts || {};
  return {
    name: cfg.name, tag: cfg.tag, owner: cfg.owner, repo: cfg.repo || null, live: cfg.live || null, lang: cfg.lang || "en",
    title: R.title || `${cfg.name} · the system`, accent: R.accent || "#888888",
    fonts: { text: f.text?.family || null, display: f.display?.family || null },
    grounds: R.grounds || { paper: "#fff" },
    notes: R.notes || {},
    paths: { colours: typeof cfg.colours === "object" ? cfg.colours?.file : null, scale: cfg.paths.scale, decisions: cfg.paths.decisions, questions: cfg.paths.questions, styles: cfg.paths.styles, media: cfg.css?.media || null },
    blocks: (R.blocks || []).map((b) => ({ id: b.id, title: b.title || b.id, page: b.page || "", anchor: b.anchor || null, selector: b.selector || null, files: b.files || [] })),
    typesetSamples: R.typesetSamples || [],
    sizes: (cfg.checks?.sizes || []).length,
  };
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** the page's index.html with the site's title, brand line and favicon colour */
export function indexHtml(tpl, cfg) {
  const R = cfg.report || {}, title = R.title || `${cfg.name} · the system`, accent = R.accent || "#888888";
  const [name, ...rest] = title.split(" · ");
  const icon = `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22${encodeURIComponent(accent)}%22/%3E%3C/svg%3E`;
  return tpl.replace(/\{\{title\}\}/g, escHtml(title)).replace(/\{\{icon\}\}/g, icon).replace(/\{\{lang\}\}/g, "en")
    .replace(/\{\{brand\}\}/g, `${escHtml(name)}${rest.length ? ` <span>· ${escHtml(rest.join(" · "))}</span>` : ""}`);
}

/** the site's faces and accent: @font-face for every file the adapter names, and the page's font stacks */
export function siteCss(cfg) {
  const R = cfg.report || {}, f = R.fonts || {}, q = (s) => JSON.stringify(s);
  let css = "/* generated by site-kit report from the site's adapter: do not edit */\n";
  for (const face of [f.text, f.display].filter(Boolean))
    for (const [w, file] of Object.entries(face.files || {})) css += `@font-face { font-family: ${q(face.family)}; src: url("fonts/${file}") format("woff2"); font-weight: ${w}; font-display: swap; }\n`;
  const text = f.text ? `${q(f.text.family)}, ` : "", display = f.display ? `${q(f.display.family)}, ` : "";
  css += `:root {\n  --site-accent: ${R.accent || "#888888"};\n  --font: ${text}ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;\n  --site-text: ${text}ui-sans-serif, system-ui, sans-serif;\n  --display: ${display}${text}Arial, sans-serif;\n}\n`;
  return css;
}

/** the kit's typesetter bundled for the browser (window.Typeset), with rolldown from the site's own node_modules */
async function bundleTypeset(cfg, file) {
  const core = path.join(KIT, "typeset/core.js"), lint = path.join(KIT, "typeset/lint.js");
  const stub = (why) => { fs.writeFileSync(file, `/* site-kit report: the typesetter is not bundled (${why}); the page works without it */\n`); console.warn(`site-kit report: typeset.js not bundled: ${why}`); return false; };
  if (!fs.existsSync(core) || !fs.existsSync(lint)) return stub("the kit has no typeset/core.js and lint.js");
  let rolldown;
  try { rolldown = await import(pathToFileURL(createRequire(path.join(cfg.root, "package.json")).resolve("rolldown")).href); }
  catch { return stub("rolldown is not installed in the site (a peer dependency of site-kit)"); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-kit-report-"));
  const entry = path.join(dir, "entry.mjs");
  fs.writeFileSync(entry, `export * from ${JSON.stringify(core)};\nexport { lint, CHECKS } from ${JSON.stringify(lint)};\n`);
  try {
    const bundle = await rolldown.rolldown({ input: entry, logLevel: "silent" });
    await bundle.write({ format: "iife", name: "Typeset", file });
    await bundle.close?.();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  fs.writeFileSync(file, "/* generated by site-kit report from site-kit/typeset/core.js and lint.js: do not edit */\n" + fs.readFileSync(file, "utf8"));
  return true;
}
