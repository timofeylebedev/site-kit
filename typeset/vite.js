// The typesetter as a Vite plugin (`import { typeset } from "site-kit/typeset/vite"`): where the lines of the page's
// texts may break, no-break spaces and word joiners by the language of each text (README.md). Letters you can see are
// never changed: what a proofreader would change (straight quotes, a hyphen for a dash, a look-alike letter) is listed
// when the site is built, and `site-kit typeset --lint <page>` shows it all.
//
//   typeset()                        the settings from cfg.typeset of the site's site-kit.config.mjs, if there is one
//   typeset({ pages, warn, lang, off, spacesOnly })
//     pages       which pages: file names (["index.html"]), a RegExp or a function (path) => boolean; default every page
//     warn        true (default): one line per page with findings, on the first build only · false: silent ·
//                 "error": the build stops on a finding
//     lang, off, spacesOnly   as in typesetHtml (html.js)
import { relative } from "node:path";
import { typesetHtml, settings } from "./html.js";

export function typeset(options) {
  let warned = false, opts = options;
  const wanted = (file) => {
    const pages = opts?.pages;
    if (!pages) return true;
    if (typeof pages === "function") return pages(file);
    if (pages instanceof RegExp) return pages.test(file);
    return [].concat(pages).some((p) => file === p || file.endsWith("/" + p));
  };
  return {
    name: "site-kit-typeset",
    async configResolved() {
      if (opts) return;
      // no options given: the site's adapter, when the build runs in the site's root
      try { const { loadConfig } = await import("../lib/config.mjs"); opts = (await loadConfig()).typeset || {}; }
      catch { opts = {}; }
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!wanted(ctx.filename)) return html;
        const { html: out, report } = typesetHtml(html, settings(opts));
        const findings = report.flatMap((r) => r.findings);
        if (findings.length && opts?.warn === "error")
          throw new Error(`typeset: ${relative(process.cwd(), ctx.filename)} — ${findings.length} spots a proofreader would change (site-kit typeset --lint ${relative(process.cwd(), ctx.filename)})`);
        if (findings.length && !warned && opts?.warn !== false) {
          const file = relative(process.cwd(), ctx.filename);
          console.warn(`typeset: ${file.split("/").pop()} — ${findings.length} spots a proofreader would change (site-kit typeset --lint ${file})`);
        }
        return out;
      }
    },
    buildEnd() { warned = true; }
  };
}
