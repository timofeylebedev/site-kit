// The state of the design system: every rule's result, the decisions and questions, and «what needs you», in one file
// that the report and the AI agents both read.
//   site-kit checks state [--record <out>/record-chromium.json] [--webkit <out>/record-webkit.json] [--prev prev-state.json]
//                         [--prev-record prev-record.json] [--out <out>/state.json]
// Inputs: a record of `checks measure` (Chromium; WebKit's too if given), the code's rules (source.mjs), the scale, the
// palette (cfg.colours), the decisions and the questions; and the state of the last deploy of main (--prev), so it can
// say what is new and what fixed itself since.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { siteIO, options } from "../lib/config.mjs";
import { measuredRules, KINDS, STEP_OF } from "./measured.mjs";
import { sourceRules, selectorIn } from "./source.mjs";

export const SEV = { error: 4, fail: 3, warn: 2, pass: 0, info: 0 };

/** the palette as the checks see it: [{ name, value, … }] (cfg.colours: a function of io, or { file, read }) */
export function palette(cfg, io) {
  const c = cfg.colours;
  if (!c) return [];
  if (typeof c === "function") return c(io);
  if (Array.isArray(c)) return c;
  return c.read ? c.read(io.json(c.file, {})) : [];
}

// the code's rules as rules of the state: an item is keyed by its file and what it found there (not the line: an edit
// above it would make it «fixed» and «new» again), and says which CSS rule it is in, so a decision can name it
export function codeRules(results, selectorAt = () => null) {
  return results.map((r) => {
    // a rule that could not run (its module failed to load or threw): an error, so its last findings are carried
    if (r.error) return { id: "code." + r.id, area: r.area, kind: "hard", title: r.title, how: `${r.how} (read from the code).`, status: "error", value: null, unit: "places", note: r.note,
      items: [{ key: "error", where: r.area || "Code", what: `could not run: ${r.error}` }] };
    const seen = new Map();
    return { id: "code." + r.id, area: r.area, kind: "hard", title: r.title, how: `${r.how} (read from the code).`, status: r.ok ? "pass" : "fail", value: r.n, unit: "places", note: r.note,
      items: r.fails.map((f) => {
        const m = f.match(/^(\S+?):(\d+)\s+(.*)$/), file = m ? m[1] : r.area, what = m ? m[3] : f, base = `${file}|${what}`;
        const k = (seen.get(base) || 0) + 1; seen.set(base, k);
        const sel = m && selectorAt(file, +m[2]);
        return { key: `${base}#${k}`, where: m ? `${file}:${m[2]}` : r.area, what: sel ? `${what} in ${sel}` : what };
      }) };
  });
}

/** the selector of the CSS rule a line is in (for a code finding in a stylesheet; the same as a decision's `selectors`
 *  are matched against: source.mjs selectorIn) */
export function selectorFinder(io) {
  const cache = new Map();
  return (file, line) => {
    if (!/\.css$/.test(file)) return null;
    if (!cache.has(file)) cache.set(file, io.exists(file) ? io.read(file).split("\n") : []);
    return selectorIn(cache.get(file), line);
  };
}

/**
 * Joins everything into the state (pure: no files, no clock but `now`).
 * rules: the measured rules of `rec` and the code's rules; wkRules: the measured rules of the WebKit record (or null)
 */
