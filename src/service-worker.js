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
const TOOLBAR_THEME_MESSAGE = "CAPTION_PIP_TOOLBAR_THEME";
const CORNER_SNAP_SET_ENABLED_MESSAGE = "CAPTION_PIP_CORNER_SNAP_SET_ENABLED";
const PIP_SURFACE_DRAG_START_MESSAGE = "CAPTION_PIP_SURFACE_DRAG_START";
const PIP_SURFACE_DRAG_MOVE_MESSAGE = "CAPTION_PIP_SURFACE_DRAG_MOVE";
const PIP_SURFACE_DRAG_END_MESSAGE = "CAPTION_PIP_SURFACE_DRAG_END";
const FOCUS_PRESENTATION_MESSAGE = "CAPTION_PIP_FOCUS_PRESENTATION";
const NO_VIDEO_INFORMATION = "No video is available in this tab.";
const INITIAL_PIP_DISCOVERY_DELAYS = Object.freeze([0, 40, 80, 120, 180, 260]);
const CORNER_SNAP_STORAGE_KEY = "captionPipCornerSnapWindowsV1";
const PINNED_EDGE_PADDING = 15;
const DOCUMENT_PIP_MIN_INNER_WIDTH = 240;
const DOCUMENT_PIP_MIN_INNER_HEIGHT = 52;
const DOCUMENT_PIP_MAX_SCREEN_RATIO = 0.8;
const ACTION_ICON_PATHS = Object.freeze({
  light: Object.freeze({
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
  }),
  dark: Object.freeze({
    16: "icons/dark/icon-16.png",
    32: "icons/dark/icon-32.png",
    48: "icons/dark/icon-48.png",
  }),
});
const embeddedSessions = new Map();
const recentlyCreatedWindows = new Map();
const cornerSnapWindows = new Map();
const cornerSnapEnabledByTab = new Map();
const cornerSnapInFlight = new Set();
const pipSurfaceDragWindows = new Map();
const pipSizeOperations = new Map();
const cornerSnapStateReady = restoreCornerSnapState();
let cornerSnapPersistence = Promise.resolve();
let focusedDocumentPipWindowId = null;

chrome.windows?.onCreated?.addListener((browserWindow) => {
  if (!Number.isInteger(browserWindow?.id)) return;
  recentlyCreatedWindows.set(browserWindow.id, Date.now());
  setTimeout(() => recentlyCreatedWindows.delete(browserWindow.id), 30_000);
});

chrome.windows?.onRemoved?.addListener((windowId) => {
  recentlyCreatedWindows.delete(windowId);
  pipSurfaceDragWindows.delete(windowId);
  if (focusedDocumentPipWindowId === windowId) setFocusedDocumentPipWindow(null);
  void forgetCornerSnapWindow(windowId);
});

chrome.windows?.onFocusChanged?.addListener((windowId) => {
  setFocusedDocumentPipWindow(cornerSnapWindows.has(windowId) ? windowId : null);
});

chrome.windows?.onBoundsChanged?.addListener((browserWindow) => {
  void constrainDocumentPipToSafeArea(browserWindow);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: "#7c5cff" });
  chrome.storage.local
    .remove([
      "pipTopBarHeight",
      "pipHorizontalInset",
      "pipInitialWidthCorrection",
      "captionPipFrameCalibrationsV1",
      "captionPipFrameCalibrationsV2",
      "captionPipFrameCalibrationsV4",
    ])
    .catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  launchBestVideo(tab.id);
});

async function launchBestVideo(tabId) {
  const reservationPromise = chrome.tabs
    .sendMessage(tabId, { type: RESERVE_PIP_MESSAGE }, { frameId: 0 })
    .catch((error) => ({ reserved: false, error: error?.message || String(error) }));
  const candidatesPromise = collectVideoCandidates(tabId);

  try {
    const [reservation, candidates] = await Promise.all([
      reservationPromise,
      candidatesPromise,
    ]);
    if (reservation?.active) return;

    const selected = chooseVideoCandidate(candidates);
    if (!selected) {
      if (reservation?.reserved) await cancelPipReservation(tabId);
      await showInformationToast(tabId, NO_VIDEO_INFORMATION);
      return;
    }
    if (!reservation?.reserved) {
      await showInformationToast(
        tabId,
        `Picture-in-Picture could not open: ${reservation?.error || "the window reservation failed."}`,
      );
      await flashBadge(tabId, "R");
      return;
    }

    const result = await chrome.tabs.sendMessage(
      tabId,
      {
        type: OPEN_CANDIDATE_MESSAGE,
        video: selected.video,
      },
      { frameId: selected.frameId },
    );
    if (!result?.started) {
      await cancelPipReservation(tabId);
      await showInformationToast(
        tabId,
        "Picture-in-Picture could not open because the selected video changed before it could be attached.",
      );
      await flashBadge(tabId, "V");
    }
  } catch (error) {
    await cancelPipReservation(tabId);
    await showInformationToast(
      tabId,
      `Picture-in-Picture could not open: ${error?.message || String(error)}`,
    );
    await flashBadge(tabId, "E");
  }
}

