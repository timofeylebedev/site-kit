// The pure parts of checks/: the measured rules on a tiny record, the joining into a state (decisions' bands, keys,
// new and fixed, a step that did not run), the code rules' keys, the code rules' context with a decision's `rules`, and
// the answer line. No browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { measuredRules, roleAt } from "../checks/measured.mjs";
import { measuredPages, tagShot, merge } from "../checks/measure.mjs";
import { joinState, codeRules } from "../checks/state.mjs";
import { sourceRules } from "../checks/source.mjs";
import { parseLine, applyAnswer } from "../checks/answer.mjs";

const FIX = join(import.meta.dirname, "fixtures/checks");
const rec = () => JSON.parse(readFileSync(join(FIX, "record.json"), "utf8"));
const scale = JSON.parse(readFileSync(join(FIX, "site/design/scale.json"), "utf8"));
const palette = [{ name: "ink", value: "#000000" }, { name: "paper", value: "#ffffff" }];
const cfg = { pages: [{ path: "", main: true }], scenarios: [] };
const rules = (r = rec()) => measuredRules({ rec: r, prev: null, scale, palette, cfg });
const ruleOf = (list, id) => list.find((r) => r.id === id);

test("roleAt: a straight line between 320 and 1440, the screen's height counting", () => {
  const body = scale.type.roles["type/body"];
  assert.equal(roleAt(scale, body, 320, 900), 16);
  assert.equal(roleAt(scale, body, 1440, 900), 18);
  assert.equal(roleAt(scale, body, 880, 900), 17);
  // a short screen counts as a narrower one: 1440 wide but 568 tall is the 320 end
  assert.equal(roleAt(scale, body, 1440, 568), 16);
  assert.equal(roleAt(scale, { ...body, by: "width" }, 1440, 568), 18);
});

test("measured rules: shares, hard rules and stable keys", () => {
  const r = rules();
  const type = ruleOf(r, "type.roles");
  // 390×844: body ≈ 16.25, small 14; 16px is on body (±0.6), 15px is off; the object is left out
  assert.equal(type.total, 100); assert.equal(type.on, 90); assert.equal(type.value, 90); assert.equal(type.status, "warn");
  assert.deepEqual(type.items.map((i) => i.key), ["p.note|15"]);
  const colour = ruleOf(r, "colour.palette");
  assert.equal(colour.value, 95); assert.equal(colour.status, "warn"); assert.equal(colour.items[0].key, "18,52,86,1");
  const alt = ruleOf(r, "images.alt");
  // the build's hash is taken out of the key, so a new build of the same picture is the same finding
  assert.equal(alt.status, "fail"); assert.equal(alt.items[0].key, "photo.jpg");
  assert.equal(ruleOf(r, "images.format").status, "fail");
  assert.equal(ruleOf(r, "shape.radii").status, "pass");
  assert.equal(ruleOf(r, "states.timing").status, "pass");
});

test("state: a decision's band accepts an item, and brings it back when the value moves", () => {
  const decide = (band) => [{ id: "odd-blue", kind: "exception", what: "x", decided: "Owner", checks: [{ rule: "colour.palette", match: "div\\.odd", band }] }];
  const held = joinState({ rules: rules(), rec: rec(), decisions: decide([1, 10]), now: Date.parse("2026-11-23") });
  const c = ruleOf(held.rules, "colour.palette");
  assert.equal(c.accepted, 1); assert.equal(c.value, 100); assert.equal(c.status, "pass");
  assert.equal(held.decisions[0].state, "holding");
  assert.ok(!held.findings.some((f) => f.rule === "colour.palette"));
  const moved = joinState({ rules: rules(), rec: rec(), decisions: decide([1, 2]), now: Date.parse("2026-11-23") });
  assert.equal(moved.decisions[0].state, "moved");
  assert.ok(moved.needs.some((n) => n.type === "decision" && n.id === "odd-blue"));
  const unused = joinState({ rules: rules(), rec: rec(), decisions: [{ id: "gone", checks: [{ rule: "colour.palette", match: "nothing-here" }] }] });
  assert.equal(unused.decisions[0].state, "unused");
  const broken = joinState({ rules: rules(), rec: rec(), decisions: [{ id: "lost", checks: [{ rule: "no.such" }] }] });
  assert.equal(broken.decisions[0].state, "broken");
});

