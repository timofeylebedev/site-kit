// The pictures' index (`shots/index.json`, here and on the report-data branch):
//   { blocks: { <id>: { files: { "<path>": "<git blob sha>" }, taken: "<iso>", commit, sizes: [{ w, h, file }], missed? } } }
// A block's fingerprint is the git blob sha of each file that changes its look (cfg.report.blocks[].files): the same
// content gives the same sha on any machine, committed or not. A picture is out of date when one of them differs now.
// Pure functions (and one git call), shared by `site-kit shots`, the report (marks "may be out of date") and keep.

/** the blob sha of each file now ("missing" for a file that is not there) */
export function fingerprints(io, files) {
  const out = {}, present = [];
  for (const f of files) { if (io.exists(f)) present.push(f); else out[f] = "missing"; }
  if (present.length) {
    const shas = io.git("hash-object", "--", ...present).trim().split("\n");
    present.forEach((f, i) => { out[f] = shas[i]; });
  }
  return Object.fromEntries(files.map((f) => [f, out[f]]));
}

/** what differs between a block's kept entry and now: [] = up to date. `sizes` = the sizes asked for ("390x844") */
export function whatChanged(entry, now, sizes = []) {
  if (!entry) return ["no picture yet"];
  const why = [];
  const was = entry.files || {};
  for (const [f, sha] of Object.entries(now)) {
    if (!(f in was)) why.push(`${f} is new to the block`);
    else if (was[f] !== sha) why.push(`${f} changed`);
  }
  for (const f of Object.keys(was)) if (!(f in now)) why.push(`${f} is no longer the block's`);
  const have = new Set((entry.sizes || []).map((s) => `${s.w}x${s.h}`));
  // a size the block was missing from (hidden there) last time does not count as missing now
  for (const m of entry.missed || []) have.add(`${m.w}x${m.h}`);
  for (const s of sizes) if (!have.has(s)) why.push(`no picture at ${s}`);
  return why;
}

/** the files of a stale picture: which of the block's files differ now (for the report's "may be out of date") */
export function staleFiles(entry, now) {
  if (!entry) return Object.keys(now);
  return Object.entries(now).filter(([f, sha]) => entry.files?.[f] !== sha).map(([f]) => f);
}

/** the kept index with a run's pictures put in: a block shot now replaces its entry (its folder is replaced too);
 *  blocks no longer in `ids` (when given: the adapter's blocks) are dropped */
export function mergeShots(kept, fresh, ids = null) {
  const blocks = { ...(kept?.blocks || {}), ...(fresh?.blocks || {}) };
  if (ids) for (const id of Object.keys(blocks)) if (!ids.includes(id)) delete blocks[id];
  return { ...(kept || {}), ...(fresh || {}), blocks };
}

/** "390x844,1440x900" → [{ w, h }] */
export function parseSizes(text) {
  return String(text).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\d+)\s*[x×]\s*(\d+)$/);
    if (!m) throw new Error(`shots: a size is <width>x<height>, not "${s}"`);
    return { w: +m[1], h: +m[2] };
  });
}
