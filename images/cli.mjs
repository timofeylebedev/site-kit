// site-kit images [--force] [--dry] [--only <name>]   the pictures from their originals (cfg.images, README.md)
// site-kit images score [--only <name>]               each committed output scored against its original (SSIMULACRA2)
// site-kit images search --only <name> | --all [--target 90] [--format avif|webp] [--bits 8|10] [--chroma 420|444]
//                                                     the lowest setting of each output that still scores the target
// Encoding is CPU-heavy: on a shared machine run it under the browser lock (flock), never beside a browser run.
import { options } from "../lib/config.mjs";
import { make } from "./make.mjs";
import { scoreAll, search } from "./search.mjs";

export async function run(args, cfg) {
  const opt = options(args, ["only", "bits", "chroma", "target", "format"]), sub = ["score", "search"].includes(args[0]) ? args[0] : null;
  const only = typeof opt("only") === "string" ? opt("only") : null;
  if (!cfg.images) { console.log("images: no `images` in site-kit.config.mjs"); return 0; }
  if (sub === "score") { await scoreAll(cfg, { only }); return 0; }
  if (sub === "search") {
    if (!only && !opt("all")) { console.log("images search: name the pictures (--only <part of a name>) or --all (slow: several encodes per output)"); return 2; }
    const bits = opt("bits"), chroma = opt("chroma");
    const modes = bits || chroma ? [8, 10].filter((b) => !bits || String(b) === String(bits))
      .flatMap((b) => ["4:2:0", "4:4:4"].filter((c) => !chroma || c.replace(/:/g, "") === String(chroma)).map((c) => ({ bitdepth: b, chromaSubsampling: c }))) : null;
    await search(cfg, { only, target: opt("target") ? Number(opt("target")) : undefined, format: opt("format") || null, modes });
    return 0;
  }
  await make(cfg, { force: !!opt("force"), dry: !!opt("dry"), only });
  return 0;
}