test("state: finding keys, new and fixed against the last state", () => {
  const first = joinState({ rules: rules(), rec: rec() });
  const keys = first.findings.map((f) => f.key);
  assert.ok(keys.includes("type.roles::p.note|15"));
  assert.ok(keys.includes("images.alt::photo.jpg"));
  assert.ok(first.findings.every((f) => f.new === false), "no last state: nothing is new");
  // the next run: the note's size fixed, a new colour off the palette
  const r2 = rec();
  r2.at["390x844"].text = r2.at["390x844"].text.filter((t) => t.px !== 15);
  r2.at["390x844"].colours.push({ rgba: [1, 2, 3, 1], n: 1, where: ["div.new"], props: { text: 1 } });
  const next = joinState({ rules: rules(r2), rec: r2, prev: first });
  assert.deepEqual(next.fixed.map((f) => f.key), ["type.roles::p.note|15"]);
  assert.deepEqual(next.findings.filter((f) => f.new).map((f) => f.key), ["colour.palette::1,2,3,1"]);
  assert.equal(ruleOf(next.rules, "type.roles").was.status, "warn");
});

test("state: a rule whose step did not run is an error and keeps its last findings", () => {
  const first = joinState({ rules: rules(), rec: rec() });
  const r2 = rec(); r2.errors = ["sizes: browser crashed"];
  const next = joinState({ rules: rules(r2), rec: r2, prev: first });
  const type = ruleOf(next.rules, "type.roles");
  assert.equal(type.status, "error"); assert.equal(type.value, null);
  const carried = next.findings.filter((f) => f.rule === "type.roles");
  assert.equal(carried.length, 1); assert.ok(carried[0].carried);
  assert.equal(next.needs[0].title, "Could not be checked: Text is set in the roles of the scale");
  assert.equal(next.summary.errors > 0, true);
});

test("state: questions reopen when a file they are about changes", () => {
  const q = [{ id: "look", ask: "Does it look right?", since: "2026-11-01", status: "answered", about: ["a.css"], answer: { choice: "yes", hashes: { "a.css": "old" } } }];
  const same = joinState({ rules: [], rec: rec(), questions: q, fingerprint: () => "old" });
  assert.equal(same.questions[0].state, "answered");
  const changed = joinState({ rules: [], rec: rec(), questions: q, fingerprint: () => "new" });
  assert.equal(changed.questions[0].state, "reopened");
  assert.equal(changed.needs[0].type, "question");
});

test("code rules: keyed by file and what (not the line), repeats counted, the CSS rule named", () => {
  const [r] = codeRules([{ id: "colour-tokens", area: "Colour", title: "t", how: "h", ok: false, n: 3, fails: ["a.css:3 #fff", "a.css:9 #fff", "b.css:1 #000"] }], (f, l) => (l === 3 ? ".x" : null));
  assert.equal(r.id, "code.colour-tokens"); assert.equal(r.status, "fail"); assert.equal(r.value, 3);
  assert.deepEqual(r.items.map((i) => i.key), ["a.css|#fff#1", "a.css|#fff#2", "b.css|#000#1"]);
  assert.equal(r.items[0].what, "#fff in .x"); assert.equal(r.items[0].where, "a.css:3");
});

test("source rules: one context; a decision's `rules` allows a rule in its files", () => {
  const site = { name: "Fixture", root: join(FIX, "site"), paths: { dist: "dist", scale: "design/scale.json", decisions: "design/decisions.json", styles: "src/styles", scripts: "src/scripts" },
    css: { tokens: ["src/styles/base/tokens.css"] }, rules: { learnings: {} } };
  const { results } = sourceRules(site);
  const get = (id) => results.find((r) => r.id === id);
  const colours = get("colour-tokens");
  // legacy.css is allowed by the decision «old-colour»; page.css is not; token definitions are fine
  assert.deepEqual(colours.fails, ["src/styles/page.css:1 rgb(1 2 3)"]);
  assert.deepEqual(colours.allowed, ["src/styles/legacy.css:1 #123456 (old-colour)"]);
  assert.deepEqual(get("type-from-scale").fails, ["src/styles/page.css:1 13px"]);
  assert.deepEqual(get("fluid-from-scale").fails, ["src/styles/page.css:2 margin: 2vw"]);
  assert.deepEqual(get("tokens-wired").fails, ["defined, never used: --unused"]);
  assert.ok(get("ladder").ok); assert.ok(get("relations").ok); assert.ok(get("decisions").ok);
  // rules whose input the adapter does not give are not run
  assert.equal(get("layout-steps"), undefined); assert.equal(get("media-steps"), undefined); assert.equal(get("curves"), undefined);
});

