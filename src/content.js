(() => {
  "use strict";

  const GLOBAL_GUARD = "__captionPipContentScriptV1";
  if (globalThis[GLOBAL_GUARD]) return;
  globalThis[GLOBAL_GUARD] = true;

  const RESERVE_PIP_MESSAGE = "CAPTION_PIP_RESERVE_WINDOW";
  const CANDIDATE_MESSAGE = "CAPTION_PIP_GET_CANDIDATE";
  const OPEN_CANDIDATE_MESSAGE = "CAPTION_PIP_OPEN_CANDIDATE";
  const CANCEL_RESERVATION_MESSAGE = "CAPTION_PIP_CANCEL_RESERVATION";
  const SHOW_INFORMATION_TOAST_MESSAGE = "CAPTION_PIP_SHOW_INFORMATION_TOAST";
  const REGISTER_PIP_WINDOW_MESSAGE = "CAPTION_PIP_REGISTER_WINDOW";
  const SET_PIP_SIZE_MESSAGE = "CAPTION_PIP_SET_SIZE";
  const FOCUSED_PIP_WHEEL_STATE_QUERY_MESSAGE = "CAPTION_PIP_FOCUSED_WHEEL_STATE_QUERY";
  const FOCUSED_PIP_WHEEL_STATE_MESSAGE = "CAPTION_PIP_FOCUSED_WHEEL_STATE";
  const FOCUSED_PIP_WHEEL_INPUT_MESSAGE = "CAPTION_PIP_FOCUSED_WHEEL_INPUT";
  const FOCUSED_PIP_WHEEL_RELAY_MESSAGE = "CAPTION_PIP_FOCUSED_WHEEL_RELAY";
  const CORNER_SNAP_SET_ENABLED_MESSAGE = "CAPTION_PIP_CORNER_SNAP_SET_ENABLED";
  const PIP_SURFACE_DRAG_START_MESSAGE = "CAPTION_PIP_SURFACE_DRAG_START";
  const PIP_SURFACE_DRAG_MOVE_MESSAGE = "CAPTION_PIP_SURFACE_DRAG_MOVE";
  const PIP_SURFACE_DRAG_END_MESSAGE = "CAPTION_PIP_SURFACE_DRAG_END";
  const FOCUS_PRESENTATION_MESSAGE = "CAPTION_PIP_FOCUS_PRESENTATION";
  const BRIDGE_MARKER = "__CAPTION_PIP_FRAME_BRIDGE_V1__";
  const NETFLIX_SEEK_CHANNEL = "caption-pip-netflix-seek";
  const TARGET_RETRY_INTERVAL = 350;
  const TARGET_RETRY_LIMIT = 24;
  const CAPTURE_CONNECT_TIMEOUT = 5_000;
  const ICE_GATHER_TIMEOUT = 1_800;
  const CONTROL_HIDE_DELAY = 2_300;
  const CONTROL_LEAVE_GRACE = 900;
  const CONTROL_POINTER_THROTTLE = 90;
  const PIP_MAX_SCREEN_WIDTH_RATIO = 0.3;
  const DOCUMENT_PIP_MIN_INNER_WIDTH = 240;
  const DOCUMENT_PIP_MIN_INNER_HEIGHT = 52;
  const DOCUMENT_PIP_MAX_SCREEN_RATIO = 0.8;
  const WHEEL_RESIZE_PIXEL_FACTOR = 0.25;
  const WHEEL_RESIZE_MAX_DELTA = 80;
  const PIP_RESIZE_SETTLE_DELAY = 140;
  const PIP_PIXEL_ALIGN_SEARCH_RADIUS = 32;
  const DEFAULT_PIP_TOP_BAR_HEIGHT = 34;
  const MAX_PIP_FRAME_INSET = 256;
  const PIP_REQUEST_FRAME_STORAGE_KEY = "captionPipRequestFrameV1";
  const IS_GOOGLE_CHROME_BROWSER = detectGoogleChromeBrowser();
  const DEFAULT_PIP_REQUEST_FRAME = Object.freeze({
    width: 0,
    height: IS_GOOGLE_CHROME_BROWSER ? DEFAULT_PIP_TOP_BAR_HEIGHT : 0,
  });
  const DEFAULT_PIP_NATIVE_FRAME = Object.freeze({
    width: 0,
    height: DEFAULT_PIP_TOP_BAR_HEIGHT,
  });
  const SUBTITLE_VISIBILITY_STORAGE_PREFIX = "captionPipSubtitleVisibilityV1.";
  const CORNER_SNAP_ENABLED_STORAGE_KEY = "captionPipCornerSnapEnabled";
  const DEFAULT_SETTINGS = Object.freeze({
    font: "system",
    size: 24,
    color: "#ffffff",
    textOpacity: 1,
    background: "#000000",
    backgroundOpacity: 0.72,
    weight: 700,
    edge: "none",
    position: "bottom",
  });

  const FONT_FAMILIES = Object.freeze({
    system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    sans: "Arial, Helvetica, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
    rounded: "'Trebuchet MS', 'Arial Rounded MT Bold', system-ui, sans-serif",
  });

  const CAPTION_EDGE_STYLES = Object.freeze({
    shadow: "0 1px 2px rgba(0,0,0,.92), 0 0 5px rgba(0,0,0,.5)",
    raised: "-1px -1px 0 rgba(255,255,255,.42), 1px 1px 0 rgba(0,0,0,.95), 0 2px 3px rgba(0,0,0,.55)",
    none: "none",
  });

  const PIP_MEDIA_GEOMETRY = Object.freeze([
    ["position", "absolute"],
    ["inset", "auto"],
    ["left", "0"],
    ["top", "0"],
    ["right", "auto"],
    ["bottom", "auto"],
    ["display", "block"],
    ["box-sizing", "border-box"],
    ["width", "100%"],
    ["height", "100%"],
    ["min-width", "0"],
    ["min-height", "0"],
    ["max-width", "none"],
    ["max-height", "none"],
    ["margin", "0"],
    ["padding", "0"],
    ["border", "0"],
    ["object-fit", "var(--cp-media-fit, contain)"],
    ["object-position", "0 0"],
    ["transform", "none"],
    ["transform-origin", "0 0"],
    ["translate", "none"],
    ["scale", "none"],
    ["rotate", "none"],
    ["clip-path", "none"],
    ["background", "#050507"],
    ["z-index", "1"],
  ]);

  const SPECIFIC_CAPTION_SELECTORS = [
    ".ytp-caption-segment",
    ".ytp-caption-window-container",
    ".player-timedtext-text-container",
    ".player-timedtext",
    ".vjs-text-track-cue",
    ".jw-text-track-cue",
    ".jw-text-track-display",
    ".plyr__caption",
    ".captions-display",
    ".subtitles-container",
    ".subtitle-container",
    "[data-testid*='caption' i]",
    "[data-testid*='subtitle' i]",
    "[class*='timedtext' i]",
  ];

  const GENERIC_CAPTION_SELECTORS = [
    "[class*='caption' i]",
    "[class*='subtitle' i]",
    "[aria-live='assertive']",
    "[aria-live='polite']",
  ];

  let activeSession = null;
  let targetSession = null;
  let pipReservation = null;
  let cachedSettings = { ...DEFAULT_SETTINGS };
  let cachedCornerSnapEnabled = true;
  let cachedPipRequestFrame = { ...DEFAULT_PIP_REQUEST_FRAME };
  let focusedPipWheelCaptureEnabled = false;
  let saveSettingsTimer = 0;
  let settingsDirty = false;
  let settingsSaveRevision = 0;

  const routedFrameStyles = new Map();
  const embeddedCandidateHints = new Map();
  const lastAudibleVolumes = new WeakMap();

  const settingsReady = chrome.storage.local
    .get({
      subtitleSettings: DEFAULT_SETTINGS,
      [CORNER_SNAP_ENABLED_STORAGE_KEY]: true,
      [PIP_REQUEST_FRAME_STORAGE_KEY]: DEFAULT_PIP_REQUEST_FRAME,
    })
    .then((stored) => {
      cachedSettings = normalizeSettings(stored.subtitleSettings);
      cachedCornerSnapEnabled = stored[CORNER_SNAP_ENABLED_STORAGE_KEY] !== false;
      cachedPipRequestFrame = normalizePipFrameInsets(
        stored[PIP_REQUEST_FRAME_STORAGE_KEY],
        DEFAULT_PIP_REQUEST_FRAME,
      );
    })
    .catch(() => {});

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.subtitleSettings && !settingsDirty) {
      cachedSettings = normalizeSettings(changes.subtitleSettings.newValue);
    }
    if (changes[CORNER_SNAP_ENABLED_STORAGE_KEY]) {
      cachedCornerSnapEnabled = changes[CORNER_SNAP_ENABLED_STORAGE_KEY].newValue !== false;
      activeSession?.ui?.setCornerSnapEnabled?.(cachedCornerSnapEnabled);
    }
    if (changes[PIP_REQUEST_FRAME_STORAGE_KEY]) {
      cachedPipRequestFrame = normalizePipFrameInsets(
        changes[PIP_REQUEST_FRAME_STORAGE_KEY].newValue,
        DEFAULT_PIP_REQUEST_FRAME,
      );
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === FOCUSED_PIP_WHEEL_STATE_MESSAGE) {
      focusedPipWheelCaptureEnabled = message.enabled === true;
      sendResponse({ enabled: focusedPipWheelCaptureEnabled });
      return;
    }
    if (message?.type === FOCUSED_PIP_WHEEL_RELAY_MESSAGE && isTopFrame()) {
      const handled = activeSession?.ui?.resizeFromRelayedWheel?.(message) === true;
      sendResponse({ handled });
      return;
    }
    if (message?.type === RESERVE_PIP_MESSAGE && isTopFrame()) {
      reservePipWindow(message.aspect).then(sendResponse);
      return true;
    }
    if (message?.type === CANDIDATE_MESSAGE) {
      sendResponse({ candidate: getBestVideoCandidate() });
      return;
    }
    if (message?.type === OPEN_CANDIDATE_MESSAGE) {
      const video = locateVideo(message.video || {});
      if (!video || !isUsableVideo(video)) {
        sendResponse({ started: false });
        return;
      }
      beginForVideo(video);
      sendResponse({ started: true });
      return;
    }
    if (message?.type === CANCEL_RESERVATION_MESSAGE && isTopFrame()) {
      cancelPipReservation();
      sendResponse({ cancelled: true });
      return;
    }
    if (message?.type === SHOW_INFORMATION_TOAST_MESSAGE && isTopFrame()) {
      showToast(message.message || "No video is available in this tab.", 2_600, "info");
      sendResponse({ shown: true });
      return;
    }
    if (
      message?.type === "CAPTION_PIP_EMBEDDED_STATUS" &&
      isTopFrame() &&
      activeSession?.kind === "embedded" &&
      message.status?.sessionId === activeSession.id
    ) {
      handleEmbeddedStatus(activeSession, message.status, true);
    }
  });

  window.addEventListener("message", handleFrameBridgeMessage);
  window.addEventListener("wheel", captureFocusedPipWheel, {
    capture: true,
    passive: false,
  });
  chrome.runtime
    .sendMessage({ type: FOCUSED_PIP_WHEEL_STATE_QUERY_MESSAGE })
    .then((response) => {
      focusedPipWheelCaptureEnabled = response?.enabled === true;
    })
    .catch(() => {});
  for (const eventName of ["loadedmetadata", "play", "pause", "emptied", "ended"]) {
    document.addEventListener(eventName, scheduleCandidateHint, true);
  }
  window.addEventListener("resize", scheduleCandidateHint);
  window.setTimeout(publishCandidateHint, 0);
  window.setTimeout(publishCandidateHint, 750);
  window.setTimeout(publishCandidateHint, 2_000);
  if (!isTopFrame() && document.documentElement) {
    const candidateHintObserver = new MutationObserver(scheduleCandidateHint);
    candidateHintObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
  window.addEventListener("pagehide", () => {
    persistSettingsNow();
    cancelPipReservation();
    stopTargetSession();
  });

  function isTopFrame() {
    return window.top === window;
  }

  function captureFocusedPipWheel(event) {
    if (
      !focusedPipWheelCaptureEnabled ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      !Number.isFinite(Number(event.deltaY)) ||
      Number(event.deltaY) === 0
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    sendRuntime({
      type: FOCUSED_PIP_WHEEL_INPUT_MESSAGE,
      deltaY: Number(event.deltaY),
      deltaMode: Number(event.deltaMode) || 0,
    });
  }

  function getBestVideoCandidate() {
    const videos = collectDeep(document, "video").filter(isUsableVideo);
    let best = null;
    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, innerWidth) - Math.max(rect.left, 0),
      );
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0),
      );
      const visibleArea = visibleWidth * visibleHeight;
      const totalArea = Math.max(1, rect.width * rect.height);
      const visibilityRatio = visibleArea / totalArea;
      const playing = !video.paused && !video.ended;
      const audible = playing && !video.muted && video.volume > 0;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const centerDistance = Math.hypot(
        centerX - innerWidth / 2,
        centerY - innerHeight / 2,
      );
      const centerBonus = Math.max(0, 10_000 - centerDistance * 10);
      const score =
        visibleArea * (playing ? 1.65 : 1) * (audible ? 1.12 : 1) +
        (visibleArea > 0 ? 100_000 : 0) +
        visibilityRatio * 10_000 +
        centerBonus +
        (video.readyState >= 2 ? 2_000 : 0) +
        (video.currentTime > 0 ? 1_000 : 0);
      if (!best || score > best.score) best = { video, score, visibleArea };
    }

    if (!best) return null;
    return {
      video: describeVideo(best.video),
      score: Math.round(best.score),
      visibleArea: Math.round(best.visibleArea),
      playing: !best.video.paused && !best.video.ended,
      aspect: getVideoAspect(best.video),
    };
  }

  let candidateHintTimer = 0;
  function scheduleCandidateHint() {
    clearTimeout(candidateHintTimer);
    candidateHintTimer = window.setTimeout(publishCandidateHint, 100);
  }

  function publishCandidateHint() {
    if (isTopFrame()) return;
    window.parent.postMessage(
      {
        [BRIDGE_MARKER]: true,
        type: "CANDIDATE_HINT",
        path: [],
        candidate: getBestVideoCandidate(),
      },
      "*",
    );
  }

  function getReservationAspect(requestedAspect) {
    const candidates = [];
    const localCandidate = getBestVideoCandidate();
    if (localCandidate) {
      candidates.push({ ...localCandidate, score: Number(localCandidate.score) + 25_000 });
    }
    for (const hint of embeddedCandidateHints.values()) {
      if (!hint.candidate || !locateIframe(hint.path[0])) continue;
      candidates.push(hint.candidate);
    }
    const selected = candidates.sort(
      (first, second) => Number(second.score) - Number(first.score),
    )[0];
    if (!selected) return null;

    const explicitAspect = Number(requestedAspect);
    if (Number.isFinite(explicitAspect) && explicitAspect > 0) return explicitAspect;
    return selected.aspect || 16 / 9;
  }

  function isUsableVideo(video) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    return (
      rect.width >= 80 &&
      rect.height >= 45 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0
    );
  }

  async function reservePipWindow(aspect) {
    if (activeSession?.pipWindow && !activeSession.pipWindow.closed) {
      activeSession.pipWindow.focus?.();
      return { active: true };
    }
    if (pipReservation?.pipWindow && !pipReservation.pipWindow.closed) {
      pipReservation.pipWindow.focus?.();
      return { reserved: true };
    }

    cancelPipReservation();
    const reservationAspect = getReservationAspect(aspect);
    if (!reservationAspect) return { reserved: false, noVideo: true };

    try {
      const pipWindow = await requestPipWindow(reservationAspect);
      createPipReservation(pipWindow, reservationAspect);
      renderPipReservationStatus(pipWindow);
      return { reserved: true };
    } catch (error) {
      const message = readablePipError(error);
      showToast(`Picture-in-Picture could not open: ${message}`, 5_000, "info");
      return { reserved: false, error: message };
    }
  }

  function createPipReservation(pipWindow, aspect) {
    const reservation = {
      pipWindow,
      aspect: normalizePipAspect(aspect),
      timeout: 0,
      onPageHide: null,
    };
    reservation.onPageHide = () => {
      if (pipReservation !== reservation) return;
      window.clearTimeout(reservation.timeout);
      pipReservation = null;
    };
    reservation.timeout = window.setTimeout(() => {
      if (pipReservation === reservation) cancelPipReservation();
    }, 10_000);
    pipReservation = reservation;
    pipWindow.addEventListener("pagehide", reservation.onPageHide, { once: true });
    return reservation;
  }

  function renderPipReservationStatus(pipWindow) {
    const doc = pipWindow.document;
    doc.title = "Caption PiP";
    doc.body.replaceChildren();
    for (const node of [doc.documentElement, doc.body]) {
      node.style.setProperty("width", "100%", "important");
      node.style.setProperty("height", "100%", "important");
      node.style.setProperty("margin", "0", "important");
      node.style.setProperty("overflow", "hidden", "important");
      node.style.setProperty("background", "#050507", "important");
    }
    const style = doc.createElement("style");
    style.setAttribute("data-caption-pip-reservation-style", "");
    style.textContent =
      "html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#050507;color:#fff}" +
      "body{font:600 12px system-ui,sans-serif}" +
      ".cp-reserving{position:fixed;inset:0;display:grid;place-content:center;justify-items:center;gap:9px;color:rgba(255,255,255,.78)}" +
      ".cp-reserving svg{display:block;width:26px!important;height:26px!important;min-width:26px!important;min-height:26px!important;max-width:26px!important;max-height:26px!important;animation:cp-reserving-spin .8s linear infinite}" +
      "@keyframes cp-reserving-spin{to{transform:rotate(360deg)}}" +
      "@media(prefers-reduced-motion:reduce){.cp-reserving svg{animation:none}}";
    const status = doc.createElement("div");
    status.className = "cp-reserving";
    status.style.cssText =
      "position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;" +
      "margin:0!important;padding:0!important;display:flex!important;flex-direction:column!important;" +
      "align-items:center!important;justify-content:center!important;gap:9px!important;" +
      "transform:none!important;box-sizing:border-box!important;";
    const loader = createTablerIcon(doc, "loader-2");
    loader.setAttribute("width", "26");
    loader.setAttribute("height", "26");
    loader.style.setProperty("width", "26px", "important");
    loader.style.setProperty("height", "26px", "important");
    const label = doc.createElement("span");
    label.textContent = "Loading...";
    status.append(loader, label);
    status.setAttribute("role", "status");
    doc.head.append(style);
    doc.body.append(status);
  }

  function takePipReservation() {
    const reservation = pipReservation;
    if (!reservation?.pipWindow || reservation.pipWindow.closed) {
      pipReservation = null;
      return null;
    }

    pipReservation = null;
    window.clearTimeout(reservation.timeout);
    reservation.pipWindow.removeEventListener("pagehide", reservation.onPageHide);
    reservation.pipWindow.document
      .querySelector("[data-caption-pip-reservation-style]")
      ?.remove();
    return reservation.pipWindow;
  }

  function cancelPipReservation() {
    const reservation = pipReservation;
    if (!reservation) return;
    pipReservation = null;
    window.clearTimeout(reservation.timeout);
    reservation.pipWindow.removeEventListener("pagehide", reservation.onPageHide);
    if (!reservation.pipWindow.closed) reservation.pipWindow.close();
  }

  function beginForVideo(video) {
    if (activeSession) {
      showToast("A Caption PiP window is already open.");
      activeSession.pipWindow?.focus?.();
      return;
    }

    if (isTopFrame()) {
      beginDirectSession(video);
      return;
    }

    const request = {
      [BRIDGE_MARKER]: true,
      type: "REQUEST_EMBEDDED_PIP",
      sessionId: createSessionId(),
      path: [],
      video: describeVideo(video),
      state: snapshotVideo(video),
    };
    window.parent.postMessage(request, "*");
  }

  async function beginDirectSession(video) {
    const aspect = getVideoAspect(video);
    let pipWindow = takePipReservation();
    if (!pipWindow) {
      try {
        pipWindow = await requestPipWindow(aspect);
      } catch (error) {
        await tryNativePip(video, readablePipError(error));
        return;
      }
    }
    await preparePipOpening(pipWindow, aspect);
    await settingsReady;
    const captionPreference = await loadCaptionPreference(describeVideo(video), []);

    const original = rememberNodeLocation(video);
    const originalStyle = video.getAttribute("style");
    const originalControls = video.hasAttribute("controls");
    const stopPip = () => pipWindow.close();
    const placeholder = createFlowPlaceholder(video, stopPip, { visual: false });
    const cover = createCoverPlaceholder(placeholder, stopPip);
    const initialState = snapshotVideo(video);
    const ui = createPipUi(
      pipWindow,
      initialState,
      captionPreference,
      cachedCornerSnapEnabled,
    );
    ui.setWheelResizeReady?.(aspect);
    const session = {
      kind: "direct",
      id: createSessionId(),
      pipWindow,
      video,
      original,
      originalStyle,
      originalControls,
      placeholder,
      cover,
      ui,
      finished: false,
      disposers: [],
    };
    activeSession = session;
    prepareVideoForPip(video);
    ui.stage.append(video);
    session.disposers.push(lockPipMediaGeometry(video));
    await refreshPipMediaCompositor(pipWindow, video);
    session.disposers.push(
      createPipMediaResizeStabilizer(pipWindow, ui.stage, () => getVideoAspect(video)),
    );
    const netflixVisibilityGuard = location.hostname === "www.netflix.com"
      ? createNetflixVisibilityPlaybackGuard({
          video,
          sourceDocument: original.document,
          isSessionActive: () => activeSession === session && !session.finished,
        })
      : null;
    if (netflixVisibilityGuard) {
      session.disposers.push(() => netflixVisibilityGuard.dispose());
    }

    const captionMonitor = createCaptionMonitor({
      video,
      sourceDocument: original.document,
      referenceElement: cover,
      onUpdate: ({ text }) => {
        ui.setCaptionState(text);
      },
    });
    session.disposers.push(() => captionMonitor.stop());

    const updateState = () => ui.setState(snapshotVideo(video));
    for (const eventName of [
      "play",
      "pause",
      "timeupdate",
      "durationchange",
      "volumechange",
      "ratechange",
      "loadedmetadata",
      "ended",
    ]) {
      video.addEventListener(eventName, updateState);
      session.disposers.push(() => video.removeEventListener(eventName, updateState));
    }

    const mediaHandlers = createMediaHandlers(video, pipWindow, netflixVisibilityGuard);
    mediaHandlers.enterPresentation = () => requestFullscreenPresentation(session);
    ui.setHandlers(mediaHandlers);
    ui.setLoading("");
    updateState();
    pipWindow.addEventListener("pagehide", () => finishSession(session), { once: true });
    notifyRuntime("CAPTION_PIP_SESSION_STARTED", {
      cornerSnapEnabled: cachedCornerSnapEnabled,
    });
    notifyRuntime(CORNER_SNAP_SET_ENABLED_MESSAGE, {
      enabled: cachedCornerSnapEnabled,
    });
  }

  async function beginEmbeddedSession(outerFrame, request) {
    if (activeSession) {
      showToast("A Caption PiP window is already open.");
      return;
    }

    let pipWindow = takePipReservation();
    if (!pipWindow) {
      try {
        pipWindow = await requestPipWindow(request.state.aspect);
      } catch (error) {
        showToast(readablePipError(error));
        sendRoute(outerFrame, request.path.slice(1), request.video, {
          type: "NATIVE_FALLBACK",
          reason: readablePipError(error),
        }, request.sessionId);
        return;
      }
    }
    await preparePipOpening(pipWindow, request.state.aspect);
    await settingsReady;
    const captionPreference = await loadCaptionPreference(request.video, request.path);

    const original = rememberNodeLocation(outerFrame);
    const originalStyle = outerFrame.getAttribute("style");
    const cover = createCoverPlaceholder(outerFrame, () => pipWindow.close());
    const ui = createPipUi(
      pipWindow,
      request.state,
      captionPreference,
      cachedCornerSnapEnabled,
    );
    ui.setWheelResizeReady?.(request.state.aspect);
    const captureVideo = pipWindow.document.createElement("video");
    const captureCanvas = pipWindow.document.createElement("canvas");
    const captureMethods = /^blob:/i.test(request.video.src || "")
      ? ["track", "frames", "canvas", "media"]
      : ["media", "track", "frames", "canvas"];
    captureVideo.autoplay = true;
    captureVideo.muted = true;
    captureVideo.volume = clamp(request.state.volume, 0, 1);
    if (captureVideo.volume > 0) {
      lastAudibleVolumes.set(captureVideo, captureVideo.volume);
    }
    captureVideo.playsInline = true;
    captureVideo.disablePictureInPicture = true;
    captureVideo.setAttribute("aria-label", "Live embedded video mirror");
    prepareVideoForPip(captureVideo);
    captureCanvas.setAttribute("aria-label", "Live embedded video frames");
    prepareVideoForPip(captureCanvas);

    const session = {
      kind: "embedded",
      id: request.sessionId,
      pipWindow,
      originalFrame: outerFrame,
      original,
      originalStyle,
      cover,
      ui,
      clone: null,
      mediaFrame: outerFrame,
      path: request.path,
      videoDescriptor: request.video,
      initialState: request.state,
      sourceState: request.state,
      lastState: request.state,
      audioMode: "source",
      mode: "capture",
      captureVideo,
      capturePeer: null,
      captureRemoteStream: null,
      captureNegotiating: false,
      captureTimeout: 0,
      captureMethods,
      captureAttemptIndex: 0,
      captureMethod: captureMethods[0],
      captureErrors: [],
      captureCanvas,
      captureContext: captureCanvas.getContext("2d", { alpha: false }),
      captureFrameCount: 0,
      ready: false,
      usingOriginal: false,
      finished: false,
      disposers: [],
      retryCount: 0,
    };
    activeSession = session;
    sendRuntime({
      type: "CAPTION_PIP_REGISTER_EMBEDDED_SESSION",
      sessionId: session.id,
    });

    outerFrame.style.setProperty("pointer-events", "none", "important");
    ui.stage.append(captureVideo, captureCanvas);
    session.disposers.push(
      createPipMediaResizeStabilizer(pipWindow, ui.stage, () => request.state.aspect),
    );
    session.handlers = createEmbeddedHandlers(session);
    session.handlers.enterPresentation = () => requestFullscreenPresentation(session);
    ui.setHandlers(session.handlers);

    const pipMessageHandler = (event) => {
      if (event.source !== session.mediaFrame?.contentWindow) return;
      const message = event.data;
      if (!message?.[BRIDGE_MARKER] || message.sessionId !== session.id) return;
      handleEmbeddedStatus(session, message, true);
    };
    pipWindow.addEventListener("message", pipMessageHandler);
    session.disposers.push(() => pipWindow.removeEventListener("message", pipMessageHandler));

    const markCaptureReady = () => {
      if (!["track", "frames"].includes(session.captureMethod)) {
        markEmbeddedCaptureReady(session);
      }
    };
    captureVideo.addEventListener("loadeddata", markCaptureReady);
    captureVideo.addEventListener("playing", markCaptureReady);
    session.disposers.push(() => {
      captureVideo.removeEventListener("loadeddata", markCaptureReady);
      captureVideo.removeEventListener("playing", markCaptureReady);
    });

    startEmbeddedCaptureAttempt(session);
    session.disposers.push(() => clearTimeout(session.captureTimeout));
    pipWindow.addEventListener("pagehide", () => finishSession(session), { once: true });
    notifyRuntime("CAPTION_PIP_SESSION_STARTED", {
      cornerSnapEnabled: cachedCornerSnapEnabled,
    });
    notifyRuntime(CORNER_SNAP_SET_ENABLED_MESSAGE, {
      enabled: cachedCornerSnapEnabled,
    });
  }

  function startEmbeddedCaptureAttempt(session) {
    if (session.finished || session.mode !== "capture") return;
    session.ready = false;
    session.captureFrameCount = 0;
    session.captureVideo.dataset.captureMethod = session.captureMethod;
    session.captureCanvas.dataset.captureMethod = session.captureMethod;
    session.captureCanvas.dataset.captureFrames = "0";
    const usesFrames = ["track", "frames"].includes(session.captureMethod);
    session.captureVideo.style.setProperty("display", usesFrames ? "none" : "block", "important");
    session.captureCanvas.style.setProperty("display", usesFrames ? "block" : "none", "important");
    session.ui.setLoading(
      usesFrames
        ? session.captureMethod === "track"
          ? "Connecting to the background-safe video stream…"
          : "Connecting directly to the embedded video frames…"
        : session.captureMethod === "canvas"
        ? "Connecting with a compatibility video mirror…"
        : "Connecting to the live embedded player…",
    );
    sendRoute(
      session.originalFrame,
      session.path.slice(1),
      session.videoDescriptor,
      { type: "START_CAPTURE", method: session.captureMethod },
      session.id,
    );
    clearTimeout(session.captureTimeout);
    session.captureTimeout = setTimeout(() => {
      if (!session.ready && !session.finished && session.mode === "capture") {
        advanceEmbeddedCaptureAttempt(session, "The live video stream was unavailable.");
      }
    }, CAPTURE_CONNECT_TIMEOUT);
  }

  function markEmbeddedCaptureReady(session) {
    if (session.finished || session.mode !== "capture" || session.ready) return;
    session.ready = true;
    clearTimeout(session.captureTimeout);
    session.ui.setState(session.lastState);
    session.ui.setLoading("");
  }

  function advanceEmbeddedCaptureAttempt(session, reason) {
    if (session.finished || session.mode !== "capture") return;
    session.captureErrors.push({ method: session.captureMethod, reason: String(reason || "Unknown capture error") });
    session.captureCanvas.dataset.captureErrors = JSON.stringify(session.captureErrors);
    clearTimeout(session.captureTimeout);
    closeCaptureReceiver(session);
    sendRoute(
      session.originalFrame,
      session.path.slice(1),
      session.videoDescriptor,
      { type: "STOP_CAPTURE" },
      session.id,
    );

    session.captureAttemptIndex += 1;
    if (session.captureAttemptIndex >= session.captureMethods.length) {
      startEmbeddedCloneFallback(session, reason);
      return;
    }
    session.captureMethod = session.captureMethods[session.captureAttemptIndex];
    startEmbeddedCaptureAttempt(session);
  }

  function startEmbeddedCloneFallback(session, reason) {
    if (session.finished || session.mode !== "capture") return;
    session.mode = "clone";
    session.ready = false;
    clearTimeout(session.captureTimeout);
    closeCaptureReceiver(session);
    sendRoute(
      session.originalFrame,
      session.path.slice(1),
      session.videoDescriptor,
      { type: "STOP_CAPTURE" },
      session.id,
    );

    session.captureVideo.remove();
    session.clone = cloneIframe(session.originalFrame);
    session.mediaFrame = session.clone;
    prepareFrameForPip(session.clone);
    session.ui.stage.append(session.clone);
    session.ui.setLoading(
      reason ? "Live mirroring unavailable; reconnecting the embedded player…" : "Connecting to embedded player…",
    );

    sendRoute(
      session.originalFrame,
      session.path.slice(1),
      session.videoDescriptor,
      { type: "PAUSE_ORIGINAL" },
      session.id,
    );

    const retryTimer = setInterval(() => {
      if (session.finished || session.ready || session.mode !== "clone") return;
      session.retryCount += 1;
      sendEnterTarget(session);
      if (session.retryCount >= TARGET_RETRY_LIMIT) clearInterval(retryTimer);
    }, TARGET_RETRY_INTERVAL);
    session.disposers.push(() => clearInterval(retryTimer));

    const handleCloneLoad = () => sendEnterTarget(session);
    session.clone.addEventListener("load", handleCloneLoad);
    session.disposers.push(() => session.clone?.removeEventListener("load", handleCloneLoad));
    sendEnterTarget(session);

    const fallbackTimer = setTimeout(() => {
      if (!session.ready && !session.finished && session.mode === "clone") {
        useOriginalFrameInPip(session);
      }
    }, 6_000);
    session.disposers.push(() => clearTimeout(fallbackTimer));
  }

  function sendEnterTarget(session) {
    if (!session.mediaFrame?.contentWindow) return;
    sendRoute(
      session.mediaFrame,
      session.path.slice(1),
      session.videoDescriptor,
      {
        type: "ENTER_TARGET",
        initialState: session.lastState || session.initialState,
      },
      session.id,
    );
  }

  function useOriginalFrameInPip(session) {
    if (session.ready || session.finished || session.usingOriginal) return;
    session.usingOriginal = true;
    session.mode = "original";
    session.ui.setLoading("Reconnecting to the original embedded player…");
    sendRoute(
      session.clone,
      session.path.slice(1),
      session.videoDescriptor,
      { type: "EXIT_TARGET" },
      session.id,
    );
    session.clone?.remove();
    session.mediaFrame = session.originalFrame;
    prepareFrameForPip(session.originalFrame);
    session.ui.stage.append(session.originalFrame);
    session.retryCount = 0;
    session.originalFrame.addEventListener("load", () => sendEnterTarget(session));
    sendEnterTarget(session);
  }

  function handleFrameBridgeMessage(event) {
    const message = event.data;
    if (!message?.[BRIDGE_MARKER]) return;

    if (message.type === "CANDIDATE_HINT") {
      const sourceFrame = findDirectIframeByWindow(event.source);
      if (!sourceFrame) return;
      const forwarded = {
        ...message,
        path: [describeIframe(sourceFrame), ...(message.path || [])],
      };
      if (isTopFrame()) {
        const key = JSON.stringify(forwarded.path);
        if (forwarded.candidate) {
          embeddedCandidateHints.set(key, forwarded);
        } else {
          embeddedCandidateHints.delete(key);
        }
      } else {
        window.parent.postMessage(forwarded, "*");
      }
      return;
    }

    if (message.type === "REQUEST_EMBEDDED_PIP") {
      const sourceFrame = findDirectIframeByWindow(event.source);
      if (!sourceFrame) return;
      const forwarded = {
        ...message,
        path: [describeIframe(sourceFrame), ...message.path],
      };
      if (isTopFrame()) {
        beginEmbeddedSession(sourceFrame, forwarded);
      } else {
        window.parent.postMessage(forwarded, "*");
      }
      return;
    }

    if (message.type === "ROUTE_TO_VIDEO") {
      if (!isTrustedRouteSource(event.source)) return;
      routeTowardVideo(message);
      return;
    }

    if (
      [
        "TARGET_READY",
        "VIDEO_STATE",
        "CAPTION_STATE",
        "TARGET_ERROR",
        "CAPTURE_OFFER",
        "CAPTURE_ERROR",
        "CAPTURE_FRAME",
      ].includes(message.type)
    ) {
      if (
        isTopFrame() &&
        message.viaPipOpener &&
        activeSession?.kind === "embedded" &&
        event.source === activeSession.mediaFrame.contentWindow
      ) {
        handleEmbeddedStatus(activeSession, message, true);
        return;
      }

      const sourceFrame = findDirectIframeByWindow(event.source);
      if (!sourceFrame) return;
      if (isTopFrame()) {
        if (activeSession?.kind === "embedded" && event.source === activeSession.originalFrame.contentWindow) {
          handleEmbeddedStatus(activeSession, message, false);
        }
      } else {
        postBridgeUp(message, message.type === "CAPTURE_FRAME" && message.frame ? [message.frame] : []);
      }
    }
  }

  function routeTowardVideo(message) {
    if (message.path.length) {
      const frame = locateIframe(message.path[0]);
      if (!frame) return;

      if (message.command.type === "ENTER_TARGET") {
        focusRoutedFrame(frame, message.sessionId);
      }
      if (message.command.type === "EXIT_TARGET") {
        restoreRoutedFrame(message.sessionId);
      }

      frame.contentWindow?.postMessage(
        { ...message, path: message.path.slice(1) },
        "*",
      );
      return;
    }

    executeVideoCommand(message);
  }

  function executeVideoCommand(message) {
    const video = locateVideo(message.video);
    if (!video) return;
    const { command, sessionId } = message;

    switch (command.type) {
      case "START_CAPTURE":
        void startCaptureTargetSession(sessionId, video, command.method);
        break;
      case "CAPTURE_ANSWER":
        void acceptCaptureAnswer(sessionId, command.description, command.method);
        break;
      case "STOP_CAPTURE":
        if (targetSession?.id === sessionId && targetSession.mode === "capture") {
          stopTargetSession();
        }
        break;
      case "ENTER_TARGET":
        try {
          startTargetSession(sessionId, video, command.initialState);
        } catch (error) {
          emitBridgeUp({
            type: "TARGET_ERROR",
            sessionId,
            message: error?.message || "Could not connect to the embedded video.",
          });
        }
        break;
      case "EXIT_TARGET":
        if (targetSession?.id === sessionId) stopTargetSession();
        break;
      case "PAUSE_ORIGINAL":
        video.pause();
        emitBridgeUp({
          type: "VIDEO_STATE",
          sessionId,
          source: "original",
          state: snapshotVideo(video),
        });
        break;
      case "RESTORE_ORIGINAL":
        applyVideoState(video, command.state, true);
        break;
      case "NATIVE_FALLBACK":
        tryNativePip(video, command.reason);
        break;
      case "TOGGLE_PLAY":
        toggleVideoPlayback(video);
        break;
      case "SEEK_BY":
        seekVideo(video, command.seconds);
        break;
      case "SEEK_TO":
        seekVideoTo(video, command.time);
        break;
      case "TOGGLE_MUTE":
        toggleVideoMute(video);
        break;
      case "SET_VOLUME":
        setVideoVolume(video, command.volume);
        break;
      case "SET_AUDIO_STATE":
        void setEmbeddedSourceAudioState(sessionId, video, command);
        break;
      default:
        break;
    }
  }

  function startTargetSession(sessionId, video, initialState) {
    if (
      targetSession?.id === sessionId &&
      targetSession.video === video &&
      targetSession.mode === "focused"
    ) {
      emitTargetReady(targetSession);
      return;
    }
    stopTargetSession();

    const originalStyle = video.getAttribute("style");
    const originalControls = video.hasAttribute("controls");
    const focusStyle = document.createElement("style");
    focusStyle.setAttribute("data-caption-pip-focus-style", sessionId);
    focusStyle.textContent = `
      html, body { margin: 0 !important; overflow: hidden !important; background: #050507 !important; }
    `;
    (document.head || document.documentElement).append(focusStyle);
    prepareVideoForPip(video);

    const session = {
      id: sessionId,
      video,
      originalStyle,
      originalControls,
      focusStyle,
      mode: "focused",
      disposers: [],
    };
    targetSession = session;

    applyVideoState(video, initialState, true);
    emitTargetReady(session);
    attachTargetMonitoring(session);
  }

  async function startCaptureTargetSession(sessionId, video, requestedMethod) {
    const captureMethod = ["track", "frames", "canvas"].includes(requestedMethod)
      ? requestedMethod
      : "media";
    if (
      targetSession?.id === sessionId &&
      targetSession.video === video &&
      targetSession.mode === "capture" &&
      targetSession.captureMethod === captureMethod
    ) {
      if (targetSession.captureOffer) {
        emitBridgeUp({
          type: "CAPTURE_OFFER",
          sessionId,
          method: captureMethod,
          description: targetSession.captureOffer,
        });
      }
      return;
    }
    stopTargetSession();

    const session = {
      id: sessionId,
      video,
      mode: "capture",
      capturePeer: null,
      captureStream: null,
      captureOffer: null,
      captureMethod,
      captureCleanup: null,
      captureFailureEmitted: false,
      disposers: [],
    };
    targetSession = session;
    attachTargetMonitoring(session);

    try {
      if (captureMethod === "track") {
        const relay = startTrackFrameRelay(video, session);
        session.captureCleanup = relay.cleanup;
        session.captureStream = relay.stream;
        const audioTracks = relay.stream.getAudioTracks();
        if (audioTracks.length && typeof RTCPeerConnection === "function") {
          await startTargetCapturePeer(session, relay.stream, audioTracks);
        }
        return;
      }
      if (captureMethod === "frames") {
        session.captureCleanup = startVideoFrameRelay(video, session);
        try {
          const audioStream = new MediaStream();
          appendCapturedAudioTracks(video, audioStream);
          if (audioStream.getAudioTracks().length && typeof RTCPeerConnection === "function") {
            session.captureStream = audioStream;
            await startTargetCapturePeer(session, audioStream, audioStream.getAudioTracks());
          }
        } catch {}
        return;
      }
      if (typeof RTCPeerConnection !== "function") {
        throw new Error("Local live-video mirroring is unavailable in this frame.");
      }

      const capture = captureMethod === "canvas"
        ? createCanvasVideoCapture(video, session)
        : createMediaElementVideoCapture(video);
      const capturedStream = capture.stream;
      session.captureCleanup = capture.cleanup;
      if (captureMethod === "canvas") {
        try {
          appendCapturedAudioTracks(video, capturedStream);
        } catch {}
      }
      const videoTrack = capturedStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("The player did not provide a video track.");
      }

      let muteCheckTimer = 0;
      const verifyCaptureTrack = () => {
        clearTimeout(muteCheckTimer);
        muteCheckTimer = setTimeout(() => {
          if (
            targetSession === session &&
            !video.paused &&
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            videoTrack.muted
          ) {
            emitTargetCaptureError(session, "The player blocked access to its video track.");
          }
        }, 900);
      };
      videoTrack.addEventListener("mute", verifyCaptureTrack);
      video.addEventListener("play", verifyCaptureTrack);
      session.disposers.push(() => {
        clearTimeout(muteCheckTimer);
        videoTrack.removeEventListener("mute", verifyCaptureTrack);
        video.removeEventListener("play", verifyCaptureTrack);
      });
      verifyCaptureTrack();

      await startTargetCapturePeer(session, capturedStream, capturedStream.getTracks());
    } catch (error) {
      if (targetSession !== session) return;
      emitTargetCaptureError(
        session,
        error?.message || "The live embedded video could not be mirrored.",
      );
    }
  }

  async function startTargetCapturePeer(session, capturedStream, tracks) {
    if (typeof RTCPeerConnection !== "function") {
      throw new Error("Local live-video mirroring is unavailable in this frame.");
    }
    const liveTracks = tracks.filter((track) => track.readyState === "live");
    if (!liveTracks.length) {
      throw new Error("The player did not provide a live media track.");
    }

    const peer = new RTCPeerConnection({ iceServers: [] });
    session.captureStream = capturedStream;
    session.capturePeer = peer;
    for (const track of liveTracks) peer.addTrack(track, capturedStream);
    peer.addEventListener("connectionstatechange", () => {
      if (
        targetSession === session &&
        session.mode === "capture" &&
        peer.connectionState === "failed"
      ) {
        emitTargetCaptureError(session, "The live video connection could not be established.");
      }
    });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGatheringComplete(peer);
    if (targetSession !== session || !peer.localDescription) return;

    session.captureOffer = serializeSessionDescription(peer.localDescription);
    emitBridgeUp({
      type: "CAPTURE_OFFER",
      sessionId: session.id,
      method: session.captureMethod,
      description: session.captureOffer,
    });
  }

  function createMediaElementVideoCapture(video) {
    if (typeof video.captureStream !== "function") {
      throw new Error("This player does not expose a capturable video stream.");
    }
    return { stream: video.captureStream(), cleanup: null };
  }

  function appendCapturedAudioTracks(video, destinationStream) {
    const sourceStream = createMediaElementVideoCapture(video).stream;
    for (const videoTrack of sourceStream.getVideoTracks()) videoTrack.stop();
    for (const audioTrack of sourceStream.getAudioTracks()) {
      destinationStream.addTrack(audioTrack);
    }
  }

  function startTrackFrameRelay(video, session) {
    if (typeof video.captureStream !== "function") {
      throw new Error("This player does not expose a capturable video stream.");
    }
    if (typeof MediaStreamTrackProcessor !== "function" || typeof createImageBitmap !== "function") {
      throw new Error("Background-safe video-frame processing is unavailable in this frame.");
    }

    const stream = video.captureStream();
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error("The player did not provide a processable video track.");
    }
    const processor = new MediaStreamTrackProcessor({ track: videoTrack });
    const reader = processor.readable.getReader();
    let stopped = false;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      reader.cancel().catch(() => {});
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
    };

    const pump = async () => {
      try {
        while (!stopped && targetSession === session) {
          const { value: frame, done } = await reader.read();
          if (done) break;
          if (!frame) continue;
          try {
            const bitmap = await createImageBitmap(frame);
            if (stopped || targetSession !== session) {
              bitmap.close();
              break;
            }
            transferCaptureFrame(session, bitmap);
          } finally {
            frame.close();
          }
        }
        if (!stopped && targetSession === session) {
          emitTargetCaptureError(session, "The background-safe video stream ended.");
        }
      } catch (error) {
        if (!stopped && targetSession === session) {
          emitTargetCaptureError(
            session,
            error?.message || "The background-safe video stream failed.",
          );
        }
      }
    };
    void pump();
    return { cleanup, stream };
  }

  function transferCaptureFrame(session, frame) {
    try {
      postBridgeUp(
        {
          [BRIDGE_MARKER]: true,
          type: "CAPTURE_FRAME",
          sessionId: session.id,
          method: session.captureMethod,
          source: "capture",
          frame,
        },
        [frame],
      );
    } catch (error) {
      try {
        frame.close();
      } catch {}
      throw error;
    }
  }

  function startVideoFrameRelay(video, session) {
    if (typeof createImageBitmap !== "function") {
      throw new Error("Direct video-frame transfer is unavailable in this frame.");
    }

    let stopped = false;
    let framePending = false;
    let videoFrameId = 0;
    let animationFrameId = 0;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      if (videoFrameId && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(videoFrameId);
      }
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
    const sendFrame = async () => {
      if (stopped || framePending || targetSession !== session) return;
      framePending = true;
      let frame = null;
      try {
        frame = await createImageBitmap(video);
        if (stopped || targetSession !== session) {
          frame.close();
          return;
        }
        transferCaptureFrame(session, frame);
        frame = null;
      } catch (error) {
        try {
          frame?.close();
        } catch {}
        cleanup();
        emitTargetCaptureError(
          session,
          error?.message || "The player blocked direct video-frame transfer.",
        );
      } finally {
        framePending = false;
      }
    };
    const handleFrame = () => {
      if (stopped || targetSession !== session) return;
      try {
        void sendFrame();
      } catch (error) {
        cleanup();
        emitTargetCaptureError(
          session,
          error?.message || "The player blocked direct video-frame transfer.",
        );
        return;
      }
      scheduleFrame();
    };
    const scheduleFrame = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        videoFrameId = video.requestVideoFrameCallback(handleFrame);
      } else {
        animationFrameId = requestAnimationFrame((now) => handleFrame(now));
      }
    };

    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        void sendFrame();
      }
      scheduleFrame();
      return cleanup;
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  function createCanvasVideoCapture(video, session) {
    const canvas = document.createElement("canvas");
    if (typeof canvas.captureStream !== "function") {
      throw new Error("Canvas video mirroring is unavailable in this frame.");
    }
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) throw new Error("Could not create the compatibility video mirror.");

    let stopped = false;
    let videoFrameId = 0;
    let animationFrameId = 0;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      if (videoFrameId && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(videoFrameId);
      }
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
    const scheduleFrame = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        videoFrameId = video.requestVideoFrameCallback(drawFrame);
      } else {
        animationFrameId = requestAnimationFrame(drawFrame);
      }
    };
    const paintFrame = () => {
      const width = Math.max(2, video.videoWidth || video.clientWidth || 1280);
      const height = Math.max(2, video.videoHeight || video.clientHeight || 720);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    };
    const drawFrame = () => {
      if (stopped) return;
      try {
        paintFrame();
        scheduleFrame();
      } catch (error) {
        cleanup();
        emitTargetCaptureError(
          session,
          error?.message || "The player blocked the compatibility video mirror.",
        );
      }
    };

    try {
      paintFrame();
      const stream = canvas.captureStream();
      scheduleFrame();
      return { stream, cleanup };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  function emitTargetCaptureError(session, message) {
    if (targetSession !== session || session.captureFailureEmitted) return;
    session.captureFailureEmitted = true;
    emitBridgeUp({
      type: "CAPTURE_ERROR",
      sessionId: session.id,
      method: session.captureMethod,
      message,
    });
  }

  async function acceptCaptureAnswer(sessionId, description, method) {
    const session = targetSession;
    if (
      !description ||
      session?.id !== sessionId ||
      session.mode !== "capture" ||
      (method && session.captureMethod !== method) ||
      !session.capturePeer
    ) {
      return;
    }

    try {
      if (session.capturePeer.signalingState === "have-local-offer") {
        await session.capturePeer.setRemoteDescription(description);
      }
    } catch (error) {
      if (targetSession !== session) return;
      emitTargetCaptureError(
        session,
        error?.message || "The live video connection was rejected.",
      );
    }
  }

  function attachTargetMonitoring(session) {
    const { id: sessionId, video } = session;
    const captionMonitor = createCaptionMonitor({
      video,
      sourceDocument: document,
      referenceElement: video,
      onUpdate: ({ text }) => {
        emitBridgeUp({
          type: "CAPTION_STATE",
          sessionId,
          text,
          source: session.mode === "capture" ? "capture" : "pip",
        });
      },
    });
    session.disposers.push(() => captionMonitor.stop());

    const emitState = () => {
      emitBridgeUp({
        type: "VIDEO_STATE",
        sessionId,
        source: session.mode === "capture" ? "capture" : "pip",
        state: snapshotVideo(video),
      });
    };
    const stateTimer = setInterval(emitState, 250);
    session.disposers.push(() => clearInterval(stateTimer));
    for (const eventName of [
      "play",
      "pause",
      "timeupdate",
      "seeking",
      "seeked",
      "durationchange",
      "loadedmetadata",
      "volumechange",
      "ended",
    ]) {
      video.addEventListener(eventName, emitState);
      session.disposers.push(() => video.removeEventListener(eventName, emitState));
    }
    emitState();
  }

  function emitTargetReady(session) {
    emitBridgeUp({
      type: "TARGET_READY",
      sessionId: session.id,
      state: snapshotVideo(session.video),
    });
  }

  function stopTargetSession() {
    if (!targetSession) return;
    const session = targetSession;
    targetSession = null;
    for (const dispose of session.disposers.splice(0)) dispose();
    try {
      session.captureCleanup?.();
    } catch {}
    if (session.capturePeer) {
      try {
        session.capturePeer.close();
      } catch {}
    }
    for (const track of session.captureStream?.getTracks?.() || []) {
      try {
        track.stop();
      } catch {}
    }
    if (session.mode === "focused") {
      restoreStyleAttribute(session.video, session.originalStyle);
      if (session.originalControls) session.video.setAttribute("controls", "");
      else session.video.removeAttribute("controls");
      session.focusStyle?.remove();
    }
  }

  function handleEmbeddedStatus(session, message, fromPipWindow) {
    if (session.finished || message.sessionId !== session.id) return;
    const fromCaptureTarget =
      session.mode === "capture" &&
      (message.source === "capture" ||
        ["CAPTURE_OFFER", "CAPTURE_ERROR", "CAPTURE_FRAME"].includes(message.type));
    if (!fromPipWindow && message.source !== "original" && !fromCaptureTarget) return;

    if (message.type === "CAPTURE_FRAME") {
      if (session.mode === "capture" && message.method === session.captureMethod) {
        drawEmbeddedCaptureFrame(session, message.frame);
      } else {
        try {
          message.frame?.close?.();
        } catch {}
      }
      return;
    }

    if (message.type === "CAPTURE_OFFER" && session.mode === "capture") {
      if (!message.method || message.method === session.captureMethod) {
        void acceptCaptureOffer(session, message.description, message.method);
      }
      return;
    }

    if (message.type === "CAPTURE_ERROR" && session.mode === "capture") {
      if (!message.method || message.method === session.captureMethod) {
        advanceEmbeddedCaptureAttempt(
          session,
          message.message || "The live embedded video could not be mirrored.",
        );
      }
      return;
    }

    if (
      message.type === "TARGET_READY" &&
      fromPipWindow &&
      ["clone", "original"].includes(session.mode)
    ) {
      session.ready = true;
      session.lastState = message.state || session.lastState;
      session.ui.setState(session.lastState);
      session.ui.setLoading("");
      return;
    }

    const expectedSource = session.mode === "capture" ? "capture" : "pip";
    if (
      message.type === "VIDEO_STATE" &&
      (fromPipWindow || fromCaptureTarget) &&
      message.source === expectedSource
    ) {
      session.sourceState = message.state;
      session.lastState = embeddedUiState(session, message.state);
      session.ui.setState(session.lastState);
      return;
    }

    if (
      message.type === "AUDIO_STATE_RESULT" &&
      fromCaptureTarget &&
      session.mode === "capture"
    ) {
      session.sourceState = message.state || session.sourceState;
      if (message.accepted) {
        session.audioMode = "source";
        session.lastState = {
          ...(message.state || session.lastState),
          muted: Boolean(message.requested?.muted),
          volume: Number.isFinite(message.requested?.volume)
            ? message.requested.volume
            : Number(message.state?.volume) || Number(session.lastState?.volume) || 1,
        };
        session.ui.setState(session.lastState);
      } else {
        const requested = message.requested || {};
        session.handlers?.useCapturedAudioFallback?.({
          muted: Boolean(requested.muted),
          volume: Number.isFinite(requested.volume)
            ? requested.volume
            : Number(session.lastState?.volume) || 1,
        });
      }
      return;
    }

    if (
      message.type === "CAPTION_STATE" &&
      (fromPipWindow || fromCaptureTarget) &&
      message.source === expectedSource
    ) {
      session.ui.setCaptionState(message.text || "");
      return;
    }

    if (message.type === "TARGET_ERROR" && fromPipWindow && session.mode !== "capture") {
      session.ui.setLoading(message.message || "The embedded player needs attention.");
    }
  }

  async function acceptCaptureOffer(session, description, method) {
    if (
      !description ||
      session.finished ||
      session.mode !== "capture" ||
      (method && method !== session.captureMethod) ||
      session.captureNegotiating ||
      session.capturePeer
    ) {
      return;
    }

    if (typeof RTCPeerConnection !== "function") {
      startEmbeddedCloneFallback(session, "Local live-video mirroring is unavailable.");
      return;
    }

    session.captureNegotiating = true;
    const peer = new RTCPeerConnection({ iceServers: [] });
    session.capturePeer = peer;
    session.captureRemoteStream = new MediaStream();
    session.captureVideo.srcObject = session.captureRemoteStream;
    peer.addEventListener("track", (event) => {
      if (
        session.finished ||
        session.mode !== "capture" ||
        session.capturePeer !== peer
      ) {
        return;
      }
      const remoteTracks = [event.track];
      for (const stream of event.streams) remoteTracks.push(...stream.getTracks());
      for (const track of remoteTracks) {
        if (!session.captureRemoteStream.getTrackById(track.id)) {
          session.captureRemoteStream.addTrack(track);
        }
      }
      session.captureVideo.dataset.captureMethod = session.captureMethod;
      session.captureVideo.play().catch(() => {});
      event.track.addEventListener("ended", () => {
        if (
          event.track.kind === "video" &&
          !session.finished &&
          session.mode === "capture" &&
          session.capturePeer === peer
        ) {
          advanceEmbeddedCaptureAttempt(session, "The live embedded video stream ended.");
        }
      }, { once: true });
    });
    peer.addEventListener("connectionstatechange", () => {
      if (
        !session.finished &&
        session.mode === "capture" &&
        session.capturePeer === peer &&
        peer.connectionState === "failed"
      ) {
        advanceEmbeddedCaptureAttempt(session, "The live video connection failed.");
      }
    });

    try {
      await peer.setRemoteDescription(description);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGatheringComplete(peer);
      if (
        session.finished ||
        session.mode !== "capture" ||
        session.capturePeer !== peer ||
        !peer.localDescription
      ) {
        return;
      }
      sendRoute(
        session.originalFrame,
        session.path.slice(1),
        session.videoDescriptor,
        {
          type: "CAPTURE_ANSWER",
          method: session.captureMethod,
          description: serializeSessionDescription(peer.localDescription),
        },
        session.id,
      );
    } catch (error) {
      if (
        !session.finished &&
        session.mode === "capture" &&
        session.capturePeer === peer
      ) {
        advanceEmbeddedCaptureAttempt(
          session,
          error?.message || "The live video connection could not be negotiated.",
        );
      }
    } finally {
      if (session.capturePeer === peer) session.captureNegotiating = false;
    }
  }

  function closeCaptureReceiver(session) {
    session.captureNegotiating = false;
    if (session.capturePeer) {
      try {
        session.capturePeer.close();
      } catch {}
      session.capturePeer = null;
    }
    for (const track of session.captureRemoteStream?.getTracks?.() || []) {
      try {
        track.stop();
      } catch {}
    }
    session.captureRemoteStream = null;
    if (session.captureVideo) session.captureVideo.srcObject = null;
    if (session.captureContext && session.captureCanvas) {
      session.captureContext.clearRect(0, 0, session.captureCanvas.width, session.captureCanvas.height);
    }
  }

  function drawEmbeddedCaptureFrame(session, frame) {
    if (!frame || !session.captureContext) {
      advanceEmbeddedCaptureAttempt(session, "The embedded player did not provide a usable video frame.");
      return;
    }
    try {
      const width = Math.min(8192, Math.max(2, frame.displayWidth || frame.width || frame.codedWidth || 0));
      const height = Math.min(8192, Math.max(2, frame.displayHeight || frame.height || frame.codedHeight || 0));
      if (session.captureCanvas.width !== width || session.captureCanvas.height !== height) {
        session.captureCanvas.width = width;
        session.captureCanvas.height = height;
      }
      session.captureContext.drawImage(frame, 0, 0, width, height);
      session.captureFrameCount += 1;
      session.captureCanvas.dataset.captureFrames = String(session.captureFrameCount);
      markEmbeddedCaptureReady(session);
    } catch (error) {
      advanceEmbeddedCaptureAttempt(
        session,
        error?.message || "The embedded video frame could not be rendered.",
      );
    } finally {
      try {
        frame.close?.();
      } catch {}
    }
  }

  function waitForIceGatheringComplete(peer) {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      let timer = 0;
      const finish = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", checkState);
        resolve();
      };
      const checkState = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      timer = setTimeout(finish, ICE_GATHER_TIMEOUT);
      peer.addEventListener("icegatheringstatechange", checkState);
    });
  }

  function serializeSessionDescription(description) {
    return { type: description.type, sdp: description.sdp };
  }

  function sendRoute(rootFrame, path, video, command, sessionId) {
    rootFrame?.contentWindow?.postMessage(
      {
        [BRIDGE_MARKER]: true,
        type: "ROUTE_TO_VIDEO",
        sessionId,
        path,
        video,
        command,
      },
      "*",
    );
  }

  function emitBridgeUp(payload) {
    if (window.parent === window) return;
    const message = { [BRIDGE_MARKER]: true, ...payload };
    postBridgeUp(message);
    sendRuntime({ type: "CAPTION_PIP_EMBEDDED_STATUS", status: message });
  }

  function postBridgeUp(message, transfer = []) {
    window.parent.postMessage(message, "*", transfer);
    if (transfer.length) return;
    try {
      const pipOpener = window.parent.opener;
      if (pipOpener) {
        pipOpener.postMessage({ ...message, viaPipOpener: true }, "*");
      }
    } catch {}
  }

  function isTrustedRouteSource(sourceWindow) {
    if (sourceWindow === window.parent) return true;
    try {
      // A frame hosted in a Document PiP window receives the call from the
      // opener realm, even though its visual parent is the PiP window.
      return Boolean(window.parent?.opener && sourceWindow === window.parent.opener);
    } catch {
      return false;
    }
  }

  function createNetflixVisibilityPlaybackGuard({ video, sourceDocument, isSessionActive }) {
    const sourceWindow = sourceDocument.defaultView;
    const recoveryDelays = [0, 80, 250, 700];
    const recoveryTimers = new Set();
    let playbackWanted = !video.paused && !video.ended;
    let recoveryDeadline = 0;

    const clearRecoveryTimers = () => {
      for (const timer of recoveryTimers) sourceWindow.clearTimeout(timer);
      recoveryTimers.clear();
    };

    const sourceIsBackgrounded = () =>
      Boolean(sourceDocument.hidden) || sourceDocument.hasFocus?.() === false;

    const tryRecoverPlayback = () => {
      if (
        !playbackWanted ||
        video.ended ||
        !video.paused ||
        !sourceIsBackgrounded() ||
        !isSessionActive()
      ) {
        return;
      }
      try {
        video.play()?.catch?.(() => {});
      } catch {}
    };

    const beginRecoveryWindow = () => {
      if (!playbackWanted || video.ended || !isSessionActive()) return;
      clearRecoveryTimers();
      recoveryDeadline = Date.now() + 1_200;
      for (const delay of recoveryDelays) {
        const timer = sourceWindow.setTimeout(() => {
          recoveryTimers.delete(timer);
          tryRecoverPlayback();
        }, delay);
        recoveryTimers.add(timer);
      }
    };

    const endRecoveryWindow = () => {
      recoveryDeadline = 0;
      clearRecoveryTimers();
    };

    const handlePlay = () => {
      playbackWanted = true;
    };
    const handlePause = () => {
      if (playbackWanted && Date.now() <= recoveryDeadline) return;
      playbackWanted = false;
    };
    const handleEnded = () => {
      playbackWanted = false;
      endRecoveryWindow();
    };
    const handleVisibilityChange = () => {
      if (sourceDocument.hidden) beginRecoveryWindow();
      else endRecoveryWindow();
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    sourceDocument.addEventListener("visibilitychange", handleVisibilityChange, true);
    sourceWindow.addEventListener("blur", beginRecoveryWindow, true);
    sourceWindow.addEventListener("focus", endRecoveryWindow, true);

    return {
      setIntent(shouldPlay) {
        playbackWanted = Boolean(shouldPlay);
        if (!playbackWanted) endRecoveryWindow();
      },
      dispose() {
        endRecoveryWindow();
        video.removeEventListener("play", handlePlay);
        video.removeEventListener("pause", handlePause);
        video.removeEventListener("ended", handleEnded);
        sourceDocument.removeEventListener("visibilitychange", handleVisibilityChange, true);
        sourceWindow.removeEventListener("blur", beginRecoveryWindow, true);
        sourceWindow.removeEventListener("focus", endRecoveryWindow, true);
      },
    };
  }

  function createEmbeddedHandlers(session) {
    const command = (value) =>
      sendRoute(
        session.mediaFrame,
        session.path.slice(1),
        session.videoDescriptor,
        value,
        session.id,
      );

    const updateCapturedAudio = (change) => {
      if (session.mode !== "capture") return false;
      change(session.captureVideo);
      if (!session.captureVideo.muted) session.captureVideo.play().catch(() => {});
      syncEmbeddedCapturedAudioState(session);
      return true;
    };

    const useCapturedAudioFallback = (state) => {
      session.audioMode = "capture";
      if (Number.isFinite(state?.volume)) {
        setVideoVolume(session.captureVideo, state.volume);
      } else {
        toggleVideoMute(session.captureVideo);
      }
      if (!session.captureVideo.muted) session.captureVideo.play().catch(() => {});
      syncEmbeddedCapturedAudioState(session);
    };

    const requestSourceAudio = (next) => {
      if (session.mode !== "capture" || session.audioMode === "capture") {
        return false;
      }
      command({ type: "SET_AUDIO_STATE", ...next });
      return true;
    };

    return {
      togglePlay: () => command({ type: "TOGGLE_PLAY" }),
      seekBy: (seconds) => command({ type: "SEEK_BY", seconds }),
      seekTo: (time) => command({ type: "SEEK_TO", time }),
      toggleMute: () => {
        if (requestSourceAudio({ muted: !Boolean(session.lastState?.muted) })) return;
        if (!updateCapturedAudio(toggleVideoMute)) command({ type: "TOGGLE_MUTE" });
      },
      setVolume: (volume) => {
        if (requestSourceAudio({ muted: volume <= 0, volume })) return;
        if (!updateCapturedAudio((video) => setVideoVolume(video, volume))) {
          command({ type: "SET_VOLUME", volume });
        }
      },
      useCapturedAudioFallback,
      close: () => session.pipWindow.close(),
    };
  }

  async function setEmbeddedSourceAudioState(sessionId, video, command) {
    const wasPlaying = !video.paused && !video.ended;
    const wantsMuted = Boolean(command.muted);
    const previousVolume = video.volume;
    const previousLastAudibleVolume = lastAudibleVolumes.get(video);
    if (Number.isFinite(command.volume)) {
      const nextVolume = clamp(command.volume, 0, 1);
      if (nextVolume > 0) lastAudibleVolumes.set(video, nextVolume);
      video.volume = nextVolume;
    }
    if (!wantsMuted && video.volume === 0) {
      video.volume = clamp(lastAudibleVolumes.get(video) || 1, 0.01, 1);
    }
    video.muted = wantsMuted;
    const immediatelyPausedAfterUnmute = wasPlaying && !wantsMuted && video.paused;

    const report = () => {
      const state = snapshotVideo(video);
      const sourceAccepted =
        state.muted === wantsMuted &&
        (!wasPlaying || (!immediatelyPausedAfterUnmute && !state.paused));
      emitBridgeUp({
        type: "AUDIO_STATE_RESULT",
        sessionId,
        source: "capture",
        accepted: sourceAccepted,
        requested: {
          muted: wantsMuted,
          volume: Number.isFinite(command.volume) ? clamp(command.volume, 0, 1) : null,
        },
        state,
      });
      if (!sourceAccepted && !wantsMuted && wasPlaying && video.paused) {
        video.volume = previousVolume;
        if (previousLastAudibleVolume) {
          lastAudibleVolumes.set(video, previousLastAudibleVolume);
        }
        video.muted = true;
        video.play().catch(() => {});
      }
      return sourceAccepted;
    };

    if (wasPlaying && !wantsMuted && video.paused) {
      await video.play().catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    report();
  }

  function embeddedUiState(session, sourceState) {
    if (!sourceState || session.mode !== "capture" || session.audioMode !== "capture") {
      return sourceState;
    }
    return {
      ...sourceState,
      muted: session.captureVideo.muted,
      volume: session.captureVideo.volume,
    };
  }

  function syncEmbeddedCapturedAudioState(session) {
    const state = embeddedUiState(
      session,
      session.sourceState || session.lastState || session.initialState,
    );
    if (!state) return;
    session.lastState = state;
    session.ui.setState(state);
  }

  function createMediaHandlers(video, pipWindow, playbackGuard = null) {
    return {
      seekOnCommit: location.hostname === "www.netflix.com",
      togglePlay: () => {
        playbackGuard?.setIntent(video.paused || video.ended);
        toggleVideoPlayback(video);
      },
      seekBy: (seconds) => seekVideoForSite(video, (Number(video.currentTime) || 0) + Number(seconds || 0)),
      seekTo: (time) => seekVideoForSite(video, time),
      toggleMute: () => toggleVideoMute(video),
      setVolume: (volume) => setVideoVolume(video, volume),
      close: () => pipWindow.close(),
    };
  }

  function requestFullscreenPresentation(session) {
    if (!session || session.finished || session.presentationRequested) return;
    session.presentationRequested = true;
    const media = session.kind === "direct" ? session.video : session.originalFrame;
    const pipWindow = session.pipWindow;
    finishSession(session);
    enterOriginalPlayerFullscreen(media);
    sendRuntime({ type: FOCUS_PRESENTATION_MESSAGE });
    if (!pipWindow.closed) pipWindow.close();
  }

  function finishSession(session) {
    if (!session || session.finished) return;
    session.finished = true;
    persistSettingsNow();
    if (activeSession === session) activeSession = null;

    for (const dispose of session.disposers.splice(0)) {
      try {
        dispose();
      } catch {}
    }
    session.ui?.destroy();

    if (session.kind === "direct") {
      session.cover?.remove();
      restoreNodeLocation(session.video, session.original, session.placeholder);
      restoreStyleAttribute(session.video, session.originalStyle);
      if (session.originalControls) session.video.setAttribute("controls", "");
      else session.video.removeAttribute("controls");
    }

    if (session.kind === "embedded") {
      const wasLiveCapture = session.mode === "capture";
      if (wasLiveCapture) {
        sendRoute(
          session.originalFrame,
          session.path.slice(1),
          session.videoDescriptor,
          { type: "STOP_CAPTURE" },
          session.id,
        );
        closeCaptureReceiver(session);
      } else {
        sendRoute(
          session.mediaFrame,
          session.path.slice(1),
          session.videoDescriptor,
          { type: "EXIT_TARGET" },
          session.id,
        );
      }

      sendRuntime({
        type: "CAPTION_PIP_UNREGISTER_EMBEDDED_SESSION",
        sessionId: session.id,
      });

      if (session.usingOriginal) {
        restoreNodeLocation(session.originalFrame, session.original);
      } else {
        session.clone?.remove();
      }

      restoreStyleAttribute(session.originalFrame, session.originalStyle);
      session.cover.remove();

      if (!wasLiveCapture) {
        window.setTimeout(() => {
          sendRoute(
            session.originalFrame,
            session.path.slice(1),
            session.videoDescriptor,
            { type: "RESTORE_ORIGINAL", state: session.lastState || session.initialState },
            session.id,
          );
        }, session.usingOriginal ? 900 : 0);
      }
    }

    notifyRuntime("CAPTION_PIP_SESSION_ENDED");

  }

  function enterOriginalPlayerFullscreen(media) {
    if (!isTopFrame() || !media?.isConnected) {
      showToast("The original player is no longer available for fullscreen.", 2_600, "info");
      return;
    }

    const fullscreenControl = findOriginalFullscreenControl(media);
    if (fullscreenControl) {
      try {
        fullscreenControl.click();
        return;
      } catch {}
    }

    const fullscreenTarget =
      media.tagName === "IFRAME" || (media.tagName === "VIDEO" && media.controls)
        ? media
        : findPresentationTarget(media);
    requestOriginalFullscreen(fullscreenTarget);
  }

  function findOriginalFullscreenControl(media) {
    const selectors = [
      "button[aria-label*='fullscreen' i]",
      "button[aria-label*='full screen' i]",
      "[role='button'][aria-label*='fullscreen' i]",
      "[role='button'][aria-label*='full screen' i]",
      "input[aria-label*='fullscreen' i]",
      "input[aria-label*='full screen' i]",
      "button[title*='fullscreen' i]",
      "button[title*='full screen' i]",
      "[role='button'][title*='fullscreen' i]",
      "[role='button'][title*='full screen' i]",
      "[data-testid*='fullscreen' i]",
      "[data-testid*='full-screen' i]",
      "[data-uia*='fullscreen' i]",
      "[data-uia*='full-screen' i]",
      "button[class*='fullscreen' i]",
      "button[class*='full-screen' i]",
      "[role='button'][class*='fullscreen' i]",
      "[role='button'][class*='full-screen' i]",
      "button[id*='fullscreen' i]",
      "button[id*='full-screen' i]",
      "[role='button'][id*='fullscreen' i]",
      "[role='button'][id*='full-screen' i]",
    ];
    const playerTarget = findPresentationTarget(media);
    const mediaRect = safeRect(media);
    const seen = new Set();
    const scored = [];

    for (const match of querySelectorsDeep(document, selectors, 120)) {
      const control = match.closest?.(
        "button, [role='button'], input[type='button'], input[type='image'], a[href], [tabindex]",
      ) || match;
      if (seen.has(control)) continue;
      seen.add(control);
      if (typeof control.click !== "function") continue;
      if (control.disabled || control.getAttribute?.("aria-disabled") === "true") continue;
      if (
        control.closest?.(
          "[data-caption-pip-placeholder], [data-caption-pip-placeholder-cover], [data-caption-pip-toast]",
        )
      ) {
        continue;
      }

      const identity = fullscreenControlIdentity(control);
      const isEnterControl = /(?:enter|open|enable|expand|maximi[sz]e)/i.test(identity);
      const isExitControl = /(?:exit|leave|close|disable|collapse|minimi[sz]e|restore)/i.test(identity);
      if (isExitControl && !isEnterControl) continue;

      let score = 0;
      if (/full[\s_-]*screen/i.test(identity)) score += 420;
      if (isEnterControl) score += 220;
      if (control.tagName === "BUTTON" || control.getAttribute?.("role") === "button") {
        score += 60;
      }
      if (control === playerTarget || composedContains(playerTarget, control)) score += 700;
      if (composedContains(control, media)) score += 300;

      const controlRect = safeRect(control);
      if (controlRect.width >= 8 && controlRect.height >= 8) {
        const style = getComputedStyle(control);
        if (style.display !== "none" && style.visibility !== "hidden") score += 80;
        const centerX = controlRect.left + controlRect.width / 2;
        const centerY = controlRect.top + controlRect.height / 2;
        const distanceX = Math.max(mediaRect.left - centerX, 0, centerX - mediaRect.right);
        const distanceY = Math.max(mediaRect.top - centerY, 0, centerY - mediaRect.bottom);
        const distance = Math.hypot(distanceX, distanceY);
        score += Math.max(0, 260 - distance);
      }
      scored.push({ control, score });
    }

    scored.sort((first, second) => second.score - first.score);
    return scored[0]?.control || null;
  }

  function fullscreenControlIdentity(control) {
    return [
      control.getAttribute?.("aria-label"),
      control.getAttribute?.("title"),
      control.getAttribute?.("data-testid"),
      control.getAttribute?.("data-uia"),
      control.getAttribute?.("data-title"),
      control.getAttribute?.("name"),
      control.getAttribute?.("value"),
      control.id,
      control.getAttribute?.("class"),
      control.textContent,
    ]
      .filter(Boolean)
      .join(" ");
  }

  function composedContains(container, node) {
    if (!container || !node) return false;
    for (let current = node; current; ) {
      if (current === container) return true;
      const root = current.getRootNode?.();
      current = current.parentElement || root?.host || null;
    }
    return false;
  }

  function requestOriginalFullscreen(target) {
    if (!target?.isConnected || typeof target.requestFullscreen !== "function") {
      showToast("The original player's fullscreen mode is unavailable.", 2_600, "info");
      return;
    }
    try {
      const request = target.requestFullscreen({ navigationUI: "hide" });
      Promise.resolve(request).catch(() => {
        showToast("The original player's fullscreen mode is unavailable.", 2_600, "info");
      });
    } catch {
      showToast("The original player's fullscreen mode is unavailable.", 2_600, "info");
    }
  }

  function findPresentationTarget(media) {
    if (media.tagName === "IFRAME") return media;
    const mediaRect = media.getBoundingClientRect();
    if (mediaRect.width < 1 || mediaRect.height < 1) return media;
    const maximumWidth = Math.max(mediaRect.width * 1.4, mediaRect.width + 200);
    const maximumHeight = Math.max(mediaRect.height * 1.4, mediaRect.height + 200);
    let selected = media;
    for (let ancestor = media.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (["BODY", "HTML"].includes(ancestor.tagName)) break;
      const rect = ancestor.getBoundingClientRect();
      if (
        rect.width < mediaRect.width * 0.8 ||
        rect.height < mediaRect.height * 0.8 ||
        rect.width > maximumWidth ||
        rect.height > maximumHeight
      ) {
        break;
      }
      const identity = `${ancestor.id || ""} ${ancestor.className || ""}`;
      const hasPlayerIdentity = /(?:^|[\s_-])(player|video|media)(?:$|[\s_-])/i.test(identity);
      const hasPlayerControls = Boolean(
        ancestor.querySelector(
          "button[aria-label*='play' i], button[aria-label*='pause' i], [class*='controls' i]",
        ),
      );
      if (hasPlayerIdentity || hasPlayerControls) selected = ancestor;
    }
    return selected;
  }

  async function requestPipWindow(aspect) {
    if (!isTopFrame()) {
      return Promise.reject(new Error("Document PiP must be opened by the top-level page."));
    }
    if (!("documentPictureInPicture" in window)) {
      return Promise.reject(new Error("Document Picture-in-Picture requires Chrome 116 or newer."));
    }

    const size = getPipWindowSize(aspect);
    const requestFrame = normalizePipFrameInsets(
      cachedPipRequestFrame,
      DEFAULT_PIP_REQUEST_FRAME,
    );
    const requestedWidth = Math.max(1, Math.round(size.width + requestFrame.width));
    const requestedHeight = Math.max(1, Math.round(size.height + requestFrame.height));
    const requestedAt = Date.now();
    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: requestedWidth,
      height: requestedHeight,
      disallowReturnToOpener: true,
      preferInitialWindowPlacement: true,
    });
    pipWindow.document.documentElement.style.background = "#050507";
    pipWindow.document.documentElement.style.colorScheme = "dark";
    pipWindow.document.body.style.margin = "0";
    pipWindow.document.body.style.background = "#050507";
    const root = pipWindow.document.documentElement;
    root.dataset.targetVideoWidth = String(size.width);
    root.dataset.targetVideoHeight = String(size.height);
    root.dataset.requestedVideoWidth = String(requestedWidth);
    root.dataset.requestedVideoHeight = String(requestedHeight);
    root.dataset.requestedFrameWidth = String(requestFrame.width);
    root.dataset.requestedTopBarHeight = String(requestFrame.height);
    root.dataset.sizingMode = "adaptive-native-frame";
    pipWindow.__captionPipRequestGeometry = {
      targetWidth: size.width,
      targetHeight: size.height,
      requestedWidth,
      requestedHeight,
    };
    renderPipReservationStatus(pipWindow);
    let registrationPromise = Promise.resolve(null);
    try {
      registrationPromise = chrome.runtime.sendMessage({
        type: REGISTER_PIP_WINDOW_MESSAGE,
        cornerSnapEnabled: cachedCornerSnapEnabled,
        requestedAt,
      }).catch(() => null);
    } catch {}
    pipWindow.__captionPipRegistrationPromise = registrationPromise;
    return pipWindow;
  }

  async function preparePipOpening(pipWindow, sourceAspect) {
    if (!pipWindow || pipWindow.closed) return;
    let registration = null;
    try {
      registration = await pipWindow.__captionPipRegistrationPromise;
    } catch {}
    measurePipNativeFrame(pipWindow, registration);
    rememberPipRequestFrame(pipWindow);
    await adjustPipOpeningToVideo(pipWindow, sourceAspect);
  }

  async function requestPipAspectResize(pipWindow, targetInnerWidth, rawAspect) {
    if (!pipWindow || pipWindow.closed) return null;
    const aspect = normalizePipAspect(rawAspect);
    const frame = getPipNativeFrame(pipWindow);
    return chrome.runtime.sendMessage({
      type: SET_PIP_SIZE_MESSAGE,
      targetInnerWidth: Math.max(1, Math.round(Number(targetInnerWidth))),
      aspectInnerWidth: Math.max(1, Math.round(aspect * 10_000)),
      aspectInnerHeight: 10_000,
      frameWidth: frame.width,
      frameHeight: frame.height,
    }).catch(() => null);
  }

  async function adjustPipOpeningToVideo(pipWindow, rawAspect) {
    const request = pipWindow?.__captionPipRequestGeometry;
    if (!request || pipWindow.closed) return null;
    const aspect = normalizePipAspect(
      Number(rawAspect) || Number(request.targetWidth) / Number(request.targetHeight),
    );
    const targetInnerWidth = Math.max(
      1,
      Math.round(Number(pipWindow.innerWidth) || Number(request.targetWidth)),
    );
    const root = pipWindow.document?.documentElement;
    if (root) {
      root.dataset.openingAspectTargetWidth = String(targetInnerWidth);
      root.dataset.openingAspectTarget = String(aspect);
      root.dataset.openingAspectState = "adjusting";
    }
    const response = await requestPipAspectResize(
      pipWindow,
      targetInnerWidth,
      aspect,
    );
    if (response?.updated) {
      await waitForPipWindowLayout(pipWindow);
      if (root) {
        root.dataset.openingAspectState = "adjusted";
        root.dataset.openingAspectWidth = String(response.innerWidth);
        root.dataset.openingAspectHeight = String(response.innerHeight);
      }
    } else if (root) {
      root.dataset.openingAspectState = "unchanged";
    }
    return response;
  }

  function waitForPipWindowLayout(pipWindow) {
    return new Promise((resolve) => {
      if (!pipWindow || pipWindow.closed) {
        resolve();
        return;
      }
      pipWindow.requestAnimationFrame(() => pipWindow.requestAnimationFrame(resolve));
    });
  }

  function normalizePipAspect(rawAspect) {
    return clamp(Number(rawAspect) || 16 / 9, 0.45, 3.2);
  }

  function normalizePipFrameInsets(rawFrame, fallback = DEFAULT_PIP_NATIVE_FRAME) {
    const normalizeInset = (rawValue, fallbackValue) => {
      const value = Math.round(Number(rawValue));
      return Number.isFinite(value) && value >= 0 && value <= MAX_PIP_FRAME_INSET
        ? value
        : Math.round(Number(fallbackValue) || 0);
    };
    return {
      width: normalizeInset(rawFrame?.width, fallback?.width),
      height: normalizeInset(rawFrame?.height, fallback?.height),
    };
  }

  function measurePipNativeFrame(pipWindow, registration = null) {
    if (!pipWindow || pipWindow.closed) return { ...DEFAULT_PIP_NATIVE_FRAME };
    const innerWidth = Math.round(Number(pipWindow.innerWidth));
    const innerHeight = Math.round(Number(pipWindow.innerHeight));
    const outerWidth = Math.round(Number(registration?.outerWidth ?? pipWindow.outerWidth));
    const outerHeight = Math.round(Number(registration?.outerHeight ?? pipWindow.outerHeight));
    const previous = pipWindow.__captionPipNativeFrame || DEFAULT_PIP_NATIVE_FRAME;
    const measured = normalizePipFrameInsets(
      {
        width: outerWidth - innerWidth,
        height: outerHeight - innerHeight,
      },
      previous,
    );
    pipWindow.__captionPipNativeFrame = measured;
    const root = pipWindow.document?.documentElement;
    if (root) {
      root.dataset.nativeFrameWidth = String(measured.width);
      root.dataset.nativeFrameHeight = String(measured.height);
    }
    return measured;
  }

  function getPipNativeFrame(pipWindow) {
    return pipWindow?.__captionPipNativeFrame || measurePipNativeFrame(pipWindow);
  }

  function rememberPipRequestFrame(pipWindow) {
    const request = pipWindow?.__captionPipRequestGeometry;
    if (!request || pipWindow.closed) return;
    const innerWidth = Math.round(Number(pipWindow.innerWidth));
    const innerHeight = Math.round(Number(pipWindow.innerHeight));
    const rawWidth = Math.round(Number(request.requestedWidth) - innerWidth);
    const rawHeight = Math.round(Number(request.requestedHeight) - innerHeight);
    const nearRequestedSize =
      Math.abs(innerWidth - Number(request.targetWidth)) <= MAX_PIP_FRAME_INSET &&
      Math.abs(innerHeight - Number(request.targetHeight)) <= MAX_PIP_FRAME_INSET;
    if (
      !nearRequestedSize ||
      rawWidth < -1 ||
      rawHeight < -1 ||
      rawWidth > MAX_PIP_FRAME_INSET ||
      rawHeight > MAX_PIP_FRAME_INSET
    ) {
      return;
    }
    const learned = {
      width: Math.max(0, rawWidth),
      height: Math.max(0, rawHeight),
    };
    const root = pipWindow.document?.documentElement;
    if (root) {
      root.dataset.learnedRequestFrameWidth = String(learned.width);
      root.dataset.learnedRequestFrameHeight = String(learned.height);
    }
    if (
      learned.width === cachedPipRequestFrame.width &&
      learned.height === cachedPipRequestFrame.height
    ) {
      return;
    }
    cachedPipRequestFrame = learned;
    chrome.storage.local
      .set({ [PIP_REQUEST_FRAME_STORAGE_KEY]: learned })
      .catch(() => {});
  }

  function detectGoogleChromeBrowser() {
    if ("brave" in navigator) return false;
    const brands = Array.isArray(navigator.userAgentData?.brands)
      ? navigator.userAgentData.brands
      : [];
    if (brands.length) {
      return brands.some(({ brand }) => brand === "Google Chrome");
    }
    const userAgent = String(navigator.userAgent || "");
    return (
      navigator.vendor === "Google Inc." &&
      /\bChrome\/\d+/i.test(userAgent) &&
      !/\b(?:Edg|OPR|Vivaldi|YaBrowser)\//i.test(userAgent)
    );
  }

  function getPipWindowSize(rawAspect) {
    const aspect = normalizePipAspect(rawAspect);
    const maxWidth = Math.min(720, screen.availWidth * PIP_MAX_SCREEN_WIDTH_RATIO);
    const maxHeight = Math.max(260, screen.availHeight * 0.68);
    let width = maxWidth;
    let height = width / aspect;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
    return { width: Math.round(width), height: Math.round(height) };
  }

  function createPipUi(
    pipWindow,
    initialState,
    captionPreference = {},
    initialCornerSnapEnabled = true,
  ) {
    const doc = pipWindow.document;
    doc.title = "Caption PiP";
    doc.documentElement.lang = document.documentElement.lang || "en";
    doc.documentElement.removeAttribute("style");
    doc.body.removeAttribute("style");
    doc.documentElement.style.colorScheme = "dark";
    doc.body.replaceChildren();

    const style = doc.createElement("style");
    style.textContent = PIP_STYLES;
    doc.head.append(style);

    const root = element(
      doc,
      "main",
      "cp-root cp-controls-visible cp-paused",
    );
    const stage = element(doc, "div", "cp-stage");
    const loading = element(doc, "div", "cp-loading", "Preparing video…");
    loading.setAttribute("role", "status");

    const captions = element(doc, "div", "cp-captions cp-empty cp-hidden");
    captions.dataset.position = cachedSettings.position;
    const captionText = element(doc, "span", "cp-caption-text");
    captions.append(captionText);

    const topControls = element(doc, "div", "cp-top-controls");
    const returnToOpener = controlButton(
      doc,
      "",
      "Return to original tab",
      "cp-return-to-opener",
    );
    returnToOpener.append(createTablerIcon(doc, "arrow-back-up"));
    const cornerSnap = controlButton(
      doc,
      "",
      "Disable screen-edge padding",
      "cp-corner-snap cp-active",
    );
    cornerSnap.append(createTablerIcon(doc, "magnet"));
    cornerSnap.setAttribute("aria-pressed", "true");
    const presentation = controlButton(
      doc,
      "",
      "Enter original player fullscreen",
      "cp-presentation",
    );
    presentation.append(createTablerIcon(doc, "maximize"));
    const adjustAspect = controlButton(
      doc,
      "",
      "Adjust window to video aspect ratio",
      "cp-adjust-aspect",
    );
    adjustAspect.append(createTablerIcon(doc, "aspect-ratio"));
    const leftActions = element(doc, "div", "cp-top-group cp-top-group-left");
    const returnAction = element(doc, "div", "cp-top-action cp-top-action-left");
    const adjustAspectAction = element(doc, "div", "cp-top-action cp-top-action-adjust");
    const presentationAction = element(doc, "div", "cp-top-action cp-top-action-center");
    const snapAction = element(doc, "div", "cp-top-action cp-top-action-right");
    returnAction.append(returnToOpener);
    adjustAspectAction.append(adjustAspect);
    leftActions.append(returnAction, adjustAspectAction);
    presentationAction.append(presentation);
    snapAction.append(cornerSnap);
    topControls.append(leftActions, presentationAction, snapAction);

    const controls = element(doc, "div", "cp-controls");
    const play = controlButton(doc, "", "Play or pause (Space)", "cp-play");
    play.dataset.state = "play";
    play.append(
      createTablerIcon(doc, "player-play"),
      createTablerIcon(doc, "player-pause"),
    );
    const back = controlButton(doc, "", "Back 10 seconds (← or J)", "cp-seek cp-back");
    back.append(createTablerIcon(doc, "rewind-backward-10"));
    const forward = controlButton(doc, "", "Forward 10 seconds (→ or L)", "cp-seek cp-forward");
    forward.append(createTablerIcon(doc, "rewind-forward-10"));
    const volumeControl = element(doc, "div", "cp-volume-control");
    const mute = controlButton(doc, "", "Mute (M)", "cp-mute");
    mute.append(
      createTablerIcon(doc, "volume-4"),
      createTablerIcon(doc, "volume-2"),
      createTablerIcon(doc, "volume"),
      createTablerIcon(doc, "volume-off"),
    );
    mute.dataset.level = "high";
    mute.dataset.muted = "false";
    mute.classList.add("cp-active");
    mute.setAttribute("aria-pressed", "false");
    const volumeSlider = element(doc, "input", "cp-volume-slider");
    volumeSlider.type = "range";
    volumeSlider.min = "0";
    volumeSlider.max = "1";
    volumeSlider.step = "0.01";
    volumeSlider.value = "1";
    volumeSlider.setAttribute("aria-label", "Volume");
    volumeSlider.setAttribute("aria-orientation", "horizontal");
    volumeControl.append(mute, volumeSlider);

    const timeline = element(doc, "input", "cp-timeline");
    timeline.type = "range";
    timeline.min = "0";
    timeline.max = "100";
    timeline.step = "0.1";
    timeline.value = "0";
    timeline.style.setProperty("--cp-progress", "0%");
    timeline.setAttribute("aria-label", "Video timeline");

    const timeCurrent = element(doc, "span", "cp-time cp-time-current", "00:00:00");
    timeCurrent.setAttribute("aria-label", "Current video position");
    const timeDuration = element(doc, "span", "cp-time cp-time-duration", "00:00:00");
    timeDuration.setAttribute("aria-label", "Video duration");
    const cc = controlButton(doc, "", "Show subtitles (C)", "cp-cc");
    cc.append(createTablerIcon(doc, "subtitles"));
    cc.setAttribute("aria-pressed", "false");
    const appearance = controlButton(doc, "", "Subtitle appearance", "cp-aa");
    appearance.append(createTablerIcon(doc, "typography"));
    appearance.setAttribute("aria-expanded", "false");
    const primaryRow = element(doc, "div", "cp-primary-row");
    const transport = element(doc, "div", "cp-transport");
    const subtitleActions = element(doc, "div", "cp-subtitle-actions");
    const progressRow = element(doc, "div", "cp-progress-row");
    transport.append(back, play, forward);
    subtitleActions.append(cc, appearance);
    primaryRow.append(volumeControl, transport, subtitleActions);
    progressRow.append(timeCurrent, timeline, timeDuration);
    controls.append(primaryRow, progressRow);

    const panel = createAppearancePanel(doc);
    root.append(stage, loading, captions, topControls, controls, panel.element);
    doc.body.append(root);

    let handlers = {};
    let currentState = { ...initialState };
    let captionsEnabled = Boolean(captionPreference.enabled);
    let cornerSnapEnabled = initialCornerSnapEnabled !== false;
    let controlsTimer = 0;
    let lastPointerActivity = 0;
    let panelOpen = false;
    let volumeActive = false;
    let volumePointerInside = false;
    let volumePointerActive = false;
    let wheelResizeReady = false;
    let sizeRequestInFlight = false;
    let pendingSizeInnerWidth = 0;
    let sizeRequestRevision = 0;
    let appliedSizeInnerWidth = 0;
    let sizeAspectInnerWidth = 0;
    let sizeAspectInnerHeight = 0;
    let sizeMinimumInnerWidth = 0;
    let sizeMaximumInnerWidth = 0;
    let lastWheelResizeAt = 0;
    let windowDrag = null;
    let destroyed = false;

    const isWindowDragControl = (target) => Boolean(
      target?.closest?.(
        ".cp-controls, .cp-top-controls, .cp-panel, button, input, select, textarea, a, [contenteditable='true']",
      ),
    );

    const releaseWindowDragCapture = (state) => {
      if (!state) return;
      if (state.animationFrame) pipWindow.cancelAnimationFrame(state.animationFrame);
      state.animationFrame = 0;
      root.classList.remove("cp-window-dragging");
      if (windowDrag === state) windowDrag = null;
      try {
        if (root.hasPointerCapture(state.pointerId)) root.releasePointerCapture(state.pointerId);
      } catch {}
    };

    const sendWindowDragEnd = (state) => {
      if (!state?.started || state.endSent) return;
      state.endSent = true;
      sendRuntime({
        type: PIP_SURFACE_DRAG_END_MESSAGE,
        dragId: state.dragId,
        pointerX: state.latestX,
        pointerY: state.latestY,
        moved: state.moved,
      });
    };

    const scheduleWindowDragMove = (state) => {
      if (!state?.started || state.ended || state.animationFrame) return;
      state.animationFrame = pipWindow.requestAnimationFrame(() => {
        state.animationFrame = 0;
        if (!state.started || state.ended) return;
        sendRuntime({
          type: PIP_SURFACE_DRAG_MOVE_MESSAGE,
          dragId: state.dragId,
          pointerX: state.latestX,
          pointerY: state.latestY,
        });
      });
    };

    const beginWindowDrag = (event) => {
      if (
        windowDrag ||
        event.button !== 0 ||
        event.isPrimary === false ||
        isWindowDragControl(event.target) ||
        !Number.isFinite(event.screenX) ||
        !Number.isFinite(event.screenY)
      ) {
        return;
      }
      windowDrag = {
        dragId: createSessionId(),
        pointerId: event.pointerId,
        startX: event.screenX,
        startY: event.screenY,
        latestX: event.screenX,
        latestY: event.screenY,
        moved: false,
        starting: false,
        started: false,
        ended: false,
        endSent: false,
        animationFrame: 0,
      };
      try {
        root.setPointerCapture(event.pointerId);
      } catch {}
    };

    const moveWindowDrag = (event) => {
      const state = windowDrag;
      if (!state || event.pointerId !== state.pointerId) return;
      state.latestX = event.screenX;
      state.latestY = event.screenY;
      if (!state.moved) {
        const distance = Math.hypot(
          state.latestX - state.startX,
          state.latestY - state.startY,
        );
        if (distance < 4) return;
        state.moved = true;
        state.starting = true;
        root.classList.add("cp-window-dragging");
        chrome.runtime.sendMessage({
          type: PIP_SURFACE_DRAG_START_MESSAGE,
          dragId: state.dragId,
          pointerX: state.startX,
          pointerY: state.startY,
        }).then((result) => {
          state.starting = false;
          state.started = result?.started === true;
          if (!state.started) {
            releaseWindowDragCapture(state);
            return;
          }
          if (state.ended) sendWindowDragEnd(state);
          else scheduleWindowDragMove(state);
        }).catch(() => releaseWindowDragCapture(state));
      }
      if (!state.moved) return;
      event.preventDefault();
      doc.getSelection()?.removeAllRanges();
      scheduleWindowDragMove(state);
    };

    const finishWindowDrag = (event) => {
      const state = windowDrag;
      if (!state || (event && event.pointerId !== state.pointerId)) return;
      if (event) {
        state.latestX = Number.isFinite(event.screenX) ? event.screenX : state.latestX;
        state.latestY = Number.isFinite(event.screenY) ? event.screenY : state.latestY;
      }
      state.ended = true;
      if (state.moved) event?.preventDefault?.();
      releaseWindowDragCapture(state);
      sendWindowDragEnd(state);
    };

    const cancelControlsTimer = () => {
      if (controlsTimer) pipWindow.clearTimeout(controlsTimer);
      controlsTimer = 0;
    };

    const scheduleControlsHide = (delay = CONTROL_HIDE_DELAY) => {
      cancelControlsTimer();
      if (!currentState.paused && !panelOpen && !volumeActive) {
        controlsTimer = pipWindow.setTimeout(() => {
          controlsTimer = 0;
          root.classList.remove("cp-controls-visible");
        }, delay);
      }
    };

    const revealControls = () => {
      root.classList.add("cp-controls-visible");
      scheduleControlsHide();
    };

    const handlePointerActivity = () => {
      const now = pipWindow.performance.now();
      if (
        root.classList.contains("cp-controls-visible") &&
        now - lastPointerActivity < CONTROL_POINTER_THROTTLE
      ) {
        return;
      }
      lastPointerActivity = now;
      revealControls();
    };

    const handlePointerLeave = () => {
      if (!currentState.paused && !panelOpen && !volumeActive) {
        scheduleControlsHide(CONTROL_LEAVE_GRACE);
      }
    };

    const updateVolumeInteraction = () => {
      volumeActive =
        volumePointerInside ||
        volumePointerActive ||
        volumeControl.contains(doc.activeElement);
      root.classList.toggle("cp-volume-active", volumeActive);
      if (volumeActive) revealControls();
      else scheduleControlsHide();
    };

    const togglePanel = (force) => {
      panelOpen = typeof force === "boolean" ? force : !panelOpen;
      panel.element.hidden = !panelOpen;
      appearance.setAttribute("aria-expanded", String(panelOpen));
      root.classList.toggle("cp-panel-open", panelOpen);
      if (!panelOpen) persistSettingsNow();
      revealControls();
    };

    const handleVolumePointerEnter = () => {
      volumePointerInside = true;
      updateVolumeInteraction();
    };

    const handleVolumePointerLeave = () => {
      volumePointerInside = false;
      updateVolumeInteraction();
    };

    const handleVolumePointerDown = () => {
      volumePointerActive = true;
      updateVolumeInteraction();
    };

    const finishVolumePointer = () => {
      if (!volumePointerActive) return;
      volumePointerActive = false;
      updateVolumeInteraction();
    };

    const localSizeLimits = () => {
      if (sizeAspectInnerWidth < 1 || sizeAspectInnerHeight < 1) {
        return { minimumInnerWidth: 1, maximumInnerWidth: 1 };
      }
      const aspectRatio = sizeAspectInnerWidth / sizeAspectInnerHeight;
      const frame = getPipNativeFrame(pipWindow);
      const frameWidth = frame.width;
      const frameHeight = frame.height;
      const screenWidth = Number(pipWindow.screen?.width || sizeAspectInnerWidth);
      const screenHeight = Number(pipWindow.screen?.height || sizeAspectInnerHeight);
      const availableWidth = Number(pipWindow.screen?.availWidth || screenWidth);
      const availableHeight = Number(pipWindow.screen?.availHeight || screenHeight);
      const minimumInnerWidth = Math.ceil(Math.max(
        DOCUMENT_PIP_MIN_INNER_WIDTH,
        DOCUMENT_PIP_MIN_INNER_HEIGHT * aspectRatio,
      ));
      const maximumOuterWidth = Math.floor(Math.min(
        screenWidth * DOCUMENT_PIP_MAX_SCREEN_RATIO,
        availableWidth - 30,
      ));
      const maximumOuterHeight = Math.floor(Math.min(
        screenHeight * DOCUMENT_PIP_MAX_SCREEN_RATIO,
        availableHeight - 30,
      ));
      const maximumInnerWidth = Math.max(
        minimumInnerWidth,
        Math.floor(Math.min(
          maximumOuterWidth - frameWidth,
          (maximumOuterHeight - frameHeight) * aspectRatio,
        )),
      );
      return { minimumInnerWidth, maximumInnerWidth };
    };

    const updateSizeLimits = (minimumInnerWidth, maximumInnerWidth) => {
      sizeMinimumInnerWidth = Math.max(1, Math.ceil(Number(minimumInnerWidth) || 1));
      sizeMaximumInnerWidth = Math.max(
        sizeMinimumInnerWidth,
        Math.floor(Number(maximumInnerWidth) || sizeMinimumInnerWidth),
      );
    };

    const setResizeAspect = (rawAspect) => {
      const aspect = normalizePipAspect(rawAspect);
      const nextAspectInnerWidth = Math.round(aspect * 10_000);
      if (
        sizeAspectInnerWidth === nextAspectInnerWidth &&
        sizeAspectInnerHeight === 10_000
      ) {
        return;
      }
      sizeAspectInnerWidth = nextAspectInnerWidth;
      sizeAspectInnerHeight = 10_000;
      const limits = localSizeLimits();
      updateSizeLimits(limits.minimumInnerWidth, limits.maximumInnerWidth);
      appliedSizeInnerWidth = clamp(
        Math.round(Number(pipWindow.innerWidth)),
        sizeMinimumInnerWidth,
        sizeMaximumInnerWidth,
      );
      wheelResizeReady = sizeMaximumInnerWidth > sizeMinimumInnerWidth;
    };

    const flushSizeRequest = async () => {
      if (destroyed || sizeRequestInFlight || pendingSizeInnerWidth < 1) return;
      const requestedInnerWidth = pendingSizeInnerWidth;
      pendingSizeInnerWidth = 0;
      sizeRequestInFlight = true;
      const revision = sizeRequestRevision;
      const response = await requestPipAspectResize(
        pipWindow,
        requestedInnerWidth,
        sizeAspectInnerWidth / sizeAspectInnerHeight,
      );
      sizeRequestInFlight = false;
      if (destroyed || revision !== sizeRequestRevision) return;

      const localLimits = localSizeLimits();
      updateSizeLimits(
        Number(response?.minimumInnerWidth) || localLimits.minimumInnerWidth,
        Number(response?.maximumInnerWidth) || localLimits.maximumInnerWidth,
      );
      if (response?.updated) {
        appliedSizeInnerWidth = Number(response.innerWidth) || requestedInnerWidth;
      } else if (pendingSizeInnerWidth < 1) {
        appliedSizeInnerWidth = clamp(
          Math.round(Number(pipWindow.innerWidth)),
          sizeMinimumInnerWidth,
          sizeMaximumInnerWidth,
        );
      }
      if (pendingSizeInnerWidth > 0) {
        pendingSizeInnerWidth = clamp(
          pendingSizeInnerWidth,
          sizeMinimumInnerWidth,
          sizeMaximumInnerWidth,
        );
      }
      revealControls();
      if (pendingSizeInnerWidth > 0) {
        pipWindow.requestAnimationFrame(() => void flushSizeRequest());
      }
    };

    const wheelDeltaPixels = (input) => {
      let delta = Number(input.deltaY);
      if (!Number.isFinite(delta) || delta === 0) return 0;
      if (Number(input.deltaMode) === WheelEvent.DOM_DELTA_LINE) delta *= 16;
      else if (Number(input.deltaMode) === WheelEvent.DOM_DELTA_PAGE) {
        delta *= Math.max(1, Number(pipWindow.innerHeight));
      }
      const magnitude = clamp(
        Math.round(Math.abs(delta) * WHEEL_RESIZE_PIXEL_FACTOR),
        1,
        WHEEL_RESIZE_MAX_DELTA,
      );
      return Math.sign(delta) * magnitude;
    };

    const getOpenPipScrollView = () => {
      if (!panelOpen || panel.element.hidden) return null;
      return panel.element.querySelector("[data-caption-pip-scrollview]");
    };

    const scrollOpenPipView = (input) => {
      const scrollView = getOpenPipScrollView();
      if (!scrollView) return false;

      let delta = Number(input?.deltaY);
      if (Number.isFinite(delta) && delta !== 0) {
        if (Number(input?.deltaMode) === 1) delta *= 16;
        else if (Number(input?.deltaMode) === 2) {
          delta *= Math.max(1, Number(scrollView.clientHeight));
        }
        const maximumScrollTop = Math.max(
          0,
          Number(scrollView.scrollHeight) - Number(scrollView.clientHeight),
        );
        scrollView.scrollTop = clamp(
          Number(scrollView.scrollTop) + delta,
          0,
          maximumScrollTop,
        );
      }

      // An open PiP scroll surface owns the wheel even at either scroll limit.
      // This prevents a boundary wheel gesture from unexpectedly resizing PiP.
      revealControls();
      return true;
    };

    const applyWheelResize = (input) => {
      if (!wheelResizeReady || destroyed || !doc.hasFocus()) return false;
      const widthDelta = wheelDeltaPixels(input);
      if (!widthDelta) return false;

      const now = pipWindow.performance.now();
      if (!sizeRequestInFlight && pendingSizeInnerWidth < 1 && now - lastWheelResizeAt > 180) {
        appliedSizeInnerWidth = Math.round(Number(pipWindow.innerWidth));
      }
      lastWheelResizeAt = now;
      const currentInnerWidth = pendingSizeInnerWidth || appliedSizeInnerWidth;
      const requestedInnerWidth = clamp(
        currentInnerWidth - widthDelta,
        sizeMinimumInnerWidth,
        sizeMaximumInnerWidth,
      );
      if (requestedInnerWidth === currentInnerWidth) return false;
      appliedSizeInnerWidth = requestedInnerWidth;
      pendingSizeInnerWidth = requestedInnerWidth;
      void flushSizeRequest();
      revealControls();
      return true;
    };

    const adjustWindowToVideoAspect = () => {
      if (
        destroyed ||
        sizeAspectInnerWidth < 1 ||
        sizeAspectInnerHeight < 1
      ) {
        return;
      }
      const limits = localSizeLimits();
      updateSizeLimits(limits.minimumInnerWidth, limits.maximumInnerWidth);
      const requestedInnerWidth = clamp(
        Math.round(Number(pipWindow.innerWidth)),
        sizeMinimumInnerWidth,
        sizeMaximumInnerWidth,
      );
      appliedSizeInnerWidth = requestedInnerWidth;
      pendingSizeInnerWidth = requestedInnerWidth;
      void flushSizeRequest();
      revealControls();
    };

    const handleWheelResize = (event) => {
      if (
        !wheelResizeReady ||
        destroyed ||
        !doc.hasFocus() ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }
      if (scrollOpenPipView(event)) {
        event.preventDefault();
        return;
      }
      if (applyWheelResize(event)) event.preventDefault();
    };

    const updateSubtitleControl = () => {
      cc.classList.toggle("cp-active", captionsEnabled);
      cc.setAttribute("aria-pressed", String(captionsEnabled));
      captions.classList.toggle("cp-hidden", !captionsEnabled);
      const captionAction = captionsEnabled
        ? "Hide subtitles (C)"
        : "Show subtitles (C)";
      cc.title = captionAction;
      cc.setAttribute("aria-label", captionAction);
    };

    const applyCaptionState = (text) => {
      const safeText = String(text || "");
      captionText.textContent = safeText;
      captions.classList.toggle("cp-empty", !safeText);
    };

    const updateCornerSnapControl = () => {
      cornerSnap.classList.toggle("cp-active", cornerSnapEnabled);
      cornerSnap.setAttribute("aria-pressed", String(cornerSnapEnabled));
      const action = cornerSnapEnabled
        ? "Disable screen-edge padding"
        : "Enable screen-edge padding";
      cornerSnap.title = action;
      cornerSnap.setAttribute("aria-label", action);
    };

    const applyCornerSnapEnabled = (enabled, { persist = false, notify = false } = {}) => {
      cornerSnapEnabled = enabled !== false;
      cachedCornerSnapEnabled = cornerSnapEnabled;
      updateCornerSnapControl();
      if (persist) {
        chrome.storage.local
          .set({ [CORNER_SNAP_ENABLED_STORAGE_KEY]: cornerSnapEnabled })
          .catch(() => {});
      }
      if (notify) {
        sendRuntime({
          type: CORNER_SNAP_SET_ENABLED_MESSAGE,
          enabled: cornerSnapEnabled,
        });
      }
      revealControls();
    };

    play.addEventListener("click", () => handlers.togglePlay?.());
    back.addEventListener("click", () => handlers.seekBy?.(-10));
    forward.addEventListener("click", () => handlers.seekBy?.(10));
    mute.addEventListener("click", () => handlers.toggleMute?.());
    appearance.addEventListener("click", () => togglePanel());
    returnToOpener.addEventListener("click", () => {
      try {
        window.focus();
      } catch {}
      pipWindow.close();
    });
    cornerSnap.addEventListener("click", () => {
      applyCornerSnapEnabled(!cornerSnapEnabled, { persist: true, notify: true });
    });
    adjustAspect.addEventListener("click", adjustWindowToVideoAspect);
    presentation.addEventListener("click", () => handlers.enterPresentation?.());
    volumeControl.addEventListener("pointerenter", handleVolumePointerEnter);
    volumeControl.addEventListener("pointerleave", handleVolumePointerLeave);
    volumeControl.addEventListener("focusin", updateVolumeInteraction);
    volumeControl.addEventListener("focusout", () => {
      pipWindow.setTimeout(updateVolumeInteraction, 0);
    });
    volumeSlider.addEventListener("input", () => {
      const volume = clamp(volumeSlider.value, 0, 1);
      const volumePercent = Math.round(volume * 100) + "%";
      volumeSlider.setAttribute("aria-valuetext", volumePercent);
      volumeSlider.style.setProperty("--cp-volume", volumePercent);
      handlers.setVolume?.(volume);
      revealControls();
    });
    volumeSlider.addEventListener("pointerdown", handleVolumePointerDown);
    doc.addEventListener("pointerup", finishVolumePointer, true);
    doc.addEventListener("pointercancel", finishVolumePointer, true);
    pipWindow.addEventListener("wheel", handleWheelResize, { passive: false });
    cc.addEventListener("click", () => {
      captionsEnabled = !captionsEnabled;
      updateSubtitleControl();
      captionPreference.onChange?.(captionsEnabled);
    });
    timeline.addEventListener("input", () => {
      const nextTime = Number(timeline.value);
      const duration = finiteDuration(currentState.duration);
      updateTimelinePresentation(nextTime, duration);
      if (handlers.seekOnCommit) {
        return;
      }
      handlers.seekTo?.(nextTime);
    });
    timeline.addEventListener("change", () => {
      if (handlers.seekOnCommit) handlers.seekTo?.(Number(timeline.value));
    });

    panel.onSettingsChanged = (nextSettings) => {
      cachedSettings = normalizeSettings(nextSettings);
      applyCaptionSettings(captions, captionText, cachedSettings);
      scheduleSettingsSave();
    };
    panel.onClose = () => {
      if (!destroyed && panelOpen) togglePanel(false);
    };
    panel.setSettings(cachedSettings);
    applyCaptionSettings(captions, captionText, cachedSettings);

    root.addEventListener("pointerenter", handlePointerActivity);
    root.addEventListener("pointermove", handlePointerActivity);
    root.addEventListener("pointerdown", revealControls);
    root.addEventListener("pointerdown", beginWindowDrag);
    root.addEventListener("pointerleave", handlePointerLeave);
    doc.addEventListener("pointermove", moveWindowDrag, true);
    doc.addEventListener("pointerup", finishWindowDrag, true);
    doc.addEventListener("pointercancel", finishWindowDrag, true);

    doc.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = event.target?.tagName?.toLowerCase();
      if (["input", "select", "button"].includes(tag) && event.key !== "Escape") return;

      const key = event.key.toLowerCase();
      if ([" ", "k"].includes(key)) {
        event.preventDefault();
        handlers.togglePlay?.();
      } else if (["arrowleft", "j"].includes(key)) {
        event.preventDefault();
        handlers.seekBy?.(-10);
      } else if (["arrowright", "l"].includes(key)) {
        event.preventDefault();
        handlers.seekBy?.(10);
      } else if (key === "m") {
        handlers.toggleMute?.();
      } else if (key === "c") {
        cc.click();
      } else if (key === "escape") {
        if (panelOpen) togglePanel(false);
        else handlers.close?.();
      } else if (key === "home") {
        event.preventDefault();
        handlers.seekTo?.(0);
      } else if (key === "end" && Number.isFinite(currentState.duration)) {
        event.preventDefault();
        handlers.seekTo?.(currentState.duration);
      }
    });

    updateSubtitleControl();
    updateCornerSnapControl();
    revealControls();

    return {
      stage,
      setHandlers(nextHandlers) {
        handlers = nextHandlers || {};
      },
      setState(state) {
        const wasPaused = Boolean(currentState.paused);
        currentState = { ...currentState, ...state };
        if (Number(state?.aspect) > 0) setResizeAspect(state.aspect);
        const duration = finiteDuration(currentState.duration);
        const currentTime = clamp(Number(currentState.currentTime) || 0, 0, duration || Infinity);
        timeline.max = String(duration || 0);
        if (doc.activeElement !== timeline) timeline.value = String(currentTime);
        timeline.disabled = !duration;
        updateTimelinePresentation(
          doc.activeElement === timeline ? Number(timeline.value) : currentTime,
          duration,
        );
        play.dataset.state = currentState.paused ? "play" : "pause";
        play.setAttribute("aria-label", currentState.paused ? "Play" : "Pause");
        const mediaVolume = Number.isFinite(Number(currentState.volume))
          ? clamp(currentState.volume, 0, 1)
          : 1;
        const effectivelyMuted = Boolean(currentState.muted) || mediaVolume === 0;
        const volumeLabel = effectivelyMuted ? "Unmute (M)" : "Mute (M)";
        mute.dataset.level = volumeLevelFor(mediaVolume);
        mute.dataset.muted = String(effectivelyMuted);
        mute.title = volumeLabel;
        mute.setAttribute("aria-label", volumeLabel);
        mute.setAttribute("aria-pressed", String(effectivelyMuted));
        mute.classList.toggle("cp-active", !effectivelyMuted);
        if (doc.activeElement !== volumeSlider) volumeSlider.value = String(mediaVolume);
        const volumePercent = Math.round(mediaVolume * 100) + "%";
        volumeSlider.setAttribute("aria-valuetext", volumePercent);
        volumeSlider.style.setProperty("--cp-volume", volumePercent);
        root.classList.toggle("cp-paused", Boolean(currentState.paused));
        if (currentState.paused) revealControls();
        else if (wasPaused) revealControls();
      },
      setCaptionState(text) {
        applyCaptionState(text);
      },
      setCornerSnapEnabled(enabled) {
        applyCornerSnapEnabled(enabled);
      },
      setWheelResizeReady(rawAspect) {
        setResizeAspect(rawAspect);
      },
      resizeFromRelayedWheel(input) {
        if (scrollOpenPipView(input || {})) return true;
        return applyWheelResize(input || {});
      },
      setLoading(message) {
        loading.textContent = message || "";
        loading.hidden = !message;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancelControlsTimer();
        sizeRequestRevision += 1;
        pendingSizeInnerWidth = 0;
        finishWindowDrag();
        root.removeEventListener("pointerdown", beginWindowDrag);
        doc.removeEventListener("pointermove", moveWindowDrag, true);
        doc.removeEventListener("pointerup", finishWindowDrag, true);
        doc.removeEventListener("pointercancel", finishWindowDrag, true);
        doc.removeEventListener("pointerup", finishVolumePointer, true);
        doc.removeEventListener("pointercancel", finishVolumePointer, true);
        pipWindow.removeEventListener("wheel", handleWheelResize);
        panel.destroy();
      },
    };

    function updateTimelinePresentation(value, duration) {
      const safeDuration = finiteDuration(duration);
      const safeValue = clamp(Number(value) || 0, 0, safeDuration || Infinity);
      const progress = safeDuration ? clamp((safeValue / safeDuration) * 100, 0, 100) : 0;
      timeline.style.setProperty("--cp-progress", `${progress}%`);
      timeCurrent.textContent = formatTime(safeValue);
      timeDuration.textContent = safeDuration ? formatTime(safeDuration) : "00:00:00";
    }
  }

  function createAppearancePanel(doc) {
    const wrapper = element(doc, "section", "cp-panel");
    wrapper.hidden = true;
    wrapper.setAttribute("aria-label", "Subtitle appearance");
    const scroller = element(doc, "div", "cp-panel-scroll");
    scroller.setAttribute("data-caption-pip-scrollview", "");

    const header = element(doc, "div", "cp-panel-header");
    const heading = element(doc, "strong", "", "Subtitle appearance");
    const close = element(doc, "button", "cp-panel-close");
    close.type = "button";
    close.title = "Close subtitle settings";
    close.setAttribute("aria-label", "Close subtitle settings");
    close.append(createTablerIcon(doc, "x"));
    header.append(heading, close);

    const font = createSelectField(doc, "Font", [
      ["system", "System"],
      ["sans", "Sans serif"],
      ["serif", "Serif"],
      ["mono", "Monospace"],
      ["rounded", "Rounded"],
    ]);
    font.input.classList.add("cp-font-select");
    const size = createRangeField(doc, "Size", 8, 48, 1, "px");
    size.input.classList.add("cp-size-range");
    const textColor = createColorField(doc, "Text color");
    textColor.input.classList.add("cp-text-color");
    const textOpacity = createRangeField(doc, "Text opacity", 0.35, 1, 0.05, "%", true);
    textOpacity.input.classList.add("cp-text-opacity");
    const background = createColorField(doc, "Background");
    background.input.classList.add("cp-background-color");
    const backgroundOpacity = createRangeField(doc, "Background opacity", 0, 1, 0.05, "%", true);
    backgroundOpacity.input.classList.add("cp-background-opacity");
    const weight = createSelectField(doc, "Weight", [
      ["400", "Regular"],
      ["500", "Medium"],
      ["600", "Semibold"],
      ["700", "Bold"],
      ["800", "Extra bold"],
    ]);
    weight.input.classList.add("cp-weight-select");
    const edge = createSelectField(doc, "Character edge", [
      ["none", "None"],
      ["raised", "Raised"],
      ["shadow", "Drop shadow"],
    ]);
    edge.input.classList.add("cp-edge-select");

    const positionField = element(doc, "div", "cp-field cp-position-field");
    const positionLabel = element(doc, "span", "cp-field-label", "Position");
    const positions = element(doc, "div", "cp-segments");
    const positionButtons = [
      ["top", "Top"],
      ["center", "Center"],
      ["bottom", "Bottom"],
    ].map(([value, label]) => {
      const button = element(doc, "button", "", label);
      button.type = "button";
      button.dataset.value = value;
      positions.append(button);
      return button;
    });
    positionField.append(positionLabel, positions);

    scroller.append(
      font.element,
      size.element,
      textColor.element,
      textOpacity.element,
      background.element,
      backgroundOpacity.element,
      weight.element,
      edge.element,
      positionField,
    );
    wrapper.append(header, scroller);

    let settings = { ...cachedSettings };
    let onSettingsChanged = () => {};
    let onClose = () => {};

    const emit = () => onSettingsChanged({ ...settings });
    font.input.addEventListener("change", () => {
      settings.font = font.input.value;
      emit();
    });
    size.input.addEventListener("input", () => {
      settings.size = Number(size.input.value);
      size.updateOutput(settings.size);
      emit();
    });
    textColor.input.addEventListener("input", () => {
      settings.color = textColor.input.value;
      emit();
    });
    textOpacity.input.addEventListener("input", () => {
      settings.textOpacity = Number(textOpacity.input.value);
      textOpacity.updateOutput(settings.textOpacity);
      emit();
    });
    background.input.addEventListener("input", () => {
      settings.background = background.input.value;
      emit();
    });
    backgroundOpacity.input.addEventListener("input", () => {
      settings.backgroundOpacity = Number(backgroundOpacity.input.value);
      backgroundOpacity.updateOutput(settings.backgroundOpacity);
      emit();
    });
    weight.input.addEventListener("change", () => {
      settings.weight = Number(weight.input.value);
      emit();
    });
    edge.input.addEventListener("change", () => {
      settings.edge = edge.input.value;
      emit();
    });
    for (const button of positionButtons) {
      button.addEventListener("click", () => {
        settings.position = button.dataset.value;
        updatePositionButtons();
        emit();
      });
    }
    close.addEventListener("click", () => onClose());

    const updatePositionButtons = () => {
      for (const button of positionButtons) {
        const active = button.dataset.value === settings.position;
        button.classList.toggle("cp-selected", active);
        button.setAttribute("aria-pressed", String(active));
      }
    };

    const api = {
      element: wrapper,
      get onSettingsChanged() {
        return onSettingsChanged;
      },
      set onSettingsChanged(handler) {
        onSettingsChanged = handler;
      },
      get onClose() {
        return onClose;
      },
      set onClose(handler) {
        onClose = handler;
      },
      setSettings(next) {
        settings = normalizeSettings(next);
        font.input.value = settings.font;
        size.input.value = String(settings.size);
        size.updateOutput(settings.size);
        textColor.input.value = settings.color;
        textOpacity.input.value = String(settings.textOpacity);
        textOpacity.updateOutput(settings.textOpacity);
        background.input.value = settings.background;
        backgroundOpacity.input.value = String(settings.backgroundOpacity);
        backgroundOpacity.updateOutput(settings.backgroundOpacity);
        weight.input.value = String(settings.weight);
        edge.input.value = settings.edge;
        updatePositionButtons();
      },
      destroy() {},
    };

    return api;
  }

  function createSelectField(doc, label, options) {
    const field = element(doc, "label", "cp-field");
    const labelElement = element(doc, "span", "cp-field-label", label);
    const select = element(doc, "select", "cp-select");
    for (const [value, text] of options) {
      const option = element(doc, "option", "", text);
      option.value = value;
      select.append(option);
    }
    field.append(labelElement, select);
    return { element: field, input: select };
  }

  function createRangeField(doc, label, min, max, step, suffix, percentage = false) {
    const field = element(doc, "label", "cp-field cp-range-field");
    const row = element(doc, "span", "cp-field-row");
    const labelElement = element(doc, "span", "cp-field-label", label);
    const output = element(doc, "output", "cp-output");
    row.append(labelElement, output);
    const input = element(doc, "input", "cp-range");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    field.append(row, input);
    return {
      element: field,
      input,
      updateOutput(value) {
        output.textContent = percentage ? `${Math.round(value * 100)}%` : `${value}${suffix}`;
      },
    };
  }

  function createColorField(doc, label) {
    const field = element(doc, "label", "cp-field cp-color-field");
    const labelElement = element(doc, "span", "cp-field-label", label);
    const input = element(doc, "input", "cp-color");
    input.type = "color";
    field.append(labelElement, input);
    return { element: field, input };
  }

  function applyCaptionSettings(captions, text, settings) {
    captions.dataset.position = settings.position;
    text.style.fontFamily = FONT_FAMILIES[settings.font] || FONT_FAMILIES.system;
    text.style.fontSize = `${settings.size}px`;
    text.style.fontWeight = String(settings.weight);
    text.style.textShadow = CAPTION_EDGE_STYLES[settings.edge] || CAPTION_EDGE_STYLES.none;
    text.style.color = colorWithOpacity(settings.color, settings.textOpacity);
    text.style.backgroundColor = colorWithOpacity(settings.background, settings.backgroundOpacity);
  }

  function scheduleSettingsSave() {
    settingsDirty = true;
    settingsSaveRevision += 1;
    clearTimeout(saveSettingsTimer);
    saveSettingsTimer = setTimeout(() => {
      saveSettingsTimer = 0;
      persistSettingsNow();
    }, 180);
  }

  function persistSettingsNow() {
    clearTimeout(saveSettingsTimer);
    saveSettingsTimer = 0;
    if (!settingsDirty) return Promise.resolve();

    const revision = settingsSaveRevision;
    const subtitleSettings = normalizeSettings(cachedSettings);
    return chrome.storage.local
      .set({ subtitleSettings })
      .then(() => {
        if (settingsSaveRevision === revision) settingsDirty = false;
      })
      .catch(() => {});
  }

  function createCaptionMonitor({ video, sourceDocument, referenceElement, onUpdate }) {
    const originalTrackModes = new Map();
    let selectedTrack = null;
    let lastText = "";
    let stopped = false;
    let cueEventTrack = null;

    const selectTrack = () => {
      if (selectedTrack && [...video.textTracks].includes(selectedTrack)) return selectedTrack;
      const tracks = [...video.textTracks].filter((track) =>
        ["captions", "subtitles"].includes(track.kind),
      );
      if (!tracks.length) {
        selectedTrack = null;
        return null;
      }

      const language = (navigator.language || "").toLowerCase();
      selectedTrack =
        tracks.find((track) => track.mode === "showing") ||
        tracks.find((track) => track.mode === "hidden") ||
        tracks.find((track) => track.language?.toLowerCase() === language) ||
        tracks.find((track) => language.startsWith(track.language?.toLowerCase())) ||
        tracks.find((track) => track.default) ||
        tracks[0];

      if (!originalTrackModes.has(selectedTrack)) {
        originalTrackModes.set(selectedTrack, selectedTrack.mode);
      }
      try {
        selectedTrack.mode = "hidden";
      } catch {}
      return selectedTrack;
    };

    const handleCueChange = () => read();
    const bindCueEvents = (track) => {
      if (cueEventTrack === track) return;
      cueEventTrack?.removeEventListener?.("cuechange", handleCueChange);
      cueEventTrack = track;
      cueEventTrack?.addEventListener?.("cuechange", handleCueChange);
    };

    const read = () => {
      if (stopped) return;
      const track = selectTrack();
      bindCueEvents(track);
      const cues = track?.activeCues ? [...track.activeCues] : [];
      let text = cues
        .map((cue) => cleanCaptionText(cue.text || ""))
        .filter(Boolean)
        .join("\n");

      if (!text) text = detectDomCaption(sourceDocument, referenceElement);

      if (text !== lastText) {
        lastText = text;
        onUpdate({ text });
      }
    };

    const timer = setInterval(read, 140);
    read();

    return {
      stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        cueEventTrack?.removeEventListener?.("cuechange", handleCueChange);
        cueEventTrack = null;
        for (const [track, mode] of originalTrackModes) {
          try {
            track.mode = mode;
          } catch {}
        }
      },
    };
  }

  function detectDomCaption(sourceDocument, referenceElement) {
    if (!sourceDocument?.documentElement) return "";
    const referenceRect = safeRect(referenceElement);
    const specific = querySelectorsDeep(sourceDocument, SPECIFIC_CAPTION_SELECTORS, 80);
    const specificText = captionTextFromElements(specific, referenceRect, true);
    if (specificText) return specificText;

    const materialUiOverlayText = detectMaterialUiOverlayCaption(
      sourceDocument,
      referenceRect,
    );
    if (materialUiOverlayText) return materialUiOverlayText;

    const generic = querySelectorsDeep(sourceDocument, GENERIC_CAPTION_SELECTORS, 100);
    return captionTextFromElements(generic, referenceRect, false);
  }

  function detectMaterialUiOverlayCaption(sourceDocument, referenceRect) {
    if (!referenceRect?.width || !referenceRect?.height) return "";
    const candidates = querySelectorsDeep(
      sourceDocument,
      ["span.MuiBox-root"],
      240,
    );
    const referenceCenterX = referenceRect.left + referenceRect.width / 2;
    const minimumFontSize = Math.max(14, referenceRect.height * 0.018);
    let bestText = "";
    let bestScore = -Infinity;

    for (const node of candidates) {
      if (!(node instanceof Element) || node.children.length) continue;
      const text = cleanCaptionText(node.textContent || "");
      if (!text || text.length > 320) continue;

      const style = getComputedStyle(node);
      const opacity = Number(style.opacity || 1);
      const fontSize = Number(style.fontSize.replace("px", "")) || 0;
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        opacity <= 0 ||
        style.pointerEvents !== "none" ||
        fontSize < minimumFontSize
      ) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (
        rect.width > referenceRect.width * 0.96 ||
        rect.height > referenceRect.height * 0.35 ||
        rect.right < referenceRect.left ||
        rect.left > referenceRect.right ||
        rect.bottom < referenceRect.top ||
        rect.top > referenceRect.bottom + referenceRect.height * 0.08
      ) {
        continue;
      }

      const centerDistance = Math.abs(
        rect.left + rect.width / 2 - referenceCenterX,
      ) / Math.max(1, referenceRect.width);
      if (centerDistance > 0.24) continue;

      const verticalPosition =
        (rect.top - referenceRect.top) / Math.max(1, referenceRect.height);
      const numericWeight = Number(style.fontWeight) || 0;
      const score =
        fontSize * 2 -
        centerDistance * 80 +
        (verticalPosition >= 0.45 ? 20 : 0) +
        (numericWeight >= 600 ? 8 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    }

    return bestText;
  }

  function captionTextFromElements(elements, referenceRect, knownSelector) {
    const fragments = [];
    const seen = new Set();
    const interactiveSelector =
      "video, audio, button, input, select, textarea, [role='button'], [role='menuitem'], [role='switch'], [role='slider'], [role='progressbar']";

    for (const node of elements) {
      if (!(node instanceof Element)) continue;
      const raw = cleanCaptionText(node.textContent || "");
      if (!raw || raw.length > 320 || seen.has(raw)) continue;
      if (isCaptionControlText(raw)) continue;
      if (
        node.matches(interactiveSelector) ||
        node.closest(interactiveSelector) ||
        node.querySelector(interactiveSelector)
      ) {
        continue;
      }
      if (!knownSelector && node.children.length > 5) continue;

      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) === 0) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (referenceRect && !rectsAreNear(rect, referenceRect) && !knownSelector) continue;

      seen.add(raw);
      fragments.push(raw);
      if (fragments.join("\n").length > 300) break;
    }

    return fragments.join("\n");
  }

  function isCaptionControlText(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    return /^(?:cc|subtitles?(?: cc)?|(?:closed )?captions?(?: cc)?|(?:enable|disable|show|hide) (?:subtitles?|captions?))$/i.test(
      normalized,
    );
  }

  function querySelectorsDeep(root, selectors, limit = Infinity) {
    const results = [];
    const visit = (queryRoot) => {
      for (const selector of selectors) {
        let matches = [];
        try {
          matches = queryRoot.querySelectorAll(selector);
        } catch {}
        for (const match of matches) {
          if (!results.includes(match)) results.push(match);
          if (results.length >= limit) return;
        }
      }
      const elements = queryRoot.querySelectorAll?.("*") || [];
      for (const element of elements) {
        if (element.shadowRoot) visit(element.shadowRoot);
        if (results.length >= limit) return;
      }
    };
    visit(root);
    return results;
  }

  function collectDeep(root, selector) {
    const results = [];
    const visit = (queryRoot) => {
      try {
        results.push(...queryRoot.querySelectorAll(selector));
      } catch {}
      const elements = queryRoot.querySelectorAll?.("*") || [];
      for (const element of elements) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(root);
    return [...new Set(results)];
  }

  async function loadCaptionPreference(videoDescriptor, framePath) {
    const storageKey = captionVisibilityStorageKey(videoDescriptor, framePath);
    let enabled = false;
    try {
      const stored = await chrome.storage.local.get(storageKey);
      enabled = stored[storageKey] === true;
    } catch {}

    return {
      enabled,
      onChange(nextEnabled) {
        chrome.storage.local
          .set({ [storageKey]: Boolean(nextEnabled) })
          .catch(() => {});
      },
    };
  }

  function captionVisibilityStorageKey(videoDescriptor = {}, framePath = []) {
    const identity = JSON.stringify({
      page: String(videoDescriptor.page || ""),
      src: String(videoDescriptor.src || ""),
      id: String(videoDescriptor.id || ""),
      index: Number(videoDescriptor.index) || 0,
      frames: framePath.map((frame) => ({
        src: String(frame?.src || ""),
        id: String(frame?.id || ""),
        name: String(frame?.name || ""),
        index: Number(frame?.index) || 0,
      })),
    });
    const forwardHash = hashCaptionSourceIdentity(identity, 0x811c9dc5);
    const reverseHash = hashCaptionSourceIdentity(
      [...identity].reverse().join(""),
      0x9e3779b9,
    );
    return `${SUBTITLE_VISIBILITY_STORAGE_PREFIX}${forwardHash}.${reverseHash}`;
  }

  function hashCaptionSourceIdentity(value, seed) {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
  }

  function describeVideo(video) {
    const videos = collectDeep(document, "video");
    return {
      id: video.id || "",
      index: Math.max(0, videos.indexOf(video)),
      src: safeUrl(video.currentSrc || video.src || ""),
      page: safeUrl(location.href),
    };
  }

  function locateVideo(descriptor) {
    const videos = collectDeep(document, "video");
    if (descriptor.id) {
      const byId = videos.find((video) => video.id === descriptor.id);
      if (byId) return byId;
    }
    if (descriptor.src) {
      const bySrc = videos.find(
        (video) => safeUrl(video.currentSrc || video.src || "") === descriptor.src,
      );
      if (bySrc) return bySrc;
    }
    return videos[descriptor.index] || videos.find(isUsableVideo) || videos[0] || null;
  }

  function describeIframe(frame) {
    const frames = collectDeep(document, "iframe");
    return {
      id: frame.id || "",
      name: frame.name || "",
      src: safeUrl(frame.src || frame.getAttribute("src") || ""),
      index: Math.max(0, frames.indexOf(frame)),
    };
  }

  function locateIframe(descriptor) {
    const frames = collectDeep(document, "iframe");
    if (descriptor.id) {
      const byId = frames.find((frame) => frame.id === descriptor.id);
      if (byId) return byId;
    }
    if (descriptor.name) {
      const byName = frames.find((frame) => frame.name === descriptor.name);
      if (byName) return byName;
    }
    if (descriptor.src) {
      const bySrc = frames.find((frame) => safeUrl(frame.src || "") === descriptor.src);
      if (bySrc) return bySrc;
    }
    return frames[descriptor.index] || null;
  }

  function findDirectIframeByWindow(sourceWindow) {
    return collectDeep(document, "iframe").find(
      (frame) => frame.contentWindow === sourceWindow,
    );
  }

  function focusRoutedFrame(frame, sessionId) {
    if (!routedFrameStyles.has(sessionId)) {
      routedFrameStyles.set(sessionId, {
        frame,
        style: frame.getAttribute("style"),
      });
    }
    prepareFrameForPip(frame);
  }

  function restoreRoutedFrame(sessionId) {
    const saved = routedFrameStyles.get(sessionId);
    if (!saved) return;
    restoreStyleAttribute(saved.frame, saved.style);
    routedFrameStyles.delete(sessionId);
  }

  function prepareVideoForPip(video) {
    video.removeAttribute("controls");
    applyPipMediaGeometry(video);
  }

  function applyPipMediaGeometry(element) {
    for (const [property, value] of PIP_MEDIA_GEOMETRY) {
      element.style.setProperty(property, value, "important");
    }
  }

  function lockPipMediaGeometry(element) {
    applyPipMediaGeometry(element);
    const expected = new Map(
      PIP_MEDIA_GEOMETRY.map(([property]) => [property, element.style.getPropertyValue(property)]),
    );
    const geometryIsLocked = () =>
      PIP_MEDIA_GEOMETRY.every(
        ([property]) =>
          element.style.getPropertyPriority(property) === "important" &&
          element.style.getPropertyValue(property) === expected.get(property),
      );
    const observer = new MutationObserver(() => {
      if (element.isConnected && !geometryIsLocked()) applyPipMediaGeometry(element);
    });
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["style", "width", "height"],
    });
    return () => observer.disconnect();
  }

  async function refreshPipMediaCompositor(pipWindow, element) {
    if (!pipWindow || pipWindow.closed || !element?.isConnected) return;
    const previousVisibility = element.style.getPropertyValue("visibility");
    const previousVisibilityPriority = element.style.getPropertyPriority("visibility");
    element.style.setProperty("visibility", "hidden", "important");
    applyPipMediaGeometry(element);
    element.getBoundingClientRect();
    pipWindow.document.documentElement.getBoundingClientRect();

    await new Promise((resolve) => {
      pipWindow.requestAnimationFrame(() => {
        if (pipWindow.closed || !element.isConnected) {
          resolve();
          return;
        }
        applyPipMediaGeometry(element);
        element.getBoundingClientRect();
        pipWindow.requestAnimationFrame(resolve);
      });
    });

    if (previousVisibility) {
      element.style.setProperty(
        "visibility",
        previousVisibility,
        previousVisibilityPriority,
      );
    } else {
      element.style.removeProperty("visibility");
    }
  }

  function createPipMediaResizeStabilizer(pipWindow, stage, readAspect) {
    const root = pipWindow.document.documentElement;
    let settleTimer = 0;
    let revision = 0;
    let correcting = false;
    let expectedInnerSize = null;
    let lastObservedInnerSize = null;
    let destroyed = false;

    const updateMetrics = () => {
      if (pipWindow.closed || !stage?.isConnected) return null;
      const rect = stage.getBoundingClientRect();
      const sourceAspect = normalizePipAspect(readAspect?.());
      if (rect.width < 1 || rect.height < 1 || sourceAspect <= 0) return null;
      const pixelRatio = Math.max(1, Number(pipWindow.devicePixelRatio) || 1);
      const physicalWidth = Math.max(1, Math.round(rect.width * pixelRatio));
      const physicalHeight = Math.max(1, Math.round(rect.height * pixelRatio));
      const physicalGap = Math.abs(physicalWidth - physicalHeight * sourceAspect);
      root.dataset.pipMediaPhysicalWidth = String(physicalWidth);
      root.dataset.pipMediaPhysicalHeight = String(physicalHeight);
      root.dataset.pipMediaPhysicalGap = String(Math.round(physicalGap * 1000) / 1000);
      return {
        sourceAspect,
        pixelRatio,
        innerWidth: Math.max(1, Math.round(Number(pipWindow.innerWidth))),
        innerHeight: Math.max(1, Math.round(Number(pipWindow.innerHeight))),
      };
    };

    const setFit = (fit, state) => {
      root.style.setProperty("--cp-media-fit", fit);
      root.dataset.pipMediaFit = fit;
      root.dataset.pipResizeState = state;
    };

    const nearestPixelAlignedWidth = (metrics) => {
      const { sourceAspect, pixelRatio, innerWidth, innerHeight } = metrics;
      const projectedWidth = sourceAspect * (
        (sourceAspect * innerWidth + innerHeight) /
        (sourceAspect * sourceAspect + 1)
      );
      const centerWidth = Math.max(1, Math.round(projectedWidth));
      let best = null;
      const minimumWidth = Math.max(1, centerWidth - PIP_PIXEL_ALIGN_SEARCH_RADIUS);
      const maximumWidth = centerWidth + PIP_PIXEL_ALIGN_SEARCH_RADIUS;
      for (let width = minimumWidth; width <= maximumWidth; width += 1) {
        const height = Math.max(1, Math.round(width / sourceAspect));
        const physicalWidth = Math.round(width * pixelRatio);
        const physicalHeight = Math.round(height * pixelRatio);
        const pixelError = Math.abs(physicalWidth - physicalHeight * sourceAspect);
        const distance = Math.hypot(width - innerWidth, height - innerHeight);
        if (
          !best ||
          pixelError < best.pixelError - 0.0001 ||
          (Math.abs(pixelError - best.pixelError) <= 0.0001 && distance < best.distance)
        ) {
          best = { width, height, pixelError, distance };
        }
      }
      return best || { width: innerWidth, height: innerHeight };
    };

    const settleResize = async (scheduledRevision) => {
      settleTimer = 0;
      if (destroyed || correcting || pipWindow.closed || scheduledRevision !== revision) return;
      const metrics = updateMetrics();
      if (!metrics) return;
      correcting = true;
      const target = nearestPixelAlignedWidth(metrics);
      root.dataset.pipResizeTargetWidth = String(target.width);
      root.dataset.pipResizeTargetHeight = String(target.height);
      const response = await requestPipAspectResize(
        pipWindow,
        target.width,
        metrics.sourceAspect,
      );
      if (destroyed || pipWindow.closed || scheduledRevision !== revision) {
        correcting = false;
        return;
      }
      if (response?.updated) {
        expectedInnerSize = {
          width: Math.round(Number(response.innerWidth)),
          height: Math.round(Number(response.innerHeight)),
        };
        await waitForPipWindowLayout(pipWindow);
        const settledMetrics = updateMetrics();
        if (settledMetrics) {
          lastObservedInnerSize = {
            width: settledMetrics.innerWidth,
            height: settledMetrics.innerHeight,
          };
        }
        setFit("cover", "settled");
      } else {
        expectedInnerSize = null;
        setFit("contain", "correction-unavailable");
      }
      correcting = false;
    };

    const handleResize = () => {
      if (destroyed || pipWindow.closed || !stage?.isConnected) return;
      const metrics = updateMetrics();
      if (!metrics) return;
      const dimensionsChanged = !lastObservedInnerSize ||
        metrics.innerWidth !== lastObservedInnerSize.width ||
        metrics.innerHeight !== lastObservedInnerSize.height;
      lastObservedInnerSize = {
        width: metrics.innerWidth,
        height: metrics.innerHeight,
      };
      if (correcting) return;
      if (
        expectedInnerSize &&
        Math.abs(metrics.innerWidth - expectedInnerSize.width) <= 1 &&
        Math.abs(metrics.innerHeight - expectedInnerSize.height) <= 1
      ) {
        expectedInnerSize = null;
        setFit("cover", "settled");
        return;
      }
      if (!dimensionsChanged) return;
      expectedInnerSize = null;
      setFit("contain", "resizing");
      revision += 1;
      pipWindow.clearTimeout(settleTimer);
      const scheduledRevision = revision;
      settleTimer = pipWindow.setTimeout(
        () => void settleResize(scheduledRevision),
        PIP_RESIZE_SETTLE_DELAY,
      );
    };
    const resizeObserver = typeof pipWindow.ResizeObserver === "function"
      ? new pipWindow.ResizeObserver(handleResize)
      : null;
    const initialMetrics = updateMetrics();
    if (initialMetrics) {
      lastObservedInnerSize = {
        width: initialMetrics.innerWidth,
        height: initialMetrics.innerHeight,
      };
      setFit("contain", "fixed-opening");
      const openingRevision = revision;
      const openingInnerSize = { ...lastObservedInnerSize };
      void waitForPipWindowLayout(pipWindow).then(() => {
        if (destroyed || pipWindow.closed || revision !== openingRevision) return;
        const settledOpeningMetrics = updateMetrics();
        if (
          !settledOpeningMetrics ||
          settledOpeningMetrics.innerWidth !== openingInnerSize.width ||
          settledOpeningMetrics.innerHeight !== openingInnerSize.height
        ) {
          return;
        }
        setFit("cover", "opening-settled");
      });
    }
    resizeObserver?.observe(stage);
    return () => {
      destroyed = true;
      revision += 1;
      pipWindow.clearTimeout(settleTimer);
      resizeObserver?.disconnect();
    };
  }

  function prepareFrameForPip(frame) {
    frame.style.setProperty("position", "absolute", "important");
    frame.style.setProperty("inset", "0", "important");
    frame.style.setProperty("display", "block", "important");
    frame.style.setProperty("width", "100%", "important");
    frame.style.setProperty("height", "100%", "important");
    frame.style.setProperty("min-width", "0", "important");
    frame.style.setProperty("min-height", "0", "important");
    frame.style.setProperty("max-width", "none", "important");
    frame.style.setProperty("max-height", "none", "important");
    frame.style.setProperty("margin", "0", "important");
    frame.style.setProperty("padding", "0", "important");
    frame.style.setProperty("border", "0", "important");
    frame.style.setProperty("transform", "none", "important");
    frame.style.setProperty("z-index", "1", "important");
  }

  function cloneIframe(frame) {
    const clone = frame.cloneNode(false);
    const absoluteSrc = frame.src;
    if (absoluteSrc && !frame.hasAttribute("srcdoc")) clone.src = absoluteSrc;
    return clone;
  }

  function rememberNodeLocation(node) {
    return {
      document: node.ownerDocument,
      parent: node.parentNode,
      nextSibling: node.nextSibling,
    };
  }

  function restoreNodeLocation(node, original, placeholder = null) {
    if (placeholder?.isConnected && placeholder.parentNode) {
      placeholder.parentNode.replaceChild(node, placeholder);
      return;
    }
    if (!original.parent?.isConnected) return;
    if (original.nextSibling?.parentNode === original.parent) {
      original.parent.insertBefore(node, original.nextSibling);
    } else {
      original.parent.append(node);
    }
  }

  function createFlowPlaceholder(node, onStop, { visual = true } = {}) {
    const rect = node.getBoundingClientRect();
    const computed = getComputedStyle(node);
    const layoutWidth = Number(node.offsetWidth) || rect.width;
    const layoutHeight = Number(node.offsetHeight) || rect.height;
    const host = document.createElement("div");
    host.setAttribute("data-caption-pip-placeholder", "");
    setImportantStyles(host, {
      boxSizing: "border-box",
      display: computed.display === "inline" ? "inline-block" : computed.display,
      position: computed.position === "static" ? "relative" : computed.position,
      top: computed.top,
      right: computed.right,
      bottom: computed.bottom,
      left: computed.left,
      zIndex: computed.zIndex,
      width: `${layoutWidth}px`,
      height: `${layoutHeight}px`,
      minWidth: computed.minWidth,
      minHeight: computed.minHeight,
      maxWidth: computed.maxWidth,
      maxHeight: computed.maxHeight,
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,
      flex: computed.flex,
      order: computed.order,
      alignSelf: computed.alignSelf,
      gridArea: computed.gridArea,
      transform: computed.transform,
      transformOrigin: computed.transformOrigin,
      borderRadius: computed.borderRadius,
      overflow: "hidden",
      visibility: visual ? "visible" : "hidden",
      pointerEvents: visual ? "auto" : "none",
      background: visual ? "#0c0c11" : "transparent",
    });
    if (visual) mountPlaceholderContents(host, onStop);
    node.parentNode?.insertBefore(host, node);
    return host;
  }

  function createCoverPlaceholder(node, onStop) {
    const host = document.createElement("div");
    host.setAttribute("data-caption-pip-placeholder-cover", "");
    setImportantStyles(host, {
      position: "fixed",
      zIndex: "2147483647",
      display: "block",
      overflow: "hidden",
      background: "#0c0c11",
      pointerEvents: "auto",
    });
    mountPlaceholderContents(host, onStop);
    document.documentElement.append(host);

    let frame = 0;
    let lastRect = node.getBoundingClientRect();
    const update = () => {
      if (!host.isConnected) return;
      if (node.ownerDocument === document && node.isConnected) lastRect = node.getBoundingClientRect();
      host.style.setProperty("left", `${lastRect.left}px`, "important");
      host.style.setProperty("top", `${lastRect.top}px`, "important");
      host.style.setProperty("width", `${lastRect.width}px`, "important");
      host.style.setProperty("height", `${lastRect.height}px`, "important");
      host.style.setProperty(
        "visibility",
        lastRect.bottom > 0 && lastRect.top < innerHeight ? "visible" : "hidden",
        "important",
      );
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    const nativeRemove = host.remove.bind(host);
    host.remove = () => {
      cancelAnimationFrame(frame);
      nativeRemove();
    };
    return host;
  }

  function mountPlaceholderContents(host, onStop) {
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .wrap {
        box-sizing: border-box;
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        min-height: 72px;
        padding: 16px;
        color: #f7f5ff;
        background:
          radial-gradient(circle at 22% 20%, rgba(116,83,255,.28), transparent 38%),
          radial-gradient(circle at 82% 80%, rgba(39,190,171,.22), transparent 40%),
          #0c0c11;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: center;
      }
      .content { display: grid; justify-items: center; gap: 9px; }
      .icon {
        display: grid;
        place-items: center;
        width: 42px;
        height: 30px;
        border: 2px solid rgba(255,255,255,.92);
        border-radius: 8px;
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.2);
      }
      .icon::after {
        content: "";
        width: 17px;
        height: 11px;
        margin: 8px 0 0 14px;
        border-radius: 3px;
        background: linear-gradient(135deg, #896cff, #35c9b4);
      }
      strong { font-size: 14px; line-height: 1.2; }
      span { color: rgba(247,245,255,.65); font-size: 11px; }
      button {
        all: unset;
        margin-top: 2px;
        padding: 6px 10px;
        border: 1px solid rgba(255,255,255,.2);
        border-radius: 8px;
        color: #fff;
        background: rgba(255,255,255,.08);
        font: 650 11px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      button:hover { background: rgba(255,255,255,.15); }
      button:focus-visible { outline: 2px solid #9b87ff; outline-offset: 2px; }
    `;
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const content = document.createElement("div");
    content.className = "content";
    const icon = document.createElement("div");
    icon.className = "icon";
    const title = document.createElement("strong");
    title.textContent = "Playing in Picture-in-Picture";
    const detail = document.createElement("span");
    detail.textContent = "The player will return here when PiP closes.";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = "Stop PiP";
    stop.addEventListener("click", onStop);
    content.append(icon, title, detail, stop);
    wrap.append(content);
    shadow.append(style, wrap);
  }

  function snapshotVideo(video) {
    return {
      paused: video.paused,
      ended: video.ended,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: finiteDuration(video.duration),
      muted: video.muted,
      volume: Number.isFinite(video.volume) ? video.volume : 1,
      playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : 1,
      aspect: getVideoAspect(video),
    };
  }

  function setVideoVolume(video, value) {
    const nextVolume = clamp(value, 0, 1);
    if (nextVolume > 0) {
      lastAudibleVolumes.set(video, nextVolume);
      video.volume = nextVolume;
      video.muted = false;
      return;
    }

    if (video.volume > 0) lastAudibleVolumes.set(video, video.volume);
    video.volume = 0;
    video.muted = true;
  }

  function toggleVideoMute(video) {
    if (!video.muted && video.volume > 0) {
      lastAudibleVolumes.set(video, video.volume);
      video.muted = true;
      return;
    }

    if (video.volume === 0) {
      const rememberedVolume = clamp(lastAudibleVolumes.get(video) || 1, 0.01, 1);
      video.volume = rememberedVolume;
    } else {
      lastAudibleVolumes.set(video, video.volume);
    }
    video.muted = false;
  }

  function applyVideoState(video, state, restorePlayback) {
    if (!state) return;
    video.muted = Boolean(state.muted);
    if (Number.isFinite(state.volume)) video.volume = clamp(state.volume, 0, 1);
    if (Number.isFinite(state.playbackRate) && state.playbackRate > 0) {
      video.playbackRate = state.playbackRate;
    }

    const setTime = () => {
      if (Number.isFinite(state.currentTime)) seekVideoTo(video, state.currentTime);
      if (restorePlayback) {
        if (state.paused || state.ended) video.pause();
        else video.play().catch(() => {
          emitBridgeUp({
            type: "TARGET_ERROR",
            sessionId: targetSession?.id,
            message: "Press play in the embedded player to resume playback.",
          });
        });
      }
    };

    if (video.readyState >= 1) setTime();
    else video.addEventListener("loadedmetadata", setTime, { once: true });
  }

  function toggleVideoPlayback(video) {
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  }

  function seekVideo(video, seconds) {
    seekVideoTo(video, (Number(video.currentTime) || 0) + Number(seconds || 0));
  }

  function seekVideoForSite(video, time) {
    if (location.hostname === "www.netflix.com") {
      const duration = finiteDuration(video.duration);
      const next = clamp(Number(time) || 0, 0, duration || Number.MAX_SAFE_INTEGER);
      window.dispatchEvent(new CustomEvent(NETFLIX_SEEK_CHANNEL, {
        detail: { type: "SEEK_TO", time: next },
      }));
      return;
    }
    seekVideoTo(video, time);
  }

  function seekVideoTo(video, time) {
    const duration = finiteDuration(video.duration);
    const next = clamp(Number(time) || 0, 0, duration || Number.MAX_SAFE_INTEGER);
    try {
      video.currentTime = next;
    } catch {}
  }

  async function tryNativePip(video, reason) {
    if (!video?.requestPictureInPicture) {
      showToast(reason || "Picture-in-Picture is unavailable for this video.");
      return;
    }
    try {
      if (video.disablePictureInPicture) video.disablePictureInPicture = false;
      await video.requestPictureInPicture();
      showToast("Opened native PiP; custom subtitle styling is unavailable in fallback mode.", 3500);
    } catch (error) {
      showToast(readablePipError(error || reason));
    }
  }

  function getVideoAspect(video) {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      return video.videoWidth / video.videoHeight;
    }
    const rect = video.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9;
  }

  function normalizeSettings(value) {
    const settings = { ...DEFAULT_SETTINGS, ...(value || {}) };
    if (!FONT_FAMILIES[settings.font]) settings.font = DEFAULT_SETTINGS.font;
    settings.size = clamp(Number(settings.size) || DEFAULT_SETTINGS.size, 8, 48);
    settings.color = normalizeHex(settings.color, DEFAULT_SETTINGS.color);
    settings.textOpacity = clamp(Number(settings.textOpacity), 0.35, 1);
    settings.background = normalizeHex(settings.background, DEFAULT_SETTINGS.background);
    settings.backgroundOpacity = clamp(Number(settings.backgroundOpacity), 0, 1);
    settings.weight = [400, 500, 600, 700, 800].includes(Number(settings.weight))
      ? Number(settings.weight)
      : DEFAULT_SETTINGS.weight;
    settings.edge = Object.hasOwn(CAPTION_EDGE_STYLES, settings.edge)
      ? settings.edge
      : DEFAULT_SETTINGS.edge;
    settings.position = ["top", "center", "bottom"].includes(settings.position)
      ? settings.position
      : DEFAULT_SETTINGS.position;
    return settings;
  }

  function showToast(message, duration = 2300, tone = "neutral") {
    const existing = document.querySelector("[data-caption-pip-toast-host]");
    existing?.remove();
    const host = document.createElement("div");
    host.setAttribute("data-caption-pip-toast-host", "");
    host.setAttribute("data-caption-pip-toast-tone", tone === "info" ? "info" : "neutral");
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-label", String(message));
    setImportantStyles(host, {
      position: "fixed",
      left: "50%",
      bottom: "24px",
      transform: "translateX(-50%)",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    const shadow = host.attachShadow({ mode: "closed" });
    const box = document.createElement("div");
    box.style.cssText = `
      box-sizing:border-box;display:flex;align-items:center;gap:9px;
      max-width:min(520px,calc(100vw - 32px));padding:11px 14px;
      border:0;border-radius:11px;color:#fff;
      background:linear-gradient(180deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,.04) 26%,rgba(255,255,255,0) 52%),radial-gradient(140% 120% at 8% -22%,rgba(175,185,255,.13) 0%,rgba(175,185,255,0) 56%),rgba(18,18,25,.9);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.2),inset 0 -1px 0 rgba(255,255,255,.045),0 12px 35px rgba(0,0,0,.32);
      font:600 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      text-align:left;
    `;
    if (tone === "info") {
      const icon = createTablerIcon(document, "info-circle");
      icon.style.cssText = "width:18px;height:18px;flex:0 0 18px;color:#8ec5ff;";
      box.append(icon);
    }
    const label = document.createElement("span");
    label.textContent = String(message);
    box.append(label);
    shadow.append(box);
    document.documentElement.append(host);
    setTimeout(() => host.remove(), duration);
  }

  function readablePipError(error) {
    const message = typeof error === "string" ? error : error?.message || "";
    if (/user gesture|activation/i.test(message)) {
      return "Click the Caption PiP toolbar icon again to allow the floating window.";
    }
    if (/top-level/i.test(message)) {
      return "This embedded player cannot open Document PiP; trying Chrome’s native PiP.";
    }
    if (/not allowed|permission|policy/i.test(message)) {
      return "This site blocks Picture-in-Picture for the selected player.";
    }
    return message || "Could not open Picture-in-Picture for this video.";
  }

  function notifyRuntime(type, details = {}) {
    sendRuntime({ type, ...details });
  }

  function sendRuntime(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {}
  }

  function setImportantStyles(element, styles) {
    for (const [property, value] of Object.entries(styles)) {
      element.style.setProperty(kebabCase(property), value, "important");
    }
  }

  function restoreStyleAttribute(element, value) {
    if (value === null) element.removeAttribute("style");
    else element.setAttribute("style", value);
  }

  function element(doc, tag, className = "", text = "") {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function controlButton(doc, text, label, className = "") {
    const button = element(doc, "button", `cp-button ${className}`, text);
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    return button;
  }

  // SVG geometry is sourced from Tabler Icons' MIT-licensed outline set.
  // Keeping the paths local avoids runtime requests inside the PiP document.
  function createTablerIcon(doc, name) {
    const namespace = "http://www.w3.org/2000/svg";
    const definitions = {
      "player-play": [
        ["path", { d: "M7 4v16l13 -8l-13 -8" }],
      ],
      "player-pause": [
        ["path", { d: "M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12" }],
        ["path", { d: "M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12" }],
      ],
      "rewind-backward-10": [
        ["path", { d: "M7 9l-3 -3l3 -3" }],
        ["path", { d: "M15.997 17.918a6.002 6.002 0 0 0 -.997 -11.918h-11" }],
        ["path", { d: "M6 14v6" }],
        ["path", { d: "M9 15.5v3a1.5 1.5 0 0 0 3 0v-3a1.5 1.5 0 0 0 -3 0" }],
      ],
      "rewind-forward-10": [
        ["path", { d: "M17 9l3 -3l-3 -3" }],
        ["path", { d: "M8 17.918a5.997 5.997 0 0 1 -5 -5.918a6 6 0 0 1 6 -6h11" }],
        ["path", { d: "M12 14v6" }],
        ["path", { d: "M15 15.5v3a1.5 1.5 0 0 0 3 0v-3a1.5 1.5 0 0 0 -3 0" }],
      ],
      volume: [
        ["path", { d: "M15 8a5 5 0 0 1 0 8" }],
        ["path", { d: "M17.7 5a9 9 0 0 1 0 14" }],
        ["path", { d: "M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" }],
      ],
      "volume-4": [
        ["path", { d: "M9.5 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" }],
      ],
      "volume-2": [
        ["path", { d: "M15 8a5 5 0 0 1 0 8" }],
        ["path", { d: "M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" }],
      ],
      "volume-off": [
        ["path", { d: "M15 8a5 5 0 0 1 1.912 4.934m-1.377 2.602a5 5 0 0 1 -.535 .464" }],
        ["path", { d: "M17.7 5a9 9 0 0 1 2.362 11.086m-1.676 2.299a9 9 0 0 1 -.686 .615" }],
        ["path", { d: "M9.069 5.054l.431 -.554a.8 .8 0 0 1 1.5 .5v2m0 4v8a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l1.294 -1.664" }],
        ["path", { d: "M3 3l18 18" }],
      ],
      subtitles: [
        ["path", { d: "M18 5a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3l12 0" }],
        ["path", { d: "M7 15h5" }],
        ["path", { d: "M15 15h2" }],
        ["path", { d: "M17 12h-3" }],
        ["path", { d: "M11 12h-1" }],
      ],
      "picture-in-picture": [
        ["path", { d: "M11 19h-6a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v4" }],
        ["path", { d: "M14 15a1 1 0 0 1 1 -1h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1l0 -3" }],
      ],
      typography: [
        ["path", { d: "M4 20l3 0" }],
        ["path", { d: "M14 20l7 0" }],
        ["path", { d: "M6.9 15l6.9 0" }],
        ["path", { d: "M10.2 6.3l5.8 13.7" }],
        ["path", { d: "M5 20l6 -16l2 0l7 16" }],
      ],
      "arrow-back-up": [
        ["path", { d: "M9 14l-4 -4l4 -4" }],
        ["path", { d: "M5 10h11a4 4 0 1 1 0 8h-1" }],
      ],
      magnet: [
        ["path", { d: "M4 13v-8a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v8a2 2 0 0 0 6 0v-8a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v8a8 8 0 0 1 -16 0" }],
        ["path", { d: "M4 8l5 0" }],
        ["path", { d: "M15 8l4 0" }],
      ],
      maximize: [
        ["path", { d: "M4 8v-2a2 2 0 0 1 2 -2h2" }],
        ["path", { d: "M4 16v2a2 2 0 0 0 2 2h2" }],
        ["path", { d: "M16 4h2a2 2 0 0 1 2 2v2" }],
        ["path", { d: "M16 20h2a2 2 0 0 0 2 -2v-2" }],
      ],
      "aspect-ratio": [
        ["path", { d: "M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" }],
        ["path", { d: "M7 12v-3h3" }],
        ["path", { d: "M17 12v3h-3" }],
      ],
      x: [
        ["path", { d: "M18 6l-12 12" }],
        ["path", { d: "M6 6l12 12" }],
      ],
      "info-circle": [
        ["path", { d: "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" }],
        ["path", { d: "M12 9h.01" }],
        ["path", { d: "M11 12h1v4h1" }],
      ],
      "loader-2": [
        ["path", { d: "M12 3a9 9 0 1 0 9 9" }],
      ],
    };
    const svg = doc.createElementNS(namespace, "svg");
    svg.setAttribute("class", `cp-control-icon cp-icon-${name}`);
    svg.setAttribute("data-tabler-icon", name);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const [tag, attributes] of definitions[name] || []) {
      const node = doc.createElementNS(namespace, tag);
      for (const [attribute, value] of Object.entries(attributes)) {
        node.setAttribute(attribute, value);
      }
      svg.append(node);
    }
    return svg;
  }

  function cleanCaptionText(value) {
    if (!value) return "";
    const parser = new DOMParser();
    const parsed = parser.parseFromString(String(value).replace(/<br\s*\/?>/gi, "\n"), "text/html");
    return (parsed.body.textContent || "")
      .replace(/\u200b/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function safeRect(element) {
    try {
      return element?.getBoundingClientRect?.() || null;
    } catch {
      return null;
    }
  }

  function rectsAreNear(a, b) {
    const horizontalOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const verticalOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    if (horizontalOverlap > 0 && verticalOverlap > 0) return true;
    const centerX = Math.abs(a.left + a.width / 2 - (b.left + b.width / 2));
    const centerY = Math.abs(a.top + a.height / 2 - (b.top + b.height / 2));
    return centerX < Math.max(a.width, b.width) && centerY < Math.max(a.height, b.height) * 0.8;
  }

  function safeUrl(value) {
    if (!value) return "";
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return String(value);
    }
  }

  function finiteDuration(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function volumeLevelFor(volume) {
    const safeVolume = clamp(Number(volume) || 0, 0, 1);
    if (safeVolume < 1 / 3) return "low";
    if (safeVolume < 2 / 3) return "medium";
    return "high";
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function colorWithOpacity(hex, opacity) {
    const normalized = normalizeHex(hex, "#000000").slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${clamp(Number(opacity), 0, 1)})`;
  }

  function normalizeHex(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function kebabCase(value) {
    return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  }

  function createSessionId() {
    return `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  const PIP_STYLES = `
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #050507; }
    button, input, select { font: inherit; }
    .cp-root {
      --cp-caption-edge-offset: 10%;
      --cp-control-rail-height: 84px;
      --cp-media-fit: contain;
      --cp-glass-surface:
        linear-gradient(180deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,.045) 24%, rgba(255,255,255,0) 48%),
        radial-gradient(140% 120% at 8% -22%, rgba(175,185,255,.13) 0%, rgba(175,185,255,0) 56%),
        rgba(10,11,16,.82);
      --cp-glass-shadow:
        inset 0 1px 0 rgba(255,255,255,.2),
        inset 0 -1px 0 rgba(255,255,255,.045),
        0 8px 24px rgba(0,0,0,.28);
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      color: #fff;
      background: #050507;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      user-select: none;
    }
    .cp-stage { position: absolute; inset: 0; display: grid; place-items: center; overflow: hidden; background: #050507; cursor: grab; }
    .cp-stage > * { cursor: grab !important; -webkit-user-drag: none; }
    .cp-window-dragging .cp-stage, .cp-window-dragging .cp-stage > * { cursor: grabbing !important; }
    .cp-stage > video, .cp-stage > canvas, .cp-stage > iframe {
      box-sizing: border-box !important;
      position: absolute !important;
      inset: auto !important;
      left: 0 !important;
      top: 0 !important;
      right: auto !important;
      bottom: auto !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      object-fit: var(--cp-media-fit, contain) !important;
      object-position: 0 0 !important;
      transform: none !important;
      transform-origin: 0 0 !important;
      translate: none !important;
      scale: none !important;
      rotate: none !important;
      clip-path: none !important;
    }
    .cp-loading {
      position: absolute;
      z-index: 3;
      left: 50%;
      top: 50%;
      max-width: 80%;
      transform: translate(-50%, -50%);
      padding: 10px 14px;
      border: 0;
      border-radius: 10px;
      color: rgba(255,255,255,.82);
      background: var(--cp-glass-surface);
      box-shadow: var(--cp-glass-shadow);
      font-size: 12px;
      text-align: center;
      pointer-events: none;
    }
    .cp-loading[hidden] { display: none; }
    .cp-captions {
      position: absolute;
      z-index: 5;
      left: 50%;
      width: min(calc(100% - 16px), 960px);
      text-align: center;
      line-height: 1.28;
      pointer-events: none;
      transition: top .18s ease, bottom .18s ease, opacity .14s ease;
    }
    .cp-captions[data-position="bottom"] { bottom: var(--cp-caption-edge-offset); transform: translateX(-50%); }
    .cp-captions[data-position="center"] { top: 50%; transform: translate(-50%, -50%); }
    .cp-captions[data-position="top"] { top: var(--cp-caption-edge-offset); transform: translateX(-50%); }
    .cp-root:is(.cp-controls-visible, .cp-paused, .cp-panel-open, .cp-volume-active) .cp-captions[data-position="bottom"] {
      bottom: calc(var(--cp-control-rail-height) + var(--cp-caption-edge-offset));
    }
    .cp-caption-text {
      display: inline;
      padding: .13em .36em .18em;
      border-radius: .25em;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      white-space: pre-line;
      -webkit-font-smoothing: antialiased;
    }
    .cp-captions.cp-empty, .cp-captions.cp-hidden { opacity: 0; }
    .cp-top-controls {
      position: absolute;
      z-index: 9;
      top: 8px;
      left: 8px;
      right: 8px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: start;
      opacity: 0;
      transform: translateY(-7px);
      transition: opacity .16s ease, transform .16s ease;
      pointer-events: none;
    }
    .cp-top-action {
      display: flex;
      padding: 2px;
      border-radius: 50%;
      background: var(--cp-glass-surface);
      box-shadow: var(--cp-glass-shadow);
      pointer-events: none;
    }
    .cp-top-group { display: flex; align-items: flex-start; gap: 6px; }
    .cp-top-group-left { justify-self: start; }
    .cp-top-action-left { justify-self: start; }
    .cp-top-action-center { justify-self: center; }
    .cp-top-action-right { justify-self: end; }
    .cp-controls-visible .cp-top-controls, .cp-paused .cp-top-controls, .cp-panel-open .cp-top-controls, .cp-volume-active .cp-top-controls {
      opacity: 1;
      transform: translateY(0);
    }
    .cp-controls-visible .cp-top-action, .cp-paused .cp-top-action, .cp-panel-open .cp-top-action, .cp-volume-active .cp-top-action {
      pointer-events: auto;
    }
    .cp-top-controls .cp-button {
      min-width: 40px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
    }
    .cp-top-controls .cp-control-icon { width: 20px; height: 20px; }
    .cp-corner-snap .cp-control-icon,
    .cp-cc .cp-control-icon,
    .cp-mute .cp-control-icon {
      transition: opacity .14s ease;
    }
    .cp-corner-snap.cp-active .cp-control-icon,
    .cp-cc.cp-active .cp-control-icon,
    .cp-mute.cp-active .cp-control-icon { opacity: 1; }
    .cp-corner-snap:not(.cp-active) .cp-control-icon,
    .cp-cc:not(.cp-active) .cp-control-icon,
    .cp-mute:not(.cp-active) .cp-control-icon { opacity: .42; }
    .cp-controls {
      position: absolute;
      z-index: 8;
      left: 8px;
      right: 8px;
      bottom: 8px;
      display: grid;
      grid-template-rows: 40px 18px;
      row-gap: 3px;
      min-height: 76px;
      padding: 7px 14px 8px;
      border-radius: 6px;
      background: var(--cp-glass-surface);
      box-shadow: var(--cp-glass-shadow);
      opacity: 0;
      transform: translateY(7px);
      transition: opacity .16s ease, transform .16s ease;
      pointer-events: none;
    }
    .cp-controls-visible .cp-controls, .cp-paused .cp-controls, .cp-panel-open .cp-controls, .cp-volume-active .cp-controls {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .cp-primary-row, .cp-progress-row { min-width: 0; }
    .cp-primary-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
    }
    .cp-transport, .cp-subtitle-actions {
      display: flex;
      align-items: center;
    }
    .cp-transport {
      grid-column: 2;
      justify-self: center;
      gap: 4px;
    }
    .cp-subtitle-actions {
      grid-column: 3;
      justify-self: end;
      gap: 2px;
    }
    .cp-progress-row {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr) max-content;
      align-items: center;
      gap: 10px;
    }
    .cp-button {
      appearance: none;
      display: inline-grid;
      place-items: center;
      flex: 0 0 auto;
      min-width: 40px;
      height: 40px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      color: rgba(255,255,255,.9);
      background: transparent;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
      transition: color .12s ease, background .12s ease, box-shadow .12s ease;
    }
    .cp-button:hover { color: #fff; background: rgba(255,255,255,.1); }
    .cp-button:focus-visible {
      outline: none;
      color: #fff;
      background: rgba(126,96,255,.38);
      box-shadow: 0 8px 22px rgba(86,61,207,.42);
    }
    .cp-volume-slider:focus-visible, .cp-panel button:focus-visible, .cp-panel select:focus-visible, .cp-panel input:focus-visible {
      outline: none;
    }
    .cp-panel button:focus-visible, .cp-panel select:focus-visible, .cp-panel input[type="color"]:focus-visible {
      background-color: rgba(126,96,255,.3);
    }
    .cp-control-icon {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .cp-play .cp-control-icon { width: 26px; height: 26px; }
    .cp-play[data-state="play"] .cp-icon-player-pause,
    .cp-play[data-state="pause"] .cp-icon-player-play { display: none; }
    .cp-seek {
      width: 40px;
      min-width: 40px;
      height: 40px;
      border-radius: 8px;
      color: rgba(255,255,255,.94);
    }
    .cp-seek:hover { background: rgba(255,255,255,.08); }
    .cp-volume-control {
      position: relative;
      display: grid;
      grid-template-columns: 40px minmax(52px, 1fr);
      grid-column: 1;
      justify-self: start;
      width: min(176px, 100%);
      min-width: 0;
      height: 40px;
      align-items: center;
      gap: 6px;
    }
    .cp-mute {
      width: 40px;
      min-width: 40px;
      padding: 0;
    }
    .cp-mute .cp-control-icon { display: none; width: 20px; height: 20px; }
    .cp-mute[data-muted="false"][data-level="low"] .cp-icon-volume-4,
    .cp-mute[data-muted="false"][data-level="medium"] .cp-icon-volume-2,
    .cp-mute[data-muted="false"][data-level="high"] .cp-icon-volume,
    .cp-mute[data-muted="true"] .cp-icon-volume-off { display: block; }
    .cp-volume-slider {
      appearance: none;
      width: 100%;
      min-width: 0;
      height: 18px;
      margin: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
    }
    .cp-volume-slider::-webkit-slider-runnable-track {
      height: 3px;
      border-radius: 999px;
      background: linear-gradient(to right, #e5e7eb 0 var(--cp-volume, 100%), rgba(255,255,255,.24) var(--cp-volume, 100%) 100%);
    }
    .cp-volume-slider::-webkit-slider-thumb {
      appearance: none;
      width: 10px;
      height: 10px;
      margin-top: -3.5px;
      border: 0;
      border-radius: 50%;
      background: #f8fafc;
      box-shadow: 0 1px 5px rgba(0,0,0,.55), 0 0 8px rgba(255,255,255,.2);
    }
    .cp-cc, .cp-aa { min-width: 40px; }
    .cp-cc { position: relative; }
    .cp-timeline {
      appearance: none;
      width: 100%;
      min-width: 0;
      height: 18px;
      margin: 0;
      background: transparent;
      cursor: pointer;
    }
    .cp-timeline:disabled { opacity: .45; cursor: default; }
    .cp-timeline::-webkit-slider-runnable-track {
      height: 4px;
      border-radius: 999px;
      background: linear-gradient(
        to right,
        #8064ff 0 var(--cp-progress, 0%),
        rgba(255,255,255,.24) var(--cp-progress, 0%) 100%
      );
    }
    .cp-timeline::-webkit-slider-thumb {
      appearance: none;
      width: 10px;
      height: 10px;
      margin-top: -3.5px;
      border: 0;
      border-radius: 50%;
      background: #fdfcff;
      box-shadow: 0 1px 5px rgba(0,0,0,.55), 0 0 10px rgba(128,100,255,.46);
    }
    .cp-time {
      display: block;
      min-width: 8ch;
      color: rgba(255,255,255,.92);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .cp-time-current { font-weight: 650; text-align: left; }
    .cp-time-duration { color: rgba(255,255,255,.58); text-align: right; }
    .cp-panel {
      --cp-panel-max-height: calc(100vh - 102px);
      position: absolute;
      z-index: 12;
      right: 10px;
      bottom: 92px;
      width: min(292px, calc(100% - 20px));
      max-height: var(--cp-panel-max-height);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 14px;
      color: #f7f5ff;
      background: var(--cp-glass-surface);
      box-shadow: var(--cp-glass-shadow);
      font-size: 12px;
      user-select: none;
    }
    .cp-panel[hidden] { display: none; }
    .cp-panel-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
      padding: 0 14px 14px;
    }
    .cp-panel-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
    .cp-panel-scroll::-webkit-scrollbar-track { background: transparent; margin-block: 10px; }
    .cp-panel-scroll::-webkit-scrollbar-thumb {
      border: 1px solid transparent;
      border-radius: 999px;
      background: rgba(255,255,255,.38);
      background-clip: padding-box;
    }
    .cp-panel-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.58); background-clip: padding-box; }
    .cp-panel-scroll::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
    .cp-panel-scroll::-webkit-scrollbar-corner { background: transparent; }
    .cp-panel-header, .cp-field-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .cp-panel-header {
      position: relative;
      z-index: 2;
      flex: 0 0 auto;
      padding: 14px 14px 8px;
    }
    .cp-panel-header strong { font-size: 13px; }
    .cp-panel-close {
      appearance: none;
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      color: rgba(255,255,255,.72);
      background: transparent;
      cursor: pointer;
      transition: background .12s ease, color .12s ease, transform .12s ease;
    }
    .cp-panel-close:hover { color: #fff; background: rgba(255,255,255,.1); }
    .cp-panel-close:active { transform: translateY(1px); }
    .cp-panel-close .cp-control-icon { width: 16px; height: 16px; }
    .cp-field { display: grid; gap: 6px; margin-top: 10px; }
    .cp-panel-scroll > .cp-field:first-child { margin-top: 2px; }
    .cp-color-field { grid-template-columns: 1fr auto; align-items: center; }
    .cp-field-label { color: rgba(255,255,255,.72); font-size: 10px; font-weight: 650; }
    .cp-output { color: rgba(255,255,255,.5); font-size: 10px; font-variant-numeric: tabular-nums; }
    .cp-select {
      width: 100%;
      height: 29px;
      padding: 0 8px;
      border: 0;
      border-radius: 7px;
      color: #fff;
      background: #292732;
      font-size: 11px;
    }
    .cp-range { appearance: none; width: 100%; height: 14px; margin: 0; background: transparent; }
    .cp-range::-webkit-slider-runnable-track { height: 3px; border-radius: 99px; background: rgba(255,255,255,.22); }
    .cp-range::-webkit-slider-thumb { appearance: none; width: 12px; height: 12px; margin-top: -4.5px; border: 0; border-radius: 50%; background: #fdfcff; box-shadow: 0 0 8px rgba(128,100,255,.55); }
    .cp-color { appearance: none; width: 34px; height: 25px; padding: 2px; border: 0; border-radius: 7px; background: #292732; cursor: pointer; }
    .cp-color::-webkit-color-swatch-wrapper { padding: 0; }
    .cp-color::-webkit-color-swatch { border: 0; border-radius: 4px; }
    .cp-segments { display: grid; grid-template-columns: repeat(3,1fr); gap: 3px; padding: 3px; border-radius: 8px; background: rgba(255,255,255,.07); }
    .cp-segments button { appearance: none; border: 0; border-radius: 6px; padding: 6px; color: rgba(255,255,255,.58); background: transparent; font-size: 10px; cursor: pointer; }
    .cp-segments button.cp-selected { color: #fff; background: rgba(126,96,255,.55); }
    @media (max-width: 470px) {
      .cp-controls {
        padding-inline: 6px;
      }
      .cp-button { min-width: 36px; }
      .cp-seek { width: 34px; min-width: 34px; height: 34px; }
      .cp-transport { gap: 2px; }
      .cp-subtitle-actions { gap: 0; }
      .cp-volume-control { grid-template-columns: 34px minmax(36px, 1fr); width: min(142px, 100%); gap: 4px; }
      .cp-mute { width: 36px; min-width: 36px; padding: 0; }
      .cp-cc, .cp-aa { min-width: 36px; }
      .cp-progress-row { gap: 6px; }
      .cp-time { font-size: 10px; }
    }
    @media (max-width: 340px) {
      .cp-controls {
        padding-inline: 4px;
      }
      .cp-button { min-width: 32px; height: 36px; }
      .cp-seek { width: 30px; min-width: 30px; height: 30px; }
      .cp-seek .cp-control-icon { width: 22px; height: 22px; }
      .cp-transport { gap: 0; }
      .cp-volume-control { grid-template-columns: 30px minmax(32px, 1fr); width: 100%; height: 36px; gap: 3px; }
      .cp-mute { width: 32px; min-width: 32px; }
      .cp-cc, .cp-aa { min-width: 32px; }
      .cp-progress-row { gap: 4px; }
      .cp-time { font-size: 9px; }
    }
    @media (max-width: 280px) {
      .cp-top-controls .cp-button { min-width: 36px; width: 36px; height: 36px; }
      .cp-top-action { padding: 1px; }
      .cp-top-group { gap: 4px; }
    }
    @media (max-height: 300px) {
      .cp-root { --cp-control-rail-height: 66px; }
      .cp-panel {
        --cp-panel-max-height: calc(100vh - 80px);
        right: 8px;
        bottom: 72px;
        width: min(292px, calc(100% - 16px));
      }
      .cp-controls {
        bottom: 6px;
        grid-template-rows: 32px 14px;
        min-height: 60px;
        row-gap: 2px;
        padding-block: 4px 6px;
      }
      .cp-button, .cp-volume-control, .cp-mute { height: 32px; }
    }
  `;
})();
