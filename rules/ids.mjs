// The lessons' ids and titles, in the order learningRules() returns them, in a module of their own that imports
// nothing: when rules/learnings.mjs cannot be loaded or throws, checks/source.mjs still knows which rules could not run
// and says so (status "error", their last findings carried), instead of letting them vanish (their findings would count
// as fixed, and come back as «new» on the next good run). test/learnings.test.mjs keeps this list and the rules in step.
export const LESSONS = [
  { id: "learn.window-scroll", title: "The scroll goes through one module" },
  { id: "learn.io-root", title: "Observers that look ahead watch from the scroller" },
  { id: "learn.webgl-caveat", title: "WebGL only on a real GPU" },
  { id: "learn.bare-load", title: "Nothing waits for a load that has passed" },
  { id: "learn.styles-first", title: "The start-up waits for the stylesheets" },
  { id: "learn.consent-first", title: "Third parties start only after consent" },
  { id: "learn.lazy-media", title: "A stylesheet loaded on its own imports the custom media" },
  { id: "learn.bar-guard", title: "The bottom bar's guard stays empty" },
  { id: "learn.box-every-page", title: "Every page with the box runs the box script first" },
];

/** a lesson that could not run, in the shape of a rule: checks/source.mjs turns `error` into the status "error" */
export const couldNotRun = (l, why) => ({ id: l.id, area: "Code", title: l.title, how: "—", fails: [], error: why, note: `could not run: ${why}` });
