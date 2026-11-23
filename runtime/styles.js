/* stylesReady(): a promise that settles when every stylesheet linked by the page has applied.

   The lesson: Safari may run a module script before the page's stylesheet has applied (WebKit bug 261655: a module
   script does not always wait for the stylesheets before it, more often with a warm cache). Everything measured then is
   wrong, and what is measured once stays wrong: on Flow Medium the card stack read the page's colour as transparent and
   lost its strips "sometimes" (Tim's screenshots, Oct 2026). So the entry script waits for every stylesheet before it
   starts anything. A stylesheet that fails to load does not hold the page up (its `error` settles it too).
   Waiting is not the whole cure: never read a computed colour or size once and write it inline for good. Put it in the
   CSS (`var(--paper)`), or measure again on refresh.
   A stylesheet put inside the page by the build (<style>) is always in; this covers any page that links one.
   The kit's rule `learn.styles-first` checks that the entry script (rules.learnings.entry) waits before its first call.

   Wiring, at the top of the entry module, before anything is started or measured:
     import { stylesReady } from "site-kit/runtime/styles.js";
     await stylesReady();
     initEverything();
   (Flow Medium: the `await Promise.all(...)` near the top of src/scripts/main.js is this function.) */
export function stylesReady(doc = document) {
  const waiting = [...doc.querySelectorAll('link[rel="stylesheet"]')].filter((link) => !link.sheet);
  return Promise.all(waiting.map((link) => new Promise((done) => {
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
  }))).then(() => undefined);
}
