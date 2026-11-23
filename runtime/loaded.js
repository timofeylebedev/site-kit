/* whenLoaded(fn): runs fn once the page has loaded, at once if it already has.

   The lesson: a module script that starts late (a site that lets the browser draw its first frame before the start-up
   work, a script imported on demand, a slow line) may run after the page's `load` event has fired. A plain
   addEventListener("load", fn) then never runs, and nothing says so. An independent review of Flow Medium (Oct 25, 2026)
   found four such listeners at once, after the start-up was moved behind the first frame.
   The kit's rule `learn.bare-load` fails a window `load` listener that is not guarded by a readyState check.

   Wiring:
     import { whenLoaded } from "site-kit/runtime/loaded.js";
     whenLoaded(() => measureAgain());
   (Flow Medium: src/scripts/loaded.js is this file.) */
export function whenLoaded(fn) {
  if (document.readyState === "complete") fn();
  else addEventListener("load", fn, { once: true });
}
