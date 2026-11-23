// The built site served as GitHub Pages serves it: an address without ".html" finds the page, a folder its
// index.html, anything missing gets 404.html with the status 404. Same rules as the checks' runner (measure.mjs), so a
// picture shows the page the checks measured.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".avif": "image/avif", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml",
  ".webmanifest": "application/manifest+json", ".mp4": "video/mp4", ".webm": "video/webm", ".vtt": "text/vtt" };
const isFile = async (f) => { try { return (await stat(f)).isFile(); } catch { return false; } };

/** serves `dist` on a free port of localhost; resolves to { url, close() } */
export function serve(dist) {
  const server = createServer(async (req, res) => {
    try {
      const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
      let file = join(dist, p), status = 200;
      if (p.endsWith("/")) file = join(file, "index.html");
      else if (!(await isFile(file)) && (await isFile(file + ".html"))) file += ".html";
      if (!(await isFile(file))) { file = join(dist, "404.html"); status = 404; }
      const body = (await isFile(file)) ? await readFile(file) : "not found";
      res.writeHead(status, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((ok) => server.listen(0, () => ok({ url: `http://localhost:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) })));
}
