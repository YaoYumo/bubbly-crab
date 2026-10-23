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
      "此网关入口仅用于网页版；桌面本地模型请使用“一句话生成”。参考生成网关仍未启用，不扫描本机端口。",
    );
}