async function collectVideoCandidates(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const deliveries = await Promise.allSettled(
    frames.map(async (frame) => ({
      frameId: frame.frameId,
      response: await chrome.tabs.sendMessage(
        tabId,
        { type: CANDIDATE_MESSAGE },
        { frameId: frame.frameId },
      ),
    })),
  );
  return deliveries
    .filter((delivery) => delivery.status === "fulfilled")
    .map((delivery) => delivery.value)
    .filter(({ response }) => response?.candidate)
    .map(({ frameId, response }) => ({
      frameId,
      ...response.candidate,
    }));
}

function chooseVideoCandidate(candidates) {
  return [...candidates].sort((first, second) => {
    const firstScore = Number(first.score) + (first.frameId === 0 ? 25_000 : 0);
    const secondScore = Number(second.score) + (second.frameId === 0 ? 25_000 : 0);
    const scoreDifference = secondScore - firstScore;
    if (scoreDifference) return scoreDifference;
    if (first.frameId === 0) return -1;
    if (second.frameId === 0) return 1;
    return first.frameId - second.frameId;
  })[0] || null;
}

async function cancelPipReservation(tabId) {
  await chrome.tabs
    .sendMessage(tabId, { type: CANCEL_RESERVATION_MESSAGE }, { frameId: 0 })
    .catch(() => {});
}

async function showInformationToast(tabId, message) {
  await chrome.tabs
    .sendMessage(
      tabId,
      { type: SHOW_INFORMATION_TOAST_MESSAGE, message },
      { frameId: 0 },
    )
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message?.type === FOCUSED_PIP_WHEEL_STATE_QUERY_MESSAGE) {
    sendResponse({ enabled: Number.isInteger(focusedDocumentPipWindowId) });
    return;
  }

  if (message?.type === TOOLBAR_THEME_MESSAGE && Number.isInteger(tabId)) {
    const theme = message.theme === "dark" ? "dark" : "light";
    chrome.action
      .setIcon({ tabId, path: ACTION_ICON_PATHS[theme] })
      .catch(() => {});
    return;
  }

  if (message?.type === "CAPTION_PIP_REGISTER_EMBEDDED_SESSION" && tabId) {
    embeddedSessions.set(message.sessionId, tabId);
    return;
  }

  if (message?.type === "CAPTION_PIP_UNREGISTER_EMBEDDED_SESSION") {
    embeddedSessions.delete(message.sessionId);
    return;
  }

  if (message?.type === "CAPTION_PIP_EMBEDDED_STATUS") {
    const sessionId = message.status?.sessionId;
    const destinationTabId = embeddedSessions.get(sessionId) || tabId;
    if (destinationTabId && sessionId) {
      chrome.tabs
        .sendMessage(
          destinationTabId,
          { type: "CAPTION_PIP_EMBEDDED_STATUS", status: message.status },
          { frameId: 0 },
        )
        .catch(() => {});
    }
    return;
  }

  if (!tabId) return;

  if (message?.type === FOCUSED_PIP_WHEEL_INPUT_MESSAGE) {
    relayFocusedPipWheelInput(message).then(sendResponse);
    return true;
  }

  if (message?.type === REGISTER_PIP_WINDOW_MESSAGE && sender.frameId === 0) {
    registerDocumentPipWindow(
      tabId,
      sender.tab.windowId,
      message.cornerSnapEnabled,
      message.requestedAt,
    )
      .then(sendResponse);
    return true;
  }

  if (message?.type === SET_PIP_SIZE_MESSAGE && sender.frameId === 0) {
    queueDocumentPipSize(tabId, sender.tab.windowId, message).then(sendResponse);
    return true;
  }

  if (message?.type === CORNER_SNAP_SET_ENABLED_MESSAGE) {
    const enabled = message.enabled !== false;
    cornerSnapEnabledByTab.set(tabId, enabled);
    setCornerSnapEnabledForTab(tabId, enabled, sender.tab.windowId)
      .then(() => sendResponse({ enabled }));
    return true;
  }

  if (message?.type === PIP_SURFACE_DRAG_START_MESSAGE && sender.frameId === 0) {
    startPipSurfaceDrag(tabId, sender.tab.windowId, message).then(sendResponse);
    return true;
  }

  if (message?.type === PIP_SURFACE_DRAG_MOVE_MESSAGE && sender.frameId === 0) {
    sendResponse(queuePipSurfaceDrag(tabId, message));
    return;
  }

  if (message?.type === PIP_SURFACE_DRAG_END_MESSAGE && sender.frameId === 0) {
    endPipSurfaceDrag(tabId, message).then(sendResponse);
    return true;
  }

  if (message?.type === FOCUS_PRESENTATION_MESSAGE && sender.frameId === 0) {
    focusPresentationTab(tabId, sender.tab.windowId).then(sendResponse);
    return true;
  }

  if (message?.type === "CAPTION_PIP_SESSION_STARTED") {
    const enabled = message.cornerSnapEnabled !== false;
    cornerSnapEnabledByTab.set(tabId, enabled);
    void discoverCornerSnapWindow(tabId, sender.tab.windowId);
    chrome.action.setBadgeText({ tabId, text: "ON" });
    chrome.action.setTitle({
      tabId,
      title: "Caption PiP is active — click to focus it",
    });
  }

  if (message?.type === "CAPTION_PIP_SESSION_ENDED") {
    pipSizeOperations.delete(tabId);
    void forgetCornerSnapTab(tabId);
    chrome.action.setBadgeText({ tabId, text: "" });
    chrome.action.setTitle({
      tabId,
      title: "Open Caption PiP for the active video",
    });
  }
});

