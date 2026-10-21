// Frontend-only smoke server; NOT a native Tauri runtime or model gateway.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { createHash } from "node:crypto";
const root = resolve("desktop/dist");
const cfg = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const index = readFileSync(resolve(root, "index.html"), "utf8");
const hashes = [...index.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .filter((m) => m[1])
  .map(
    (m) =>
      "'sha256-" + createHash("sha256").update(m[1]).digest("base64") + "'",
  );
const csp = cfg.app.security.csp.replace(
  "script-src 'self'",
  "script-src 'self' " + hashes.join(" "),
);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
http
  .createServer((req, res) => {
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, "http://internal").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
    if (
      !file.startsWith(root + sep) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    ) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Content-Security-Policy": csp,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(readFileSync(file));
  })
  .listen(5181, "0.0.0.0", () =>
    console.log("Desktop frontend preflight on 5181 (not native Windows)"),
  );
