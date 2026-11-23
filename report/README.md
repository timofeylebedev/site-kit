# report: the review page of the system

One static page of the whole design system of a site: open `index.html` of the built folder straight from the disk
(no server needed), or online where the site's workflow publishes it (`<site>/report/`; a pull request's preview has
it at `…/pr-preview/pr-<number>/report/`).

```sh
site-kit report [--out <dir>] [--since <commit>]
```

`--out`: where to build (default: the adapter's `paths.report`). `--since`: the commit the system page marks new
against (default: `report.since`, else the rounds' `meta.since`; with none, nothing is marked, quietly). It takes about
a second and needs no browser: run it after changing any of the sources; the site's workflow runs it on every build,
so the published page is always the commit's own.

## The pages

- **What needs you** (the first page): from the checks (`site-kit checks`): rules that fail, decisions whose measured
  value moved, questions for the owner (a look on a device, a choice) with answer buttons that copy a line for a chat
  with Claude (`<tag> answer · <id>: <answer>`), warnings, and what fixed itself since the last deploy of main.
- **The system**: the system as it is now, in tabs, each with the checks of its areas at the top: colour, type, space,
  layout, effects, motion, icons & pictures, components, behaviour, page health, responsive, blocks, grammar,
  decisions. Only the current state; what is new or changed since the baseline is marked new.
- **Blocks**: each block of the page (`report.blocks`) live, the site itself in a frame at a width you pick (320, 390,
  768, 1024, 1440; scaled to fit), and its latest pictures, each with its day; a picture is marked «may be out of date»
  when a file of its block has changed since it was taken.
- **The typesetter**: how `site-kit typeset` decides where lines may break, with a demo running the real code.
- **History**: every deploy of main, measured: failures, the shares of the rules, the weight of a first visit.
- **Rounds** (only when the site keeps rounds, `paths.rounds`): one page per review round.

## The three layers

1. **From the code**, rebuilt on every build: colours (`colours`), the scale's type and space roles (`paths.scale`),
   every `@container` step and page step (`paths.styles`, `css.media`), every shadow, the decisions
   (`paths.decisions`), the questions (`paths.questions`); each marked new or changed against the baseline commit
   (fetched by itself in a shallow clone). Motion is the latest round's reading when the site keeps rounds, else read
   from the code (curves and times in custom properties, curves kept in a script's constant, every time in a
   transition or an animation).
2. **Measured**: `<paths.out>/state.json` and `record-chromium.json` when the checks just ran here, else the last deploy
   of main's from the `report-data` branch (`latest/`, fetched by itself), and `history/index.json`. The responsive
   picture and the map come from the record's sweep. When the state is not this commit's own, the page says whose it is
   in plain words («measured on main at abc1234, before this change»), on What needs you, at the top of the system and
   above every tab's checks; the data has it as `checks.whose` (and `checks.own`).
3. **Pictures** (`site-kit shots`): `<paths.out>/shots/index.json` and its images when present, else
   `report-data:shots/`; copied into `blocks/` of the output. Each block's files are fingerprinted again now
   (`git hash-object`) against the ones stored with its pictures.

## What it writes (into the output folder)

| file | what |
|---|---|
| `index.html`, `report.css`, `report.js` | the page (`page/` of the kit; index.html takes the site's title, brand line and favicon colour) |
| `site.css` | the site's `@font-face` rules and accent (`--font`, `--display`, `--site-text`, `--site-accent`) |
| `data.js` | `window.REPORT`: `meta`, `rounds`, `system`, `typeset`, `checks`, `history`, `questions`, `live`, `site`, `shots` |
| `typeset.js` | the kit's `typeset/core.js` + `lint.js` bundled for the browser (`window.Typeset`), with rolldown from the site's own node_modules |
| `fonts/` | every `.woff2` of `paths.fonts` |
| `shots/` | the rounds' pictures (`paths.shots`; the rounds point to them as `shots/…`) |
| `blocks/` | the blocks' latest pictures (`<block>/<w>x<h>.jpg`) |
| `state.json`, `history.json` | the checks' state the page shows and the history, for agents and anything else that reads them |

No module scripts and no fetch on the page, so it opens from `file://`. Served under the site (a path ending in
`/report/`), the Blocks frame shows this very build (`../#<anchor>`, and a switch to main); from the disk it shows
`live`.

## The adapter fields it reads

- `name`, `tag` (answer lines), `owner`, `repo` (commit links), `live` (the frame), `lang` (the specimens' language).
- `paths`: `report` (output), `scale`, `decisions`, `questions`, `styles`, `scripts`, `fonts`, `out` (the checks'
  records, state and shots), `rounds` (optional: `data.json` of typed blocks, `meta.rounds`, `meta.since`), `shots`
  (optional: the rounds' pictures).
- `colours`: `{ file, read(json) → [{ name, value, css, group, use }], groups: [[key, label, about, contrast?]] }`,
  read now and at the baseline commit. `contrast`: `"on-white"` (the colour as text on white) or `"white-on"` (white text
  on it). A function `(io) → [...]` also works, with no new marks for colours.
- `css`: `tokens` (stylesheets whose custom properties name colours: the shadow tiles and the type specimens use them),
  `media` (the page steps).
- `checks.mapRows`: the rows of the responsive map (layout states of the probes).
- `report`:
  - `title`, `accent`: the page's title, brand line and favicon; the accent also marks the typesetter's holds.
  - `fonts`: `{ text: { family, files: { <weight>: "<file>.woff2" } }, display: { … } }`: the page's own text is the
    site's text face, the specimens use both.
  - `since`, `sinceLabel`: the baseline (else the rounds').
  - `typeRoles`: `{ "<role>": { font: "text" | "display", weight, lh, text, where, color, upper, track } }`: how each
    text role is drawn (`color` names a custom property of `css.tokens`, without `--`).
  - `column`: `{ max, gutter }`: the column the roles sized «per» card follow (else the screen's width).
  - `steps`: `{ "22rem": "S", … }`: the shared container steps (any other is own).
  - `shadow(s) → { name, painter, ground, shape, text, bg }` and `grounds: { <name>: <colour> }`: how each shadow is
    named and drawn.
  - `cssVars`: extra custom properties for the shadow tiles (`{ face: "var(--idcard-face-1)" }`).
  - `blocks: [{ id, title, page, anchor, selector, files }]`: the blocks (shared with `site-kit shots`). `anchor`: the id
    of the block's element on the page (the frame's address); without one, the frame is scrolled to `selector` when it
    is on the same origin.
  - `picture: { groups, order, labels }`: the responsive picture's groups when no round describes them.
  - `roundBlocks: { <section id>: "<line under its title>" }`, `motionBase`: for sites with rounds (the latest round's
    measured blocks; the published round before, whose motion reading marks the curves that changed).
  - `notes: { layout, steps, radii, shadows, typeset }`: texts of the page only the site can say.
  - `typesetSamples: [{ lang, text }]`: the typesetter demo's texts; `typesetDecision`: the decision shown under it
    (default `typeset`).

Environment: `SITE_KIT_SHA` (the commit being built, when the checkout is a merge commit: a pull request; the workflows set it),
`GITHUB_HEAD_REF` / `GITHUB_REF_NAME` (the branch).

## Lessons it carries

- The page must open from the disk: no module scripts, no fetch; everything is in `data.js`.
- A shallow clone has no baseline commit: fetch that one commit, or nothing can be marked new; with no baseline,
  nothing is marked (rather than everything).
- A local run of the checks is «this build» only when it measured this very commit; any other state says whose it is.
- The system page shows only what is now: old values and relative dates are taken out of the rounds' texts
  (`nowOnly`).
- Durations' names and notes get rewritten between rounds, so no text comparison can tell a real change from a new
  wording: the round lists what changed (`meta.motionChanged`).
- A link that comes from data (a question's «Open») is followed only to an https address.