async function focusPresentationTab(tabId, windowId) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    return { focused: false };
  }
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
    return { focused: true };
  } catch {
    return { focused: false };
  }
}

function setFocusedDocumentPipWindow(windowId) {
  const nextWindowId = Number.isInteger(windowId) ? windowId : null;
  if (focusedDocumentPipWindowId === nextWindowId) return;
  focusedDocumentPipWindowId = nextWindowId;
  void broadcastFocusedPipWheelState();
}

async function broadcastFocusedPipWheelState() {
  const enabled = Number.isInteger(focusedDocumentPipWindowId);
  const tabs = typeof chrome.tabs.query === "function"
    ? await chrome.tabs.query({}).catch(() => [])
    : [];
  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) =>
        chrome.tabs
          .sendMessage(
            tab.id,
            { type: FOCUSED_PIP_WHEEL_STATE_MESSAGE, enabled },
          )
          .catch(() => {}),
      ),
  );
}

async function relayFocusedPipWheelInput(message) {
  const record = cornerSnapWindows.get(focusedDocumentPipWindowId);
  const deltaY = Number(message.deltaY);
  const deltaMode = Number(message.deltaMode) || 0;
  if (!record || !Number.isFinite(deltaY) || deltaY === 0) {
    return { handled: false };
  }
  const focusedWindow = await chrome.windows.get(record.windowId).catch(() => null);
  if (focusedWindow?.focused !== true) {
    setFocusedDocumentPipWindow(null);
    return { handled: false };
  }
  return chrome.tabs
    .sendMessage(
      record.tabId,
      {
        type: FOCUSED_PIP_WHEEL_RELAY_MESSAGE,
        deltaY,
        deltaMode,
      },
      { frameId: 0 },
    )
    .catch(() => ({ handled: false }));
}

async function startPipSurfaceDrag(tabId, openerWindowId, message) {
  const pointerX = Number(message.pointerX);
  const pointerY = Number(message.pointerY);
  const dragId = String(message.dragId || "");
  if (!dragId || !Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
    return { started: false };
  }

  await cornerSnapStateReady;
  let record = findCornerSnapRecordForTab(tabId);
  if (!record) {
    await discoverCornerSnapWindow(tabId, openerWindowId);
    record = findCornerSnapRecordForTab(tabId);
  }
  if (!record) return { started: false };

  try {
    const browserWindow = await chrome.windows.get(record.windowId);
    if (
      browserWindow.state && browserWindow.state !== "normal" ||
      !Number.isFinite(Number(browserWindow.left)) ||
      !Number.isFinite(Number(browserWindow.top)) ||
      !Number.isFinite(Number(browserWindow.width)) ||
      !Number.isFinite(Number(browserWindow.height))
    ) {
      return { started: false };
    }
    for (const [windowId, session] of pipSurfaceDragWindows) {
      if (session.tabId === tabId) pipSurfaceDragWindows.delete(windowId);
    }
    pipSurfaceDragWindows.set(record.windowId, {
      dragId,
      tabId,
      windowId: record.windowId,
      pointerStartX: pointerX,
      pointerStartY: pointerY,
      windowStartLeft: Number(browserWindow.left),
      windowStartTop: Number(browserWindow.top),
      windowStartWidth: Math.round(Number(browserWindow.width)),
      windowStartHeight: Math.round(Number(browserWindow.height)),
      pending: null,
      flushPromise: null,
      lastLeft: Number(browserWindow.left),
      lastTop: Number(browserWindow.top),
    });
    return { started: true };
  } catch {
    return { started: false };
  }
}