test("answer: the line the report copies, and the change it makes", () => {
  assert.deepEqual(parseLine("FM answer · cta-dust: keep it — but less dust", "FM"), ["cta-dust", "keep it", "but less dust"]);
  assert.deepEqual(parseLine("«QQ answer · tabs-30: yes»", "QQ"), ["tabs-30", "yes", ""]);
  assert.equal(parseLine("FM answer · x: y", "QQ"), null);
  const q = applyAnswer({ id: "x", about: ["a.css"] }, "yes", "", { by: "Owner", today: "2026-11-23", hash: () => "h1" });
  assert.deepEqual(q.answer, { choice: "yes", note: "", when: "2026-11-23", by: "Owner", hashes: { "a.css": "h1" } });
  assert.equal(applyAnswer(q, "--reopen", "", {}).status, "open"); assert.equal(q.answer, undefined);
  assert.deepEqual(applyAnswer(q, "--drop", "not needed", { today: "2026-11-24" }).dropped, { why: "not needed", when: "2026-11-24" });
});

// ── the review's fixes ──
import { isBroken } from "../checks/keep.mjs";
import { allowedBy, selectorIn } from "../checks/source.mjs";
import { LESSONS } from "../rules/ids.mjs";

test("a code rule that could not run is an error: its findings are carried, and the next good run finds nothing new", () => {
  const fails = ["src/scripts/nav.js:80 reads the window's scrollY", "src/scripts/nav.js:95 reads the window's scrollY"];
  const good = (n) => codeRules([{ id: "learn.window-scroll", area: "Code", title: "t", how: "h", ok: false, n, fails }]);
  const first = joinState({ rules: good(2), rec: rec() });
  const [err] = codeRules([{ id: "learn.window-scroll", area: "Code", title: "t", how: "—", ok: false, n: null, fails: [], error: "Unexpected token" }]);
  assert.equal(err.status, "error");
  const broken = joinState({ rules: [err], rec: rec(), prev: first });
  const carried = broken.findings.filter((f) => f.rule === "code.learn.window-scroll");
  assert.equal(carried.length, 2); assert.ok(carried.every((f) => f.carried && !f.new));
  assert.equal(broken.fixed.length, 0, "nothing counts as fixed");
  assert.match(broken.needs[0].title, /^Could not be checked/);
  const again = joinState({ rules: good(2), rec: rec(), prev: broken });
  assert.equal(again.findings.filter((f) => f.new).length, 0);
  assert.equal(again.fixed.length, 0);
});

test("a second engine's failure: its rules say WebKit could not run; the run is not broken", () => {
  const wk = rec(); wk.engine = "webkit"; wk.errors = ["sizes: page crashed"];
  const all = rules();
  const st = joinState({ rules: all, rec: rec(), webkit: wk, wkRules: measuredRules({ rec: wk, prev: null, scale, palette, cfg }) });
  const type = ruleOf(st.rules, "type.roles");
  assert.notEqual(type.status, "error"); assert.equal(type.webkit.status, "error");
  assert.ok(st.errors.some((e) => e.startsWith("webkit ")));
  st.engines = { chromium: { errors: [] }, webkit: { errors: wk.errors } };
  assert.equal(isBroken(st), false);
  assert.equal(isBroken({ ...st, engines: { chromium: { errors: ["sizes: x"] }, webkit: { errors: [] } } }), true);
  // a measured rule that could not run (a step that did not run) is broken; a code rule that could not run is not
  assert.equal(isBroken({ engines: { chromium: { errors: [] } }, rules: [{ id: "type.roles", status: "error" }] }), true);
  assert.equal(isBroken({ engines: { chromium: { errors: [] } }, rules: [{ id: "code.learn.bare-load", status: "error" }] }), false);
});

