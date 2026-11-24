import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("src/service-worker.js", "utf8");
const listeners = {};
const updateCalls = [];
const presentationUpdateCalls = [];
const tabUpdateCalls = [];
const tabMessageCalls = [];
const queriedTabs = [{ id: 42 }, { id: 84 }];
const sessionStorage = {};
let now = 100_000;

class TestDate extends Date {
  static now() {
    return now;
  }
}

const event = (name) => ({
  addListener(listener) {
    listeners[name] = listener;
  },
});
const clone = (value) => structuredClone(value);
const openerWindow = {
  id: 1,
  left: 200,
  top: 100,
  width: 1200,
  height: 800,
  state: "normal",
  tabs: [{ id: 42 }],
};
const pipWindow = {
  id: 9,
  left: 1300,
  top: 700,
  width: 600,
  height: 300,
  state: "normal",
  focused: true,
  alwaysOnTop: true,
  tabs: [{ id: 90, openerTabId: 42 }],
};
const displays = [
  {
    id: "primary",
    isEnabled: true,
    activeState: "active",
    bounds: { left: 0, top: 0, width: 1920, height: 1080 },
    workArea: { left: 0, top: 0, width: 1920, height: 1040 },
  },
  {
    id: "secondary",
    isEnabled: true,
    activeState: "active",
    bounds: { left: -1280, top: 0, width: 1280, height: 1024 },
    workArea: { left: -1280, top: 0, width: 1280, height: 984 },
  },
];

const chrome = {
  runtime: {
    onInstalled: event("installed"),
    onMessage: event("message"),
  },
  action: {
    onClicked: event("actionClicked"),
    setBadgeBackgroundColor: () => Promise.resolve(),
    setBadgeText: () => Promise.resolve(),
    setTitle: () => Promise.resolve(),
    setIcon: () => Promise.resolve(),
  },
  storage: {
    local: {
      remove: () => Promise.resolve(),
    },
    session: {
      async get(key) {
        return key in sessionStorage ? { [key]: clone(sessionStorage[key]) } : {};
      },
      async set(values) {
        Object.assign(sessionStorage, clone(values));
      },
    },
  },
  system: {
    display: {
      getInfo: () => Promise.resolve(clone(displays)),
    },
  },
  tabs: {
    onRemoved: event("tabRemoved"),
    query: () => Promise.resolve(clone(queriedTabs)),
    sendMessage: (...args) => {
      tabMessageCalls.push(clone(args));
      return Promise.resolve();
    },
    update: (tabId, properties) => {
      tabUpdateCalls.push([tabId, clone(properties)]);
      return Promise.resolve({ id: tabId, ...properties });
    },
  },
  webNavigation: {
    getAllFrames: () => Promise.resolve([]),
  },
  windows: {
    onCreated: event("windowCreated"),
    onRemoved: event("windowRemoved"),
    onBoundsChanged: event("windowBoundsChanged"),
    onFocusChanged: event("windowFocusChanged"),
    getAll: () => Promise.resolve(clone([openerWindow, pipWindow])),
    get: (windowId) => Promise.resolve(clone(windowId === openerWindow.id ? openerWindow : pipWindow)),
    async update(windowId, bounds) {
      if (windowId === openerWindow.id) {
        presentationUpdateCalls.push(clone(bounds));
        Object.assign(openerWindow, bounds);
        return clone(openerWindow);
      }
      assert.equal(windowId, pipWindow.id);
      updateCalls.push(clone(bounds));
      if (
        ("left" in bounds || "top" in bounds) &&
        !("width" in bounds) &&
        !("height" in bounds)
      ) {
        // Reproduce the Document PiP platform quirk that caused every
        // position-only extension update to accumulate native frame pixels.
        pipWindow.width += 8;
        pipWindow.height += 8;
      }
      Object.assign(pipWindow, bounds);
      return clone(pipWindow);
    },
  },
};

const fastSetTimeout = (callback, delay = 0, ...args) =>
  setTimeout(callback, Math.min(delay, 5), ...args);

vm.runInNewContext(source, {
  chrome,
  console,
  Date: TestDate,
  Map,
  Number,
  Object,
  Promise,
  Set,
  setTimeout: fastSetTimeout,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 15));

