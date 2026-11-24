import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const themedActionIcons = [16, 32, 48, 128].map(
  (size) => `icons/dark/icon-${size}.png`,
);

const expected = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...themedActionIcons,
].filter(Boolean);

const missing = [...new Set(expected)].filter(
  (relativePath) => !fs.existsSync(path.join(root, relativePath)),
);

if (missing.length) {
  throw new Error(`Manifest references missing files: ${missing.join(", ")}`);
}

const declaredIconFiles = [
  ...Object.entries(manifest.icons ?? {}),
  ...themedActionIcons.map((relativePath) => [path.basename(relativePath).match(/\d+/)?.[0], relativePath]),
];
const invalidIconDimensions = declaredIconFiles.filter(([declaredSize, relativePath]) => {
  const png = fs.readFileSync(path.join(root, relativePath));
  const isPng = png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const size = Number(declaredSize);
  return !isPng || png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size;
});
const iconGeneratorSource = fs.readFileSync(path.join(root, "tools/generate-icons.ps1"), "utf8");
const lightToolbarIcon = fs.readFileSync(path.join(root, "icons/icon-16.png"));
const darkToolbarIcon = fs.readFileSync(path.join(root, "icons/dark/icon-16.png"));
if (
  invalidIconDimensions.length ||
  !iconGeneratorSource.includes("Custom Caption PiP mark on Tabler's native 24x24 grid") ||
  !iconGeneratorSource.includes('$outerGeometryData = "M21,10 L21,5 A2,2') ||
  !iconGeneratorSource.includes("M10,10.5 A1.5,1.5 0 0 0 7,10.5") ||
  !iconGeneratorSource.includes("[System.Windows.Media.GeometryCombineMode]::Exclude") ||
  !iconGeneratorSource.includes("[System.Windows.Media.Color]::FromArgb(255, 52, 54, 63)") ||
  !iconGeneratorSource.includes("[System.Windows.Media.Colors]::White") ||
  !iconGeneratorSource.includes('Directory = Join-Path $iconDirectory "dark"') ||
  !iconGeneratorSource.includes("$glyphScaleX = ($size / 24.0) * 1.15") ||
  !iconGeneratorSource.includes("$glyphScaleY = ($size / 24.0) * 1.15") ||
  !iconGeneratorSource.includes("$glyphOffsetX = ($size - 24 * $glyphScaleX) / 2") ||
  !iconGeneratorSource.includes("$glyphOffsetY = ($size - 24 * $glyphScaleY) / 2") ||
  !iconGeneratorSource.includes("$drawing.DrawGeometry($null, $outerPen, $outerGeometry)") ||
  !iconGeneratorSource.includes("$drawing.DrawGeometry($iconBrush, $null, $captionBadgeGeometry)") ||
  !iconGeneratorSource.includes("[System.Windows.Media.PixelFormats]::Pbgra32") ||
  lightToolbarIcon.equals(darkToolbarIcon) ||
  /128, 100, 255|IconBadgeCcFilled|fe96|IconSubtitles|101a1|\$background|LinearGradientBrush/.test(iconGeneratorSource)
) {
  throw new Error("Every Chrome icon size must provide distinct background-free custom Caption PiP variants: dark gray for light themes and white for dark themes.");
}

if (manifest.manifest_version !== 3) {
  throw new Error("The extension must use Manifest V3.");
}

