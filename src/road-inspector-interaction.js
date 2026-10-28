// Road property commits temporarily enter/leave the path editor and emit many
// events. Coalesce those intermediate renders and retain the actual focused DOM
// node while typing/spinning numbers or moving between road fields.
const states = new WeakMap();
export function deferRoadInspectorRender(app, host, render) {
  let state = states.get(host);
  if (!state) {
    state = { pending: false, queued: false };
    states.set(host, state);
    host.addEventListener("focusout", () =>
      setTimeout(() => {
        if (state.pending && host.isConnected) {
          state.pending = false;
          render();
        }
      }, 0),
    );
  }
  if (app._roadPropertyCommit) {
    if (!state.queued) {
      state.queued = true;
      queueMicrotask(() => {
        state.queued = false;
        if (host.isConnected) render();
      });
    }
    return true;
  }
  const token = app.roadBrush?.active ? "draft" : app.selObj?.id;
  const input = host.ownerDocument.activeElement,
    road = app.selObj?.type === "road_brush" || app.roadBrush?.active;
  if (
    state.token === token &&
    road &&
    host.contains(input) &&
    input.matches("input[type=number],select") &&
    (app.roadBrush?.active ||
      input.closest(
        ".road-section-controls,.road-elevation-controls,[data-road-terrain],[data-road-lighting],[data-road-property]",
      ))
  ) {
    state.pending = true;
    return true;
  }
  if (road && state.token === token) {
    const body = host.querySelector(".ibody"),
      top = body?.scrollTop || 0;
    const folds = new Map(
      [...host.querySelectorAll(".sec")].map((s) => [
        s.querySelector(".sec-h b")?.textContent,
        s.classList.contains("closed"),
      ]),
    );
    const version = (state.version = (state.version || 0) + 1);
    queueMicrotask(() => {
      if (version !== state.version || !host.isConnected) return;
      for (const s of host.querySelectorAll(".sec")) {
        const title = s.querySelector(".sec-h b")?.textContent;
        if (!folds.has(title)) continue;
        const closed = folds.get(title);
        s.classList.toggle("closed", closed);
        const caret = s.querySelector(".caret");
        if (caret) caret.textContent = closed ? "▸" : "▾";
      }
      if (body) body.scrollTop = top;
    });
  } else state.version = (state.version || 0) + 1;
  state.pending = false;
  state.token = token;
  return false;
}
