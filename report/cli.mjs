// site-kit report [--out <dir>] [--since <commit>]: builds the review page of the system into <dir>
// (default: the adapter's paths.report). See README.md.
import { options } from "../lib/config.mjs";
import { buildReport } from "./build.mjs";

export async function run(args, cfg) {
  const opt = options(args);
  if (opt("help")) {
    console.log("site-kit report [--out <dir>] [--since <commit>]\n  builds the review page into <dir> (default: paths.report); --since: the commit it marks new against");
    return 0;
  }
  const out = opt("out"), since = opt("since");
  await buildReport(cfg, { out: typeof out === "string" ? out : undefined, since: typeof since === "string" ? since : undefined });
  return 0;
}
