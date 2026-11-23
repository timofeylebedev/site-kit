/* Safari on a Mac: the page scrolls in its own box (scroller.js says why). A classic script, free of imports: put it
   into <head> of every page as it is (inlined by the build, minified), before anything is drawn and before any other
   script that asks what scrolls. safari.css makes the box fill the screen and scroll, on every page that has one.

   When: Safari 26 and later (Version/26…), on a Mac (no touch: an iPad says "Macintosh" too, but has touch points), and
   not another browser that names Safari in its user agent (Chrome, Edge, Firefox, Opera). ?<param>=1 / ?<param>=0 at
   the end of the address force the box on or off in any browser (tests; the design checks load pages with =0, since
   Playwright's WebKit says it is that Safari, and then the window never scrolls).

   Options, as attributes of <html> (read by scroller.js too; the defaults in brackets):
     data-box-class  the class put on <html> when the page is boxed   ["boxed"]
     data-box-page   the selector of the box, the element that holds the whole page   ["[data-page]"]
     data-box-param  the address switch   ["box", so ?box=1 / ?box=0]
     data-box-from   the first Safari version that tints its bar   ["26"]
   Flow Medium: <html lang="ru" data-box-param="fmbox">, and <div class="page" data-page> right inside <body>.

   The keys that scroll (space, the arrows, Page Down…) scroll what holds the focus, and at first nothing does. The box
   takes the focus (not drawn: safari.css), so they scroll the page from the start; the first Tab still goes to the
   page's first focusable element (a skip link, say), the box's first child. */
(function () {
  var root = document.documentElement, o = root.dataset;
  var param = o.boxParam || "box", page = o.boxPage || "[data-page]", from = +(o.boxFrom || 26);
  var force = new RegExp("[?&]" + param + "=([01])").exec(location.search);
  var ua = navigator.userAgent, ver = /Version\/(\d+)[\d.]* (Mobile\/\S+ )?Safari\//.exec(ua);
  var macSafari = /Macintosh/.test(ua) && !navigator.maxTouchPoints && !!ver && +ver[1] >= from
    && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Firefox/.test(ua);
  if (!(force ? force[1] === "1" : macSafari)) return;
  root.classList.add(o.boxClass || "boxed");
  document.addEventListener("DOMContentLoaded", function () {
    var box = document.querySelector(page);
    if (!box) return;
    box.tabIndex = -1;
    box.focus({ preventScroll: true });
  });
})();