function queuePipSurfaceDrag(tabId, message) {
  const session = findPipSurfaceDrag(tabId, message.dragId);
  const pointerX = Number(message.pointerX);
  const pointerY = Number(message.pointerY);
  if (!session || !Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
    return { queued: false };
  }
  session.pending = { pointerX, pointerY };
  void flushPipSurfaceDrag(session);
  return { queued: true };
}

async function endPipSurfaceDrag(tabId, message) {
  const session = findPipSurfaceDrag(tabId, message.dragId);
  if (!session) return { ended: false };
  const pointerX = Number(message.pointerX);
  const pointerY = Number(message.pointerY);
  const moved = message.moved === true;
  if (moved && Number.isFinite(pointerX) && Number.isFinite(pointerY)) {
    session.pending = { pointerX, pointerY };
    await flushPipSurfaceDrag(session);
  } else if (session.flushPromise) {
    await session.flushPromise;
  }
  if (pipSurfaceDragWindows.get(session.windowId) === session) {
    pipSurfaceDragWindows.delete(session.windowId);
  }
  if (moved) {
    const browserWindow = await chrome.windows.get(session.windowId).catch(() => null);
    if (browserWindow) await constrainDocumentPipToSafeArea(browserWindow);
  }
  return { ended: true };
}

function findPipSurfaceDrag(tabId, dragId) {
  const expectedDragId = String(dragId || "");
  for (const session of pipSurfaceDragWindows.values()) {
    if (session.tabId === tabId && session.dragId === expectedDragId) return session;
  }
  return null;
}

function findCornerSnapRecordForTab(tabId) {
  for (const record of cornerSnapWindows.values()) {
    if (record.tabId === tabId) return record;
  }
  return null;
}

async function flushPipSurfaceDrag(session) {
  if (session.flushPromise) return session.flushPromise;
  session.flushPromise = (async () => {
    while (session.pending) {
      const next = session.pending;
      session.pending = null;
      const left = Math.round(
        session.windowStartLeft + next.pointerX - session.pointerStartX,
      );
      const top = Math.round(
        session.windowStartTop + next.pointerY - session.pointerStartY,
      );
      if (left === session.lastLeft && top === session.lastTop) continue;
      await chrome.windows.update(session.windowId, {
        left,
        top,
        width: session.windowStartWidth,
        height: session.windowStartHeight,
      });
      session.lastLeft = left;
      session.lastTop = top;
    }
  })().catch(() => {}).finally(() => {
    session.flushPromise = null;
  });
  return session.flushPromise;
}

