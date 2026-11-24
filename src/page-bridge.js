(() => {
  "use strict";

  const MARKER = "__CAPTION_PIP_PAGE_BRIDGE_V1__";
  const CHANNEL = "caption-pip-netflix-seek";
  if (globalThis[MARKER]) return;
  globalThis[MARKER] = true;

  window.addEventListener(CHANNEL, (event) => {
    if (location.hostname !== "www.netflix.com") return;
    const detail = event.detail;
    if (!detail || detail.type !== "SEEK_TO" || !Number.isFinite(detail.time)) return;

    const player = getNetflixPlayer();
    if (!player?.seek) return;

    try {
      player.seek(Math.max(0, detail.time * 1_000));
    } catch {}
  });

  function getNetflixPlayer() {
    try {
      const videoPlayers = window.netflix?.appContext?.state?.playerApp
        ?.getAPI?.()?.videoPlayer;
      const sessionIds = videoPlayers?.getAllPlayerSessionIds?.() || [];
      const sessionId =
        sessionIds.find((value) => String(value).includes("watch")) || sessionIds[0];
      return sessionId
        ? videoPlayers.getVideoPlayerBySessionId(sessionId)
        : null;
    } catch {
      return null;
    }
  }
})();
