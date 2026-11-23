# site-kit: the contract

What every part of the kit agrees on: the layout, the site's adapter (`site-kit.config.mjs`), the files the parts
hand to each other, and how a site uses the kit. The kit's own code never names a site: whatever is particular to a
site (Flow Medium's pages, QQ's grounds) lives in that site's adapter.

## Layout

| Folder | What | Command |
|---|---|---|
| `bin/site-kit.mjs` | the one command; dispatches to `<folder>/cli.mjs` (`export async function run(args, cfg)`) | `site-kit <cmd>` |
| `lib/` | `config.mjs` (`loadConfig()`, `siteIO(cfg)`, `options(args, valued)`, `mainBranch(cfg)`, `dataBranch(cfg)`, `need()`), `env.mjs` (`env("SHA")`: every `SITE_KIT_*` setting, read in one place), `serve.mjs` (the built site as GitHub Pages serves it, on 127.0.0.1, for the checks, the audit and the pictures), `changed.mjs` | |
| `checks/` | the design system's checks: `collect.js` (in-page collector), `measure.mjs` (runner → record), `measured.mjs` (rules from the record), `source.mjs` (rules from the code), `state.mjs` (→ state.json), `keep.mjs` (report-data branch), `answer.mjs` | `site-kit checks [measure\|state\|keep\|answer]` |
| `rules/` | the lessons learned as code rules that fail (`learnings.mjs`), run by `checks/source.mjs` and by `site-kit rules` | `site-kit rules [--strict]` |
| `report/` | the review page: `page/` (index.html, report.css, report.js: the page itself, generic) and `build.mjs` (writes data.js, typeset.js, fonts/, state.json, history.json, shots into the output folder) | `site-kit report [--out dir]` |
| `shots/` | pictures of the blocks (layer 3), with fingerprints and dates | `site-kit shots [--changed\|--all]` |
| `typeset/` | the typesetter (core, html, lint, words, RU/EN rules), its tests, a Vite plugin (`site-kit/typeset/vite`) | `site-kit typeset [--lint] files…` |
| `images/` | source pictures → AVIF/WebP at the lowest quality that scores SSIMULACRA2 ≥ 90 | `site-kit images` |
| `audit/` | the built pages in a real browser: sideways scroll, cut text, small text and targets, axe, contrast from pixels over canvases | `site-kit audit` |
| `runtime/` | small browser modules a site imports from its own scripts (see below) | |
| `.github/workflows/` | reusable workflows: `site.yml` (build, publish, PR previews), `checks.yml` (checks + report), `audit.yml` | |
| `test/` | `node --test` tests of the kit (`test/*.test.mjs`), with tiny fixture sites; the browser ones only with `SITE_KIT_BROWSER=1` | `npm test` |

## How a site uses the kit

- `package.json`: `"site-kit": "github:timofeylebedev/site-kit#v0.1.0"` in devDependencies; scripts call `site-kit …`
  (`"checks": "site-kit checks"`, `"report": "site-kit report"`, …).
- Its own scripts import helpers: `import { whenLoaded } from "site-kit/runtime/loaded.js"` (Vite resolves them like
  any package; they are plain ES modules with no dependencies).
- Its workflow calls the kit's: `uses: timofeylebedev/site-kit/.github/workflows/site.yml@v0.1.0` with inputs.
- A site moves to a new kit version on purpose (raise the tag in both places); a change made for one site never
  reaches another by surprise.
- Commands run in the site's root (the folder with `site-kit.config.mjs`); `SITE_KIT_ROOT` overrides it.
- Something a command needs and the adapter (or the command line: an option that takes a value, given without one)
  does not give stops it with one clear line and exit 2 (`NeedError`), not a stack.
- Kit commands are Node 22 ES modules with no build step. Third-party packages are peer dependencies resolved from
  the site's own node_modules (playwright, axe-core, sharp, rolldown).

## The adapter: `site-kit.config.mjs`

