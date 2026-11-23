# site-kit: the contract

What every part of the kit agrees on: the layout, the site's adapter (`site-kit.config.mjs`), the files the parts
hand to each other, and how a site uses the kit. The kit's own code never names a site: whatever is particular to a
site (Flow Medium's pages, QQ's grounds) lives in that site's adapter.

## Layout

| Folder | What | Command |
|---|---|---|
| `bin/site-kit.mjs` | the one command; dispatches to `<folder>/cli.mjs` (`export async function run(args, cfg)`) | `site-kit <cmd>` |
| `lib/` | `config.mjs` (`loadConfig()`, `siteIO(cfg)`, `options(args)`), `changed.mjs`, shared helpers | |
| `checks/` | the design system's checks: `collect.js` (in-page collector), `measure.mjs` (runner → record), `measured.mjs` (rules from the record), `source.mjs` (rules from the code), `state.mjs` (→ state.json), `keep.mjs` (report-data branch), `answer.mjs` | `site-kit checks [measure\|state\|keep\|answer]` |
| `rules/` | the lessons learned as code rules that fail (`learnings.mjs`), run by `checks/source.mjs` and by `site-kit rules` | `site-kit rules [--strict]` |
| `report/` | the review page: `page/` (index.html, report.css, report.js: the page itself, generic) and `build.mjs` (writes data.js, typeset.js, fonts/, state.json, history.json, shots into the output folder) | `site-kit report [--out dir]` |
| `shots/` | pictures of the blocks (layer 3), with fingerprints and dates | `site-kit shots [--changed\|--all]` |
| `typeset/` | the typesetter (core, html, lint, words, RU/EN rules), its tests, a Vite plugin (`site-kit/typeset/vite`) | `site-kit typeset [--lint] files…` |
| `images/` | source pictures → AVIF/WebP at the lowest quality that scores SSIMULACRA2 ≥ 90 | `site-kit images` |
| `audit/` | the built pages in a real browser: sideways scroll, cut text, small text and targets, axe, contrast from pixels over canvases | `site-kit audit` |
| `runtime/` | small browser modules a site imports from its own scripts (see below) | |
| `.github/workflows/` | reusable workflows: `site.yml` (build, publish, PR previews), `checks.yml` (checks + report), `audit.yml` | |
| `test/` | `node --test` tests of the kit, with a tiny fixture site | `npm test` |

## How a site uses the kit

- `package.json`: `"site-kit": "github:timofeylebedev/site-kit#v0.1.0"` in devDependencies; scripts call `site-kit …`
  (`"checks": "site-kit checks"`, `"report": "site-kit report"`, …).
- Its own scripts import helpers: `import { whenLoaded } from "site-kit/runtime/loaded.js"` (Vite resolves them like
  any package; they are plain ES modules with no dependencies).
- Its workflow calls the kit's: `uses: timofeylebedev/site-kit/.github/workflows/site.yml@v0.1.0` with inputs.
- A site moves to a new kit version on purpose (raise the tag in both places); a change made for one site never
  reaches another by surprise.
