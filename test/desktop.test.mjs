import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import {
  writeDesktopBlob,
  safeSaveName,
  createDesktopSaveQueue,
} from "../src/desktop-save.js";
import { DESKTOP_BUILD, isDesktopShell } from "../src/desktop-runtime.js";
const cfg = JSON.parse(readFileSync("src-tauri/tauri.conf.json"));
const schema = JSON.parse(
  readFileSync("node_modules/@tauri-apps/cli/config.schema.json"),
);
const validate = new Ajv({
  strict: false,
  validateFormats: false,
  unicodeRegExp: false,
}).compile(schema);
assert.ok(validate(cfg), JSON.stringify(validate.errors));
assert.equal(cfg.bundle.windows.webviewInstallMode.type, "downloadBootstrapper");
assert.equal(cfg.app.windows[0].dragDropEnabled, false);
assert.equal(cfg.app.windows[0].useHttpsScheme, true);
assert.equal(cfg.app.withGlobalTauri, false);
assert.equal(cfg.plugins.fs.scopeDroppedPaths, false);
assert.deepEqual(cfg.app.security.capabilities, ["main-local-save"]);
assert.equal(cfg.build.frontendDist, "../desktop/dist");
assert.deepEqual(cfg.bundle.targets, ["nsis"]);
const caps = JSON.parse(readFileSync("src-tauri/capabilities/main.json"));
assert.deepEqual(caps.windows, ["main"]);
assert.equal(caps.local, true);
assert.ok(!caps.remote);
assert.deepEqual(caps.permissions, [
  "dialog:allow-save",
  "fs:allow-create",
  "fs:allow-write",
  "core:resources:allow-close",
  "core:event:allow-listen",
  "core:event:allow-unlisten",
  "core:window:allow-destroy",
]);
assert.ok(!/https:\*|https:;|'unsafe-eval'|\*;/.test(cfg.app.security.csp));
assert.ok(cfg.app.security.csp.includes("object-src 'none'"));
const rust = readFileSync("src-tauri/src/main.rs", "utf8");
assert.ok(
  rust.includes("tauri_plugin_fs::init()") &&
    rust.includes("tauri_plugin_dialog::init()"),
);
assert.ok(rust.includes('local_ai::LocalAI::default()'));
const nativeModel = readFileSync('src-tauri/src/local_ai.rs','utf8');
assert.ok(nativeModel.includes('127.0.0.1:0') && nativeModel.includes('.no_proxy()'));
assert.ok(nativeModel.includes('authorize(&window)') && nativeModel.includes('path.parent() != Some(folder.as_path())'));
assert.ok(nativeModel.includes('getrandom::fill') && nativeModel.includes('response.chunk().await'));
assert.ok(!nativeModel.includes('cmd.exe') && !nativeModel.includes('powershell.exe'));
assert.ok(nativeModel.includes('tauri.localhost') && readFileSync('src-tauri/src/local_ai_limits.rs','utf8').includes('64000'));
assert.deepEqual(cfg.bundle.resources, {'resources/llama/':'runtime/llama/','resources/model-folder/':'models/'});
const ico = readFileSync("src-tauri/icons/icon.ico");
assert.equal(ico.readUInt16LE(2), 1);
assert.ok(ico.readUInt16LE(4) >= 2);
assert.ok(ico.readUInt32LE(18) >= 6 + 16 * ico.readUInt16LE(4));
assert.equal(DESKTOP_BUILD, false);
globalThis.isTauri = true;
globalThis.__TAURI_INTERNALS__ = { invoke() {} };
assert.equal(
  isDesktopShell(),
  false,
  "web build cannot gain native access by flags",
);
delete globalThis.isTauri;
delete globalThis.__TAURI_INTERNALS__;
assert.equal(safeSaveName("C:\\secret\\project.previz"), "project.previz");
assert.equal(safeSaveName("../../CON.txt"), "_CON.txt");
assert.equal(safeSaveName('bad<>:"?*.zip'), "bad______.zip");
assert.equal(safeSaveName("..."), "previz-export");
assert.equal(safeSaveName("a".repeat(159) + ".z"), "a".repeat(159));
let closed = 0,
  created = 0;
const buffers = [];
const data = Uint8Array.from(
    { length: 2 * 1024 * 1024 + 123 },
    (_, i) => i % 251,
  ),
  blob = new Blob([data]);
