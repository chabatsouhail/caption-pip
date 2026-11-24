import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("src/service-worker.js", "utf8");
const lightIconBytes = fs.readFileSync("icons/icon-16.png");
const darkIconBytes = fs.readFileSync("icons/dark/icon-16.png");
assert.equal(lightIconBytes.equals(darkIconBytes), false);
const listeners = {};
const iconCalls = [];
const event = (name) => ({
  addListener(listener) {
    listeners[name] = listener;
  },
});

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
    setIcon(details) {
      iconCalls.push(structuredClone(details));
      return Promise.resolve();
    },
  },
  storage: {
    local: {
      remove: () => Promise.resolve(),
    },
  },
  tabs: {
    onRemoved: event("tabRemoved"),
    sendMessage: () => Promise.resolve(),
  },
  webNavigation: {
    getAllFrames: () => Promise.resolve([]),
  },
};

vm.runInNewContext(source, {
  chrome,
  console,
  Map,
  Number,
  Object,
  Promise,
  setTimeout,
});

assert.equal(typeof listeners.message, "function");

listeners.message(
  { type: "CAPTION_PIP_TOOLBAR_THEME", theme: "dark" },
  { tab: { id: 42 }, frameId: 0 },
);
assert.deepEqual(iconCalls.at(-1), {
  tabId: 42,
  path: {
    16: "icons/dark/icon-16.png",
    32: "icons/dark/icon-32.png",
    48: "icons/dark/icon-48.png",
  },
});

listeners.message(
  { type: "CAPTION_PIP_TOOLBAR_THEME", theme: "light" },
  { tab: { id: 42 }, frameId: 0 },
);
assert.deepEqual(iconCalls.at(-1), {
  tabId: 42,
  path: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
  },
});

listeners.message(
  { type: "CAPTION_PIP_TOOLBAR_THEME", theme: "unexpected" },
  { tab: { id: 7 }, frameId: 0 },
);
assert.deepEqual(iconCalls.at(-1), {
  tabId: 7,
  path: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
  },
});

const callCount = iconCalls.length;
listeners.message(
  { type: "CAPTION_PIP_TOOLBAR_THEME", theme: "dark" },
  {},
);
assert.equal(iconCalls.length, callCount);

const themeIconSource = fs.readFileSync("src/theme-icon.js", "utf8");
const themeMessages = [];
const themeListeners = {};
let darkTheme = false;
const colorScheme = {
  get matches() {
    return darkTheme;
  },
  addEventListener(name, listener) {
    themeListeners[name] = listener;
  },
};
const themeWindow = {
  matchMedia(query) {
    assert.equal(query, "(prefers-color-scheme: dark)");
    return colorScheme;
  },
  addEventListener(name, listener) {
    themeListeners[name] = listener;
  },
};
themeWindow.top = themeWindow;
const themeContext = {
  window: themeWindow,
  chrome: {
    runtime: {
      sendMessage(message) {
        themeMessages.push(structuredClone(message));
        return Promise.resolve();
      },
    },
  },
  Promise,
};

vm.runInNewContext(themeIconSource, themeContext);
assert.deepEqual(themeMessages.at(-1), {
  type: "CAPTION_PIP_TOOLBAR_THEME",
  theme: "light",
});

darkTheme = true;
themeListeners.change();
assert.deepEqual(themeMessages.at(-1), {
  type: "CAPTION_PIP_TOOLBAR_THEME",
  theme: "dark",
});

darkTheme = false;
themeListeners.pageshow();
assert.deepEqual(themeMessages.at(-1), {
  type: "CAPTION_PIP_TOOLBAR_THEME",
  theme: "light",
});

const guardedMessageCount = themeMessages.length;
vm.runInNewContext(themeIconSource, themeContext);
assert.equal(themeMessages.length, guardedMessageCount);

console.log("Theme-aware toolbar icon validation passed.");
