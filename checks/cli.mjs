// site-kit checks [measure|state|keep|answer|help] [...]: the design system's checks (README.md here).
//   site-kit checks                    measure (Chromium) then state
//   site-kit checks measure            [--engine chromium|webkit] [--quick] [--only sweep,sizes,modes,privacy,scenarios,pages,weight] [--out <file>]
//   site-kit checks state              [--record <file>] [--webkit <file>] [--prev <state>] [--prev-record <record>] [--out <file>]
//   site-kit checks keep               [--pr <n>] | --forget <n>
//   site-kit checks answer             <id> "<answer>" ["note"] | <id> --drop "why" | <id> --reopen | "<tag> answer · <id>: <answer>"
// Env: SITE_KIT_SHA (else FM_HEAD_SHA, GITHUB_SHA, git HEAD) the commit measured; SITE_KIT_PR (else FM_PR) the pull
// request; SITE_KIT_ENGINE (else FM_ENGINE) the engine; PLAYWRIGHT_CHROMIUM a Chromium to use.
const HELP = `site-kit checks [measure|state|keep|answer|help]

  (nothing)   measure in Chromium, then state
  measure     [--engine chromium|webkit] [--quick] [--only sweep,sizes,modes,privacy,scenarios,pages,weight] [--out file]
  state       [--record file] [--webkit file] [--prev state.json] [--prev-record record.json] [--out file]
  keep        [--pr <n>] | --forget <n>     the record and state onto the report-data branch (CI)
  answer      <id> "<answer>" ["note"] | <id> --drop "why" | <id> --reopen | "<tag> answer · <id>: <answer> — <note>"`;

export async function run(args, cfg) {
  const [sub, ...rest] = args;
  if (sub === "help" || sub === "--help") { console.log(HELP); return 0; }
  if (!sub || sub.startsWith("--")) {
    const { measure } = await import("./measure.mjs"), { state } = await import("./state.mjs");
    const code = await measure(cfg, args);
    if (code) return code;
    // the state reads the record just written (an --out of measure is its --record)
    const i = args.indexOf("--out"), e = args.indexOf("--engine");
    const rec = i >= 0 ? ["--record", args[i + 1]] : e >= 0 ? ["--record", `${cfg.paths.out}/record-${args[e + 1]}.json`] : [];
    return state(cfg, rec);
  }
  if (sub === "measure") return (await import("./measure.mjs")).measure(cfg, rest);
  if (sub === "state") return (await import("./state.mjs")).state(cfg, rest);
  if (sub === "keep") return (await import("./keep.mjs")).keep(cfg, rest);
  if (sub === "answer") return (await import("./answer.mjs")).answer(cfg, rest);
  console.error(`site-kit checks: no «${sub}»\n\n${HELP}`);
  return 2;
}
