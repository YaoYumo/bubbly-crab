import { isDesktopShell } from "./desktop-runtime.js";
// Native save adapter. No directory traversal, broad fs scope, HTTP or shell access.
// The dialog plugin grants the fs plugin access to the user-selected file only.
const CHUNK = 1024 * 1024;
const MAX_FILE = 512 * 1024 * 1024;
export function safeSaveName(name) {
  const clean = String(name || "previz-export")
    .split(/[\\/]/)
    .at(-1)
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
    .replace(/[ .]+$/g, "")
    .slice(0, 160)
    .replace(/[ .]+$/g, "");
  const value = clean || "previz-export";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
    ? "_" + value
    : value;
}
export async function nativeSaveAdapter() {
  if (!isDesktopShell())
    throw Error(
      "当前仅浏览器前端预检，无法原生保存；请在Windows桌面程序中保存，或使用网页版",
    );
  const [dialog, fs] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  return { save: dialog.save, create: fs.create };
}
export async function writeDesktopBlob(blob, name, adapter) {
  if (!(blob instanceof Blob) || blob.size > MAX_FILE)
    throw Error("桌面单文件保存上限512MiB，请降低导出规格或拆分工程");
  const api = adapter || (await nativeSaveAdapter());
  const filename = safeSaveName(name),
    ext = /\.([a-z0-9]{1,12})$/i.exec(filename)?.[1];
  const path = await api.save({
    title: "保存 PREVIZ LAB 文件",
    defaultPath: filename,
    ...(ext
      ? { filters: [{ name: ext.toUpperCase() + " 文件", extensions: [ext] }] }
      : {}),
  });
  if (path === null) return { status: "cancelled", name: filename, bytes: 0 };
  if (typeof path !== "string" || !path)
    throw Error("保存对话框未返回有效文件路径");
  let file, failure;
  try {
    // create truncates only after the system dialog's overwrite confirmation.
    file = await api.create(path);
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      const data = new Uint8Array(
        await blob.slice(offset, offset + CHUNK).arrayBuffer(),
      );
      let at = 0;
      while (at < data.length) {
        const n = await file.write(data.subarray(at));
        if (!Number.isInteger(n) || n <= 0 || n > data.length - at)
          throw Error("文件写入未完成");
        at += n;
      }
    }
  } catch (e) {
    failure = e;
  } finally {
    if (file)
      try {
        await file.close();
      } catch (e) {
        failure ||= e;
      }
  }
  if (failure)
    throw Error(
      "磁盘保存失败，目标位置可能留下不完整文件：" +
        (failure.message || failure),
    );
  return { status: "saved", name: filename, bytes: blob.size };
}
// Serialize native dialogs/writes and cap queued immutable Blobs. Never fall back
// to browser download after a cancellation or native failure (no hidden second save).
export function createDesktopSaveQueue({ adapter, onStatus = () => {} } = {}) {
  let tail = Promise.resolve(),
    pending = 0,
    bytes = 0;
  const publish = (detail) => {
    try {
      onStatus({ ...detail, pending, queuedBytes: bytes });
    } catch {
      /* observers cannot corrupt writes */
    }
  };
  return {
    get pending() {
      return pending;
    },
    get queuedBytes() {
      return bytes;
    },
    enqueue(blob, name) {
      if (
        !(blob instanceof Blob) ||
        blob.size > MAX_FILE ||
        pending >= 4 ||
        bytes + blob.size > MAX_FILE
      ) {
        const result = {
          status: "error",
          name: safeSaveName(name),
          error: "保存队列已满或文件过大（最多4项／合计512MiB），请等待后重试",
        };
        publish(result);
        return Promise.resolve(result);
      }
      pending++;
      bytes += blob.size;
      publish({ status: "queued", name: safeSaveName(name) });
      const run = async () => {
        let result;
        try {
          publish({ status: "saving", name: safeSaveName(name) });
          result = await writeDesktopBlob(blob, name, adapter);
        } catch (e) {
          result = {
            status: "error",
            name: safeSaveName(name),
            error: e.message || String(e),
          };
        } finally {
          pending--;
          bytes -= blob.size;
        }
        publish(result);
        return result;
      };
      const job = tail.then(run);
      tail = job.then(
        () => undefined,
        () => undefined,
      );
      return job;
    },
  };
}
export const desktopSaves = createDesktopSaveQueue({
  onStatus: (detail) => {
    if (typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent("previz-desktop-save", { detail }));
  },
});