test("decisions: an allowance by file, by CSS rule, or site-wide", () => {
  const d = [
    { id: "by-file", rules: [{ rule: "a", files: "legacy\\.css$" }] },
    { id: "by-selector", rules: [{ rule: "b", files: "\\.css$", selectors: "^\\.card" }] },
    { id: "everywhere", rules: [{ rule: "c" }] },
  ];
  assert.equal(allowedBy(d, "a", "src/legacy.css")?.id, "by-file");
  assert.equal(allowedBy(d, "a", "src/page.css"), null);
  assert.equal(allowedBy(d, "b", "src/page.css", ".card:hover")?.id, "by-selector");
  assert.equal(allowedBy(d, "b", "src/page.css", ".nav"), null);
  assert.equal(allowedBy(d, "b", "src/page.css", null), null, "a selector allowance needs a CSS rule");
  assert.equal(allowedBy(d, "c", "src/scripts/x.js")?.id, "everywhere");
  assert.equal(allowedBy(d, "c", null)?.id, "everywhere");
  assert.equal(selectorIn([".a {", "  color: red;", "}", ".b { x: 1; }"], 2), ".a");
  assert.equal(selectorIn([".a {", "}", "", "x"], 4), null);
});

test("source rules: selectors and site-wide allowances, the decision fields of the adapter, every inline custom property", () => {
  const site = (more = {}) => ({ name: "Fixture", root: join(FIX, "site"), paths: { dist: "dist", scale: "design/scale.json", decisions: "design/decisions.json", styles: "src/styles", scripts: "src/scripts" },
    css: { tokens: ["src/styles/base/tokens.css"] }, rules: { learnings: {}, ...more } });
  const get = (results, id) => results.find((r) => r.id === id);
  // the kit's default: id, what and why; a site may ask for more, by kind
  assert.ok(get(sourceRules(site()).results, "decisions").ok);
  const strict = get(sourceRules(site({ decisionFields: { "*": ["id", "what", "why", "owner"], exception: ["rule", "fix", "until"] } })).results, "decisions");
  assert.deepEqual(strict.fails, ["old-colour: no owner", "old-colour: an exception without «until»"]);
  assert.match(strict.how, /id, what, why, owner; the rule and a fix and until for each exception; ids unique/);

  // a site of its own: an allowance by CSS rule and one site-wide, scripts as a list, two custom properties in one style
  const root = mkdtempSync(join(tmpdir(), "kit-source-"));
  const put = (f, t) => { mkdirSync(join(root, f, ".."), { recursive: true }); writeFileSync(join(root, f), t); };
  put("design/scale.json", JSON.stringify(scale));
  put("design/decisions.json", JSON.stringify({ decisions: [
    { id: "card-ink", what: "w", why: "y", rules: [{ rule: "colour-tokens", selectors: "^\\.card" }] },
    { id: "no-fluid", what: "w", why: "y", rules: [{ rule: "fluid-from-scale" }] },
  ] }));
  put("src/styles/base/tokens.css", ":root {\n  --ink: #000;\n}\n");
  put("src/styles/page.css", ".card {\n  color: #111;\n}\n.nav {\n  color: #222;\n  margin: 2vw;\n  top: var(--i);\n  left: var(--turn);\n  right: var(--set);\n  color: var(--ink);\n}\n");
  put("src/index.html", '<!doctype html><html><body><div style="--i: 1; --turn: 2">x</div></body></html>');
  put("src/scripts/a.js", "");
  put("public/vt.js", 'el.style.setProperty("--set", 1);');
  const own = { name: "Own", root, paths: { dist: "dist", scale: "design/scale.json", decisions: "design/decisions.json", styles: "src/styles", scripts: ["src/scripts", "public/vt.js"] },
    css: { tokens: ["src/styles/base/tokens.css"] }, rules: { learnings: {} } };
  const res = sourceRules(own).results;
  assert.deepEqual(get(res, "colour-tokens").fails, ["src/styles/page.css:5 #222"]);
  assert.deepEqual(get(res, "colour-tokens").allowed, ["src/styles/page.css:2 #111 (card-ink)"]);
  assert.deepEqual(get(res, "fluid-from-scale").fails, []);
  assert.deepEqual(get(res, "tokens-wired").fails, [], "--turn (second in its style) and --set (in public/vt.js) are defined");
  // without a scroll module the window's scroll is not checked (rules/README.md)
  put("src/scripts/a.js", "const y = window.scrollY;");
  const ws = get(sourceRules(own).results, "learn.window-scroll");
  assert.deepEqual(ws.fails, []); assert.match(ws.note, /no scroll module/);
});