const adapter = {
  save: async (opts) => {
    assert.equal(opts.defaultPath, "场景.previz");
    assert.deepEqual(opts.filters, [
      { name: "PREVIZ 文件", extensions: ["previz"] },
    ]);
    return "C:\\chosen\\场景.previz";
  },
  create: async (path) => {
    assert.equal(path, "C:\\chosen\\场景.previz");
    created++;
    return {
      write: async (bytes) => {
        assert.ok(bytes.byteLength <= 1024 * 1024);
        const n = Math.min(bytes.byteLength, 32768);
        buffers.push(bytes.slice(0, n));
        return n;
      },
      close: async () => closed++,
    };
  },
};
assert.deepEqual(await writeDesktopBlob(blob, "../场景.previz", adapter), {
  status: "saved",
  name: "场景.previz",
  bytes: blob.size,
});
assert.equal(created, 1);
assert.equal(closed, 1);
assert.deepEqual(new Uint8Array(await new Blob(buffers).arrayBuffer()), data);
assert.equal(
  (
    await writeDesktopBlob(blob, "cancel.zip", {
      save: async () => null,
      create: () => {
        throw Error("must not create");
      },
    })
  ).status,
  "cancelled",
);
for (const value of [0, NaN, -1, 1.5, 999999]) {
  let done = false;
  await assert.rejects(
    writeDesktopBlob(new Blob(["abc"]), "bad.txt", {
      save: async () => "/chosen",
      create: async () => ({
        write: async () => value,
        close: async () => (done = true),
      }),
    }),
    /不完整文件/,
  );
  assert.equal(done, true);
}
let done = false;
await assert.rejects(
  writeDesktopBlob(blob, "io.zip", {
    save: async () => "/chosen",
    create: async () => ({
      write: async () => {
        throw Error("disk full");
      },
      close: async () => (done = true),
    }),
  }),
  /disk full/,
);
assert.ok(done);
await assert.rejects(
  writeDesktopBlob(new Blob(), "close.zip", {
    save: async () => "/chosen",
    create: async () => ({
      close: async () => {
        throw Error("close failed");
      },
    }),
  }),
  /close failed/,
);
class HugeBlob extends Blob {
  get size() {
    return 513 * 1024 * 1024;
  }
}
await assert.rejects(
  writeDesktopBlob(new HugeBlob(), "huge.zip", adapter),
  /512MiB/,
);
let release,
  dialogs = 0;
const order = [];
const q = createDesktopSaveQueue({
  adapter: {
    save: async () => {
      const i = ++dialogs;
      order.push(i);
      if (i === 1) await new Promise((r) => (release = r));
      return i === 2 ? null : "/chosen";
    },
    create: async () => ({
      write: async (b) => b.byteLength,
      close: async () => {},
    }),
  },
  onStatus: () => {
    throw Error("observer only");
  },
});
const jobs = Array.from({ length: 4 }, (_, i) =>
  q.enqueue(new Blob(["abc"]), `${i}.txt`),
);
await Promise.resolve();
assert.equal(dialogs, 1);
assert.equal(q.pending, 4);
assert.equal((await q.enqueue(new Blob(["x"]), "fifth.txt")).status, "error");
release();
assert.deepEqual(
  (await Promise.all(jobs)).map((r) => r.status),
  ["saved", "cancelled", "saved", "saved"],
);
assert.deepEqual(order, [1, 2, 3, 4]);
assert.equal(q.pending, 0);
assert.equal(q.queuedBytes, 0);
let times = 0;
const recovery = createDesktopSaveQueue({
  adapter: {
    save: async () => "/x",
    create: async () => {
      if (++times === 1) throw Error("create denied");
      return { write: async (b) => b.length, close: async () => {} };
    },
  },
});
assert.equal(
  (await recovery.enqueue(new Blob(["a"]), "a.txt")).status,
  "error",
);
assert.equal(
  (await recovery.enqueue(new Blob(["b"]), "b.txt")).status,
  "saved",
);
console.log(
  "PASS desktop config schema, minimal local capability allowlist, native isolation, name sanitization, exact chunk/partial writes, cancel, failures/close cleanup, queue budget/order/recovery. NOT native Windows execution.",
);

assert.ok(cfg.app.security.csp.includes("style-src-attr 'unsafe-inline'"), "Tauri nonces must not suppress runtime style attributes");

assert.ok(cfg.app.security.csp.includes("style-src-elem 'self' 'unsafe-inline'"), 'Runtime CSS elements must remain available with Tauri CSP nonces');
