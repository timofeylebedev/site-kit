# site-kit

The shared machinery of Tim's static sites. It started as Flow Medium's own code (Oct–Nov 2026) and moved here so
every site uses the same code, and what was learned on one site reaches the next as code that fails, not as prose.

What a site gets:

| Part | What it does | Command |
|---|---|---|
| [checks](checks/README.md) | Every rule of the design system measured in a browser: a sweep every 10px of width and 25px of height, full sizes, modes (no JS, no WebGL, forced colours, fonts that never arrive, reduced motion), privacy before and after consent, behaviour scenarios, every page and link, weight. Decisions accept findings within a band; questions reopen when their files change. One `state.json` with «what needs you». | `site-kit checks` |
| [report](report/README.md) | The review page of the system, built from the code on every build, with the measurements and «what needs you», the live site in a frame per block, and the site's review rounds. Opens from the folder or at `<site>/report/`. | `site-kit report` |
| [shots](shots/README.md) | Pictures of the blocks, taken only for blocks whose files changed (or on request), each with its date. | `site-kit shots` |
| [rules](rules/README.md) | The rules read from the code, in a second: the design system's (sizes on the ladder, colours from tokens, …) and the lessons (nothing reads `window.scrollY` outside the scroll module, every WebGL context asks for a real GPU, …). | `site-kit rules` |
| [audit](audit/README.md) | The built pages at nine sizes in Chromium, Firefox and WebKit: sideways scroll, cut text, small text and targets, axe, contrast from pixels over canvases. | `site-kit audit` |
| [typeset](typeset/README.md) | Where lines may break, by each text's language (Russian and English rules); never changes a visible letter. A Vite plugin and a linter. | `site-kit typeset` |
| [images](images/README.md) | Source pictures → AVIF/WebP at the lowest quality that still looks the same (SSIMULACRA2 ≥ 90). | `site-kit images` |
| [runtime](runtime/README.md) | Small browser modules: `whenLoaded`, `stylesReady`, `realGPU`, Safari's bars (the scroll box on a Mac, the bar guard on iPhone). | imported |
| [workflows](.github/templates/) | Build, publish, a preview for every pull request, the checks (only when design files changed), the audit. | reusable |

[AGENTS.md](AGENTS.md) holds the lessons no rule can check. [SPEC.md](SPEC.md) is the contract between the parts and
the site's adapter.

## Using it in a site

1. `npm install -D github:timofeylebedev/site-kit#v0.1.0` (a git dependency, pinned to a tag; no build step). Its
   peer dependencies come from the site: `playwright`, and as needed `axe-core`, `sharp`, `svgo`, `parse5`, `rolldown`.
2. Write `site-kit.config.mjs` at the site's root: its pages, sizes, palette, selectors, probes, scenarios, blocks
   (SPEC.md «The adapter»; Flow Medium's is the full example:
   [timofeylebedev/fm/site-kit.config.mjs](https://github.com/timofeylebedev/fm/blob/main/site-kit.config.mjs)).
3. Scripts: `"checks": "site-kit checks"`, `"rules": "site-kit rules"`, `"report": "site-kit report"`,
   `"audit": "site-kit audit"`, … Run them from the site's root.
4. Copy `.github/templates/deploy.yml` and `audit.yml` into the site's `.github/workflows/` and do the one-time
   settings their comments list (Pages from the `gh-pages` branch, the labels `checks` and `shots`).
5. Adopt the runtime helpers one at a time, where the site's own code does the same thing; `site-kit rules` says
   where a lesson is broken.

## Versions

A site pins a tag (`#v0.1.0` in package.json, `@v0.1.0` in its workflows) and moves to a new one on purpose, raising
both together. A change made for one site never reaches another by surprise. A change to the kit is a pull request
here; the site that needs it raises its tag in its own pull request, after checking that its findings did not move
for a reason other than the change.

Unreleased (for v0.1.1, QQ Coffee's move onto the kit): the audit takes what counts as a text and a target, the box
of a text, a link stretched over its card, localStorage put in before each page and a probe of the site's own from
the adapter (audit/README.md); the checks measure the pages marked `measure: true` at the full sizes too, beside the
home page (checks/README.md). Flow Medium's results do not move.

## Developing the kit

`npm test` runs the tests that need no browser (`SITE_KIT_BROWSER=1 npm test` adds the browser ones). To try a change
on a site, run the kit's command from the site's root: `node ../site-kit/bin/site-kit.mjs checks …`. The proof that a
change is safe is the same as for the move from Flow Medium: the site's findings stay the same, apart from what the
change means to move.