async function setDocumentPipSize(tabId, openerWindowId, message) {
  const targetInnerWidth = Math.round(Number(message.targetInnerWidth));
  const aspectInnerWidth = Math.round(Number(message.aspectInnerWidth));
  const aspectInnerHeight = Math.round(Number(message.aspectInnerHeight));
  const frameWidth = Math.round(Number(message.frameWidth));
  const frameHeight = Math.round(Number(message.frameHeight));
  if (
    ![
      targetInnerWidth,
      aspectInnerWidth,
      aspectInnerHeight,
      frameWidth,
      frameHeight,
    ]
      .every(Number.isFinite) ||
    targetInnerWidth < 1 ||
    aspectInnerWidth < 1 ||
    aspectInnerHeight < 1 ||
    frameWidth < 0 ||
    frameHeight < 0 ||
    frameWidth > 256 ||
    frameHeight > 256
  ) {
    return { updated: false };
  }

  await cornerSnapStateReady;
  let record = findCornerSnapRecordForTab(tabId);
  if (!record) {
    await discoverCornerSnapWindow(tabId, openerWindowId);
    record = findCornerSnapRecordForTab(tabId);
  }
  if (!record || pipSurfaceDragWindows.has(record.windowId)) return { updated: false };

  const windowId = record.windowId;
  cornerSnapInFlight.add(windowId);
  try {
    const browserWindow = await chrome.windows.get(windowId);
    if (!hasCompleteWindowBounds(browserWindow)) return { updated: false };
    if (browserWindow.state && browserWindow.state !== "normal") return { updated: false };
    const displays = await chrome.system?.display?.getInfo?.().catch(() => []);
    const display = chooseDisplayForWindow(displays || [], browserWindow);
    const workArea = display?.workArea || display?.bounds;
    const displayBounds = display?.bounds || workArea;
    if (!hasCompleteRectangle(workArea) || !hasCompleteRectangle(displayBounds)) {
      return { updated: false };
    }

    const maximumOuterWidth = Math.floor(Math.min(
      Number(displayBounds.width) * DOCUMENT_PIP_MAX_SCREEN_RATIO,
      Number(workArea.width) - PINNED_EDGE_PADDING * 2,
    ));
    const maximumOuterHeight = Math.floor(Math.min(
      Number(displayBounds.height) * DOCUMENT_PIP_MAX_SCREEN_RATIO,
      Number(workArea.height) - PINNED_EDGE_PADDING * 2,
    ));
    const aspectRatio = aspectInnerWidth / aspectInnerHeight;
    const minimumInnerWidth = Math.ceil(Math.max(
      DOCUMENT_PIP_MIN_INNER_WIDTH,
      DOCUMENT_PIP_MIN_INNER_HEIGHT * aspectRatio,
    ));
    const maximumInnerWidth = Math.floor(Math.min(
      maximumOuterWidth - frameWidth,
      (maximumOuterHeight - frameHeight) * aspectRatio,
    ));
    if (maximumInnerWidth < minimumInnerWidth) {
      return { updated: false, minimumInnerWidth, maximumInnerWidth };
    }
    const innerWidth = Math.min(
      maximumInnerWidth,
      Math.max(minimumInnerWidth, targetInnerWidth),
    );
    const innerHeight = Math.round(innerWidth / aspectRatio);
    const width = innerWidth + frameWidth;
    const height = innerHeight + frameHeight;
    if (
      innerWidth < DOCUMENT_PIP_MIN_INNER_WIDTH ||
      innerHeight < DOCUMENT_PIP_MIN_INNER_HEIGHT ||
      width > maximumOuterWidth ||
      height > maximumOuterHeight
    ) {
      return { updated: false, minimumInnerWidth, maximumInnerWidth };
    }

    const workLeft = Math.round(Number(workArea.left) + PINNED_EDGE_PADDING);
    const workTop = Math.round(Number(workArea.top) + PINNED_EDGE_PADDING);
    const workRight = Math.round(
      Number(workArea.left) + Number(workArea.width) - PINNED_EDGE_PADDING,
    );
    const workBottom = Math.round(
      Number(workArea.top) + Number(workArea.height) - PINNED_EDGE_PADDING,
    );
    const currentLeft = Math.round(Number(browserWindow.left));
    const currentTop = Math.round(Number(browserWindow.top));
    const currentRight = currentLeft + Math.round(Number(browserWindow.width));
    const currentBottom = currentTop + Math.round(Number(browserWindow.height));
    const anchorRight = Math.abs(workRight - currentRight) < Math.abs(currentLeft - workLeft);
    const anchorBottom = Math.abs(workBottom - currentBottom) < Math.abs(currentTop - workTop);
    const maximumLeft = workRight - width;
    const maximumTop = workBottom - height;
    const left = Math.min(
      maximumLeft,
      Math.max(workLeft, anchorRight ? currentRight - width : currentLeft),
    );
    const top = Math.min(
      maximumTop,
      Math.max(workTop, anchorBottom ? currentBottom - height : currentTop),
    );
    const updatedWindow = await chrome.windows.update(windowId, {
      left,
      top,
      width,
      height,
    });
    const updatedInnerWidth = Math.min(maximumInnerWidth, Math.max(
      minimumInnerWidth,
      Math.round(Number(updatedWindow.width) - frameWidth),
    ));
    return {
      updated: true,
      innerWidth: updatedInnerWidth,
      innerHeight: Math.round(updatedInnerWidth / aspectRatio),
      minimumInnerWidth,
      maximumInnerWidth,
      left: updatedWindow.left,
      top: updatedWindow.top,
      width: updatedWindow.width,
      height: updatedWindow.height,
      anchorHorizontal: anchorRight ? "right" : "left",
      anchorVertical: anchorBottom ? "bottom" : "top",
    };
  } catch {
    return { updated: false };
  } finally {
    cornerSnapInFlight.delete(windowId);
  }
}

function queueDocumentPipSize(tabId, openerWindowId, message) {
  const previous = pipSizeOperations.get(tabId) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(() => setDocumentPipSize(tabId, openerWindowId, message));
  pipSizeOperations.set(tabId, operation);
  operation
    .finally(() => {
      if (pipSizeOperations.get(tabId) === operation) {
        pipSizeOperations.delete(tabId);
      }
    })
    .catch(() => {});
  return operation;
}

function isRecentlyCreatedPipWindow(windowId, openedAt) {
  const createdAt = recentlyCreatedWindows.get(windowId);
  if (!Number.isFinite(createdAt)) return false;
  if (!Number.isFinite(openedAt)) return Date.now() - createdAt <= 2_000;
  return createdAt >= openedAt - 1_500 && createdAt <= openedAt + 1_500;
}

