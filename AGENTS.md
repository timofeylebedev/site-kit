# AGENTS.md: the lessons that are not code

What Tim's sites learned that no rule in `rules/` can check. Read this before working on any site that uses the kit,
together with that site's own CLAUDE.md (its rules win where they differ). Each lesson says where it came from, so
the reasons can be read in full: «FM #63» is pull request 63 of timofeylebedev/fm.

## Working with Tim

- Tim reviews every change: a branch, a pull request, one topic per PR; never commit to `main`. The PR says what
  changed, what was measured and what Tim should look at, with the preview link.
- Talk to Tim in the language he writes in. The sites are Russian; the code, comments and docs are English.
- Larger rounds get an independent review: a separate agent that has not seen the work checks it, and its findings are
  fixed in a commit "Fixes from the independent review". It keeps paying: FM #63's review found 17 problems, 4 high,
  in work that looked done.
- A question a check cannot answer (a look on his iPhone, a choice) goes into `design/questions.json`, so the report
  shows it with answer buttons and it reopens when its files change. Asks left in chat or project notes were never
  answered (FM: a month, Oct–Nov 2026).
- Anything decided on purpose goes into `design/decisions.json` with who, when and why; bind it to what a check finds
  (`checks: [{ rule, match, band }]`) so it comes back when the value moves.

## Measuring

- Measure, don't guess: numbers in a PR come from a browser (Playwright), never from reading the CSS.
- At the start of design work read the site's `state.json` (`<live>/report/state.json`, or `report-data:latest/`)
  instead of an old round's numbers. Never edit the `report-data` branch by hand.
- Headless Chromium has no GPU here: launch with `--use-gl=swiftshader --enable-unsafe-swiftshader`, keep at most two
  browser contexts at a time, and judge motion by its curves, not by frame timing.
- Scroll a page top to bottom once before measuring: drawings, reveals and lazy blocks mount on the way. Things shown
  only in view (FM's card stack) must be measured a screen at a time (FM #63 review).
- `scrollbar-gutter: stable` is drawn as a classic 15px scrollbar in headless Chromium, even with hidden scrollbars:
  layout steps then show 15–20px late. Take it out of the served CSS *and* the pages (an inline stylesheet keeps it)
  to measure as on a Mac or a phone (`checks.unstyle`).
- Playwright's WebKit presents itself as Safari on a Mac: a Mac-Safari-only mode (FM's scroll box) must be switched off
  to measure the window (`checks.query`).
- axe and the audit cannot see text over a canvas or a video: measure that contrast from pixels (hide the text,
  screenshot, sample behind it), in reduced and normal motion. Fail the audit if axe checked nothing (FM: a
  `body::before` once made axe check no contrast at all).
- PageSpeed in the cloud: serve `dist/` with about 60 ms of delay per response, or the page paints before its scripts
  run and the numbers look better than on GitHub Pages (FM #61: 79 vs 91.5 on the same build). Lighthouse mobile,
  three runs, the median.
- A step that fails must make its rules «could not run», never pass, and never become main's baseline (FM #63 review).

## Browsers

- **Safari is the truth for Safari.** Articles about Safari 26's bar tinting were wrong on macOS 27. Tim tests in his
  own Safari and on his iPhone: ask him, with a link (the PR preview).
  - On a Mac, a light fixed header is never extended into the bar in dark mode; a dark one is. A page that scrolls
    inside its own box gets a solid bar (`runtime/box.js`, `runtime/scroller.js`).
  - On iPhone, Safari's bottom bar takes the background of anything fixed or sticky at the bottom edge, even clipped.
    An empty fixed `.bar-guard` keeps it plain glass; never give the guard a background or a backdrop filter (Safari
    then paints the bar white). A site with a fixed bottom bar of its own must test this on the device.
- Safari can run the module script before the stylesheet has applied (WebKit bug 261655): start after
  `stylesReady()`, and never read a computed colour or size once and write it inline for good (FM: the card stack's
  strips vanished «sometimes», Oct 24).
- Telegram's in-app browser: a 3–5 frame flicker on a hard fling past the end is its own; don't chase it.
- No real GPU (a blocklisted GPU, a VM, a remote desktop, CI): Chrome reads WebGL back every frame (about 12 ms on FM's
  ring). Draw a still instead (`runtime/gpu.js`), and keep a switch to force WebGL for tests (FM: `?fmring=gl`).

## Start-up (phones)

- Draw the first frame before the main script starts its work (an `await` of one frame near its top), except when the
  address names a section.
- The page's `load` may already have fired when a module starts: `whenLoaded(fn)`, never a bare listener.
- Work far from the screen waits for the visitor's first own move and a quiet second, never just the page's load.
- Inline the home page's stylesheet at build time, and stop the build if an address in it is not rewritten.
- With GSAP: never `gsap.set` freshly split lines one text at a time (each reads styles back); batch them. Split a
  text once, not again until its width or its font changes. Word joiners become empty animated letters in `chars`
  splits, and a hold at the edge of an inline tag is lost in every split: keep links and tags out of split headings.

## Pictures and text

- Pictures: the lowest quality with SSIMULACRA2 ≥ 90 per file and size, 10-bit AVIF (`site-kit images`). The checks
  compare each file's width with its drawn width × DPR.
- Text: write it normally; the typesetter decides where lines may break and never changes a visible letter
  (`site-kit typeset --lint` lists what a proofreader would fix).

## Privacy

- Nothing optional (analytics, a booking widget's preload, a chat) runs before consent; only the notice's «OK» is
  consent (152-ФЗ for Russian sites). Raise the consent version when the purposes change.
- Every third-party domain goes into the site's CSP policy; the build writes a strict CSP with script hashes, so the
  checks and tests need `bypassCSP: true` to inject scripts.

## In the cloud

- The cloud workspace cannot reach figma.com or most sites; `gh pr create` fails there (use the REST API:
  `gh api repos/<owner>/<repo>/pulls`), and branches cannot be deleted. The PR preview is how Tim sees a build.
- Start servers with the shell's background mode, not `nohup … &`; never `pkill -f <name>` from a command that
  contains the name.
- Unicode escapes typed into a file-writing tool can arrive as the characters themselves: build them in a script.
