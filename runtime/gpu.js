/* Is WebGL drawn by a real GPU here? realGPU(), gpuContext(), isSoftware(), rendererOf().

   The lesson: without a real GPU (a GPU the browser has turned off, a virtual machine, a remote desktop, a headless
   browser in CI) the browser still offers WebGL, drawn in software (SwiftShader, llvmpipe). Chrome then copies a WebGL
   canvas back to the processor on every frame, which costs far more than a decorative picture is worth: measured on
   Flow Medium's ring of covers in Chromium without a GPU, about 12 ms a frame. So a decorative WebGL canvas asks for
   `failIfMajorPerformanceCaveat` (the browser then says no when it would draw in software) and also checks the
   renderer's name (not every browser honours the flag), and falls back to a still picture (a 2D canvas, an image).
   A canvas that has once been asked for WebGL can never draw 2D: the fallback needs a fresh canvas.
   Where software WebGL is still worth it, in a lighter form (Flow Medium's dust keeps 6 000 specks a card instead of
   300 000, so the page stays usable), take the context and ask isSoftware(gl).
   Tests in a browser without a GPU: give the site a switch that forces WebGL anyway (Flow Medium: ?fmring=gl,
   ?fmdust=full) and pass it as { force }.
   The kit's rule `learn.webgl-caveat` fails a getContext("webgl"/"webgl2") that neither asks for the caveat nor checks
   the renderer, unless the file goes through this module.

   Wiring:
     import { gpuContext, realGPU, isSoftware } from "site-kit/runtime/gpu.js";
     const gl = gpuContext(canvas, "webgl2", { alpha: true, antialias: false }, { force: /[?&]ring=gl/.test(location.search) });
     if (!gl) drawStill(freshCanvas());               // software or no WebGL 2: a still picture
     if (!realGPU()) return;                          // decide before making anything (a throwaway canvas, asked once)
   (Flow Medium: tryGL() in src/scripts/ring-gl.js is gpuContext(); the renderer test in src/scripts/stipple.js is
   isSoftware().) */

const SOFTWARE = /SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i;

/** The renderer's name as the browser gives it (the unmasked one where the browser allows it). */
export function rendererOf(gl) {
  if (!gl) return "";
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
}

/** True when this context is drawn in software. */
export const isSoftware = (gl) => SOFTWARE.test(rendererOf(gl));

/** A WebGL context on a real GPU, or null (no WebGL of that kind, or drawn in software). `force` skips both tests.
 *  A software context it turns down is let go at once (browsers keep only so many contexts; an abandoned one holds
 *  its memory until it is collected, and pushes out an older, wanted one first). */
export function gpuContext(canvas, kind = "webgl2", attrs = {}, { force = false } = {}) {
  const gl = canvas.getContext(kind, { ...attrs, failIfMajorPerformanceCaveat: !force });
  if (!gl) return null;
  if (!force && isSoftware(gl)) { gl.getExtension("WEBGL_lose_context")?.loseContext(); return null; }
  return gl;
}

let known = null;
/** Whether this browser draws WebGL on a real GPU: asked once on a throwaway canvas, which is then let go. */
export function realGPU(kind = "webgl2") {
  if (known && kind in known) return known[kind];
  known ||= {};
  let ok = false;
  try {
    const gl = gpuContext(document.createElement("canvas"), kind);
    ok = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { ok = false; }
  return (known[kind] = ok);
}
