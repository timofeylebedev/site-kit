# The design system's checks

Every rule of a site's design system as a check, measured in a browser on every deploy, so the review page always
shows the site as it is, and says what needs the owner.

- A **finding** is a failing check. A **decision** (`paths.decisions`) can cover what a check finds: the item is then
  *accepted*, shown with its value on every run, and comes back when that value leaves the decision's band, when the
  decision covers nothing any more, or after its date (`until`). **Fixed** is a finding that is gone: it closes itself.
- What a check cannot answer (a look on a phone, a choice) is a **question** (`paths.questions`). An answer is stored
  with the fingerprints (git blob hashes) of the files it is about; when one changes, the question opens again.
- Everything comes together in one file, `state.json`: the report draws from it, and AI agents read it at the start
  of a session (history on the `report-data` branch).

## Commands

Run in the site's root (the folder with `site-kit.config.mjs`), after the site's build:

```sh
site-kit checks                                   # measure (Chromium, ~6–8 min) + state → <paths.out>/
site-kit checks measure --engine webkit --quick   # WebKit too (npx playwright install webkit)
site-kit checks measure --only scenarios          # one step while working on the checks
site-kit checks state                             # the state again from the last record
site-kit checks state --prev main-state.json --prev-record main-record.json --webkit <out>/record-webkit.json
site-kit checks keep [--pr <n>] | --forget <n>    # CI: onto the report-data branch
site-kit checks answer <id> "<answer>" ["note"]   # record the owner's answer (also --drop "why", --reopen)
site-kit checks answer "FM answer · <id>: <answer> — <note>"   # the line the report's button copied, as it is
```

Env: `SITE_KIT_SHA` (else `FM_HEAD_SHA`, `GITHUB_SHA`, git HEAD) the commit measured; `SITE_KIT_PR` (else `FM_PR`)
the pull request; `SITE_KIT_ENGINE` (else `FM_ENGINE`) the engine; `PLAYWRIGHT_CHROMIUM` a Chromium to launch.
`playwright` is a peer dependency, resolved from the site's node_modules.

## Files

| File | What it is |
|---|---|
| `collect.js` | The collector: plain browser script, measures a page as drawn (type, colours, fills, radii, borders, shadows, effects, layers, icons, pictures, ratios, edges, lines of text, components, hover timings) and its head (titles, outline, anchors, links). Selectors come from the adapter; nothing else about the site. |
| `measure.mjs` | The runner: serves `paths.dist` as GitHub Pages does and records the sweep (every 10px of width, every 25px of height), the full sizes, the modes (no scripts, no WebGL, forced colours, fonts that never come, reduced motion), privacy before and after consent, the scenarios, every page and link, the weight. Writes `<out>/record-<engine>.json`. |
| `measured.mjs` | The rules measured from the record, each with its kind and bands (`measuredRules`, `roleAt`, `STEP_OF`). |
| `source.mjs` | The rules read from the code: one context, the kit's generic rules, the lessons (`rules/learnings.mjs`) and the site's own (`rules.code`). SPEC.md «Code rules: one shape». |
| `state.mjs` | Joins the record(s), the code's rules, the decisions and the questions into `state.json`, with «what needs you» ranked, and what is new or fixed since the last deploy of main (`joinState` is pure). |
| `keep.mjs` | CI: keeps the record and the state on the report-data branch (`latest/`, `history/<day>-<sha7>/`, `history/index.json`, `pr/<n>/`, `branch/<name>/`, `broken/`), and the pictures of `site-kit shots` (`shots/`, main only). |
| `answer.mjs` | Records the owner's answer to a question (with the files' fingerprints). |
| `cli.mjs` | `site-kit checks …` |

## What it reads from the adapter

