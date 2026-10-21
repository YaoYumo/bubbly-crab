// Build-time isolation: a web page cannot opt into native disk access by setting a flag.
export const DESKTOP_BUILD = import.meta.env?.MODE === "desktop";
export function isDesktopShell() {
  return (
    DESKTOP_BUILD &&
    !!globalThis.isTauri &&
    typeof globalThis.__TAURI_INTERNALS__?.invoke === "function"
  );
}
export function requireWebGateway() {
  if (DESKTOP_BUILD)
    throw Error(
      "轻量桌面版未内置AI／参考生成网关。请使用本地配方、手动蓝图或导出参考ZIP；不会直连模型或扫描本机端口。",
    );
}
