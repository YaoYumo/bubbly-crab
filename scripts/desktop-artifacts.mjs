import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const list = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? list(resolve(dir, d.name)) : [resolve(dir, d.name)],
      )
    : [];
const entry = (p) => ({
  path: relative(root, p).replaceAll("\\", "/"),
  bytes: statSync(p).size,
  sha256: createHash("sha256").update(readFileSync(p)).digest("hex"),
});
const frontend = list(resolve(root, "desktop/dist")).map(entry);
const installers = list(resolve(root, "src-tauri/target/release/bundle/nsis"))
  .filter((p) => p.endsWith(".exe"))
  .map(entry);
const executable = resolve(root, "src-tauri/target/release/previz-lab.exe");
const binaries = existsSync(executable) ? [entry(executable)] : [];
if (
  process.argv.includes("--require-windows") &&
  (!installers.length || !binaries.length)
)
  throw Error("No Windows installer/executable was produced");
const manifest = {
  frontendBytes: frontend.reduce((s, f) => s + f.bytes, 0),
  frontend,
  installers,
  binaries,
  nativeArtifactsPresent: !!(installers.length && binaries.length),
  installerIncludesWebView2: false,
  missingWebView2Policy: "download-bootstrapper-on-install; internet required only if runtime is absent",
  modelWeightsIncluded: false,
  signed: false,
  note: installers.length
    ? "Unsigned Windows artifacts found on disk; this inventory alone does not prove a fresh build or native/manual acceptance."
    : "Frontend sizes only. No native installer has been built in this environment.",
};
mkdirSync(resolve(root, ".shots"), { recursive: true });
writeFileSync(
  resolve(root, ".shots/desktop-artifacts.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest, null, 2));
