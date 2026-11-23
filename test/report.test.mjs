// The pure parts of the review page's build (report/parts.mjs) and the page's index/site.css (report/build.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nowOnly, walk, selectorOf, shadowsOf, groupShadows, stepsOf, containerSteps, mediaOf, cssColours, linearPoints,
  motionFromCode, mapFromSweep, pictureFromSweep, heightLineOf, typesetRules, whoseState, blockShots,
} from "../report/parts.mjs";
import { indexHtml, siteCss } from "../report/build.mjs";

test("nowOnly takes old values and relative dates out of a round's text", () => {
  assert.equal(nowOnly("31 at 390, was 36; 40 at 1440"), "31 at 390; 40 at 1440");
  assert.equal(nowOnly("0.45s (was 0.8s / 18%)"), "0.45s");
  assert.equal(nowOnly("<span class='was'>24</span> 32 since today."), "32.");
  assert.equal(nowOnly(7), 7);
});

test("walk keeps the nested selector and the line of each declaration", () => {
  const css = ".a {\n  color: red;\n  & .b { box-shadow: 0 1px 2px #000; }\n}\n";
  const got = [];
  walk("x.css", css, (decl, stack, line) => got.push([decl, selectorOf(stack), line]));
  assert.deepEqual(got, [["color: red", ".a", 2], ["box-shadow: 0 1px 2px #000", ".a .b", 3]]);
});

test("shadows: grouped by value, marked new against the baseline, described by the adapter", () => {
  const now = { "src/styles/a.css": ".card { box-shadow: 0 4px 16px var(--ink-10); }\n.menu { box-shadow: 0 4px 16px var(--ink-10); }\n.x { filter: blur(2px); }\n.y { text-shadow: none; }\n@media (--mouse) { .chip { box-shadow: 0 2px 6px rgb(90 60 30 / 0.2); } }" };
  const then = { "src/styles/a.css": ".card { box-shadow: 0 4px 16px var(--ink-10); }" };
  const sh = groupShadows(shadowsOf(Object.keys(now), (f) => now[f]), shadowsOf(Object.keys(then), (f) => then[f]),
    (s) => ({ name: /90 60 30/.test(s.value) ? "Chip" : null, ground: /chip/.test(s.uses[0].sel) ? "sand" : null, shape: "pill" }));
  assert.equal(sh.length, 2);
  assert.equal(sh[0].file ?? sh[0].uses[0].file, "a.css");
  assert.deepEqual(sh[0].uses.map((u) => [u.sel, u.isNew]), [[".card", false], [".menu", true]]);
  assert.equal(sh[0].isNew, false);
  assert.equal(sh[0].name, ".card");                                     // no name from the adapter: its first selector
  assert.deepEqual([sh[1].name, sh[1].ground, sh[1].isNew, sh[1].uses[0].media, sh[1].shape], ["Chip", "sand", true, "@media (--mouse)", "pill"]);
});

test("container steps: shared or own, new, and the step a new one replaced", () => {
  const now = { "s.css": ".col { container: col / inline-size; }\n.grid { @container col (width >= 43rem) { .a { gap: 1px; } } }\n.b { @container (width >= 30rem) { .c { x: 1 } } }" };
  const then = { "s.css": ".grid { @container col (width >= 40rem) { .a { gap: 1px; } } }" };
  const steps = containerSteps(stepsOf(Object.keys(now), (f) => now[f], "src/styles"), stepsOf(Object.keys(then), (f) => then[f], "src/styles"), { "43rem": "M" });
  assert.deepEqual(steps.map((s) => [s.container, s.cond, s.step, s.px, s.isNew, s.was, s.first]),
    [["col", "(width >= 43rem)", "M", 688, true, "(width >= 40rem)", ".a"], ["(nearest)", "(width >= 30rem)", "own", 480, true, null, ".c"]]);
});

test("page steps and colours from the stylesheets", () => {
  assert.deepEqual(mediaOf("@custom-media --phone (width < 40em); /* the tab bar */\n@custom-media --mouse (hover: hover);"),
    [{ name: "--phone", cond: "(width < 40em)", note: "the tab bar" }, { name: "--mouse", cond: "(hover: hover)", note: "" }]);
  assert.deepEqual(cssColours([":root { --ink: #000; --ink-60: rgb(0 0 0 / 0.6); --gap: 4px; }", ":root { --ink: #111; }"], { face: "var(--x)" }),
    { face: "var(--x)", ink: "#000", "ink-60": "rgb(0 0 0 / 0.6)" });
});