assert.equal(typeof listeners.windowBoundsChanged, "function");
assert.equal(typeof listeners.windowCreated, "function");
assert.equal(typeof listeners.windowRemoved, "function");
assert.equal(typeof listeners.windowFocusChanged, "function");
assert.equal(typeof listeners.message, "function");

listeners.windowCreated({ id: pipWindow.id });
const registeredAt = now;
const registration = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_REGISTER_WINDOW",
      cornerSnapEnabled: true,
      requestedAt: registeredAt,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
await flush();
assert.equal(registration?.registered, true);
assert.deepEqual(
  updateCalls.at(-1),
  { left: 1305, top: 725, width: 600, height: 300 },
  "Every newly registered PiP must open at the selected display's bottom-right with 15px taskbar-aware padding.",
);

const initialPlacementCallCount = updateCalls.length;
listeners.message(
  {
    type: "CAPTION_PIP_REGISTER_WINDOW",
    cornerSnapEnabled: true,
    requestedAt: registeredAt,
  },
  { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
  () => {},
);
await flush();
assert.equal(
  updateCalls.length,
  initialPlacementCallCount,
  "Repeated registration must not fight the user's position after the one-time opening placement.",
);

listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.equal(
  updateCalls.length,
  initialPlacementCallCount,
  "Pinning must be active immediately while a PiP already inside the safe area keeps its free position.",
);

listeners.windowFocusChanged(pipWindow.id);
await flush();
assert.ok(
  tabMessageCalls.some(
    ([tabId, message, options]) =>
      [42, 84].includes(tabId) &&
      message?.type === "CAPTION_PIP_FOCUSED_WHEEL_STATE" &&
      message.enabled === true &&
      options === undefined,
  ),
  "Focusing PiP must arm browser-page wheel relays without requiring pointer hover.",
);

const relayedWheel = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_FOCUSED_WHEEL_INPUT",
      deltaY: -120,
      deltaMode: 0,
    },
    { frameId: 0, tab: { id: 84, windowId: 55 } },
    resolve,
  );
});
assert.equal(
  tabMessageCalls.at(-1)[0],
  42,
  "Wheel input from another regular webpage must be relayed to the focused PiP's source tab.",
);
assert.deepEqual(
  tabMessageCalls.at(-1)[1],
  {
    type: "CAPTION_PIP_FOCUSED_WHEEL_RELAY",
    deltaY: -120,
    deltaMode: 0,
  },
);
assert.deepEqual(tabMessageCalls.at(-1)[2], { frameId: 0 });

listeners.windowFocusChanged(openerWindow.id);
await flush();
const wheelRelayCountAfterBlur = tabMessageCalls.filter(
  ([, message]) => message?.type === "CAPTION_PIP_FOCUSED_WHEEL_RELAY",
).length;
const ignoredWheel = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_FOCUSED_WHEEL_INPUT",
      deltaY: 120,
      deltaMode: 0,
    },
    { frameId: 0, tab: { id: 84, windowId: 55 } },
    resolve,
  );
});
assert.equal(ignoredWheel?.handled, false);
assert.equal(
  tabMessageCalls.filter(
    ([, message]) => message?.type === "CAPTION_PIP_FOCUSED_WHEEL_RELAY",
  ).length,
  wheelRelayCountAfterBlur,
  "Page scrolling must resume as soon as PiP loses focus.",
);
listeners.windowFocusChanged(pipWindow.id);
await flush();

Object.assign(pipWindow, { left: 1312, top: 732 });
listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.deepEqual(
  updateCalls.at(-1),
  { left: 1305, top: 725, width: 600, height: 300 },
  "A pinned PiP must be nudged only far enough to restore 15px of right and bottom padding.",
);

const armingDragUpdateCount = updateCalls.length;
const armingDragStart = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_SURFACE_DRAG_START",
      dragId: "arming-drag",
      pointerX: 100,
      pointerY: 100,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(armingDragStart?.started, true);
const armingDragEnd = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_SURFACE_DRAG_END",
      dragId: "arming-drag",
      pointerX: 100,
      pointerY: 100,
      moved: true,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(armingDragEnd?.ended, true);