async function restoreCornerSnapState() {
  try {
    const stored = await chrome.storage.session?.get(CORNER_SNAP_STORAGE_KEY);
    const records = stored?.[CORNER_SNAP_STORAGE_KEY];
    if (!records || typeof records !== "object") return;
    for (const record of Object.values(records)) {
      const windowId = Number(record?.windowId);
      const tabId = Number(record?.tabId);
      const readyAt = Number(record?.readyAt);
      if (!Number.isInteger(windowId) || !Number.isInteger(tabId)) continue;
      cornerSnapWindows.set(windowId, {
        windowId,
        tabId,
        readyAt: Number.isFinite(readyAt) ? readyAt : 0,
        enabled: record?.enabled !== false,
        initialPlacementApplied: record?.initialPlacementApplied !== false,
      });
    }
  } catch {}
}

function persistCornerSnapState() {
  const records = Object.fromEntries(
    [...cornerSnapWindows].map(([windowId, record]) => [String(windowId), record]),
  );
  cornerSnapPersistence = cornerSnapPersistence
    .catch(() => {})
    .then(() => chrome.storage.session?.set({ [CORNER_SNAP_STORAGE_KEY]: records }))
    .catch(() => {});
  return cornerSnapPersistence;
}

async function rememberCornerSnapWindow(windowId, tabId, requestedEnabled) {
  if (!Number.isInteger(windowId) || !Number.isInteger(tabId)) return;
  await cornerSnapStateReady;
  const existing = cornerSnapWindows.get(windowId);
  const sameTabRecord = [...cornerSnapWindows.values()].find(
    (record) => record.tabId === tabId,
  );
  const enabled = typeof requestedEnabled === "boolean"
    ? requestedEnabled
    : cornerSnapEnabledByTab.get(tabId) ?? existing?.enabled ?? sameTabRecord?.enabled ?? true;
  for (const [registeredWindowId, record] of cornerSnapWindows) {
    if (record.tabId === tabId && registeredWindowId !== windowId) {
      cornerSnapWindows.delete(registeredWindowId);
    }
  }
  const readyAt = Date.now();
  const record = {
    windowId,
    tabId,
    readyAt,
    enabled,
    initialPlacementApplied: existing?.initialPlacementApplied === true,
  };
  cornerSnapWindows.set(windowId, record);
  await persistCornerSnapState();
  return record;
}

async function forgetCornerSnapWindow(windowId) {
  await cornerSnapStateReady;
  pipSurfaceDragWindows.delete(windowId);
  if (!cornerSnapWindows.delete(windowId)) return;
  await persistCornerSnapState();
}

async function forgetCornerSnapTab(tabId) {
  await cornerSnapStateReady;
  cornerSnapEnabledByTab.delete(tabId);
  for (const [windowId, session] of pipSurfaceDragWindows) {
    if (session.tabId === tabId) pipSurfaceDragWindows.delete(windowId);
  }
  let changed = false;
  for (const [windowId, record] of cornerSnapWindows) {
    if (record.tabId !== tabId) continue;
    cornerSnapWindows.delete(windowId);
    changed = true;
  }
  if (changed) await persistCornerSnapState();
}

async function setCornerSnapEnabledForTab(tabId, enabled, openerWindowId) {
  await cornerSnapStateReady;
  let changed = false;
  let activeRecord = null;
  for (const record of cornerSnapWindows.values()) {
    if (record.tabId !== tabId) continue;
    activeRecord = record;
    if (enabled && record.readyAt > Date.now()) {
      record.readyAt = Date.now();
      changed = true;
    }
    if (record.enabled !== enabled) {
      record.enabled = enabled;
      changed = true;
    }
  }
  if (!activeRecord && Number.isInteger(openerWindowId)) {
    await discoverCornerSnapWindow(tabId, openerWindowId);
    activeRecord = findCornerSnapRecordForTab(tabId);
    if (activeRecord && activeRecord.enabled !== enabled) {
      activeRecord.enabled = enabled;
      changed = true;
    }
  }
  if (changed) await persistCornerSnapState();
  if (enabled && activeRecord) {
    const browserWindow = await chrome.windows.get(activeRecord.windowId).catch(() => null);
    if (browserWindow) await constrainDocumentPipToSafeArea(browserWindow);
  }
}

async function registerDocumentPipWindow(
  tabId,
  openerWindowId,
  requestedEnabled,
  requestedAt,
) {
  await cornerSnapStateReady;
  for (const delay of INITIAL_PIP_DISCOVERY_DELAYS) {
    if (delay) await wait(delay);
    const browserWindow = await findDocumentPipWindow(tabId, openerWindowId, requestedAt);
    if (!Number.isInteger(browserWindow?.id)) continue;
    await rememberCornerSnapWindow(browserWindow.id, tabId, requestedEnabled !== false);
    setFocusedDocumentPipWindow(browserWindow.focused === true ? browserWindow.id : null);
    await placeDocumentPipAtBottomRight(browserWindow);
    const measuredWindow = await chrome.windows
      .get(browserWindow.id)
      .catch(() => browserWindow);
    return {
      registered: true,
      outerWidth: Math.round(Number(measuredWindow.width)),
      outerHeight: Math.round(Number(measuredWindow.height)),
    };
  }
  return { registered: false };
}