| Field | Used for |
|---|---|
| `name`, `tag`, `owner` | the record's and state's `site`; the answer line «`<tag>` answer · …»; `by` of an answer |
| `paths.dist`, `out`, `scale`, `decisions`, `questions`, `styles`, `scripts`, `pages` | what is served, where the records go, the system's files |
| `colours` | the palette: `(io) => [{ name, value }]`, or `{ file, read(json) }` |
| `css.tokens`, `css.media` | the token stylesheets (definitions may hold literal colours; every token must be used) and the page steps (`@custom-media`) |
| `checks.pages`, `sizes` | the pages (`main: true` for the home page) and the full sizes |
| `checks.query`, `unstyle` | added to every address; `[[regex, replacement]]` rewritten in served documents and stylesheets |
| `checks.skip`, `notIcons`, `typeObjects`, `align`, `cards`, `paragraphs` | the collector's selectors |
| `checks.sections` | where the collector stops (default `main > section, body > footer`) |
| `checks.sweepStyle` | CSS added before the sweep (default: canvases hidden) |
| `checks.boxes`, `boxSkip` | the texts compared with the fallback font, and what is left out of them |
| `checks.files` | the files a browser or a search engine asks for (default robots.txt, sitemap.xml, site.webmanifest, favicon.ico, apple-touch-icon.png) |
| `checks.probes`, `mapRows` | measured at every width and height (keys with `@` are layout states, the report's map) |
| `checks.scenarios` | the logic table: `{ id, area, given, when, then, size, consent?, run(page, h) }` |
| `checks.consent` | `{ button, label, storage, version(io), hover, allowedBefore, stored(version)? }`, or null for a site that asks for none: then the privacy step records the hosts called (`privacy.hosts`), with no before/after |
| `checks.objectRadii`, `ratioFamilies` | corners of objects drawn as a whole; the families of aspect ratios |
| `checks.notes` | `{ "<rule id>": "…" }`: the site's own words added to a measured rule's `how` |
| `checks.dataBranch` | the history's branch (default `report-data`) |
| `rules.code` | `(ctx) => [{ id, area, title, how, fails, note? }]`: the site's own code rules |
| `rules.generated`, `drawings`, `objectType`, `steps`, `curves`, `notes` | set up the generic code rules (top of `source.mjs`); a rule whose input is missing is not run |
| `report.blocks` | `keep` drops the kept pictures of blocks no longer listed |

## Kinds of rule

| Kind | Verdict |
|---|---|
| hard | any item fails (sideways scroll, no alt, a broken link, something loaded before consent, a code rule) |
| share | a share of the uses must follow the rule: under `pass` it warns, under `warn` it fails (text on a role, colours from the palette, corners on a role) |
| tolerance | each item inside a band; outside it warns (near-miss edges, upscaled pictures, widows) |
| convention | a count that should stay small (border widths, shadows, z-index values, icon sizes) |
| trend | against the last deploy of main (the weight of a first visit) |
| scenario | a row of the logic table, played in a browser |
| inventory | no verdict, what there is (effects that cost the GPU, ratios, components, who is called after consent) |

## The lessons it carries

- **Measure, don't guess.** Every number comes from a browser. Headless Chromium has no GPU here: it runs software
  WebGL (`--use-gl=swiftshader --enable-unsafe-swiftshader`); frame timings and the cost of effects are not measured.
- **Scroll before measuring.** Drawings, dots and reveals mount lazily: every page is scrolled top to bottom first.
  What shows only in view is measured where it shows: the collector runs at the top of every section and a screen at
  a time through the tall ones, and the snapshots are joined (a thing counts once, with the most copies seen at once).
- **Measure as a Mac or a phone shows it.** `checks.unstyle` takes out what headless Chromium draws differently
  (FM: `scrollbar-gutter: stable` is filled like a classic 15px scrollbar), in stylesheets and in pages (a build may
  inline a stylesheet). `checks.query` turns off a site's own scroll box (Playwright's WebKit says it is Safari on a Mac).
- **Nothing leaves the machine.** Other hosts are answered with nothing, but every request is recorded: that is how
  the privacy step sees what would run before consent.
- **A step that fails is not a pass.** A failed or skipped step makes its rules «could not run»; their last findings
  are carried, and such a run never becomes main's baseline (`keep` puts it under `broken/`).
- **Keys stay the same from run to run.** A code finding is keyed by file and what it found (not the line); a picture
  by its name without the build's hash. Otherwise an edit above a line would make a finding «fixed» and «new» again.
- **A decision never hides a finding for good.** It is bound with a band; when the value leaves it, or the decision
  covers nothing, it comes back to «what needs you».

## A new rule

Add it to `measured.mjs` (from the record) or `source.mjs` (generic, from the code), or to the site's `rules.code`
(only that site), with: an id `area.name`, its `area` (the tab of the report it shows on), its `kind`, a `how` that
says what is measured in plain words, and items `{ key, where, what, value, at }` (the key keeps the item the same
thing from run to run). If it needs a new measurement, add it to `collect.js` (generic) or the adapter's probes.

## Differences from Flow Medium's own copy (design/checks/)

- Code findings name files from the site's root: FM's curves rule wrote `scripts/<f>` for `src/scripts/<f>`, so the
  keys of those findings change once (`code.curves::src/scripts/…`).
- The lessons (`rules/learnings.mjs`) run with the code rules: new rules `code.learn.*`.
- A decision may allow a code rule in some files (`"rules": [{ "rule", "files" }]`); the decisions rule checks that
  each entry names its rule.
- Some `how` texts and titles are worded for any site (FM's words come from `checks.notes`, `consent.label`); the
  robots.txt note fires only on `Disallow: /` for the whole site.
