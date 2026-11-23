// The kit's settings from the environment, read in one place: env("SHA") is SITE_KIT_SHA.
//   SITE_KIT_SHA     the commit measured (CI: a pull request's head, else github.sha)
//   SITE_KIT_PR      the pull request's number (empty on main)
//   SITE_KIT_ENGINE  the browser engine (chromium, webkit, firefox)
//   SITE_KIT_MAIN    the branch that is the live site (else the adapter's mainBranch, else "main")
//   SITE_KIT_ROOT    the site's root (lib/config.mjs)
// Flow Medium's own scripts used FM_HEAD_SHA, FM_PR and FM_ENGINE before the kit. They still work for one version
// (v0.1.x), so its workflows can move at their own pace; they go in v0.2. Nothing else in the kit names them.
const OLD = { SHA: "FM_HEAD_SHA", PR: "FM_PR", ENGINE: "FM_ENGINE" };

/** SITE_KIT_<name>, else (for one version) Flow Medium's old name; undefined when neither is set or both are empty */
export function env(name) {
  const v = process.env["SITE_KIT_" + name];
  if (v) return v;
  const old = OLD[name] && process.env[OLD[name]];
  return old || undefined;
}