```js
export default {
  name: "Flow Medium",                 // shown on the report
  tag: "FM",                           // answer lines: «FM answer · <id>: <answer>»
  owner: "Tim",                        // who answers questions, who decides
  repo: "timofeylebedev/fm",           // GitHub owner/name (links to commits)
  live: "https://timofeylebedev.github.io/fm/",   // the published site (main)
  lang: "ru",
  mainBranch: "main",                  // the live branch (default "main"; SITE_KIT_MAIN, set by the workflows, overrides)

  paths: {                             // all relative to the site's root; defaults in lib/config.mjs
    dist, scale, decisions, questions, fonts,
    styles, scripts,                   // a folder, or a list of folders and files (["src/scripts", "public/vt.js"])
    out,                               // the checks' records and state.json (not committed)
    report,                            // the built review page (not committed)
    rounds, shots,                     // optional: the site's review rounds (typed blocks) and their pictures
  },

  // the palette as the checks and the report see it: read(json of `file`) → [{ name, value: "#rrggbb[aa]", css: "--ink-70",
  // group, use }]; the report reads the file now and at its baseline commit (new / changed marks). groups: the report's
  // groups, [key, label, about, contrast?] ("on-white": the colour as text on white; "white-on": white text on it)
  colours: { file: "design/tokens.json", read: (json) => [...], groups: [["ink", "Ink", "…", "on-white"], ...] },
  // the stylesheets where custom properties are defined (generated tokens first), and the page steps (custom media)
  css: { tokens: ["src/styles/base/tokens.gen.css", ...], media: "src/styles/base/media.css" },

  checks: {
    pages: [{ path: "", title, main: true }, { path, title, status }],   // default: home + "no-such-page" (404)
    sizes: [{ w, h, dpr, touch }],     // default: eight screens (DEFAULT_CHECKS in lib/config.mjs)
    query: "?fmbox=0",                 // added to every page the checks load
    unstyle: [[/scrollbar-gutter:\s*stable/g, "scrollbar-gutter:auto"]],   // rewritten in served documents and CSS
    skip, notIcons, typeObjects, align, cards, paragraphs,      // selectors for the collector
    objectRadii, ratioFamilies,
    sections, sweepStyle, boxes, boxSkip, files, notes,   // optional, defaults in checks/README.md
    dataBranch: "report-data",         // the branch of the records and pictures: keep, report, shots and the workflows use it
    consent: { button, label, storage, hover, version: (io) => number, allowedBefore: [] },   // or null: a site with no consent
    probes: () => ({ key: value, "@layout": "state" }),          // runs in the page
    mapRows: { "@layout": "Label" },
    scenarios: [{ id, area, given, when, then, size: [w, h], consent?, run: async (page, h) => true | "what failed" }],
    designPaths: ["design/**", "src/styles/**", ...],  // lighter checks: a PR runs them only when one of these changed
  },

  rules: {
    // the site's own code rules, added to the kit's: (ctx) => [{ id, area, title, how, fails: ["file:line what"], note }]
    code: (ctx) => [...],
    // set up the kit's generic code rules (checks/source.mjs; a rule whose input is missing is not run)
    generated, drawings: ["src/styles/art/"], objectType: ["--hero-title"], steps: { shared, own }, curves: { modules, tokens }, notes,
    // what every decision must have, and each kind besides (default ["id", "what", "why"])
    decisionFields: { "*": ["id", "kind", "what", "decided", "why"], exception: ["rule", "fix"] },
    // the lessons (rules/learnings.mjs): which apply and where; a missing key means the rule's default
    // (scrollModule may be a list; loadedModule, gpuModule, boxScript, boxPage, entry, consent: { module, gate, allowed } | false,
    // barGuard: rules/README.md)
    learnings: { scrollModule: "src/scripts/scroller.js", entry: "src/scripts/main.js", ... },
  },

  // the responsive audit (audit/README.md): pages (default: checks.pages without a status), sizes (default: the nine),
  // what is left out of each check, the sections looked at one by one, a style added before axe, a query for every page
  audit: { pages: [""], sizes, skip, skipSmall, skipTargets, sections, axeStyle, query },

  report: {
    title: "Flow Medium · the system",
    accent: "#884dff",
    since: "<commit>",                 // what the system page marks new against (optional)
    typesetSamples: [{ lang, text }],
    fonts: { text: { family, files: { 400: "x-400.woff2" } }, display: { … } },   // the page's text and the specimens
    typeRoles, column, steps, shadow(s), grounds, cssVars, notes, picture, roundBlocks, motionBase,   // report/README.md
    // the blocks of the page (layer 3 pictures and the live frame): each with the files that change its look;
    // anchor: the id of the block's element (the frame's address), else the frame is scrolled to `selector`
    blocks: [{ id: "hero", title: "Hero", page: "", anchor: "product", selector: ".hero", files: ["src/styles/hero.css", "src/scripts/hero.js"] }],
  },

  images: { from: "assets-src/img", to: "src/assets/img", ... },
  typeset: { ... },
};
```

