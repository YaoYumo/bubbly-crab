import assert from "node:assert/strict";
import {
  deferRangeRender,
  isRangeInteracting,
} from "../src/range-interaction.js";
const doc = new EventTarget();
doc.defaultView = new EventTarget();
doc.defaultView.CustomEvent = CustomEvent;
const input = new EventTarget();
Object.assign(input, {
  ownerDocument: doc,
  tagName: "INPUT",
  type: "range",
  disabled: false,
  isConnected: true,
});
const host = {
  ownerDocument: doc,
  isConnected: true,
  contains: (node) => node === input,
};
const other = { ownerDocument: doc, isConnected: true, contains: () => false };
let renders = 0,
  otherRenders = 0,
  ended = 0;
input.addEventListener("range-interaction-end", () => ended++);
function render() {
  if (deferRangeRender(host, render)) return;
  renders++;
}
function renderOther() {
  if (deferRangeRender(other, renderOther)) return;
  otherRenders++;
}
function event(name, props = {}) {
  const e = new Event(name);
  Object.assign(e, props);
  e.composedPath = () => [input, doc];
  doc.dispatchEvent(e);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
render();
event("pointerdown", { button: 0, pointerId: 1, isPrimary: true });
for (let i = 0; i < 12; i++) {
  render();
  renderOther();
}
assert.equal(renders, 1);
assert.equal(otherRenders, 12);
assert.equal(isRangeInteracting(input), true);
event("pointerup", { pointerId: 2 });
await settle();
assert.equal(renders, 1);
event("pointerup", { pointerId: 1 });
render(); // native change may follow pointerup
assert.equal(renders, 1);
await settle();
assert.equal(renders, 2);
assert.equal(ended, 1);
for (const termination of ["pointercancel", "lostpointercapture"]) {
  event("pointerdown", { button: 0, pointerId: 3 });
  render();
  event(termination, { pointerId: 3 });
  await settle();
  assert.equal(isRangeInteracting(input), false);
}
event("pointerdown", { button: 0, pointerId: 4 });
render();
doc.defaultView.dispatchEvent(new Event("blur"));
await settle();
assert.equal(isRangeInteracting(input), false);
event("keydown", { key: "ArrowRight" });
event("keydown", { key: "ArrowUp" });
render();
const before = renders;
event("keyup", { key: "ArrowRight" });
await settle();
assert.equal(renders, before);
event("keyup", { key: "ArrowUp" });
await settle();
assert.equal(renders, before + 1);
// A fast next gesture must be protected before the prior gesture's render flushes.
event("pointerdown", { button: 0, pointerId: 5 });
render();
event("pointerup", { pointerId: 5 });
event("pointerdown", { button: 0, pointerId: 6 });
assert.equal(isRangeInteracting(input), true);
const fast = renders;
await settle();
assert.equal(renders, fast);
event("pointerup", { pointerId: 6 });
await settle();
assert.equal(renders, fast + 1);
// Detached panels do not resurrect stale UI when a gesture ends.
event("pointerdown", { button: 0, pointerId: 7 });
render();
host.isConnected = false;
const detached = renders;
event("pointerup", { pointerId: 7 });
await settle();
assert.equal(renders, detached);
console.log(
  "PASS range interaction: scoped/coalesced renders, native-change ordering, pointer IDs, cancel/lost capture/blur, held keyboard keys, fast next gesture, detached panels",
);