export function joinState({ rules, rec, webkit = null, wkRules = null, prev = null, decisions = [], questions = [], fingerprint = () => "missing", site = "", now = Date.now() }) {
  for (const r of rules) { if (r.kind === "inventory") r.status = "info"; r.items ||= []; }

  // a rule whose measuring step failed (or did not run) cannot say anything: it is an error, not a pass
  const failedSteps = new Map((rec.errors || []).map((e) => [e.split(":")[0], e]));
  const ran = (step) => rec.timings && step in rec.timings;
  for (const r of rules) {
    const step = STEP_OF(r.id);
    if (!step) continue;
    const why = failedSteps.get(step) || (!ran(step) ? `the step «${step}» did not run` : null);
    if (!why) continue;
    r.status = "error"; r.items = [{ key: "error", where: step, what: why }]; r.value = null;
  }

  // WebKit (Playwright's build, the engine of Safari): its result beside Chromium's, and its own failures added. A missing
  // WebKit record keeps the last one's WebKit items (marked so), rather than calling them fixed.
  if (webkit && wkRules) {
    const wkFailed = new Map((webkit.errors || []).map((e) => [e.split(":")[0], e]));
    for (const w of wkRules) {
      const r = rules.find((x) => x.id === w.id); if (!r || r.status === "error") continue;
      const step = STEP_OF(w.id);
      // a step that failed in WebKit: its rules could not run there (said beside Chromium's result, which stands: only
      // the first engine's errors make a run broken, checks/keep.mjs); a step a quick run leaves out: not measured there
      if (step && wkFailed.has(step)) { r.webkit = { status: "error", value: null, why: wkFailed.get(step) }; continue; }
      if (step && !(webkit.timings && step in webkit.timings)) continue;
      r.webkit = { status: w.kind === "inventory" ? "info" : w.status, value: w.value, on: w.on, total: w.total };
      Object.defineProperty(r, "wkItems", { value: w.items, enumerable: false });     // for the decisions, not written
      if (SEV[r.webkit.status] > SEV[r.status]) {
        const known = new Set(r.items.map((i) => i.key));
        for (const i of w.items) if (!known.has(i.key)) r.items.push({ ...i, engine: "webkit" });
        r.status = r.webkit.status;
      }
    }
  } else if (prev) {
    for (const r of rules) {
      const p = prev.rules?.find((x) => x.id === r.id); if (!p?.webkit) continue;
      r.webkit = { ...p.webkit, stale: true };
      const known = new Set(r.items.map((i) => i.key));
      for (const i of (p.items || []).filter((i) => i.engine === "webkit")) if (!known.has(i.key)) r.items.push({ ...i, stale: true });
    }
  }

  // ── decisions: an item a decision covers is accepted; a decision whose items are gone or out of its band needs a look ─
  const today = new Date(now).toISOString().slice(0, 10);
  const decisionState = decisions.map((d) => {
    const binds = d.checks || [];
    if (!binds.length) return { id: d.id, kind: d.kind, state: "unbound", what: d.what, decided: d.decided };
    let covered = 0;
    const out = [], missing = [], expired = d.until && d.until < today;
    for (const b of binds) {
      const r = rules.find((x) => x.id === b.rule);
      if (!r) { missing.push(`no rule «${b.rule}»`); continue; }
      if (r.status === "error") { missing.push(`«${b.rule}» could not run`); continue; }
      const re = new RegExp(b.match || ".");
      for (const i of r.wkItems || []) if (re.test(`${i.where} ${i.what}`)) i.accepted = d.id;
      for (const i of r.items) {
        if (!re.test(`${i.where} ${i.what}`)) continue;
        i.accepted = d.id; covered++;
        if (b.band && i.value != null && (i.value < b.band[0] || i.value > b.band[1])) out.push(`${i.where}: ${i.value} is outside ${b.band[0]}–${b.band[1]}`);
      }
    }
    const state = expired ? "expired" : out.length ? "moved" : missing.length && !covered ? "broken" : covered ? "holding" : "unused";
    return { id: d.id, kind: d.kind, state, covered, notes: [...out, ...missing], what: d.what, decided: d.decided, until: d.until || null };
  });
  // accepted items count as following the rule: a share is scored again with them, and a rule whose only failures are
  // accepted holds
  const band = (r, v) => (v >= r.pass ? "pass" : v >= r.warn ? "warn" : "fail");
  for (const r of rules) {
    if (r.status === "error") { r.accepted = 0; continue; }
    const open = r.items.filter((i) => !i.accepted);
    r.accepted = r.items.length - open.length;
    if (r.kind === "share" && r.total) {
      const acc = r.items.filter((i) => i.accepted).reduce((a, i) => a + (i.n || 0), 0);
      r.value = Math.round(((r.on + acc) / r.total) * 1000) / 10;
      let st = band(r, r.value);
      // WebKit's share is scored again the same way (the accepted uses are the same places)
      if (r.webkit?.total) { const wacc = (r.wkItems || []).filter((i) => i.accepted).reduce((a, i) => a + (i.n || 0), 0); r.webkit.value = Math.round(((r.webkit.on + wacc) / r.webkit.total) * 1000) / 10; r.webkit.status = band(r, r.webkit.value); if (SEV[r.webkit.status] > SEV[st]) st = r.webkit.status; }
      r.status = st;
    } else if (r.accepted && (r.status === "fail" || r.status === "warn") && !open.length) r.status = "pass";
  }

  // ── findings: every open item of a rule with a verdict (also of a share that holds: its items are still the places off
  // the rule), with stable keys; new, or fixed, since the last deploy. A rule that could not run keeps its last findings.
  const keyOf = (r, i) => `${r.id}::${i.key}`;
  const findings = [];
  for (const r of rules) {
    if (r.kind === "inventory") continue;
    if (r.status === "error") { for (const f of (prev?.findings || []).filter((f) => f.rule === r.id)) findings.push({ ...f, carried: true }); continue; }
    for (const i of r.items) if (!i.accepted) findings.push({ key: keyOf(r, i), rule: r.id, status: r.status, where: i.where, what: i.what, at: i.at || "" });
  }
  const before = new Set((prev?.findings || []).map((f) => f.key));
  findings.forEach((f) => { f.new = prev && !f.carried ? !before.has(f.key) : false; });
  const now_ = new Set(findings.map((f) => f.key));
  const fixed = (prev?.findings || []).filter((f) => !now_.has(f.key)).map((f) => ({ key: f.key, rule: f.rule, where: f.where, what: f.what }));
  for (const r of rules) { const p = prev?.rules?.find((x) => x.id === r.id); if (p) r.was = { status: p.status, value: p.value }; }

  // ── questions: open, answered, or opened again because what they are about has changed ────────────────────────────
  const questionState = questions.map((q) => {
    if (q.status === "dropped") return { ...q, state: "dropped" };
    if (q.status !== "answered" || !q.answer) return { ...q, state: "open" };
    const changed = (q.about || []).filter((f) => (q.answer.hashes || {})[f] !== fingerprint(f));
    return { ...q, state: changed.length ? "reopened" : "answered", changed };
  });

  // ── what needs you: ranked, one card per rule (not per item), then decisions, then questions ─────────────────────
  const needs = [];
  for (const r of rules.filter((r) => r.status === "error"))
    needs.push({ type: "rule", id: r.id, severity: "fail", area: r.area, title: `Could not be checked: ${r.title}`, kind: r.kind, why: r.items[0].what, fresh: 0, sample: [], rank: 400 });
  const ranked = rules.filter((r) => r.status === "fail" || r.status === "warn").map((r) => {
    const open = r.items.filter((i) => !i.accepted), fresh = open.filter((i) => findings.find((f) => f.key === keyOf(r, i))?.new).length;
    return { r, open, fresh };
  }).filter((x) => x.open.length || x.r.kind === "share");
  for (const { r, open, fresh } of ranked)
    needs.push({ type: "rule", id: r.id, severity: r.status, area: r.area, title: r.title, kind: r.kind,
      why: r.kind === "share" ? `${r.value}${r.unit.startsWith("%") ? "" : " "}${r.unit} (wanted ${r.pass}${r.unit.startsWith("%") ? "%" : ""})` : `${open.length} ${open.length === 1 ? "place" : "places"}${r.value != null && r.unit && r.value !== open.length ? ` · ${r.value} ${r.unit}` : ""}`,
      fresh, sample: open.slice(0, 3).map((i) => `${i.where}: ${i.what}${i.at ? ` (${i.at})` : ""}`),
      rank: (r.status === "fail" ? 300 : 100) + (fresh ? 50 : 0) + Math.min(open.length, 40) + (r.area === "Page health" ? -20 : 0) });
  for (const d of decisionState.filter((d) => ["moved", "expired", "unused", "broken"].includes(d.state)))
    needs.push({ type: "decision", id: d.id, severity: d.state === "moved" || d.state === "broken" ? "warn" : "info", area: "Decisions",
      title: { unused: `Decision «${d.id}» covers nothing now`, expired: `Decision «${d.id}» has expired`, moved: `Decision «${d.id}»: the value moved`, broken: `Decision «${d.id}» is bound to a check that is not there` }[d.state],
      why: d.state === "unused" ? "the checks it is bound to find nothing it covers: the exception may no longer be needed" : d.notes.join("; ") || `until ${d.until}`, rank: d.state === "moved" ? 250 : 120 });
  for (const q of questionState.filter((q) => q.state === "open" || q.state === "reopened"))
    needs.push({ type: "question", id: q.id, severity: "ask", area: "Questions", title: q.ask, needs: q.needs, link: q.link, options: q.options, since: q.since, from: q.from,
      why: q.state === "reopened" ? `changed since your answer (${q.changed.join(", ")})` : `open since ${q.since}${q.from ? ` (${q.from})` : ""}`, rank: (q.state === "reopened" ? 230 : 200) + Math.min(30, Math.round((now - Date.parse(q.since)) / 864e5)) });
  needs.sort((a, b) => b.rank - a.rank);

  const count = (s) => rules.filter((r) => r.status === s).length;
  return {
    schema: 1, site, generated: new Date(now).toISOString(), commit: rec.commit, ref: rec.ref, pr: rec.pr || null,
    errors: [...(rec.errors || []), ...((webkit?.errors) || []).map((e) => "webkit " + e)],
    engines: Object.fromEntries([rec, webkit].filter(Boolean).map((x) => [x.engine, { version: x.version, when: x.when, quick: !!x.quick, seconds: x.seconds, errors: x.errors || [] }])),
    base: prev ? { commit: prev.commit, generated: prev.generated } : null,
    kinds: KINDS,
    summary: { rules: rules.length, errors: count("error"), pass: count("pass"), warn: count("warn"), fail: count("fail"), info: count("info"), findings: findings.length, new: findings.filter((f) => f.new).length, fixed: fixed.length, accepted: rules.reduce((a, r) => a + (r.accepted || 0), 0), questions: questionState.filter((q) => q.state === "open" || q.state === "reopened").length },
    needs, rules, findings, fixed, decisions: decisionState, questions: questionState,
  };
}