const contentSource = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
const serviceWorkerSource = fs.readFileSync(path.join(root, "src/service-worker.js"), "utf8");
if (
  !manifest.permissions?.includes("system.display") ||
  !serviceWorkerSource.includes("chrome.windows?.onBoundsChanged?.addListener") ||
  !serviceWorkerSource.includes("const PINNED_EDGE_PADDING = 15;") ||
  serviceWorkerSource.includes("CORNER_SNAP_READY_DELAY") ||
  !serviceWorkerSource.includes("const readyAt = Date.now();") ||
  !contentSource.includes("type: REGISTER_PIP_WINDOW_MESSAGE,") ||
  !serviceWorkerSource.includes("message?.type === REGISTER_PIP_WINDOW_MESSAGE") ||
  !serviceWorkerSource.includes("async function registerDocumentPipWindow") ||
  !serviceWorkerSource.includes("await rememberCornerSnapWindow(browserWindow.id, tabId, requestedEnabled !== false);") ||
  !contentSource.includes("const requestedAt = Date.now();") ||
  !contentSource.includes("requestedAt,") ||
  !serviceWorkerSource.includes("await placeDocumentPipAtBottomRight(browserWindow);") ||
  !serviceWorkerSource.includes("async function placeDocumentPipAtBottomRight") ||
  !serviceWorkerSource.includes("function getBottomRightTarget") ||
  !serviceWorkerSource.includes("Number(workArea.left) + Number(workArea.width) - PINNED_EDGE_PADDING - width") ||
  !serviceWorkerSource.includes("Number(workArea.top) + Number(workArea.height) - PINNED_EDGE_PADDING - height") ||
  !serviceWorkerSource.includes("initialPlacementApplied: existing?.initialPlacementApplied === true") ||
  !serviceWorkerSource.includes("if (!activeRecord && Number.isInteger(openerWindowId))") ||
  !serviceWorkerSource.includes("await discoverCornerSnapWindow(tabId, openerWindowId);") ||
  !serviceWorkerSource.includes("constrainDocumentPipToSafeArea(browserWindow)") ||
  !serviceWorkerSource.includes("function getSafeAreaTarget") ||
  !serviceWorkerSource.includes("const minimumLeft = Math.round(Number(workArea.left) + PINNED_EDGE_PADDING);") ||
  !serviceWorkerSource.includes("const maximumLeft = Math.round(") ||
  !serviceWorkerSource.includes("Math.min(maximumLeft, Math.max(minimumLeft") ||
  !serviceWorkerSource.includes("Math.min(maximumTop, Math.max(minimumTop") ||
  !contentSource.includes("notifyRuntime(CORNER_SNAP_SET_ENABLED_MESSAGE, {") ||
  !serviceWorkerSource.includes("record.readyAt = Date.now();") ||
  /getQuadrantCornerTarget|workAreaCenterX|workAreaCenterY/.test(serviceWorkerSource) ||
  serviceWorkerSource.includes("CORNER_SNAP_THRESHOLD") ||
  !serviceWorkerSource.includes("chrome.system?.display?.getInfo?.()") ||
  !serviceWorkerSource.includes("display?.workArea || display?.bounds") ||
  !serviceWorkerSource.includes("left: target.left") ||
  !serviceWorkerSource.includes("top: target.top") ||
  !serviceWorkerSource.includes("cornerSnapWindows") ||
  !serviceWorkerSource.includes("chrome.storage.session?.get(CORNER_SNAP_STORAGE_KEY)")
) {
  throw new Error("Every new PiP must open at the taskbar-aware bottom-right, after which Pinning must work immediately, preserve free placement, and enforce exactly 15px of usable screen-edge padding across monitors and taskbars.");
}
if (
  !contentSource.includes("disallowReturnToOpener: true") ||
  contentSource.includes("disallowReturnToOpener: false")
) {
  throw new Error("Document PiP must hide Chrome's native return-to-opener title-bar action in favor of the synchronized custom control.");
}
if (
  !contentSource.includes('const PIP_SURFACE_DRAG_START_MESSAGE = "CAPTION_PIP_SURFACE_DRAG_START";') ||
  !contentSource.includes('root.setPointerCapture(event.pointerId);') ||
  !contentSource.includes('distance < 4') ||
  !contentSource.includes('isWindowDragControl(event.target)') ||
  !contentSource.includes('".cp-controls, .cp-top-controls, .cp-panel, button, input, select, textarea, a, [contenteditable=\'true\']"') ||
  !contentSource.includes('pipWindow.requestAnimationFrame(() => {') ||
  !contentSource.includes('type: PIP_SURFACE_DRAG_MOVE_MESSAGE') ||
  !contentSource.includes('.cp-window-dragging .cp-stage') ||
  !serviceWorkerSource.includes('message?.type === PIP_SURFACE_DRAG_START_MESSAGE') ||
  !serviceWorkerSource.includes('function queuePipSurfaceDrag(tabId, message)') ||
  !serviceWorkerSource.includes('session.windowStartLeft + next.pointerX - session.pointerStartX') ||
  !serviceWorkerSource.includes('windowStartWidth: Math.round(Number(browserWindow.width))') ||
  !serviceWorkerSource.includes('windowStartHeight: Math.round(Number(browserWindow.height))') ||
  !serviceWorkerSource.includes('width: session.windowStartWidth') ||
  !serviceWorkerSource.includes('height: session.windowStartHeight') ||
  !serviceWorkerSource.includes('pipSurfaceDragWindows.has(windowId)') ||
  !serviceWorkerSource.includes('await constrainDocumentPipToSafeArea(browserWindow);') ||
  /moveTo\(|moveBy\(|webkit-app-region/.test(`${contentSource}\n${serviceWorkerSource}`)
) {
  throw new Error("Whole-surface dragging must be pointer-captured and frame-batched, lock the starting outer size throughout every position update, and avoid blocked page APIs or safe-area interference.");
}

const netflixBridge = manifest.content_scripts?.find(
  (entry) => entry.js?.includes("src/page-bridge.js"),
);
if (
  netflixBridge?.world !== "MAIN" ||
  !netflixBridge.matches?.includes("https://www.netflix.com/*")
) {
  throw new Error("Netflix seeking requires its page bridge in the main JavaScript world.");
}

const executableFiles = [...new Set([
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
])].filter(Boolean);
const remoteCodePattern = /(?:importScripts|src\s*=|href\s*=)\s*[('"`]https?:\/\//i;
const extensionNetworkPattern = /\b(?:fetch|XMLHttpRequest|WebSocket)\b/;

for (const relativePath of executableFiles) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  if (remoteCodePattern.test(source)) {
    throw new Error(`Potential remote executable code found in ${relativePath}`);
  }
  if (extensionNetworkPattern.test(source)) {
    throw new Error(`Unexpected extension-owned network API found in ${relativePath}`);
  }
}

const themeIconSource = fs.readFileSync(path.join(root, "src/theme-icon.js"), "utf8");
const themeIconScript = manifest.content_scripts?.find(
  (entry) => entry.js?.includes("src/theme-icon.js"),
);
if (
  themeIconScript?.run_at !== "document_start" ||
  themeIconScript?.all_frames === true ||
  !themeIconSource.includes('window.matchMedia("(prefers-color-scheme: dark)")') ||
  !themeIconSource.includes('darkScheme.addEventListener("change", publishTheme);') ||
  !themeIconSource.includes("type: TOOLBAR_THEME_MESSAGE") ||
  !serviceWorkerSource.includes('16: "icons/icon-16.png"') ||
  !serviceWorkerSource.includes('16: "icons/dark/icon-16.png"') ||
  !serviceWorkerSource.includes(".setIcon({ tabId, path: ACTION_ICON_PATHS[theme] })")
) {
  throw new Error("The toolbar must route a dark-gray icon for light themes and a white icon for dark themes per tab, with live prefers-color-scheme updates.");
}
if (
  !serviceWorkerSource.includes('const NO_VIDEO_INFORMATION = "No video is available in this tab.";') ||
  !serviceWorkerSource.includes("await showInformationToast(tabId, NO_VIDEO_INFORMATION);") ||
  serviceWorkerSource.includes('flashBadge(tabId, "0")') ||
  !contentSource.includes("message?.type === SHOW_INFORMATION_TOAST_MESSAGE && isTopFrame()") ||
  !contentSource.includes('showToast(message.message || "No video is available in this tab.", 2_600, "info")') ||
  !contentSource.includes('createTablerIcon(document, "info-circle")') ||
  !contentSource.includes('host.setAttribute("role", "status")') ||
  !contentSource.includes('host.setAttribute("aria-live", "polite")') ||
  !contentSource.includes("border:0;border-radius:11px")
) {
  throw new Error("Tabs without a usable video must show an accessible, borderless information toast with a local Tabler icon instead of a zero badge.");
}
if (
  !/location\.hostname === "www\.netflix\.com"\s*\? createNetflixVisibilityPlaybackGuard/.test(contentSource) ||
  !contentSource.includes("const mediaHandlers = createMediaHandlers(video, pipWindow, netflixVisibilityGuard);") ||
  !contentSource.includes("ui.setHandlers(mediaHandlers);") ||
  !contentSource.includes("playbackGuard?.setIntent(video.paused || video.ended)")
) {
  throw new Error("Netflix direct PiP must recover site-triggered background pauses without overriding explicit PiP playback intent.");
}
if (
  !contentSource.includes("const placeholder = createFlowPlaceholder(video, stopPip, { visual: false });") ||
  !contentSource.includes("const cover = createCoverPlaceholder(placeholder, stopPip);") ||
  !contentSource.includes("referenceElement: cover") ||
  !contentSource.includes("session.cover?.remove();") ||
  !contentSource.includes("const layoutWidth = Number(node.offsetWidth) || rect.width;") ||
  !contentSource.includes("const layoutHeight = Number(node.offsetHeight) || rect.height;") ||
  !contentSource.includes("transform: computed.transform") ||
  !contentSource.includes("transformOrigin: computed.transformOrigin") ||
  !contentSource.includes('visibility: visual ? "visible" : "hidden"') ||
  !contentSource.includes('zIndex: "2147483647"')
) {
  throw new Error("Direct-player placeholders must use a hidden transformed layout anchor plus a measured, top-level cover without changing the PiP media path.");
}
if (
  !contentSource.includes('audioMode: "source"') ||
  !contentSource.includes('command({ type: "SET_AUDIO_STATE", ...next })') ||
  !contentSource.includes('type: "AUDIO_STATE_RESULT"') ||
  !contentSource.includes('session.audioMode = "capture"') ||
  !contentSource.includes("const immediatelyPausedAfterUnmute = wasPlaying && !wantsMuted && video.paused") ||
  !contentSource.includes("video.muted = wantsMuted") ||
  !contentSource.includes("video.muted = true;\n        video.play().catch(() => {});")
) {
  throw new Error("Embedded PiP audio must unmute the real source first and use the captured mirror only after Chrome rejects that source transition.");
}
const requiredTablerIcons = [
  "player-play",
  "player-pause",
  "rewind-backward-10",
  "rewind-forward-10",
  "volume",
  "volume-2",
  "volume-4",
  "volume-off",
  "subtitles",
  "typography",
  "arrow-back-up",
  "magnet",
  "maximize",
  "aspect-ratio",
  "x",
  "loader-2",
];
const rootCss = contentSource.match(/^[ \t]*\.cp-root\s*\{[\s\S]*?^[ \t]*\}/m)?.[0] || "";
const controlRailCss = contentSource.match(/^[ \t]*\.cp-controls\s*\{[\s\S]*?^[ \t]*\}/m)?.[0] || "";
const primaryRowCss = contentSource.match(/^[ \t]*\.cp-primary-row\s*\{[\s\S]*?^[ \t]*\}/m)?.[0] || "";
const transportCss = contentSource.match(/^[ \t]*\.cp-transport\s*\{[\s\S]*?^[ \t]*\}/m)?.[0] || "";
const subtitleActionsCss = contentSource.match(/^[ \t]*\.cp-subtitle-actions\s*\{[\s\S]*?^[ \t]*\}/m)?.[0] || "";
const progressRowCss = contentSource.match(/^[ \t]*\.cp-progress-row\s*\{[\s\S]*?^[ \t]*\}/m)?.[0] || "";
if (
  !/--cp-glass-surface:[\s\S]*?linear-gradient\([\s\S]*?radial-gradient\([\s\S]*?rgba\(10,11,16,\.82\);/.test(rootCss) ||
  !/--cp-glass-shadow:[\s\S]*?inset 0 1px 0 rgba\(255,255,255,\.2\)[\s\S]*?0 8px 24px rgba\(0,0,0,\.28\);/.test(rootCss) ||
  (contentSource.match(/background:\s*var\(--cp-glass-surface\);/g) || []).length < 4 ||
  (contentSource.match(/box-shadow:\s*var\(--cp-glass-shadow\);/g) || []).length < 4 ||
  !/left:\s*8px;[\s\S]*?right:\s*8px;[\s\S]*?bottom:\s*8px;/.test(controlRailCss) ||
  !/border-radius:\s*6px;/.test(controlRailCss) ||
  !/background:\s*var\(--cp-glass-surface\);/.test(controlRailCss) ||
  !/box-shadow:\s*var\(--cp-glass-shadow\);/.test(controlRailCss) ||
  /backdrop-filter|animation\s*:/.test(controlRailCss) ||
  /(?:-webkit-)?backdrop-filter\s*:/.test(contentSource)
) {
  throw new Error("The bottom controls must use the shared static liquid-glass material with fixed highlights, no live backdrop filtering or animation, and 6px rounded corners.");
}
if (
  !/grid-template-rows:\s*40px 18px;/.test(controlRailCss) ||
  !/grid-template-columns:\s*minmax\(0,\s*1fr\) auto minmax\(0,\s*1fr\);/.test(primaryRowCss) ||
  !/grid-column:\s*2;/.test(transportCss) ||
  !/justify-self:\s*center;/.test(transportCss) ||
  !/grid-column:\s*3;/.test(subtitleActionsCss) ||
  !/justify-self:\s*end;/.test(subtitleActionsCss) ||
  !/grid-template-columns:\s*max-content minmax\(0,\s*1fr\) max-content;/.test(progressRowCss) ||
  !contentSource.includes("transport.append(back, play, forward);") ||
  !contentSource.includes("subtitleActions.append(cc, appearance);") ||
  !contentSource.includes("primaryRow.append(volumeControl, transport, subtitleActions);") ||
  !contentSource.includes("progressRow.append(timeCurrent, timeline, timeDuration);") ||
  !contentSource.includes("controls.append(primaryRow, progressRow);") ||
  !contentSource.includes('"cp-time cp-time-current", "00:00:00"') ||
  !contentSource.includes('"cp-time cp-time-duration", "00:00:00"') ||
  !contentSource.includes('return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;')
) {
  throw new Error("The control rail must use a two-row layout: left volume, centered back/play/forward and right subtitle actions above elapsed time, the flexible timeline and duration in HH:MM:SS.");
}
const volumeControlCss = contentSource.match(/\.cp-volume-control\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
const volumeSliderCss = contentSource.match(/\.cp-volume-slider\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
const volumeTrackCss = contentSource.match(/\.cp-volume-slider::\-webkit-slider-runnable-track\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
const volumeThumbCss = contentSource.match(/\.cp-volume-slider::\-webkit-slider-thumb\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
const timelineThumbCss = contentSource.match(/\.cp-timeline::\-webkit-slider-thumb\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
if (
  !/display:\s*grid;/.test(volumeControlCss) ||
  !/grid-template-columns:\s*40px minmax\(52px,\s*1fr\);/.test(volumeControlCss) ||
  !/width:\s*min\(176px,\s*100%\);/.test(volumeControlCss) ||
  !/min-width:\s*0;/.test(volumeControlCss) ||
  !/width:\s*100%;/.test(volumeSliderCss) ||
  !/min-width:\s*0;/.test(volumeSliderCss) ||
  !/background:\s*linear-gradient\(to right,\s*#e5e7eb/.test(volumeTrackCss) ||
  !/rgba\(255,255,255,\.24\)/.test(volumeTrackCss) ||
  !/width:\s*10px;/.test(volumeThumbCss) ||
  !/height:\s*10px;/.test(volumeThumbCss) ||
  !/margin-top:\s*-3\.5px;/.test(volumeThumbCss) ||
  !/background:\s*#f8fafc;/.test(volumeThumbCss) ||
  !/rgba\(255,255,255,\.2\)/.test(volumeThumbCss) ||
  /#8d77ff|rgba\(128,100,255/.test(`${volumeTrackCss}\n${volumeThumbCss}`) ||
  !/width:\s*10px;/.test(timelineThumbCss) ||
  !/height:\s*10px;/.test(timelineThumbCss) ||
  !contentSource.includes('volumeSlider.setAttribute("aria-orientation", "horizontal")') ||
  !contentSource.includes("mute.dataset.level = volumeLevelFor(mediaVolume);") ||
  !contentSource.includes('mute.dataset.muted = String(effectivelyMuted);') ||
  !contentSource.includes('mute.classList.toggle("cp-active", !effectivelyMuted);') ||
  !contentSource.includes('if (safeVolume < 1 / 3) return "low";') ||
  !contentSource.includes('if (safeVolume < 2 / 3) return "medium";') ||
  !contentSource.includes('return "high";') ||
  !contentSource.includes('.cp-mute[data-muted="false"][data-level="low"] .cp-icon-volume-4,') ||
  !contentSource.includes('.cp-mute[data-muted="false"][data-level="medium"] .cp-icon-volume-2,') ||
  !contentSource.includes('.cp-mute[data-muted="false"][data-level="high"] .cp-icon-volume,') ||
  !contentSource.includes('.cp-mute[data-muted="true"] .cp-icon-volume-off') ||
  !contentSource.includes('.cp-mute:not(.cp-active) .cp-control-icon { opacity: .42; }') ||
  /volume-3-bars|very-high/.test(contentSource) ||
  /cp-volume-popover|cp-volume-value|cp-volume-slider-wrap|rotate\(-90deg\)|aria-haspopup/.test(contentSource)
) {
  throw new Error("Volume must use zero/one/two-wave audible icons and a dimmed crossed-out icon while muted.");
}
if (
  !contentSource.includes("function createTablerIcon") ||
  requiredTablerIcons.some((icon) => !contentSource.includes(`createTablerIcon(doc, "${icon}")`)) ||
  /createMaterialControlIcon|createVolumeIcon|cp-control-divider/.test(contentSource) ||
  /cp-detected/.test(contentSource) ||
  /controlButton\(doc,\s*"(?:CC|Aa)"/.test(contentSource)
) {
  throw new Error("PiP controls must remain icon-only, dot-free, and use the local Tabler icon set, including both 10-second jump controls.");
}
if (
  !contentSource.includes('pipWindow.document.documentElement.style.background = "#050507";') ||
  !contentSource.includes('pipWindow.document.body.style.background = "#050507";') ||
  !contentSource.includes('createTablerIcon(doc, "loader-2")') ||
  !contentSource.includes('label.textContent = "Loading...";') ||
  !contentSource.includes("@keyframes cp-reserving-spin") ||
  contentSource.includes("Finding the active video…")
) {
  throw new Error("The PiP reservation must be black from its first available frame and show only an animated local Tabler loader with a Loading label.");
}
if (
  !contentSource.includes('const SET_PIP_SIZE_MESSAGE = "CAPTION_PIP_SET_SIZE";') ||
  !serviceWorkerSource.includes('const SET_PIP_SIZE_MESSAGE = "CAPTION_PIP_SET_SIZE";') ||
  !contentSource.includes('const DOCUMENT_PIP_MIN_INNER_WIDTH = 240;') ||
  !contentSource.includes('const DOCUMENT_PIP_MIN_INNER_HEIGHT = 52;') ||
  !contentSource.includes('const DOCUMENT_PIP_MAX_SCREEN_RATIO = 0.8;') ||
  !serviceWorkerSource.includes('const DOCUMENT_PIP_MIN_INNER_WIDTH = 240;') ||
  !serviceWorkerSource.includes('const DOCUMENT_PIP_MIN_INNER_HEIGHT = 52;') ||
  !serviceWorkerSource.includes('const DOCUMENT_PIP_MAX_SCREEN_RATIO = 0.8;') ||
  !contentSource.includes('ui.setWheelResizeReady?.(aspect);') ||
  !contentSource.includes('ui.setWheelResizeReady?.(request.state.aspect);') ||
  !contentSource.includes('pipWindow.addEventListener("wheel", handleWheelResize, { passive: false });') ||
  !contentSource.includes('window.addEventListener("wheel", captureFocusedPipWheel, {') ||
  !contentSource.includes('focusedPipWheelCaptureEnabled') ||
  !contentSource.includes('type: FOCUSED_PIP_WHEEL_INPUT_MESSAGE') ||
  !contentSource.includes('activeSession?.ui?.resizeFromRelayedWheel?.(message)') ||
  !contentSource.includes('resizeFromRelayedWheel(input)') ||
  !contentSource.includes('const getOpenPipScrollView = () => {') ||
  !contentSource.includes('const scrollOpenPipView = (input) => {') ||
  !contentSource.includes('panel.element.querySelector("[data-caption-pip-scrollview]")') ||
  !contentSource.includes('if (scrollOpenPipView(event)) {') ||
  !contentSource.includes('if (scrollOpenPipView(input || {})) return true;') ||
  !contentSource.includes('scroller.setAttribute("data-caption-pip-scrollview", "");') ||
  !contentSource.includes('return applyWheelResize(input || {});') ||
  !contentSource.includes('!doc.hasFocus()') ||
  !contentSource.includes('currentInnerWidth - widthDelta') ||
  !contentSource.includes('WHEEL_RESIZE_PIXEL_FACTOR') ||
  !contentSource.includes('type: SET_PIP_SIZE_MESSAGE') ||
  !contentSource.includes('requestPipAspectResize(') ||
  !contentSource.includes('requestedInnerWidth,') ||
  !contentSource.includes('pendingSizeInnerWidth = requestedInnerWidth;') ||
  !contentSource.includes('pipWindow.requestAnimationFrame(() => void flushSizeRequest());') ||
  !contentSource.includes('const nextAspectInnerWidth = Math.round(aspect * 10_000);') ||
  !contentSource.includes('sizeAspectInnerWidth = nextAspectInnerWidth;') ||
  !contentSource.includes('sizeAspectInnerHeight = 10_000;') ||
  !contentSource.includes('sizeAspectInnerWidth / sizeAspectInnerHeight') ||
  !contentSource.includes('const frame = getPipNativeFrame(pipWindow);') ||
  !contentSource.includes('frameWidth: frame.width') ||
  !contentSource.includes('frameHeight: frame.height') ||
  !serviceWorkerSource.includes('message?.type === SET_PIP_SIZE_MESSAGE') ||
  !serviceWorkerSource.includes('chrome.windows?.onFocusChanged?.addListener') ||
  !serviceWorkerSource.includes('message?.type === FOCUSED_PIP_WHEEL_INPUT_MESSAGE') ||
  !serviceWorkerSource.includes('async function relayFocusedPipWheelInput') ||
  !serviceWorkerSource.includes('focusedWindow?.focused !== true') ||
  !serviceWorkerSource.includes('type: FOCUSED_PIP_WHEEL_RELAY_MESSAGE') ||
  !serviceWorkerSource.includes('async function broadcastFocusedPipWheelState') ||
  !serviceWorkerSource.includes('async function setDocumentPipSize') ||
  !serviceWorkerSource.includes('const frameWidth = Math.round(Number(message.frameWidth));') ||
  !serviceWorkerSource.includes('const frameHeight = Math.round(Number(message.frameHeight));') ||
  !serviceWorkerSource.includes('frameWidth > 256') ||
  !serviceWorkerSource.includes('frameHeight > 256') ||
  !serviceWorkerSource.includes('const aspectRatio = aspectInnerWidth / aspectInnerHeight;') ||
  !serviceWorkerSource.includes('DOCUMENT_PIP_MIN_INNER_HEIGHT * aspectRatio') ||
  !serviceWorkerSource.includes('Number(displayBounds.width) * DOCUMENT_PIP_MAX_SCREEN_RATIO') ||
  !serviceWorkerSource.includes('Number(displayBounds.height) * DOCUMENT_PIP_MAX_SCREEN_RATIO') ||
  !serviceWorkerSource.includes('const innerHeight = Math.round(innerWidth / aspectRatio);') ||
  !serviceWorkerSource.includes('Math.max(minimumInnerWidth, targetInnerWidth)') ||
  !serviceWorkerSource.includes('const anchorRight = Math.abs(workRight - currentRight) < Math.abs(currentLeft - workLeft);') ||
  !serviceWorkerSource.includes('const anchorBottom = Math.abs(workBottom - currentBottom) < Math.abs(currentTop - workTop);') ||
  !/chrome\.windows\.update\(windowId,\s*\{\s*left,\s*top,\s*width,\s*height,\s*\}\)/.test(serviceWorkerSource) ||
  /cp-size-control|cp-size-slider|cp-size-output|arrows-diagonal-minimize/.test(contentSource)
) {
  throw new Error("Focused PiP wheel input must prioritize any open PiP scroll surface, otherwise be ready as soon as the UI exists, relay from ordinary browser pages without pointer hover, and resize across Chromium's native 240x52-to-80%-of-screen range while preserving the source aspect ratio and nearest usable screen edges.");
}
if (
  !contentSource.includes('const topControls = element(doc, "div", "cp-top-controls");') ||
  !contentSource.includes('const returnAction = element(doc, "div", "cp-top-action cp-top-action-left");') ||
  !contentSource.includes('const adjustAspectAction = element(doc, "div", "cp-top-action cp-top-action-adjust");') ||
  !contentSource.includes('const presentationAction = element(doc, "div", "cp-top-action cp-top-action-center");') ||
  !contentSource.includes('const snapAction = element(doc, "div", "cp-top-action cp-top-action-right");') ||
  !contentSource.includes('const leftActions = element(doc, "div", "cp-top-group cp-top-group-left");') ||
  !contentSource.includes('leftActions.append(returnAction, adjustAspectAction);') ||
  !contentSource.includes('topControls.append(leftActions, presentationAction, snapAction);') ||
  !contentSource.includes('"Return to original tab"') ||
  !contentSource.includes('"Adjust window to video aspect ratio"') ||
  !contentSource.includes('"Disable screen-edge padding"') ||
  !contentSource.includes('"Enable screen-edge padding"') ||
  !contentSource.includes('"cp-corner-snap cp-active"') ||
  !contentSource.includes('createTablerIcon(doc, "arrow-back-up")') ||
  !contentSource.includes('adjustAspect.append(createTablerIcon(doc, "aspect-ratio"));') ||
  !contentSource.includes('createTablerIcon(doc, "magnet")') ||
  !contentSource.includes('cornerSnap.append(createTablerIcon(doc, "magnet"));') ||
  !contentSource.includes('d: "M4 13v-8a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v8') ||
  /magnet-rectangle|transform: "matrix\(\.55/.test(contentSource) ||
  !contentSource.includes('cc.append(createTablerIcon(doc, "subtitles"));') ||
  !contentSource.includes('.cp-corner-snap:not(.cp-active) .cp-control-icon,') ||
  !contentSource.includes('.cp-cc:not(.cp-active) .cp-control-icon,') ||
  /createTablerIcon\(doc, "(?:pinned-off|subtitles-off)"\)/.test(contentSource) ||
  !contentSource.includes('window.focus();') ||
  !contentSource.includes('pipWindow.close();') ||
  !contentSource.includes('type: CORNER_SNAP_SET_ENABLED_MESSAGE') ||
  !contentSource.includes('[CORNER_SNAP_ENABLED_STORAGE_KEY]: cornerSnapEnabled') ||
  !serviceWorkerSource.includes('message?.type === CORNER_SNAP_SET_ENABLED_MESSAGE') ||
  !serviceWorkerSource.includes('!record || !record.enabled || Date.now() < record.readyAt')
) {
  throw new Error("The top controls must include icon-only return and aspect-adjust actions, while Pin and subtitles each keep one Tabler icon with full/reduced opacity and preserve their state routing.");
}
if (
  !contentSource.includes('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);') ||
  !contentSource.includes('.cp-top-group { display: flex; align-items: flex-start; gap: 6px; }') ||
  !contentSource.includes('.cp-top-group-left { justify-self: start; }') ||
  !contentSource.includes('.cp-top-action-left { justify-self: start; }') ||
  !contentSource.includes('.cp-top-action-center { justify-self: center; }') ||
  !contentSource.includes('.cp-top-action-right { justify-self: end; }') ||
  !/\.cp-top-action\s*\{[\s\S]*?border-radius:\s*50%;/.test(contentSource) ||
  !/\.cp-top-controls \.cp-button\s*\{[\s\S]*?border-radius:\s*50%;/.test(contentSource) ||
  !contentSource.includes('.cp-controls-visible .cp-top-action, .cp-paused .cp-top-action, .cp-panel-open .cp-top-action, .cp-volume-active .cp-top-action {') ||
  contentSource.includes('.cp-corner-snap.cp-active { color: #a99bff; }') ||
  !contentSource.includes('"Enter original player fullscreen"') ||
  !contentSource.includes('"cp-presentation"') ||
  !contentSource.includes('createTablerIcon(doc, "maximize")') ||
  !contentSource.includes('const adjustWindowToVideoAspect = () => {') ||
  !contentSource.includes('Math.round(Number(pipWindow.innerWidth))') ||
  !contentSource.includes('pendingSizeInnerWidth = requestedInnerWidth;') ||
  !contentSource.includes('adjustAspect.addEventListener("click", adjustWindowToVideoAspect);') ||
  !contentSource.includes('if (Number(state?.aspect) > 0) setResizeAspect(state.aspect);') ||
  !contentSource.includes('function enterOriginalPlayerFullscreen(media)') ||
  !contentSource.includes('function findOriginalFullscreenControl(media)') ||
  !contentSource.includes('querySelectorsDeep(document, selectors, 120)') ||
  !contentSource.includes('fullscreenControl.click();') ||
  !contentSource.includes('media.tagName === "IFRAME" || (media.tagName === "VIDEO" && media.controls)') ||
  !contentSource.includes('function requestOriginalFullscreen(target)') ||
  !contentSource.includes('target.requestFullscreen({ navigationUI: "hide" })') ||
  !contentSource.includes('function findPresentationTarget(media)') ||
  !contentSource.includes('finishSession(session);') ||
  !contentSource.includes('enterOriginalPlayerFullscreen(media);') ||
  !contentSource.includes('type: FOCUS_PRESENTATION_MESSAGE') ||
  !serviceWorkerSource.includes('message?.type === FOCUS_PRESENTATION_MESSAGE') ||
  !serviceWorkerSource.includes('await chrome.tabs.update(tabId, { active: true });') ||
  !serviceWorkerSource.includes('await chrome.windows.update(windowId, { focused: true });') ||
  /enterFullscreenPresentation\(media\)|data-caption-pip-presentation|state:\s*"fullscreen"|presentationWindows|CAPTION_PIP_FULLSCREEN_SET|cp-fullscreen|pipWindow[^\n]*requestFullscreen/.test(`${contentSource}\n${serviceWorkerSource}`)
) {
  throw new Error("Maximize must restore the original player, invoke its own generic fullscreen control with the PiP click activation, use only an in-place native fallback, and focus its tab without fullscreening the Chrome window.");
}
if (
  !contentSource.includes('const captions = element(doc, "div", "cp-captions cp-empty cp-hidden")') ||
  !contentSource.includes('const cc = controlButton(doc, "", "Show subtitles (C)", "cp-cc");') ||
  !contentSource.includes("let captionsEnabled = Boolean(captionPreference.enabled);") ||
  !contentSource.includes("captionPreference.onChange?.(captionsEnabled);") ||
  !contentSource.includes('const safeText = String(text || "");') ||
  !contentSource.includes('ui.setCaptionState(text);') ||
  !contentSource.includes('session.ui.setCaptionState(message.text || "");') ||
  !contentSource.includes("loadCaptionPreference(describeVideo(video), [])") ||
  !contentSource.includes("loadCaptionPreference(request.video, request.path)") ||
  !contentSource.includes('const SUBTITLE_VISIBILITY_STORAGE_PREFIX = "captionPipSubtitleVisibilityV1.";') ||
  !contentSource.includes("enabled = stored[storageKey] === true;") ||
  !contentSource.includes("hashCaptionSourceIdentity(identity") ||
  !contentSource.includes("if (isCaptionControlText(raw)) continue;") ||
  !contentSource.includes("node.closest(interactiveSelector)") ||
  !contentSource.includes("node.querySelector(interactiveSelector)") ||
  !contentSource.includes("subtitles?(?: cc)?") ||
  /subtitlesAvailable|Subtitles unavailable|cc\.disabled|message\.available|hasTransientDomCaptionCues|getDomCaptionSourceState|YOUTUBE_CAPTION_CONTROL_SELECTOR|NETFLIX_CAPTION_LAYER_SELECTOR|\.cp-cc:disabled/.test(contentSource)
) {
  throw new Error("The subtitle control must always be enabled, default hidden for a new generic source, persist per-source visibility, ignore website caption enablement, and exclude interactive subtitle labels from caption text.");
}
if (
  !contentSource.includes("--cp-caption-edge-offset: 10%;") ||
  !contentSource.includes("--cp-control-rail-height: 84px;") ||
  !contentSource.includes("--cp-control-rail-height: 66px;") ||
  !contentSource.includes('bottom: calc(var(--cp-control-rail-height) + var(--cp-caption-edge-offset));') ||
  !contentSource.includes("--cp-panel-max-height: calc(100vh - 102px);") ||
  !contentSource.includes("--cp-panel-max-height: calc(100vh - 80px);") ||
  !contentSource.includes("scrollbar-gutter: stable;") ||
  /bottom:\s*12%|top:\s*12%|bottom:\s*clamp\(54px,\s*22%|bottom:\s*clamp\(64px,\s*18%/.test(contentSource)
) {
  throw new Error("The appearance panel must stay contained, captions must use a 10% edge inset, and visible controls must add their rail height.");
}
const appearancePanelCss = contentSource.match(/\.cp-panel\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
const appearancePanelScrollCss = contentSource.match(/\.cp-panel-scroll\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
const appearancePanelHeaderCss = contentSource.match(/\.cp-panel-header\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
if (
  !/overflow:\s*hidden/.test(appearancePanelCss) ||
  !/display:\s*flex/.test(appearancePanelCss) ||
  !/flex-direction:\s*column/.test(appearancePanelCss) ||
  !/border-radius:\s*14px/.test(appearancePanelCss) ||
  !/background:\s*var\(--cp-glass-surface\);/.test(appearancePanelCss) ||
  !/box-shadow:\s*var\(--cp-glass-shadow\);/.test(appearancePanelCss) ||
  !/flex:\s*1 1 auto/.test(appearancePanelScrollCss) ||
  !/min-height:\s*0/.test(appearancePanelScrollCss) ||
  !/padding:\s*0 14px 14px/.test(appearancePanelScrollCss) ||
  !/flex:\s*0 0 auto/.test(appearancePanelHeaderCss) ||
  !/padding:\s*14px 14px 8px/.test(appearancePanelHeaderCss) ||
  !contentSource.includes("wrapper.append(header, scroller);") ||
  /scroller\.append\(\s*header,/.test(contentSource) ||
  !contentSource.includes(".cp-panel-scroll::-webkit-scrollbar { width: 6px; height: 6px; }") ||
  !contentSource.includes(".cp-panel-scroll::-webkit-scrollbar-button { display: none; width: 0; height: 0; }") ||
  !contentSource.includes('createTablerIcon(doc, "x")') ||
  !contentSource.includes("panel.onClose = () =>") ||
  !contentSource.includes("if (!destroyed && panelOpen) togglePanel(false);") ||
  !/\.cp-panel-close\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent/.test(contentSource) ||
  /cp-save|device-floppy|panel\.onSave|Save subtitle settings|cp-reset|cp-detection|setDetectionState|setCaptionDetected|Subtitles detected|Looking for subtitles/.test(contentSource)
) {
  throw new Error("The subtitle panel must keep its header fixed above an independently scrolling settings area, use the shared static liquid-glass material, retain rounded corners and automatic persistence, and provide an icon-only Tabler X close action.");
}
if (
  !manifest.permissions?.includes("storage") ||
  !contentSource.includes('edge: "none"') ||
  !contentSource.includes('createRangeField(doc, "Size", 8, 48, 1, "px")') ||
  !contentSource.includes('["raised", "Raised"]') ||
  !contentSource.includes('["shadow", "Drop shadow"]') ||
  !contentSource.includes("settings.size = clamp(Number(settings.size) || DEFAULT_SETTINGS.size, 8, 48)") ||
  !contentSource.includes("const settingsReady = chrome.storage.local") ||
  !contentSource.includes("await settingsReady;") ||
  !contentSource.includes("chrome.storage.onChanged.addListener") ||
  !contentSource.includes("function persistSettingsNow()") ||
  !contentSource.includes("if (!settingsDirty) return Promise.resolve();") ||
  !contentSource.includes("if (!panelOpen) persistSettingsNow();") ||
  !/chrome\.storage\.local\s*\.set\(\{ subtitleSettings \}\)/.test(contentSource)
) {
  throw new Error("Every subtitle appearance field must use persistent extension storage, with None as the default edge and an 8px minimum size.");
}
const captionTextCss = contentSource.match(/\.cp-caption-text\s*\{[\s\S]*?\}/)?.[0] || "";
if (/text-shadow\s*:/.test(captionTextCss)) {
  throw new Error("Character edge None must not inherit a fixed CSS text shadow.");
}
if (
  !contentSource.includes('type: "CANDIDATE_HINT"') ||
  !contentSource.includes("const reservationAspect = getReservationAspect(aspect);") ||
  !contentSource.includes("if (!reservationAspect) return { reserved: false, noVideo: true };") ||
  !contentSource.includes("requestPipWindow(reservationAspect)") ||
  !contentSource.includes("if (!selected) return null;") ||
  !contentSource.includes("const candidateHintObserver = new MutationObserver(scheduleCandidateHint);") ||
  !contentSource.includes("candidateHintObserver.observe(document.documentElement")
) {
  throw new Error("The immediate PiP reservation must use current cross-frame video hints and skip opening when none are available.");
}
const reservationIndex = serviceWorkerSource.indexOf("const reservationPromise");
const awaitCandidatesIndex = serviceWorkerSource.indexOf("await Promise.all");
if (
  reservationIndex < 0 ||
  awaitCandidatesIndex < 0 ||
  reservationIndex > awaitCandidatesIndex
) {
  throw new Error("The candidate-aware PiP reservation must begin before asynchronous candidate ranking consumes activation.");
}
if (
  !contentSource.includes("const size = getPipWindowSize(aspect);") ||
  !contentSource.includes("function normalizePipAspect(rawAspect)") ||
  !contentSource.includes("return clamp(Number(rawAspect) || 16 / 9, 0.45, 3.2);") ||
  !contentSource.includes("const PIP_MAX_SCREEN_WIDTH_RATIO = 0.3;") ||
  !contentSource.includes("const DEFAULT_PIP_TOP_BAR_HEIGHT = 34;") ||
  !contentSource.includes('const PIP_REQUEST_FRAME_STORAGE_KEY = "captionPipRequestFrameV1";') ||
  !contentSource.includes("const DEFAULT_PIP_REQUEST_FRAME = Object.freeze({") ||
  !contentSource.includes("const DEFAULT_PIP_NATIVE_FRAME = Object.freeze({") ||
  !contentSource.includes("const IS_GOOGLE_CHROME_BROWSER = detectGoogleChromeBrowser();") ||
  !contentSource.includes("height: IS_GOOGLE_CHROME_BROWSER ? DEFAULT_PIP_TOP_BAR_HEIGHT : 0") ||
  !contentSource.includes("function detectGoogleChromeBrowser()") ||
  !contentSource.includes('brand === "Google Chrome"') ||
  !contentSource.includes('navigator.vendor === "Google Inc."') ||
  !contentSource.includes('if ("brave" in navigator) return false;') ||
  !contentSource.includes("const maxWidth = Math.min(720, screen.availWidth * PIP_MAX_SCREEN_WIDTH_RATIO);") ||
  /Math\.max\(360,\s*Math\.min\(720|if\s*\(width\s*<\s*320\)/.test(contentSource) ||
  !contentSource.includes("const requestFrame = normalizePipFrameInsets(") ||
  !contentSource.includes("const requestedWidth = Math.max(1, Math.round(size.width + requestFrame.width));") ||
  !contentSource.includes("const requestedHeight = Math.max(1, Math.round(size.height + requestFrame.height));") ||
  !/width:\s*requestedWidth\s*,\s*\n\s*height:\s*requestedHeight\s*,/.test(contentSource) ||
  !contentSource.includes("preferInitialWindowPlacement: true") ||
  !contentSource.includes("root.dataset.requestedTopBarHeight = String(requestFrame.height);") ||
  !contentSource.includes('root.dataset.sizingMode = "adaptive-native-frame";') ||
  !contentSource.includes("pipWindow.__captionPipRequestGeometry = {") ||
  !contentSource.includes("pipWindow.__captionPipRegistrationPromise = registrationPromise;") ||
  !contentSource.includes("async function preparePipOpening(pipWindow, sourceAspect)") ||
  !contentSource.includes("registration = await pipWindow.__captionPipRegistrationPromise;") ||
  !contentSource.includes("measurePipNativeFrame(pipWindow, registration);") ||
  !contentSource.includes("rememberPipRequestFrame(pipWindow);") ||
  !contentSource.includes("await adjustPipOpeningToVideo(pipWindow, sourceAspect);") ||
  !contentSource.includes("await preparePipOpening(pipWindow, aspect);") ||
  !contentSource.includes("await preparePipOpening(pipWindow, request.state.aspect);") ||
  !contentSource.includes("function normalizePipFrameInsets(rawFrame, fallback = DEFAULT_PIP_NATIVE_FRAME)") ||
  !contentSource.includes("function measurePipNativeFrame(pipWindow, registration = null)") ||
  !contentSource.includes("outerWidth - innerWidth") ||
  !contentSource.includes("outerHeight - innerHeight") ||
  !contentSource.includes("function getPipNativeFrame(pipWindow)") ||
  !contentSource.includes("function rememberPipRequestFrame(pipWindow)") ||
  !contentSource.includes("async function adjustPipOpeningToVideo(pipWindow, rawAspect)") ||
  !contentSource.includes("Number(rawAspect) || Number(request.targetWidth) / Number(request.targetHeight)") ||
  !contentSource.includes("const targetInnerWidth = Math.max(") ||
  !contentSource.includes('root.dataset.openingAspectState = "adjusting";') ||
  !contentSource.includes('root.dataset.openingAspectState = "adjusted";') ||
  !contentSource.includes("await waitForPipWindowLayout(pipWindow);") ||
  !contentSource.includes("[PIP_REQUEST_FRAME_STORAGE_KEY]: learned") ||
  !contentSource.includes("const frameWidth = frame.width;") ||
  !contentSource.includes("const frameHeight = frame.height;") ||
  !serviceWorkerSource.includes("outerWidth: Math.round(Number(measuredWindow.width))") ||
  !serviceWorkerSource.includes("outerHeight: Math.round(Number(measuredWindow.height))") ||
  !contentSource.includes("targetInnerWidth,") ||
  !contentSource.includes("async function refreshPipMediaCompositor(pipWindow, element)") ||
  !contentSource.includes('element.style.setProperty("visibility", "hidden", "important");') ||
  !contentSource.includes("await refreshPipMediaCompositor(pipWindow, video);") ||
  !contentSource.includes("pipWindow.requestAnimationFrame(resolve);") ||
  !contentSource.includes('["object-fit", "var(--cp-media-fit, contain)"]') ||
  !contentSource.includes('["inset", "auto"]') ||
  !contentSource.includes('["left", "0"]') ||
  !contentSource.includes('["top", "0"]') ||
  !contentSource.includes('["right", "auto"]') ||
  !contentSource.includes('["bottom", "auto"]') ||
  !contentSource.includes('["object-position", "0 0"]') ||
  !contentSource.includes('["transform-origin", "0 0"]') ||
  !contentSource.includes('"cp-root cp-controls-visible cp-paused"') ||
  !contentSource.includes("object-fit: var(--cp-media-fit, contain) !important;") ||
  !contentSource.includes("left: 0 !important;") ||
  !contentSource.includes("top: 0 !important;") ||
  !contentSource.includes("object-position: 0 0 !important;") ||
  !contentSource.includes("function createPipMediaResizeStabilizer(pipWindow, stage, readAspect)") ||
  !contentSource.includes("PIP_RESIZE_SETTLE_DELAY = 140") ||
  !contentSource.includes("PIP_PIXEL_ALIGN_SEARCH_RADIUS = 32") ||
  !contentSource.includes("Math.round(rect.width * pixelRatio)") ||
  !contentSource.includes("Math.round(rect.height * pixelRatio)") ||
  !contentSource.includes("const nearestPixelAlignedWidth = (metrics) => {") ||
  !contentSource.includes("const projectedWidth = sourceAspect * (") ||
  !contentSource.includes("pixelError < best.pixelError - 0.0001") ||
  !contentSource.includes('setFit("contain", "resizing");') ||
  !contentSource.includes('setFit("cover", "settled");') ||
  !contentSource.includes("pipWindow.setTimeout(") ||
  !contentSource.includes("await requestPipAspectResize(") ||
  !contentSource.includes("new pipWindow.ResizeObserver(handleResize)") ||
  !contentSource.includes("let lastObservedInnerSize = null;") ||
  !contentSource.includes("const dimensionsChanged = !lastObservedInnerSize") ||
  !contentSource.includes("if (!dimensionsChanged) return;") ||
  !contentSource.includes('setFit("contain", "fixed-opening");') ||
  !contentSource.includes("const openingRevision = revision;") ||
  !contentSource.includes("const openingInnerSize = { ...lastObservedInnerSize };") ||
  !contentSource.includes("const settledOpeningMetrics = updateMetrics();") ||
  !contentSource.includes('setFit("cover", "opening-settled");') ||
  /resizeObserver\?\.observe\(stage\);\s*handleResize\(\);/.test(contentSource) ||
  !contentSource.includes("createPipMediaResizeStabilizer(pipWindow, ui.stage, () => getVideoAspect(video))") ||
  !contentSource.includes("createPipMediaResizeStabilizer(pipWindow, ui.stage, () => request.state.aspect)") ||
  /fitPipOpeningFromLiveFrame|readPipFrameMeasurement|pipOpeningFitStatus|measuredInnerWidth|measuredInnerHeight|measuredOuterWidth|measuredOuterHeight/.test(
    `${contentSource}\n${serviceWorkerSource}`,
  ) ||
  /PIP_FRAME_CALIBRATION|learnPipFrameCalibration|pipFrameCalibration(?:Applied|Learning|Status|Interrupted|Target|Environment)|CalibrationWelcome|CALIBRATION_WELCOME|cp-welcome|ALIGN_INITIAL_PIP_BOUNDS|alignInitialPipSizing|alignInitialDocumentPipBounds|initialSizing(?:Measured|Aligned|Window)|INITIAL_PIP_STABILITY_DELAYS|preflightPipInitialViewport|waitForPipInitialViewportFit|PIP_INITIAL_FIT_/.test(
    `${contentSource}\n${serviceWorkerSource}`,
  ) ||
  /schedulePipTopBarCalibration|cachedPipTopBarHeight|chrome\.storage\.local\.set\(\{\s*pipTopBarHeight/.test(
    `${contentSource}\n${serviceWorkerSource}`,
  ) ||
  /LOCK_PIP_ASPECT_AFTER_RESIZE|PIP_SUBPIXEL_FILL_LIMIT|observePipSubpixelFill|syncPipSubpixelFill|inferResizeAnchors|readPipOuterBounds|cp-resize-fill|cp-pixel-fill|aspectResize(?:State|Correction)|lockDocumentPipAspectAfterResize/.test(
    `${contentSource}\n${serviceWorkerSource}`,
  )
) {
  throw new Error("PiP sizing must use a passively learned request correction plus each live PiP window's measured native frame, run the shared aspect adjustment during the loading phase, and preserve wheel/Adjust/manual-resize behavior.");
}
if (
  /PIP_MAX_SCREEN_AREA_RATIO|PIP_PREPARE_INITIAL_WINDOW|PIP_FINALIZE_INITIAL_WINDOW|background-native-enforced/.test(
    `${contentSource}\n${serviceWorkerSource}`,
  )
) {
  throw new Error("The former 6.25% sizing and background pre-opening window implementation must remain removed.");
}
if (
  /PIP_HORIZONTAL_FRAME_INSET|horizontalFrameInset|pipHorizontalInset|schedulePipHorizontalInsetCalibration|\.resize(?:To|By)\s*\(|pipWindow\.addEventListener\(\s*["']resize["']/.test(contentSource)
) {
  throw new Error("PiP sizing must not restore the unrelated horizontal workaround, use the activation-blocked web resize API, or intercept native resize events.");
}
const trackRelaySource = contentSource.match(
  /function startTrackFrameRelay[\s\S]*?\n  function transferCaptureFrame/,
)?.[0];
if (!trackRelaySource) {
  throw new Error("The background-safe track frame relay could not be located.");
}
const directFrameRelaySource = contentSource.match(
  /function startVideoFrameRelay[\s\S]*?\n  function createCanvasVideoCapture/,
)?.[0];
if (!directFrameRelaySource) {
  throw new Error("The direct video frame relay could not be located.");
}
const frameCadenceCapPattern =
  /frame\.timestamp|lastTimestamp|lastFrameTime|1_000_000\s*\/\s*\d+|1000\s*\/\s*\d+/;
if (
  frameCadenceCapPattern.test(trackRelaySource) ||
  frameCadenceCapPattern.test(directFrameRelaySource) ||
  /captureStream\(\s*\d/.test(contentSource)
) {
  throw new Error("The track frame relay must preserve the source cadence without an extension FPS cap.");
}
const localPeerConnections = contentSource.match(
  /new RTCPeerConnection\(\{\s*iceServers:\s*\[\s*\]\s*\}\)/g,
);
if ((localPeerConnections?.length ?? 0) !== 2) {
  throw new Error("Embedded live mirroring must use exactly two peer connections with no STUN/TURN servers.");
}

console.log(`Static validation passed (${expected.length} manifest file references checked).`);