async function findDocumentPipWindow(tabId, openerWindowId, requestedAt) {
  const windows = await chrome.windows.getAll({ populate: true });
  const candidates = windows
    .filter(
      (browserWindow) =>
        browserWindow.id !== openerWindowId &&
        browserWindow.tabs?.length === 1,
    )
    .map((browserWindow) => ({
      browserWindow,
      linkedToOpener: browserWindow.tabs.some((tab) => tab.openerTabId === tabId),
      recentlyCreated: isRecentlyCreatedPipWindow(browserWindow.id),
      alwaysOnTop: browserWindow.alwaysOnTop === true,
      createdAt: recentlyCreatedWindows.get(browserWindow.id) || 0,
      createdForRequest: isRecentlyCreatedPipWindow(browserWindow.id, Number(requestedAt)),
    }));
  const requestMatches = candidates
    .filter((candidate) => candidate.createdForRequest)
    .sort((first, second) => second.createdAt - first.createdAt);
  return (
    requestMatches.find((candidate) => candidate.linkedToOpener) ||
    requestMatches[0] ||
    candidates.find((candidate) => candidate.linkedToOpener) ||
    candidates
      .filter((candidate) => candidate.recentlyCreated && candidate.alwaysOnTop)
      .sort((first, second) => second.createdAt - first.createdAt)[0] ||
    (candidates.filter((candidate) => candidate.recentlyCreated).length === 1
      ? candidates.find((candidate) => candidate.recentlyCreated)
      : null)
  )?.browserWindow || null;
}

async function discoverCornerSnapWindow(tabId, openerWindowId) {
  try {
    for (const delay of INITIAL_PIP_DISCOVERY_DELAYS) {
      if (delay) await wait(delay);
      const browserWindow = await findDocumentPipWindow(tabId, openerWindowId);
      if (!Number.isInteger(browserWindow?.id)) continue;
      await rememberCornerSnapWindow(browserWindow.id, tabId);
      await placeDocumentPipAtBottomRight(browserWindow);
      return;
    }
  } catch {}
}

async function placeDocumentPipAtBottomRight(providedWindow) {
  const windowId = Number(providedWindow?.id);
  if (!Number.isInteger(windowId) || cornerSnapInFlight.has(windowId)) return false;
  await cornerSnapStateReady;
  const record = cornerSnapWindows.get(windowId);
  if (!record || record.initialPlacementApplied) return false;

  cornerSnapInFlight.add(windowId);
  try {
    const browserWindow = hasCompleteWindowBounds(providedWindow)
      ? providedWindow
      : await chrome.windows.get(windowId).catch(() => null);
    if (!hasCompleteWindowBounds(browserWindow)) return false;
    if (browserWindow.state && browserWindow.state !== "normal") return false;

    const displays = await chrome.system?.display?.getInfo?.().catch(() => []);
    const display = chooseDisplayForWindow(displays || [], browserWindow);
    const target = getBottomRightTarget(
      browserWindow,
      display?.workArea || display?.bounds,
    );
    if (!target) return false;

    record.initialPlacementApplied = true;
    await persistCornerSnapState();
    if (
      Math.abs(Number(browserWindow.left) - target.left) <= 1 &&
      Math.abs(Number(browserWindow.top) - target.top) <= 1
    ) {
      return true;
    }
    await chrome.windows.update(windowId, {
      left: target.left,
      top: target.top,
      width: Math.round(Number(browserWindow.width)),
      height: Math.round(Number(browserWindow.height)),
    });
    return true;
  } catch {
    return false;
  } finally {
    cornerSnapInFlight.delete(windowId);
  }
}

async function constrainDocumentPipToSafeArea(providedWindow) {
  const windowId = Number(providedWindow?.id);
  if (
    !Number.isInteger(windowId) ||
    cornerSnapInFlight.has(windowId) ||
    pipSurfaceDragWindows.has(windowId)
  ) return;
  await cornerSnapStateReady;
  const record = cornerSnapWindows.get(windowId);
  if (!record || !record.enabled || Date.now() < record.readyAt) return;

  cornerSnapInFlight.add(windowId);
  try {
    const browserWindow = hasCompleteWindowBounds(providedWindow)
      ? providedWindow
      : await chrome.windows.get(windowId).catch(() => null);
    if (!hasCompleteWindowBounds(browserWindow)) return;
    if (browserWindow.state && browserWindow.state !== "normal") return;

    const displays = await chrome.system?.display?.getInfo?.().catch(() => []);
    const display = chooseDisplayForWindow(displays || [], browserWindow);
    const target = getSafeAreaTarget(
      browserWindow,
      display?.workArea || display?.bounds,
    );
    if (!target) return;
    if (
      Math.abs(Number(browserWindow.left) - target.left) <= 1 &&
      Math.abs(Number(browserWindow.top) - target.top) <= 1
    ) {
      return;
    }
    await chrome.windows.update(windowId, {
      left: target.left,
      top: target.top,
      width: Math.round(Number(browserWindow.width)),
      height: Math.round(Number(browserWindow.height)),
    });
  } catch {
  } finally {
    cornerSnapInFlight.delete(windowId);
  }
}

