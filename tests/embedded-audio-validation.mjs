import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";

const source = fs.readFileSync(path.join(process.cwd(), "src", "content.js"), "utf8");
const start = source.indexOf("  async function setEmbeddedSourceAudioState");
const end = source.indexOf("\n  function embeddedUiState", start);
if (start < 0 || end < 0) {
  throw new Error("Embedded real-source audio controller could not be located.");
}

const messages = [];
const lastAudibleVolumes = new WeakMap();
const context = vm.createContext({
  setTimeout,
  lastAudibleVolumes,
  clamp(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
  },
  snapshotVideo(video) {
    return {
      paused: video.paused,
      ended: video.ended,
      muted: video.muted,
      volume: video.volume,
    };
  },
  emitBridgeUp(message) {
    messages.push(message);
  },
});
const setEmbeddedSourceAudioState = vm.runInContext(
  `(() => { ${source.slice(start, end)}; return setEmbeddedSourceAudioState; })()`,
  context,
);

function makeVideo({ rejectUnmute = false } = {}) {
  let muted = true;
  const video = {
    paused: false,
    ended: false,
    volume: 0.72,
    get muted() {
      return muted;
    },
    set muted(value) {
      muted = Boolean(value);
      if (!muted && rejectUnmute) video.paused = true;
    },
    play() {
      if (rejectUnmute && !muted) return Promise.reject(new Error("autoplay blocked"));
      video.paused = false;
      return Promise.resolve();
    },
  };
  return video;
}

const acceptedVideo = makeVideo();
await setEmbeddedSourceAudioState("accepted", acceptedVideo, {
  muted: false,
  volume: 0.42,
});
assert.equal(acceptedVideo.muted, false);
assert.equal(acceptedVideo.paused, false);
assert.equal(acceptedVideo.volume, 0.42);
assert.equal(messages.at(-1).accepted, true);
assert.equal(messages.at(-1).state.muted, false);

const blockedVideo = makeVideo({ rejectUnmute: true });
await setEmbeddedSourceAudioState("blocked", blockedVideo, {
  muted: false,
  volume: 0.36,
});
assert.equal(messages.at(-1).accepted, false);
assert.equal(blockedVideo.muted, true);
assert.equal(blockedVideo.paused, false);
assert.equal(blockedVideo.volume, 0.72);

console.log("Embedded real-source audio validation passed.");