test("the lessons' ids (rules/ids.mjs) are the rules learningRules returns, in order; a rule that throws could not run", async () => {
  const { learningRules } = await import("../rules/learnings.mjs");
  const ctx = { cfg: { paths: {}, rules: { learnings: { scrollModule: "s/scroller.js" } } }, js: {}, css: {}, html: {} };
  const got = learningRules(ctx);
  assert.deepEqual(got.map((r) => [r.id, r.title]), LESSONS.map((l) => [l.id, l.title]));
  // a script that is not text breaks every rule that reads scripts: each comes back as could-not-run, none vanishes
  const bad = learningRules({ ...ctx, js: { "s/x.js": null } });
  assert.equal(bad.length, LESSONS.length);
  assert.ok(bad.some((r) => r.error));
  assert.ok(bad.filter((r) => r.error).every((r) => LESSONS.some((l) => l.id === r.id) && r.fails.length === 0));
});

test("measuredPages: the home page always, then the pages marked measure (FM: the home page alone)", () => {
  const fm = [{ path: "", main: true }, { path: "privacy_policy_ru" }, { path: "no-such-page", status: 404 }];
  assert.deepEqual(measuredPages(fm, "http://x/", "?fmbox=0"), ["http://x/?fmbox=0"]);
  const qq = [{ path: "", main: true, measure: true }, { path: "catalog/", measure: true }, { path: "coffee/a/", measure: true }, { path: "faq/" }];
  assert.deepEqual(measuredPages(qq, "http://x/"), ["http://x/", "http://x/catalog/", "http://x/coffee/a/"]);
});

test("tagShot: a page other than the home page names itself in every place; the home page stays as it was", () => {
  const shot = { vw: 390, vh: 844, dpr: 2, n: 3, contexts: 1, overflow: 0,
    text: [{ px: 16, family: "A", weight: 400, lh: 1.4, object: false, n: 2, where: [".card__title", "p.lead"] }],
    radii: [{ sel: ".card", px: 0, n: 1, where: [".card"] }], typo: [{ sel: "p.lead", lines: 2 }],
    components: [{ name: "card", n: 4 }], edges: { lines: [], near: [{ sel: ".card", side: "left", x: 16, line: 16, d: 0 }], n: 1 } };
  assert.equal(tagShot(shot, ""), shot, "the home page: the same object");
  const t = tagShot(shot, "coffee/a/");
  assert.deepEqual(t.text[0].where, ["coffee/a/ .card__title", "coffee/a/ p.lead"]);
  assert.equal(t.radii[0].sel, "coffee/a/ .card");
  assert.equal(t.typo[0].sel, "coffee/a/ p.lead");
  assert.equal(t.edges.near[0].sel, "coffee/a/ .card");
  assert.deepEqual(t.components, shot.components, "components are counted by name, over pages");
  assert.deepEqual(shot.text[0].where, [".card__title", "p.lead"], "the snapshot itself is not changed");
  // joined with the home page's snapshot: one text style, seen on both pages
  const m = merge([{ ...shot, images: [], colours: [], fills: [], borders: [], shadows: [], effects: [], layers: [], z: [], icons: [], ratios: [], interact: [] }, { ...t, images: [], colours: [], fills: [], borders: [], shadows: [], effects: [], layers: [], z: [], icons: [], ratios: [], interact: [] }]);
  assert.deepEqual(m.text[0].where, [".card__title", "p.lead", "coffee/a/ .card__title", "coffee/a/ p.lead"]);
});