function hasCompleteWindowBounds(browserWindow) {
  return [
    browserWindow?.left,
    browserWindow?.top,
    browserWindow?.width,
    browserWindow?.height,
  ].every((value) => Number.isFinite(Number(value)));
}

function chooseDisplayForWindow(displays, browserWindow) {
  const enabledDisplays = displays.filter(
    (display) =>
      display?.isEnabled !== false &&
      display?.activeState !== "inactive" &&
      hasCompleteRectangle(display?.bounds),
  );
  if (!enabledDisplays.length) return null;
  const centerX = Number(browserWindow.left) + Number(browserWindow.width) / 2;
  const centerY = Number(browserWindow.top) + Number(browserWindow.height) / 2;
  const containing = enabledDisplays.find(({ bounds }) =>
    centerX >= Number(bounds.left) &&
    centerX < Number(bounds.left) + Number(bounds.width) &&
    centerY >= Number(bounds.top) &&
    centerY < Number(bounds.top) + Number(bounds.height),
  );
  if (containing) return containing;
  return enabledDisplays.sort(
    (first, second) =>
      rectangleOverlapArea(second.bounds, browserWindow) -
      rectangleOverlapArea(first.bounds, browserWindow),
  )[0];
}

function hasCompleteRectangle(rectangle) {
  return [rectangle?.left, rectangle?.top, rectangle?.width, rectangle?.height]
    .every((value) => Number.isFinite(Number(value)));
}

function rectangleOverlapArea(first, second) {
  const width = Math.max(
    0,
    Math.min(Number(first.left) + Number(first.width), Number(second.left) + Number(second.width)) -
      Math.max(Number(first.left), Number(second.left)),
  );
  const height = Math.max(
    0,
    Math.min(Number(first.top) + Number(first.height), Number(second.top) + Number(second.height)) -
      Math.max(Number(first.top), Number(second.top)),
  );
  return width * height;
}

function getSafeAreaTarget(browserWindow, workArea) {
  if (!hasCompleteRectangle(workArea)) return null;
  const width = Math.round(Number(browserWindow.width));
  const height = Math.round(Number(browserWindow.height));
  if (
    width > Number(workArea.width) - PINNED_EDGE_PADDING * 2 ||
    height > Number(workArea.height) - PINNED_EDGE_PADDING * 2
  ) {
    return null;
  }
  const minimumLeft = Math.round(Number(workArea.left) + PINNED_EDGE_PADDING);
  const maximumLeft = Math.round(
    Number(workArea.left) + Number(workArea.width) - PINNED_EDGE_PADDING - width,
  );
  const minimumTop = Math.round(Number(workArea.top) + PINNED_EDGE_PADDING);
  const maximumTop = Math.round(
    Number(workArea.top) + Number(workArea.height) - PINNED_EDGE_PADDING - height,
  );
  return {
    left: Math.min(maximumLeft, Math.max(minimumLeft, Math.round(Number(browserWindow.left)))),
    top: Math.min(maximumTop, Math.max(minimumTop, Math.round(Number(browserWindow.top)))),
  };
}

function getBottomRightTarget(browserWindow, workArea) {
  if (!hasCompleteRectangle(workArea) || !hasCompleteWindowBounds(browserWindow)) {
    return null;
  }
  const width = Math.round(Number(browserWindow.width));
  const height = Math.round(Number(browserWindow.height));
  const minimumLeft = Math.round(Number(workArea.left) + PINNED_EDGE_PADDING);
  const minimumTop = Math.round(Number(workArea.top) + PINNED_EDGE_PADDING);
  return {
    left: Math.max(
      minimumLeft,
      Math.round(
        Number(workArea.left) + Number(workArea.width) - PINNED_EDGE_PADDING - width,
      ),
    ),
    top: Math.max(
      minimumTop,
      Math.round(
        Number(workArea.top) + Number(workArea.height) - PINNED_EDGE_PADDING - height,
      ),
    ),
  };
}

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

chrome.tabs.onRemoved.addListener((tabId) => {
  pipSizeOperations.delete(tabId);
  for (const [sessionId, registeredTabId] of embeddedSessions) {
    if (registeredTabId === tabId) embeddedSessions.delete(sessionId);
  }
  void forgetCornerSnapTab(tabId);
});

async function flashBadge(tabId, text) {
  await chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }, 1800);
}
