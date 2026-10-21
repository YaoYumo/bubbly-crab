import { DESKTOP_BUILD, isDesktopShell } from "./desktop-runtime.js";
import { desktopSaves } from "./desktop-save.js";
export function desktopCapabilities(app) {
  const gl = app.stage.renderer.getContext();
  return {
    nativeShell: isDesktopShell(),
    secureContext: globalThis.isSecureContext === true,
    webgl: !gl.isContextLost(),
    webglVersion: gl.getParameter(gl.VERSION),
    webCodecs:
      typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined",
    mediaRecorder: typeof MediaRecorder !== "undefined",
    indexedDB: typeof indexedDB !== "undefined",
    fileInput: typeof FileReader !== "undefined",
    cryptoDigest: !!globalThis.crypto?.subtle,
    gateway: "disabled (no bundled BFF)",
  };
}
export async function probeDesktopStorage() {
  if (!globalThis.indexedDB) throw Error("当前WebView不支持IndexedDB");
  const name = "previz-desktop-preflight-" + crypto.randomUUID();
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("probe");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(Error("检查数据库被阻塞"));
    });
    await new Promise((resolve, reject) => {
      const t = db.transaction("probe", "readwrite");
      t.objectStore("probe").put("ok", "check");
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || Error("存储检查取消"));
    });
    const value = await new Promise((resolve, reject) => {
      const r = db.transaction("probe").objectStore("probe").get("check");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (value !== "ok") throw Error("IndexedDB读写不一致");
    return "IndexedDB临时库写入／读回通过（未操作工程库）";
  } finally {
    db?.close();
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = resolve;
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(Error("检查临时库清理被阻塞"));
    });
  }
}
export function installDesktopTools(app) {
  if (!DESKTOP_BUILD) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tb";
  button.dataset.desktopTools = "1";
  button.textContent = "桌面检查";
  button.title = "轻量桌面版：文件保存状态与本机WebView能力";
  document.getElementById("top")?.append(button);
  const status = document.createElement("div");
  status.dataset.desktopSaveStatus = "1";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.style.cssText =
    "display:none;position:fixed;bottom:calc(var(--tl-h,100px) + 12px);left:16px;pointer-events:none;z-index:120;max-width:min(550px,90vw);padding:10px 14px;background:#202536;color:#fff;border-radius:6px;overflow-wrap:anywhere";
  document.body.append(status);
  let statusTimer,
    closeGuard = "未注册（浏览器预检不等于原生验收）";
  window.addEventListener("previz-desktop-save", ({ detail: d }) => {
    clearTimeout(statusTimer);
    status.style.display = "block";
    status.dataset.state = d.status;
    const messages = {
      queued: "文件已加入保存队列",
      saving: "正在选择位置／写入磁盘",
      saved: "文件已写入磁盘",
      cancelled: "已取消磁盘保存（导出结果仍可再次保存）",
      error: "未保存：" + d.error,
    };
    status.textContent = `${messages[d.status]} · ${d.name}${d.pending ? ` · 剩余${d.pending}项，请勿退出` : ""}`;
    if (d.status === "error") app.notify(status.textContent, "warn");
    if (!d.pending && d.status !== "error")
      statusTimer = setTimeout(() => (status.style.display = "none"), 12000);
  });
  if (isDesktopShell())
    import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        await getCurrentWindow().onCloseRequested((event) => {
          if (desktopSaves.pending) {
            event.preventDefault();
            app.notify(
              "文件仍在保存队列中，请完成或取消保存后再关闭窗口",
              "warn",
            );
          }
        });
        closeGuard = "已注册保存队列关闭保护（不拦截系统强制结束进程）";
      })
      .catch((e) => {
        closeGuard = "未注册：" + e.message;
        app.notify("桌面关闭保护未启用；保存期间请勿关闭窗口", "warn");
      });
  button.onclick = () => {
    if (document.querySelector("[data-desktop-panel]")) return;
    const mask = document.createElement("div");
    mask.className = "ai-scene-mask";
    mask.dataset.desktopPanel = "1";
    const panel = document.createElement("section");
    panel.className = "ai-scene-dialog";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "桌面兼容性检查");
    panel.style.cssText = "width:min(680px,94vw);max-height:90vh;overflow:auto";
    const h = document.createElement("h2");
    h.textContent = "PREVIZ LAB · 桌面预检版";
    const note = document.createElement("p");
    note.textContent =
      "Windows WebView2实机尚需验收。此面板不探测模型／端口，不请求外部服务；内置资产和本地编排可离线使用。原生保存需确认系统文件位置。";
    const output = document.createElement("pre");
    output.dataset.desktopCapabilities = "1";
    output.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere";
    output.textContent = JSON.stringify(
      {
        ...desktopCapabilities(app),
        closeGuard,
        pendingSaves: desktopSaves.pending,
      },
      null,
      2,
    );
    const result = document.createElement("p");
    result.setAttribute("role", "status");
    result.dataset.desktopProbeStatus = "1";
    const probe = document.createElement("button");
    probe.type = "button";
    probe.className = "fbtn";
    probe.dataset.desktopProbe = "1";
    probe.textContent = "检查临时存储";
    probe.onclick = async () => {
      probe.disabled = true;
      try {
        result.textContent = await probeDesktopStorage();
      } catch (e) {
        result.textContent = "未通过：" + e.message;
      } finally {
        probe.disabled = false;
      }
    };
    const test = document.createElement("button");
    test.type = "button";
    test.className = "fbtn";
    test.dataset.desktopSaveTest = "1";
    test.textContent = "另存测试文件（需手动确认）";
    test.onclick = async () => {
      if (!isDesktopShell()) {
        result.textContent = "当前仅浏览器预检，不能验收原生保存";
        return;
      }
      test.disabled = true;
      try {
        const r = await desktopSaves.enqueue(
          new Blob([JSON.stringify(desktopCapabilities(app), null, 2)], {
            type: "application/json",
          }),
          "previz-desktop-check.json",
        );
        result.textContent =
          r.status === "saved"
            ? "测试文件已写入磁盘"
            : r.status === "cancelled"
              ? "已取消保存"
              : r.error;
      } finally {
        test.disabled = false;
      }
    };
    const close = document.createElement("button");
    close.type = "button";
    close.className = "fbtn";
    close.textContent = "关闭";
    const previous = document.activeElement;
    const dismiss = () => {
      mask.remove();
      window.removeEventListener("keydown", keys, true);
      if (previous?.isConnected) previous.focus();
    };
    const keys = (e) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
      if (e.key === "Tab") {
        const nodes = [probe, test, close].filter((n) => !n.disabled);
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0].focus();
        }
      }
    };
    close.onclick = dismiss;
    panel.append(h, note, output, result, probe, test, close);
    mask.append(panel);
    document.body.append(mask);
    window.addEventListener("keydown", keys, true);
    probe.focus();
  };
}
