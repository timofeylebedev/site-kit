// The pure parts of checks/: the measured rules on a tiny record, the joining into a state (decisions' bands, keys,
// new and fixed, a step that did not run), the code rules' keys, the code rules' context with a decision's `rules`, and
// the answer line. No browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { measuredRules, roleAt } from "../checks/measured.mjs";
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
