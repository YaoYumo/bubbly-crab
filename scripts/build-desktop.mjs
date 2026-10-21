// Build only web assets for the native shell; never traverse local-ai or bundle Node.
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  root,
  configFile: false,
  mode: "desktop",
  base: "./",
  publicDir: false,
  envDir: resolve(root, "src-tauri"),
  build: {
    outDir: resolve(root, "desktop/dist"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
await import("./desktop-artifacts.mjs");
