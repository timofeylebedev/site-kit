/* What scrolls: the window, or (in Safari on a Mac) the page's own box. Every script asks this module, never the window.

   The lesson: Safari 26 and later on a Mac draw their bar over the top of the page as glass: the page scrolls on under
   it and shows through, blurred. Safari makes the bar solid only for a page whose window does not scroll (as in Google
   Docs, where a box inside the page scrolls) or whose header at the top is dark. Measured on Flow Medium in Safari on
   macOS 27 (Oct 2026): a light header, solid or not, never made the bar solid in dark mode; the box did, in light and
   dark mode; theme-color is ignored. Articles about Safari 26's bar tinting were wrong on macOS 27: Safari is the truth
   for Safari, test there.
   So there the page scrolls in its own box (box.js puts a class on <html>, safari.css makes the box fill the screen and
   scroll). Everywhere else nothing changes: the box is an ordinary block and the window scrolls.
   Then nothing may read window.scrollY or listen to the window's `scroll` (in the box they never change): ask this
   module where the page is scrolled (y), scroll it (to, by), how far it can go (max), listen to its scrolling
   (onScroll), watch its size (watchSize), and look ahead with an IntersectionObserver (ioRoot). The kit's rule
   `learn.window-scroll` fails any other read of the window's scroll (rules.learnings.scrollModule names this module).
   GSAP: `if (box) ScrollTrigger.defaults({ scroller: box })`. A pinned block in the box is held by moving it against
   the scroll (GSAP's "transform" pin) or by position: sticky; something fixed to the screen does not scroll the box
   (the wheel over it goes to the window, which does not scroll).

   Options: the attributes of <html> that box.js reads (data-box-class ["boxed"], data-box-page ["[data-page]"]).

   Wiring:
     import { y, to, onScroll, ioRoot, box } from "site-kit/runtime/scroller.js";
     onScroll(() => bar.classList.toggle("away", y() > 80));
     new IntersectionObserver(load, { root: ioRoot, rootMargin: "100% 0px" });
   (Flow Medium: src/scripts/scroller.js is this file, with its options fixed.) */
const root = document.documentElement;
const boxed = root.classList.contains(root.dataset.boxClass || "boxed");

export const box = boxed ? document.querySelector(root.dataset.boxPage || "[data-page]") : null;
export const target = box || window;                        // what fires "scroll" and what ScrollTrigger watches
export const el = box || root;                              // its scrollHeight / clientHeight

export const y = () => (box ? box.scrollTop : window.scrollY);
export const to = (top) => (box || window).scrollTo({ top, behavior: "instant" });
export const by = (d) => { if (d) to(y() + d); };
export const height = () => el.scrollHeight;                // the height of the whole page
export const max = () => Math.max(0, el.scrollHeight - innerHeight);
export const onScroll = (fn) => target.addEventListener("scroll", fn, { passive: true });
export const offScroll = (fn) => target.removeEventListener("scroll", fn);
// the root for an IntersectionObserver that looks ahead (a rootMargin beyond the screen): the box clips what is in it,
// so seen from the screen nothing below it would ever be "near"; seen from the box it is
export const ioRoot = box || null;

// the page grew or shrank: in the box, the box itself keeps the size of the screen, so its blocks are watched
export function watchSize(observer) {
  if (box) [...box.children].forEach((child) => observer.observe(child));
  else observer.observe(document.body);
}

// the colour of the page under its sections: the box's own background when there is one
export const paper = () => getComputedStyle(box || document.body).backgroundColor;
