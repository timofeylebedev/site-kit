// The pictures' index (`shots/index.json`, here and on the report-data branch):
//   { blocks: { <id>: { files: { "<path>": "<git blob sha>" }, taken: "<iso>", commit, sizes: [{ w, h, file, old? }], missed? } },
//     missed?: { <id>: [{ w, h, why }] } }
// A run writes an entry only for a block it took at least one picture of: a block it could not find at any size is
// listed under the index's own `missed`, and its kept entry and pictures stay (and it is tried again next time, since
// its files still differ). A size the block is hidden at ("not shown at this size") is the entry's `missed` and is not
// asked for again until its files change; a size that failed for another reason is left out, so it is tried again,
// and its kept picture stays meanwhile, marked `old` (mergeShots).
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
export function whatChanged(entry, now, sizes = [], block = null) {
  if (!entry) return ["no picture yet"];
  const why = [];
  // how the block is pictured changed in the adapter (another element, other frames)
  if (block && entry.selector && block.selector !== entry.selector) why.push("its selector changed");
  if (block && JSON.stringify(block.frames || null) !== JSON.stringify(entry.frames || null)) why.push("its frames changed");
  const was = entry.files || {};
  for (const [f, sha] of Object.entries(now)) {
    if (!(f in was)) why.push(`${f} is new to the block`);
    else if (was[f] !== sha) why.push(`${f} changed`);
  }
  for (const f of Object.keys(was)) if (!(f in now)) why.push(`${f} is no longer the block's`);
  // a picture kept from an earlier run (old: this run could not take it) does not count as had
  const have = new Set((entry.sizes || []).filter((s) => !s.old).map((s) => `${s.w}x${s.h}`));
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

// why a size had no picture that means the block is hidden there by design (not a failure to retry)
export const HIDDEN = new Set(["not shown at this size", "no size at this size"]);
const sizeKey = (s) => `${s.w}x${s.h}`;

/** the index entry of a block after a run, or null when the run took no picture of it (the kept one then stays).
 *  `r`: { sizes: [{ w, h, file, … }], missed: [{ w, h, why }] }; `base`: the rest of the entry (files, taken, commit …) */
export function entryOf(base, r) {
  if (!(r.sizes || []).length) return null;
  const hidden = (r.missed || []).filter((m) => HIDDEN.has(m.why));
  return { ...base, sizes: r.sizes, ...(hidden.length ? { missed: hidden } : {}) };
}

/** the kept index with a run's pictures put in: a block shot now replaces its entry, keeping (marked old, with their
 *  own date) the kept pictures of sizes the run neither took nor found hidden; an entry of a run with no picture at all
 *  (older runs wrote them) leaves the kept one as it was; blocks no longer in `ids` (when given: the adapter's blocks)
 *  are dropped */
export function mergeShots(kept, fresh, ids = null) {
  const blocks = { ...(kept?.blocks || {}) };
  for (const [id, e] of Object.entries(fresh?.blocks || {})) {
    if (!(e.sizes || []).length) continue;
    const was = kept?.blocks?.[id];
    const done = new Set([...e.sizes.map(sizeKey), ...(e.missed || []).map(sizeKey)]);
    const carried = (was?.sizes || []).filter((s) => !done.has(sizeKey(s)))
      .map((s) => ({ ...s, old: true, taken: s.taken || was.taken || null, commit: s.commit || was.commit || null }));
    blocks[id] = carried.length ? { ...e, sizes: [...e.sizes, ...carried] } : e;
  }
  if (ids) for (const id of Object.keys(blocks)) if (!ids.includes(id)) delete blocks[id];
  const { missed, upToDate, ...rest } = fresh || {};
  return { ...(kept || {}), ...rest, blocks };
}

/** which of a merged index's pictures are this run's (`fresh`): (id, file) → true when the file is to be taken from the
 *  run's folder, false when from the kept ones */
export const freshFile = (fresh) => (id, file) => !!fresh?.blocks?.[id]?.sizes?.some((s) => s.file === file && !s.old);

/** "390x844,1440x900" → [{ w, h }] */
export function parseSizes(text) {
  return String(text).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\d+)\s*[x×]\s*(\d+)$/);
    if (!m) throw new Error(`shots: a size is <width>x<height>, not "${s}"`);
    return { w: +m[1], h: +m[2] };
  });
}
