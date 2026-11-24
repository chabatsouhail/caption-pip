import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("src/page-bridge.js", "utf8");

const netflix = createBridge("www.netflix.com");
netflix.dispatch({ type: "SEEK_TO", time: 123.456 });
assert.deepEqual(netflix.seeks, [123_456]);

netflix.dispatch({ type: "SEEK_TO", time: -10 });
assert.deepEqual(netflix.seeks, [123_456, 0]);

netflix.dispatch({ type: "SEEK_TO", time: Number.NaN });
netflix.dispatch({ type: "IGNORED", time: 5 });
assert.deepEqual(netflix.seeks, [123_456, 0]);

const otherSite = createBridge("example.com");
otherSite.dispatch({ type: "SEEK_TO", time: 50 });
assert.deepEqual(otherSite.seeks, []);

console.log("Netflix main-world seek bridge validation passed.");

function createBridge(hostname) {
  let listener = null;
  const seeks = [];
  const player = { seek: (time) => seeks.push(time) };
  const videoPlayer = {
    getAllPlayerSessionIds: () => ["preview-session", "watch-session"],
    getVideoPlayerBySessionId: (sessionId) =>
      sessionId === "watch-session" ? player : null,
  };
  const context = {
    location: { hostname },
    netflix: {
      appContext: {
        state: {
          playerApp: {
            getAPI: () => ({ videoPlayer }),
          },
        },
      },
    },
    window: null,
  };
  context.window = context;
  context.addEventListener = (type, callback) => {
    if (type === "caption-pip-netflix-seek") listener = callback;
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof listener, "function");
  return {
    seeks,
    dispatch: (detail) => listener({ detail }),
  };
}
