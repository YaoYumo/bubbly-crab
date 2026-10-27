// A range's native drag belongs to its DOM node. Replacing an inspector on each
// input/select/objects notification destroys that drag even if the replacement
// looks identical. Keep live model updates, defer only destructive panel renders.
const documents = new WeakMap();
const rangeKeys = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function controller(doc) {
  if (documents.has(doc)) return documents.get(doc);
  const state = { active: null, pending: new Map() };
  documents.set(doc, state);
  const flush = () => {
    const pending = [...state.pending];
    state.pending.clear();
    for (const [render, host] of pending) if (host.isConnected) render();
  };
  const finish = (session) => {
    if (!session || state.active !== session || session.timer) return;
    // Native change can follow pointerup. Do not remove the control before its
    // final value/commit handlers have run, including controls with commit:true.
    session.timer = setTimeout(() => {
      if (state.active !== session) return;
      state.active = null;
      try {
        if (session.input.isConnected)
          session.input.dispatchEvent(
            new doc.defaultView.CustomEvent("range-interaction-end"),
          );
      } finally {
        flush();
      }
    }, 0);
  };
  const range = (event) =>
    event
      .composedPath()
      .find((n) => n?.tagName === "INPUT" && n.type === "range");
  const start = (input, mode, pointerId) => {
    const old = state.active;
    if (old && !old.timer)
      return old.input === input && old.mode === mode ? old : null;
    if (old?.timer) clearTimeout(old.timer);
    const session = (state.active = {
      input,
      mode,
      pointerId,
      keys: new Set(),
      timer: null,
    });
    // Rapid successive gestures can start before a queued release render. The
    // new control is protected before those renders run as well.
    if (old) flush();
    return session;
  };
  doc.addEventListener(
    "pointerdown",
    (event) => {
      const input = range(event);
      if (
        input &&
        !input.disabled &&
        event.button === 0 &&
        event.isPrimary !== false
      )
        start(input, "pointer", event.pointerId);
    },
    true,
  );
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    doc.addEventListener(
      name,
      (event) => {
        const session = state.active;
        if (
          session?.mode === "pointer" &&
          session.pointerId === event.pointerId
        )
          finish(session);
      },
      true,
    );
  doc.addEventListener(
    "keydown",
    (event) => {
      const input = range(event);
      if (!input || input.disabled || !rangeKeys.has(event.key)) return;
      start(input, "keyboard")?.keys.add(event.key);
    },
    true,
  );
  doc.addEventListener(
    "keyup",
    (event) => {
      const session = state.active;
      if (session?.mode !== "keyboard") return;
      session.keys.delete(event.key);
      if (!session.keys.size) finish(session);
    },
    true,
  );
  doc.addEventListener(
    "focusout",
    (event) => {
      const session = state.active;
      if (session?.mode === "keyboard" && session.input === event.target)
        finish(session);
    },
    true,
  );
  doc.defaultView.addEventListener("blur", () => finish(state.active));
  return state;
}

export function isRangeInteracting(input) {
  return controller(input.ownerDocument).active?.input === input;
}

/** Call at the beginning of any panel render that replaces its form subtree. */
export function deferRangeRender(host, render) {
  const state = controller(host.ownerDocument),
    input = state.active?.input;
  if (input && host.contains(input)) {
    state.pending.set(render, host);
    return true;
  }
  state.pending.delete(render);
  return false;
}
