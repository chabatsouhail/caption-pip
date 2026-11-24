import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("src/service-worker.js", "utf8");
const listeners = {};
const sentMessages = [];
const badgeCalls = [];
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
    setBadgeText(details) {
      badgeCalls.push(structuredClone(details));
      return Promise.resolve();
    },
    setTitle: () => Promise.resolve(),
    setIcon: () => Promise.resolve(),
  },
  storage: {
    local: {
      remove: () => Promise.resolve(),
    },
  },
  tabs: {
    onRemoved: event("tabRemoved"),
    sendMessage(tabId, message, options) {
      sentMessages.push({ tabId, message: structuredClone(message), options: structuredClone(options) });
      if (message.type === "CAPTION_PIP_RESERVE_WINDOW") {
        return Promise.resolve({ reserved: false, noVideo: true });
      }
      if (message.type === "CAPTION_PIP_GET_CANDIDATE") {
        return Promise.resolve({ candidate: null });
      }
      return Promise.resolve({});
    },
  },
  webNavigation: {
    getAllFrames: () => Promise.resolve([{ frameId: 0 }]),
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

assert.equal(typeof listeners.actionClicked, "function");
listeners.actionClicked({ id: 47 });
await new Promise((resolve) => setTimeout(resolve, 10));

assert.equal(
  sentMessages.some(({ message }) => message.type === "CAPTION_PIP_CANCEL_RESERVATION"),
  false,
  "No PiP reservation should be opened or cancelled when no video is known.",
);
assert.ok(
  sentMessages.some(({ tabId, message, options }) =>
    tabId === 47 &&
    message.type === "CAPTION_PIP_SHOW_INFORMATION_TOAST" &&
    message.message === "No video is available in this tab." &&
    options.frameId === 0
  ),
  "The top frame should receive the no-video information toast.",
);
assert.equal(
  badgeCalls.some(({ text }) => text === "0"),
  false,
  "The ambiguous zero badge should not be used for the no-video state.",
);

console.log("No-video information toast validation passed.");
