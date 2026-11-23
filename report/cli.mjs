// site-kit report [--out <dir>] [--since <commit>] [--path <report path>]: builds the review page of the system into
// <dir> (default: the adapter's paths.report). See README.md.
import { options } from "../lib/config.mjs";
import { buildReport } from "./build.mjs";

export async function run(args, cfg) {
  const opt = options(args, ["out", "since", "path"]);
  if (opt("help")) {
    console.log("site-kit report [--out <dir>] [--since <commit>] [--path <report path>]\n  builds the review page into <dir> (default: paths.report); --since: the commit it marks new against;\n  --path: where it is served under the site (default: SITE_KIT_REPORT_PATH, else where --out is under paths.dist, else report)");
    return 0;
  }
  const str = (k) => (typeof opt(k) === "string" ? opt(k) : undefined);
  await buildReport(cfg, { out: str("out"), since: str("since"), path: str("path") });
  return 0;
}