- Commands run in the site's root (the folder with `site-kit.config.mjs`); `SITE_KIT_ROOT` overrides it.
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

  paths: {                             // all relative to the site's root; defaults in lib/config.mjs
    dist, scale, decisions, questions, styles, scripts, fonts,
    out,                               // the checks' records and state.json (not committed)
    report,                            // the built review page (not committed)
    rounds, shots,                     // optional: the site's review rounds (typed blocks) and their pictures
  },

  // the palette as the checks and the report see it: [{ name, value: "#rrggbb[aa]", css: "--ink-70", group, use }]
  colours: (io) => [...],              // io = siteIO(cfg): { read, json, files, exists, git, tryGit, abs, rel }
  // the stylesheets where custom properties are defined (generated tokens first), and the page steps (custom media)
  css: { tokens: ["src/styles/base/tokens.gen.css", ...], media: "src/styles/base/media.css" },

  checks: {
    pages: [{ path: "", title, main: true }, { path, title, status }],
    sizes: [{ w, h, dpr, touch }],
    query: "?fmbox=0",                 // added to every page the checks load
    unstyle: [[/scrollbar-gutter:\s*stable/g, "scrollbar-gutter:auto"]],   // rewritten in served documents and CSS
    skip, notIcons, typeObjects, align, cards, paragraphs,      // selectors for the collector
    objectRadii, ratioFamilies,
    consent: { button, storage, version: (io) => number, allowedBefore: [] },   // or null: a site with no consent
    probes: () => ({ key: value, "@layout": "state" }),          // runs in the page
    mapRows: { "@layout": "Label" },
    scenarios: [{ id, area, given, when, then, size: [w, h], consent?, run: async (page, h) => true | "what failed" }],
    designPaths: ["design/**", "src/styles/**", ...],  // lighter checks: a PR runs them only when one of these changed
  },

  rules: {
    // the site's own code rules, added to the kit's: (ctx) => [{ id, area, title, how, fails: ["file:line what"], note }]
    code: (ctx) => [...],
    // the lessons (rules/learnings.mjs): which apply and where; a missing key means the rule's default
    learnings: { scrollModule: "src/scripts/scroller.js", ... },
  },

  report: {
    title: "Flow Medium · the system",
    accent: "#884dff",
    since: "<commit>",                 // what the system page marks new against (optional)
    typesetSamples: [{ lang, text }],
    // the blocks of the page (layer 3 pictures and the live frame): each with the files that change its look
    blocks: [{ id: "hero", title: "Hero", page: "", selector: ".hero", files: ["src/styles/hero.css", "src/scripts/hero.js"] }],
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
- `checks keep` puts them on the site's `report-data` branch: `latest/`, `history/<day>-<sha7>/`,
  `history/index.json`, `pr/<n>/`, `branch/<name>/`, `broken/`; and `shots/` (below).
- The report reads `<out>/state.json` when the checks just ran on this commit, else `report-data:latest/`.

## Three layers: when what is rebuilt

1. **From the code** (tokens, roles, steps, decisions, questions, the code's rules): on every build, in seconds
   (`site-kit report` alone; no browser).
2. **Measured** (numbers only): on main always; on a pull request only when a path in `checks.designPaths` changed
   or the PR has the label `checks`; a newer push cancels the older run. A report built without its own
   measurements says whose they are ("measured on main at abc1234, before this change").
3. **Pictures** (`site-kit shots`): only for blocks whose files changed since their last picture (on main, after the
   checks), when asked (`--all`, workflow input, the PR label `shots`), or at a round's end. Kept on report-data in
   `shots/<block>/<w>x<h>.jpg` with `shots/index.json`:
   `{ blocks: { <id>: { files: { "<path>": "<git blob sha>" }, taken: "<iso>", commit, sizes: [{ w, h, file }] } } }`.
   The report shows each picture with its date and marks it "may be out of date" when a file's fingerprint now
   differs. For most looks the report shows the live site in a frame instead (same origin: `<live>#<block>`), at a
   width the reader picks.

## Browser helpers (`runtime/`)

Plain ES modules, no dependencies, each with a comment saying which lesson it carries:

- `loaded.js` — `whenLoaded(fn)`: runs now if the page's `load` has fired, else on it.
- `styles.js` — `stylesReady()`: a promise that settles when every stylesheet has applied (WebKit bug 261655).
- `gpu.js` — `realGPU(canvas?)`: false for software renderers (`failIfMajorPerformanceCaveat` + renderer name).
- `scroller.js` + `box.js` + `bar-guard.css` — Safari's bars: the page scrolls in its own box on a Mac (solid bar),
  one guard at the bottom on iPhone; `y()`, `to()`, `max()`, `onScroll()`, `watchSize()`, `ioRoot`.

## The lessons as rules (`rules/learnings.mjs`)

Each fails a PR when broken, with the file and line: nothing reads `window.scrollY` / listens to the window's `scroll`
outside the scroll module; every WebGL context asks for `failIfMajorPerformanceCaveat` (or goes through `gpu.js`); no
bare `addEventListener("load", …)` (use `whenLoaded`); the start-up waits for stylesheets; anything that loads a
third party starts from consent. A site turns one off only with a decision in decisions.json that names it.

## Working rules for the parts

- Behaviour first: on Flow Medium the kit must give the same results as FM's own copies did (same rules, same
  findings, same report data), apart from what a part's README lists as an intended change.
- Every command prints what it did in one or two lines and exits non-zero only on its own failure.
- Docs are English, plain words, the reasons kept (the comments of FM's files carry lessons; keep them).
