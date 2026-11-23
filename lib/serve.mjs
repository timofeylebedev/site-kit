// The built site served as GitHub Pages serves it, for every part that loads it in a browser (checks measure, audit,
// shots), so they all see the same pages:
//   x/          → x/index.html
//   x           → x, else x.html (an address without ".html" finds the page), else a folder x → 301 to x/
//   anything missing → 404.html with the status 404 (a plain "not found" when the site has none)
// Only on 127.0.0.1 (nothing else on the network reaches it), and never outside the folder: a path is decoded once,
// resolved, and refused (404) when it leaves `dist` (`/..%2F..%2Fetc/passwd`).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

export const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain",
  ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4", ".webm": "video/webm",
  ".vtt": "text/vtt", ".glb": "model/gltf-binary", ".wasm": "application/wasm", ".pdf": "application/pdf",
};
const kind = async (f) => { try { const s = await stat(f); return s.isFile() ? "file" : s.isDirectory() ? "dir" : null; } catch { return null; } };

/** the file an address names inside `root` (absolute), or null when it would leave it */
export function inside(root, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }      // a broken %-escape
  if (p.includes("\0")) return null;
  const file = resolve(root, "." + (p.startsWith("/") ? p : "/" + p));
  return file === root || file.startsWith(root + sep) ? file : null;
}

/** serves `dist` on a free port of 127.0.0.1; resolves to { url, port, server, close() } */
export function serve(dist) {
  const root = resolve(dist);
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://x").pathname;
      let file = inside(root, pathname), status = 200;
      if (file) {
        const k = await kind(file);
        if (pathname.endsWith("/")) file = k === "dir" ? resolve(file, "index.html") : null;
        else if (k === "dir") {                                                // GitHub Pages: a folder without its slash
          if (await kind(resolve(file, "index.html")) === "file") { res.writeHead(301, { location: pathname + "/" + (new URL(req.url, "http://x").search) }); res.end(); return; }
          file = null;
        } else if (k !== "file") file = (await kind(file + ".html")) === "file" ? file + ".html" : null;
        if (file && (await kind(file)) !== "file") file = null;
      }
      if (!file) { file = resolve(root, "404.html"); status = 404; }
      const body = (await kind(file)) === "file" ? await readFile(file) : Buffer.from("not found");
      res.writeHead(status, { "content-type": (await kind(file)) === "file" ? TYPES[extname(file)] || "application/octet-stream" : "text/plain" });
      res.end(body);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      ok({ url: `http://127.0.0.1:${port}/`, port, server, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