Fields only one part uses are documented in that part's README. A part may add a field to its own section; it says
so in its README and in this file.

## The record, the state and the report-data branch

- `checks measure` writes `<out>/record-<engine>.json` (format as Flow Medium's `design/checks/measure.mjs` wrote it).
- `checks state` writes `<out>/state.json`: `{ commit, generated, site, summary, rules[], findings[], needs[],
  questions[], decisions[], errors[] }` (as Flow Medium's `design/checks/state.mjs`).
- `checks keep` puts them on the site's data branch (`checks.dataBranch`, default `report-data`): `latest/`,
  `history/<day>-<sha7>/`, `history/index.json`, `pr/<n>/`, `branch/<name>/`, `broken/`; and `shots/` (below).
  `latest/`, `history/` and `shots/` only from the live branch (`mainBranch`); a run whose first engine failed goes to
  `broken/` (a second engine's failure only marks its own results «could not run»).
- The report reads `<out>/state.json` when it measured this very commit, else `<data branch>:latest/` (fetched,
  shallow and quiet, every time before it is read), and an older local state only when the data branch has none,
  labelled with its commit.

## Three layers: when what is rebuilt

1. **From the code** (tokens, roles, steps, decisions, questions, the code's rules): on every build, in seconds
   (`site-kit report` alone; no browser).
2. **Measured** (numbers only): on main always; on a pull request only when a path in `checks.designPaths` changed
   or the PR has the label `checks`; a newer push cancels the older run. A report built without its own
   measurements says whose they are ("measured on main at abc1234, before this change").
3. **Pictures** (`site-kit shots`): only for blocks whose files changed since their last picture (on main, after the
   checks), when asked (`--all`, workflow input, the PR label `shots`), or at a round's end. Kept on report-data in
   `shots/<block>/<w>x<h>.jpg` with `shots/index.json`:
   `{ blocks: { <id>: { files: { "<path>": "<git blob sha>" }, taken: "<iso>", commit, sizes: [{ w, h, file, old? }] } } }`
   (`file` relative to `shots/`: `hero/390x844.jpg`). A local `site-kit shots` writes the same into `<out>/shots/`,
   only for the blocks it took a picture of; `keep` and the report merge it into the kept index (`mergeShots`), so a
   block not taken again keeps its pictures, and a block or size the run missed keeps its old ones (marked `old`).
   The report shows each picture with its date and marks it "may be out of date" when a file's fingerprint now
   differs. For most looks the report shows the live site in a frame instead (`../#<anchor>` when the report is
   served under the site at its report path, `meta.reportPath`, default `report/`; else `<live>#<anchor>`), at a width the reader picks.
   A block may say `frames: [0, 0.5, 1]` (screens taken as the page scrolls through it, for blocks played by the
   scroll: then `sizes` has one entry per frame, `hero/390x844.jpg`, `hero/390x844-2.jpg` …, with `frame` and `at`);
   `report.shotSizes` sets the sizes (default `390x844,1440x900`). Details: `shots/README.md`.

## In CI

The kit's reusable workflows (`.github/workflows/`; the files a site copies are in `.github/templates/`) run every
command as `npx --no-install site-kit …` from the site's own node_modules, and set for them `SITE_KIT_SHA` (the
commit measured: a pull request's head, else `github.sha`) and `SITE_KIT_PR` (the pull request's number, empty on
main), `SITE_KIT_MAIN` (the input `main-branch`) and `SITE_KIT_REPORT_PATH` (the input `report-path`); commands read
these before asking git (`lib/env.mjs`). The site job runs `site-kit rules --strict` on every push and pull request
after the build: its failures go into the run's summary, and stop the deploy only with the input `rules-strict: true`
(default false: a site turns it on once its open findings are decided). The checks job calls, in order: `site-kit changed` (a pull request
only), `checks measure --engine <e> [--quick]` per engine, `checks state [--<engine> <out>/record-<engine>.json …]
--prev <out>/prev/state.json --prev-record <out>/prev/record.json` (main's latest, fetched from the data branch by the
workflow, which reads its name from the adapter; the files may be missing), `shots --changed|--all`, `checks keep [--pr <n>]`, `report --out
<dist>/<report-path>`; on a closed pull request `checks keep --forget <n>`. `keep` puts `<out>/shots/` on report-data
only from main (a pull request's pictures stay in its preview).

## Browser helpers (`runtime/`)

Plain ES modules, no dependencies, each with a comment saying which lesson it carries:

- `loaded.js` — `whenLoaded(fn)`: runs now if the page's `load` has fired, else on it.
- `styles.js` — `stylesReady()`: a promise that settles when every stylesheet has applied (WebKit bug 261655).
- `gpu.js` — `realGPU()`: false for software renderers (`failIfMajorPerformanceCaveat` + renderer name), asked once on
  a throwaway canvas; `gpuContext(canvas, kind, attrs, { force })`: a context on a real GPU or null; `isSoftware(gl)`,
  `rendererOf(gl)` for a context that is kept in software in a lighter form.
- `scroller.js` + `box.js` + `safari.css` — Safari's bars: the page scrolls in its own box on a Mac (solid bar),
  one guard at the bottom on iPhone (`.bar-guard`); `y()`, `to()`, `by()`, `max()`, `height()`, `onScroll()`,
  `watchSize()`, `ioRoot`, `box`. box.js is a classic script inlined in every page's `<head>`; its options (class,
  page selector, the `?<param>=` switch) are `data-box-*` attributes of `<html>` (runtime/README.md).

## The lessons as rules (`rules/learnings.mjs`)

Each fails a PR when broken, with the file and line: nothing reads `window.scrollY` / listens to the window's `scroll`
outside the scroll module; every WebGL context asks for `failIfMajorPerformanceCaveat` (or goes through `gpu.js`); no
bare `addEventListener("load", …)` (use `whenLoaded`); the start-up waits for stylesheets; anything that loads a
third party starts from consent; and, cheaply checked from the source: observers that look ahead watch from the
scroller (`ioRoot`), a stylesheet loaded on its own imports the custom media, the bottom bar's guard stays empty, every
page with the box runs box.js first. Ids `learn.*`, area "Code" (rules/README.md lists them). A site turns one off
only with a decision in decisions.json that names it.

## Code rules: one shape

`checks/source.mjs` exports `sourceRules(cfg) → { results: [{ id, area, title, how, ok, n, fails, note }] }`, where
each fail is a string `"<file>:<line> <what>"` (file relative to the site's root). It builds one context and runs, in
order, the kit's generic design rules, the lessons (`rules/learnings.mjs`: `learningRules(ctx) → [rule…]`) and the
site's own (`cfg.rules.code(ctx) → [rule…]`); a rule there is `{ id, area, title, how, fails, note? }` (`ok` and `n`
are filled in). The context:

```js
ctx = {
  cfg, io,                       // the adapter and siteIO(cfg)
  css: { "<path>": text },       // every stylesheet under paths.styles
  js: { "<path>": text },        // every script under paths.scripts
  html: { "<path>": text },      // every page source: *.html under paths.pages (default: the folder above paths.styles)
  scale, decisions,              // parsed paths.scale and paths.decisions (.decisions)
  strip(cssText), stripJs(jsText),   // comments blanked, line numbers kept
  lineOf(text, index),
  allowed(ruleId, file, selector?) → decision | null,   // a decision whose `rules` field allows this rule here:
                                             // "rules": [{ "rule": "learn.window-scroll", "files": "<regex>", "selectors": "<regex>" }]
                                             // files omitted: site-wide; selectors: matched against the CSS rule a place is in
  selectorAt(file, line) → selector | null,  // that CSS rule (for a stylesheet's place)
}
```

A rule that cannot run (its module fails to load, or it throws) is returned with `error: "<why>"` instead of being
left out: the state makes it «could not run» and carries its last findings (the lessons' ids are in `rules/ids.mjs`).

`site-kit rules` prints them all (`--strict`: exit 1 when one fails or could not run; CI runs it on every push and pull
request in site.yml, it takes a second: the summary lists the failures, and the deploy stops only with `rules-strict`).

## Working rules for the parts

- Behaviour first: on Flow Medium the kit must give the same results as FM's own copies did (same rules, same
  findings, same report data), apart from what a part's README lists as an intended change.
- Every command prints what it did in one or two lines and exits non-zero only on its own failure.
- Docs are English, plain words, the reasons kept (the comments of FM's files carry lessons; keep them).