assert.equal(
  updateCalls.length,
  armingDragUpdateCount,
  "A released pinned surface already inside the safe area must not be attracted elsewhere.",
);
updateCalls.length = 0;
listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.equal(updateCalls.length, 0, "The committed safe-area position must not recurse.");

Object.assign(pipWindow, { left: 2, top: 3 });
await new Promise((resolve) => {
  listeners.message(
    { type: "CAPTION_PIP_CORNER_SNAP_SET_ENABLED", enabled: false },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.equal(updateCalls.length, 0, "Unpinned PiP must bypass screen-edge padding.");

await new Promise((resolve) => {
  listeners.message(
    { type: "CAPTION_PIP_CORNER_SNAP_SET_ENABLED", enabled: true },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.deepEqual(
  updateCalls.at(-1),
  { left: 15, top: 15, width: 600, height: 300 },
  "Enabling pinning must immediately restore 15px of left and top padding.",
);

const safelyPlacedUpdateCount = updateCalls.length;
Object.assign(pipWindow, { left: 500, top: 300 });
listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.equal(
  updateCalls.length,
  safelyPlacedUpdateCount,
  "Pinning must leave an arbitrary interior position unchanged.",
);

Object.assign(pipWindow, { left: 1510, top: 100, width: 400, height: 260 });
listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.deepEqual(
  updateCalls.at(-1),
  { left: 1505, top: 100, width: 400, height: 260 },
  "Only the violating right coordinate should move.",
);

Object.assign(pipWindow, { left: 100, top: 770, width: 400, height: 260 });
listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.deepEqual(
  updateCalls.at(-1),
  { left: 100, top: 765, width: 400, height: 260 },
  "Only the violating bottom coordinate should move above the taskbar work area.",
);

Object.assign(pipWindow, { left: -1275, top: 5, width: 400, height: 260 });
listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.deepEqual(
  updateCalls.at(-1),
  { left: -1265, top: 15, width: 400, height: 260 },
  "Negative-coordinate displays must enforce the same 15px usable-edge padding.",
);

await new Promise((resolve) => {
  listeners.message(
    { type: "CAPTION_PIP_CORNER_SNAP_SET_ENABLED", enabled: false },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
Object.assign(pipWindow, { left: 400, top: 220, width: 400, height: 260 });
const dragStart = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_SURFACE_DRAG_START",
      dragId: "surface-drag-1",
      pointerX: 100,
      pointerY: 100,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(dragStart?.started, true);
listeners.message(
  {
    type: "CAPTION_PIP_SURFACE_DRAG_MOVE",
    dragId: "surface-drag-1",
    pointerX: 145,
    pointerY: 130,
  },
  { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
  () => {},
);
await flush();
assert.deepEqual(
  updateCalls.at(-1),
  { left: 445, top: 250, width: 400, height: 260 },
  "Dragging must move by the pointer delta while locking the gesture's starting size.",
);
const dragMoveCallCount = updateCalls.length;
listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.equal(
  updateCalls.length,
  dragMoveCallCount,
  "Safe-area enforcement must not fight an in-progress surface drag.",
);
const dragEnd = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_SURFACE_DRAG_END",
      dragId: "surface-drag-1",
      pointerX: 160,
      pointerY: 145,
      moved: true,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(dragEnd?.ended, true);
assert.deepEqual(
  updateCalls.at(-1),
  { left: 460, top: 265, width: 400, height: 260 },
  "An unpinned surface drag must finish at its released position.",
);
assert.deepEqual(
  { width: pipWindow.width, height: pipWindow.height },
  { width: 400, height: 260 },
  "Repeated drag position updates must not accumulate native frame pixels.",
);
const growFromTopLeft = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_SET_SIZE",
      targetInnerWidth: 777,
      aspectInnerWidth: 400,
      aspectInnerHeight: 213,
      frameWidth: 0,
      frameHeight: 34,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(growFromTopLeft?.updated, true);
assert.deepEqual(
  updateCalls.at(-1),
  { left: 460, top: 265, width: 777, height: 448 },
  "Growing near the top-left must keep that screen-nearest corner fixed and expand inward.",
);
assert.deepEqual(
  { horizontal: growFromTopLeft.anchorHorizontal, vertical: growFromTopLeft.anchorVertical },
  { horizontal: "left", vertical: "top" },
);
const growOnePixel = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_SET_SIZE",
      targetInnerWidth: 778,
      aspectInnerWidth: 400,
      aspectInnerHeight: 213,
      frameWidth: 0,
      frameHeight: 34,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(growOnePixel?.updated, true);
assert.deepEqual(
  updateCalls.at(-1),
  { left: 460, top: 265, width: 778, height: 448 },
  "Adjacent wheel targets must produce an exact one-pixel width change without preset steps.",
);

Object.assign(pipWindow, { left: 1128, top: 564, width: 777, height: 448 });
const shrinkFromBottomRight = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_SET_SIZE",
      targetInnerWidth: 603,
      aspectInnerWidth: 400,
      aspectInnerHeight: 213,
      frameWidth: 0,
      frameHeight: 34,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(shrinkFromBottomRight?.updated, true);
assert.deepEqual(
  updateCalls.at(-1),
  { left: 1302, top: 657, width: 603, height: 355 },
  "Shrinking near the bottom-right must keep that screen-nearest corner fixed and contract inward.",
);
assert.deepEqual(
  { horizontal: shrinkFromBottomRight.anchorHorizontal, vertical: shrinkFromBottomRight.anchorVertical },
  { horizontal: "right", vertical: "bottom" },
);
const shrinkToNativeMinimum = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_SET_SIZE",
      targetInnerWidth: 1,
      aspectInnerWidth: 400,
      aspectInnerHeight: 213,
      frameWidth: 0,
      frameHeight: 34,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(shrinkToNativeMinimum?.updated, true);
assert.equal(shrinkToNativeMinimum.minimumInnerWidth, 240);
assert.deepEqual(
  updateCalls.at(-1),
  { left: 1665, top: 850, width: 240, height: 162 },
  "Wheel downsizing must reach Chromium's native 240px minimum inner width.",
);

const growToNativeMaximum = await new Promise((resolve) => {
  listeners.message(
    {
      type: "CAPTION_PIP_SET_SIZE",
      targetInnerWidth: 99_999,
      aspectInnerWidth: 400,
      aspectInnerHeight: 213,
      frameWidth: 0,
      frameHeight: 34,
    },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(growToNativeMaximum?.updated, true);
assert.equal(growToNativeMaximum.maximumInnerWidth, 1536);
assert.deepEqual(
  updateCalls.at(-1),
  { left: 369, top: 160, width: 1536, height: 852 },
  "Wheel upsizing must reach Chromium's native 80%-of-display maximum.",
);
await new Promise((resolve) => {
  listeners.message(
    { type: "CAPTION_PIP_CORNER_SNAP_SET_ENABLED", enabled: true },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});

listeners.windowBoundsChanged({ id: 77, left: 10, top: 10, width: 400, height: 250 });
await flush();
assert.equal(updateCalls.length, 11, "Unregistered browser windows must never move.");

listeners.windowRemoved(pipWindow.id);
await flush();
Object.assign(pipWindow, { left: 1300, top: 700, width: 600, height: 300 });
listeners.windowBoundsChanged(clone(pipWindow));
await flush();
assert.equal(updateCalls.length, 11, "A closed PiP registration must be removed.");

const focusPresentation = await new Promise((resolve) => {
  listeners.message(
    { type: "CAPTION_PIP_FOCUS_PRESENTATION" },
    { frameId: 0, tab: { id: 42, windowId: openerWindow.id } },
    resolve,
  );
});
assert.equal(focusPresentation?.focused, true);
assert.deepEqual(tabUpdateCalls.at(-1), [42, { active: true }]);
assert.deepEqual(presentationUpdateCalls.at(-1), { focused: true });
assert.equal(
  "state" in presentationUpdateCalls.at(-1),
  false,
  "Presentation must focus the opener without fullscreening the normal Chrome window.",
);

console.log("Original-player fullscreen focus handoff validation passed.");

console.log("Non-control PiP surface drag validation passed.");

console.log("Focused-wheel native-range PiP resizing validation passed.");

console.log("Pinned 15px multi-monitor safe-area padding validation passed.");