test("motion read from the code: curves and durations", () => {
  assert.deepEqual(linearPoints("0, 0.5, 1.2 40%, 1"), [[0, 0], [0.2, 0.5], [0.4, 1.2], [1, 1]]);
  const [curves, durations] = motionFromCode(
    { "src/styles/t.css": ":root {\n  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);   /* arriving */\n  --hover-in: 0.2s;\n}\n.btn { transition: color var(--hover-in) var(--ease-out), scale 150ms ease; }\n.x { transition: visibility 0s; }" },
    { "src/scripts/a.js": 'const DRAW = "cubic-bezier(0.65, 0, 0.35, 1)";  // a hand drawing' });
  assert.deepEqual(curves.items.map((c) => [c.name, c.bez, c.use]), [["ease-out", [0.22, 1, 0.36, 1], "arriving"], ["DRAW", [0.65, 0, 0.35, 1], "a hand drawing"]]);
  assert.deepEqual(durations.rows.map((r) => [r.group, r.name, r.s]), [["tokens", "--hover-in", 0.2], ["src/styles/t.css", ".btn · scale", 0.15]]);
});

test("the responsive map and picture from a record's sweep", () => {
  const width = [{ w: 320, h: 1100, "@nav": "burger", hero: 36 }, { w: 330, h: 1100, "@nav": "burger", hero: 37 }, { w: 340, h: 1100, "@nav": "links", hero: 38 }];
  assert.deepEqual(mapFromSweep(width, { "@nav": "Navbar", "@none": "Nothing" }), [{ label: "Navbar", now: [{ from: 320, to: 340, label: "burger" }, { from: 340, to: 1920, label: "links" }] }]);
  const pic = pictureFromSweep({ width, height: [] });
  assert.deepEqual(pic.groups, { measured: { label: "Measured", keys: ["hero"] } });
  assert.equal(pic.sweep.after.width, width);
  const hl = heightLineOf({ from: 320, to: 1440, height: { from: 360, to: 920 } });
  assert.deepEqual([hl.from.h, hl.from.v, hl.to.h, hl.to.v], [360, 320, 920, 1440]);
});

test("the typesetter's rules from its README tables", () => {
  const md = "## The rules\n### Any language\n| rule | strength | example |\n|---|---|---|\n| dash | should | `a⍽— b` |\n| range (join) | must | `2022–⁀2025` |\n### Russian (`lang=\"ru\"`)\n| particle | should | `бы` |\n## Other\n| x | y | z |";
  assert.deepEqual(typesetRules(md), {
    "*": [{ name: "dash", join: false, strength: "should", example: "`a⍽— b`" }, { name: "range", join: true, strength: "must", example: "`2022–⁀2025`" }],
    ru: [{ name: "particle", join: false, strength: "should", example: "`бы`" }],
  });
});

test("whose the measurements are, in plain words", () => {
  assert.deepEqual(whoseState({ local: true, commit: "abc1234ff", head: "abc1234ee" }), { from: "this build", whose: "measured on this commit (abc1234)", own: true });
  assert.equal(whoseState({ local: true, commit: "abc1234", head: "def5678" }).from, "a local run of abc1234");
  const pr = whoseState({ local: false, commit: "abc1234", head: "def5678", ref: "claude/x" });
  assert.deepEqual(pr, { from: "the last deploy of main", whose: "measured on main at abc1234, before this change (claude/x at def5678)", own: false });
  assert.match(whoseState({ local: false, commit: "abc1234", head: "def5678", ref: "main" }).whose, /^measured on main at abc1234, an earlier commit/);
});

test("pictures of the blocks: dates and the files that changed since", () => {
  const index = { blocks: { hero: { files: { "a.css": "111", "b.js": "222" }, taken: "2026-11-20T10:00:00Z", commit: "abc", sizes: [{ w: 390, h: 844, file: "shots/hero/390x844.jpg" }] } } };
  const now = { "a.css": "111", "b.js": "999" };
  const got = blockShots([{ id: "hero" }, { id: "footer" }], index, (p) => now[p] || null);
  assert.deepEqual(got.hero, { taken: "2026-11-20T10:00:00Z", commit: "abc", changed: ["b.js"], sizes: [{ w: 390, h: 844, file: "hero/390x844.jpg" }] });
  assert.deepEqual(got.footer, { sizes: [] });
  assert.deepEqual(blockShots([{ id: "hero" }], null, () => null), { hero: { sizes: [] } });
});

test("the page's index.html and site.css take the site's title, accent and fonts", () => {
  const cfg = { name: "Site", report: { title: "Site · the system", accent: "#884dff", fonts: { text: { family: "Golos", files: { 400: "golos-400.woff2" } } } } };
  const html = indexHtml("<html lang=\"{{lang}}\"><title>{{title}}</title><link rel=\"icon\" href=\"{{icon}}\"><div class=\"brand\">{{brand}}</div>", cfg);
  assert.match(html, /<title>Site · the system<\/title>/);
  assert.match(html, /<div class="brand">Site <span>· the system<\/span><\/div>/);
  assert.match(html, /fill=%22%23884dff%22/);
  const css = siteCss(cfg);
  assert.match(css, /@font-face \{ font-family: "Golos"; src: url\("fonts\/golos-400.woff2"\) format\("woff2"\); font-weight: 400;/);
  assert.match(css, /--site-accent: #884dff;/);
  assert.match(css, /--font: "Golos", ui-sans-serif/);
  assert.match(siteCss({ name: "X" }), /--font: ui-sans-serif/);
});
