import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";

const source = fs.readFileSync(path.join(process.cwd(), "src", "content.js"), "utf8");
const guardStart = source.indexOf("  function createNetflixVisibilityPlaybackGuard");
const guardEnd = source.indexOf("\n  function createEmbeddedHandlers", guardStart);
if (guardStart < 0 || guardEnd < 0) {
  throw new Error("Netflix visibility playback guard could not be located.");
}

const guardSource = source.slice(guardStart, guardEnd).trim();
const createNetflixVisibilityPlaybackGuard = vm.runInNewContext(`(${guardSource})`);

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = false) {
    const entry = this.listeners.get(type) || { capture: [], bubble: [] };
    const phase = options === true || options?.capture ? "capture" : "bubble";
    entry[phase].push(listener);
    this.listeners.set(type, entry);
  }

  removeEventListener(type, listener, options = false) {
    const entry = this.listeners.get(type);
    if (!entry) return;
    const phase = options === true || options?.capture ? "capture" : "bubble";
    entry[phase] = entry[phase].filter((candidate) => candidate !== listener);
  }

  dispatch(type) {
    const entry = this.listeners.get(type) || { capture: [], bubble: [] };
    for (const listener of [...entry.capture, ...entry.bubble]) listener({ type, target: this });
  }
}

class FakeVideo extends FakeTarget {
  constructor({ paused = false } = {}) {
    super();
    this.paused = paused;
    this.ended = false;
    this.playCalls = 0;
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    this.dispatch("play");
    return Promise.resolve();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatch("pause");
  }
}

function createEnvironment() {
  const sourceWindow = new FakeTarget();
  sourceWindow.setTimeout = setTimeout;
  sourceWindow.clearTimeout = clearTimeout;
  const sourceDocument = new FakeTarget();
  sourceDocument.defaultView = sourceWindow;
  sourceDocument.hidden = false;
  sourceDocument.focused = true;
  sourceDocument.hasFocus = () => sourceDocument.focused;
  const video = new FakeVideo();
  return { sourceWindow, sourceDocument, video };
}

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

{
  const { sourceWindow, sourceDocument, video } = createEnvironment();
  sourceDocument.addEventListener("visibilitychange", () => video.pause());
  const guard = createNetflixVisibilityPlaybackGuard({
    video,
    sourceDocument,
    isSessionActive: () => true,
  });
  sourceDocument.hidden = true;
  sourceDocument.focused = false;
  sourceDocument.dispatch("visibilitychange");
  await wait(780);
  assert.equal(video.paused, false, "Netflix's tab-hide pause should be recovered.");
  assert.ok(video.playCalls >= 1, "Visibility recovery should issue play at least once.");
  guard.dispose();
  sourceWindow.dispatch("focus");
}

{
  const { sourceWindow, sourceDocument, video } = createEnvironment();
  sourceWindow.addEventListener("blur", () => video.pause());
  const guard = createNetflixVisibilityPlaybackGuard({
    video,
    sourceDocument,
    isSessionActive: () => true,
  });
  sourceDocument.focused = false;
  sourceWindow.dispatch("blur");
  await wait(780);
  assert.equal(video.paused, false, "Netflix's window-blur pause should be recovered.");
  guard.dispose();
}

{
  const { sourceDocument, video } = createEnvironment();
  sourceDocument.addEventListener("visibilitychange", () => video.pause());
  const guard = createNetflixVisibilityPlaybackGuard({
    video,
    sourceDocument,
    isSessionActive: () => true,
  });
  guard.setIntent(false);
  video.pause();
  sourceDocument.hidden = true;
  sourceDocument.focused = false;
  sourceDocument.dispatch("visibilitychange");
  await wait(780);
  assert.equal(video.paused, true, "An explicit PiP pause must not be overridden.");
  assert.equal(video.playCalls, 0, "Explicit pause must suppress visibility recovery.");
  guard.dispose();
}

{
  const { sourceDocument, video } = createEnvironment();
  sourceDocument.addEventListener("visibilitychange", () => video.pause());
  const guard = createNetflixVisibilityPlaybackGuard({
    video,
    sourceDocument,
    isSessionActive: () => true,
  });
  guard.dispose();
  sourceDocument.hidden = true;
  sourceDocument.focused = false;
  sourceDocument.dispatch("visibilitychange");
  await wait(100);
  assert.equal(video.paused, true, "Disposed sessions must not recover playback.");
  assert.equal(video.playCalls, 0, "Disposed sessions must not issue play.");
}

console.log("Netflix visibility playback validation passed.");
