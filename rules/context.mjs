// A minimal context for the code rules (SPEC.md «Code rules: one shape»), for `site-kit rules` when checks/source.mjs
// is not there, and for the tests. checks/source.mjs builds the full one; the fields the lessons read are the same.
import { siteIO } from "../lib/config.mjs";
import { dirname } from "node:path";
import { scanJs, stripCss } from "./learnings.mjs";

// a decision's allowance (checks/source.mjs allowedBy, kept here too so this works without it)
const allowedBy = (decisions, id, file, selector = null) => decisions.find((d) => (d.rules || []).some((r) => r.rule === id &&
  (!r.files || new RegExp(r.files).test(file || "")) && (!r.selectors || (selector != null && new RegExp(r.selectors).test(selector))))) || null;

export function minimalContext(cfg, io = siteIO(cfg)) {
  const styles = cfg.paths?.styles || "src/styles", scripts = cfg.paths?.scripts || "src/scripts";
  const pages = cfg.paths?.pages || dirname([].concat(styles)[0]);
  const load = (files) => Object.fromEntries(files.map((f) => [f, io.read(f)]));
  const decisions = io.json(cfg.paths?.decisions || "design/decisions.json", { decisions: [] }).decisions || [];
  return {
    cfg, io,
    css: load(io.files(styles, ".css")),
    js: load(io.files(scripts, [".js", ".mjs"])),
    html: load(io.files(pages, ".html").filter((f) => !f.slice(pages.length + 1).includes("/"))),
    scale: io.json(cfg.paths?.scale || "design/scale.json", null),
    decisions,
    strip: stripCss,
    stripJs: (s) => scanJs(s).text,
    lineOf: (s, i) => s.slice(0, i).split("\n").length,
    allowed: (id, file, selector) => allowedBy(decisions, id, file, selector),
  };
}