export async function state(cfg, args = []) {
  const io = siteIO(cfg), opt = options(args, ["out", "record", "webkit", "prev", "prev-record"]);
  const readJson = (p) => (typeof p === "string" && io.exists(p) ? JSON.parse(io.read(p)) : null);
  const OUT = io.abs(opt("out", join(cfg.paths.out, "state.json")));
  const rec = readJson(opt("record", join(cfg.paths.out, "record-chromium.json")));
  const webkit = readJson(opt("webkit")), prev = readJson(opt("prev")), prevRec = readJson(opt("prev-record"));
  if (!rec) { console.error("state: no record — run `site-kit checks measure` first"); return 2; }
  const scale = io.json(cfg.paths.scale);
  const pal = palette(cfg, io);
  const decisions = io.json(cfg.paths.decisions, { decisions: [] }).decisions || [];
  const questions = io.json(cfg.paths.questions, { questions: [] }).questions || [];
  const fingerprint = (f) => io.tryGit("hash-object", io.abs(f))?.trim() || "missing";
  const C = cfg.checks || {};

  const rules = [...measuredRules({ rec, prev: prevRec, scale, palette: pal, cfg: C }), ...codeRules(sourceRules(cfg).results, selectorFinder(io))];
  const wkRules = webkit ? measuredRules({ rec: webkit, prev: null, scale, palette: pal, cfg: C }) : null;
  const st = joinState({ rules, rec, webkit, wkRules, prev, decisions, questions, fingerprint, site: cfg.name });

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(st, null, 1));
  const s = st.summary;
  console.log(`state: ${s.rules} rules · ${s.errors ? s.errors + " COULD NOT RUN · " : ""}${s.pass} pass · ${s.warn} warn · ${s.fail} fail · ${s.info} inventory · ${s.findings} findings (${s.new} new, ${s.fixed} fixed since the last deploy) · ${s.accepted} accepted · ${s.questions} questions open → ${io.rel(OUT)}`);
  for (const n of st.needs.slice(0, 12)) console.log(`  ${n.severity.padEnd(4)} ${n.title.slice(0, 90)} — ${n.why}`);
  return 0;
}
