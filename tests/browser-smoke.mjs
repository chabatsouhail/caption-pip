import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  close() {
    this.socket.close();
  }
}

const root = process.cwd();
const fixtureRoot = path.join(root, "tests", "fixtures");
const visualOutput = process.env.CAPTION_PIP_VISUAL_OUTPUT
  ? path.resolve(process.env.CAPTION_PIP_VISUAL_OUTPUT)
  : "";
const panelVisualOutput = process.env.CAPTION_PIP_PANEL_VISUAL_OUTPUT
  ? path.resolve(process.env.CAPTION_PIP_PANEL_VISUAL_OUTPUT)
  : "";
const compactPanelVisualOutput = process.env.CAPTION_PIP_COMPACT_PANEL_VISUAL_OUTPUT
  ? path.resolve(process.env.CAPTION_PIP_COMPACT_PANEL_VISUAL_OUTPUT)
  : "";
const noSubtitlesVisualOutput = process.env.CAPTION_PIP_NO_SUBTITLES_VISUAL_OUTPUT
  ? path.resolve(process.env.CAPTION_PIP_NO_SUBTITLES_VISUAL_OUTPUT)
  : "";
const responsiveCheck = process.env.CAPTION_PIP_RESPONSIVE_CHECK === "1";
const skipFrameCadenceCheck = process.env.CAPTION_PIP_SKIP_FRAME_CADENCE === "1";
const headedSmoke = process.env.CAPTION_PIP_HEADED === "1";
const customSubtitleSettings = Object.freeze({
  font: "serif",
  size: 8,
  color: "#f0e14a",
  textOpacity: 0.65,
  background: "#123456",
  backgroundOpacity: 0.35,
  weight: 500,
  edge: "raised",
  position: "top",
});
const chromePath = findChrome();
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "caption-pip-smoke-"));
const server = http.createServer(serveFixture);
let chromeProcess;

try {
  const fixturePort = await listen(server);
  chromeProcess = spawn(
    chromePath,
    [
      ...(headedSmoke ? [] : ["--headless=new"]),
      "--remote-debugging-port=0",
      `--user-data-dir=${profilePath}`,
      "--enable-unsafe-extension-debugging",
      "--no-first-run",
      "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required",
      "--force-device-scale-factor=1",
      "--screen-info={1920x1080}",
      "--window-size=1100,850",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  const debugPort = await readDebugPort(profilePath);
  const browserTarget = await getBrowserTarget(debugPort);
  const browser = new CdpClient(browserTarget.webSocketDebuggerUrl);
  await browser.ready;
  const { id: extensionId } = await browser.call("Extensions.loadUnpacked", { path: root });
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/index.html`;
  const pageTarget = await createTarget(debugPort, fixtureUrl);
  const page = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await page.ready;
  await page.call("Page.enable");
  await page.call("Page.bringToFront");
  await waitFor(
    async () =>
      (await evaluate(page, "document.querySelector('#regular-video')?.readyState >= 2")) === true,
    12_000,
    "fixture video",
  );
  const embeddedUrl = `http://localhost:${fixturePort}/embed.html`;
  const embeddedTarget = await waitFor(
    async () => {
      const targets = await listTargets(debugPort);
      return targets.find((target) => target.type === "iframe" && target.url === embeddedUrl);
    },
    5_000,
    "cross-origin iframe target",
  );
  const embedded = new CdpClient(embeddedTarget.webSocketDebuggerUrl);
  await embedded.ready;
  await waitFor(
    async () =>
      (await evaluate(embedded, "document.querySelector('#embedded-video')?.readyState >= 2")) === true,
    8_000,
    "embedded fixture video",
  );

  const tabTargetId = await waitFor(
    async () => {
      const { targetInfos } = await browser.call("Target.getTargets", {
        filter: [{ type: "tab", exclude: false }, { exclude: true }],
      });
      return targetInfos.find((target) => target.type === "tab" && target.url === fixtureUrl)?.targetId;
    },
    3_000,
    "fixture tab target",
  );
  await evaluate(
    page,
    `window.__captionPipOriginalVideoRect = (() => {
      const rect = document.querySelector('#regular-video').getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    })()`,
  );
  await browser.call("Extensions.triggerAction", {
    id: extensionId,
    targetId: tabTargetId,
  });

  const firstPipSurface = await waitFor(
    async () =>
      evaluate(
        page,
        `(() => {
          const pipDocument = window.documentPictureInPicture?.window?.document;
          if (pipDocument?.querySelector('.cp-welcome')) return 'welcome';
          if (pipDocument?.querySelector('.cp-root')) return 'video';
          return '';
        })()`,
      ),
    6_000,
    "first Document Picture-in-Picture surface",
  ).catch(() => "");

  let firstWelcomeState = null;
  if (firstPipSurface === "welcome") {
    firstWelcomeState = await waitFor(
      async () => {
        const state = await evaluate(
          page,
          `(() => {
            const pipWindow = window.documentPictureInPicture?.window;
            const pipDocument = pipWindow?.document;
            const root = pipDocument?.documentElement;
            const welcome = pipDocument?.querySelector('.cp-welcome');
            const button = pipDocument?.querySelector('.cp-welcome-button');
            if (!welcome || !button || button.disabled || root.dataset.pipFrameCalibrationStatus === 'measuring') return null;
            return {
              title: pipDocument.title,
              heading: pipDocument.querySelector('h1')?.textContent || '',
              copy: pipDocument.querySelector('.cp-welcome-copy')?.textContent || '',
              note: pipDocument.querySelector('.cp-welcome-note')?.textContent || '',
              statusText: pipDocument.querySelector('.cp-welcome-status')?.textContent?.trim() || '',
              buttonText: button.textContent || '',
              buttonDisabled: button.disabled,
              icon: pipDocument.querySelector('.cp-welcome-icon [data-tabler-icon]')?.dataset.tablerIcon || '',
              calibrationStatus: root.dataset.pipFrameCalibrationStatus,
              calibrationApplied: root.dataset.pipFrameCalibrationApplied === 'true',
              environmentId: root.dataset.pipFrameCalibrationEnvironment,
              requestedWidth: Number(root.dataset.requestedVideoWidth),
              requestedHeight: Number(root.dataset.requestedVideoHeight),
              targetWidth: Number(root.dataset.pipFrameCalibrationTargetWidth),
              targetHeight: Number(root.dataset.pipFrameCalibrationTargetHeight),
              innerWidth: pipWindow.innerWidth,
              innerHeight: pipWindow.innerHeight,
              outerWidth: pipWindow.outerWidth,
              outerHeight: pipWindow.outerHeight,
              videoUi: Boolean(pipDocument.querySelector('.cp-root, video, canvas')),
              sourcePlaceholder: Boolean(document.querySelector('[data-caption-pip-placeholder], [data-caption-pip-placeholder-cover]'))
            };
          })()`,
        );
        return state || false;
      },
      15_000,
      "one-time PiP welcome calibration",
    );
    if (
      firstWelcomeState.title !== "Welcome to Caption PiP" ||
      firstWelcomeState.heading !== "Welcome to Caption PiP" ||
      !firstWelcomeState.copy.includes("every video opens at the right size") ||
      !firstWelcomeState.note.includes("Measurements stay on this device") ||
      firstWelcomeState.icon !== "picture-in-picture" ||
      firstWelcomeState.buttonDisabled ||
      firstWelcomeState.calibrationApplied ||
      !firstWelcomeState.environmentId?.startsWith("v2.") ||
      firstWelcomeState.requestedWidth !== firstWelcomeState.targetWidth ||
      firstWelcomeState.requestedHeight !== firstWelcomeState.targetHeight ||
      firstWelcomeState.videoUi ||
      firstWelcomeState.sourcePlaceholder ||
      (headedSmoke && (
        firstWelcomeState.calibrationStatus !== "stored" ||
        firstWelcomeState.statusText !== "Setup complete" ||
        firstWelcomeState.buttonText !== "Get started"
      ))
    ) {
      throw new Error(`First-run PiP welcome is invalid: ${JSON.stringify(firstWelcomeState)}`);
    }

    // Headless Chrome does not honor the requested Document PiP bounds, so its
    // measured correction is intentionally rejected. Seed a valid no-op profile
    // only for the remainder of this headless integration run; headed coverage
    // uses the real profile produced by the welcome measurement.
    if (firstWelcomeState.calibrationStatus !== "stored") {
      await seedPipFrameCalibration(debugPort, firstWelcomeState);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    await clickPipElement(
      debugPort,
      pageTarget.targetId,
      ".cp-welcome",
      ".cp-welcome-button",
    );
  }

  const pipOpened = await waitFor(
    async () =>
      (await evaluate(
        page,
        `Boolean(window.documentPictureInPicture?.window?.document.querySelector('.cp-root'))`,
      )) === true,
    6_000,
    "Document Picture-in-Picture window",
  ).catch(() => false);

  if (!pipOpened && firstPipSurface === "welcome") {
    throw new Error("The one-time welcome did not hand off to the corrected video PiP.");
  }

  if (pipOpened) {
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `documentPictureInPicture.window?.document.documentElement.dataset.pipFrameCalibrationStatus !== 'measuring'`,
        )) === true,
      15_000,
      "completed passive PiP frame measurement",
    );
    await evaluate(
      page,
      `(() => {
        const pipWindow = documentPictureInPicture.window;
        pipWindow.document.querySelector('.cp-root')?.dispatchEvent(
          new pipWindow.PointerEvent('pointermove', {
            bubbles: true,
            clientX: Math.round(pipWindow.innerWidth / 2),
            clientY: Math.max(1, pipWindow.innerHeight - 24),
          }),
        );
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 220));
    const activeState = await evaluate(
      page,
      `({
        placeholder: Boolean(document.querySelector('[data-caption-pip-placeholder]')),
        placeholderCover: Boolean(document.querySelector('[data-caption-pip-placeholder-cover]')),
        placeholderGeometry: (() => {
          const anchor = document.querySelector('[data-caption-pip-placeholder]');
          const cover = document.querySelector('[data-caption-pip-placeholder-cover]');
          const rect = cover?.getBoundingClientRect();
          return {
            anchorVisibility: anchor ? getComputedStyle(anchor).visibility : '',
            coverZIndex: cover ? getComputedStyle(cover).zIndex : '',
            left: rect?.left,
            top: rect?.top,
            width: rect?.width,
            height: rect?.height,
            original: window.__captionPipOriginalVideoRect
          };
        })(),
        videoMoved: Boolean(documentPictureInPicture.window.document.querySelector('#regular-video')),
        captionUi: Boolean(documentPictureInPicture.window.document.querySelector('.cp-captions')),
        controls: documentPictureInPicture.window.document.querySelectorAll('.cp-controls button').length,
        timeline: Boolean(documentPictureInPicture.window.document.querySelector('.cp-timeline')),
        volumeIcon: Boolean(documentPictureInPicture.window.document.querySelector('.cp-mute svg')),
        tablerControlIcons: documentPictureInPicture.window.document.querySelectorAll('.cp-controls [data-tabler-icon]').length,
        tablerJumpIcons: Array.from(documentPictureInPicture.window.document.querySelectorAll('.cp-back [data-tabler-icon], .cp-forward [data-tabler-icon]')).map((icon) => icon.dataset.tablerIcon),
        tablerVolumeIcons: Array.from(documentPictureInPicture.window.document.querySelectorAll('.cp-mute [data-tabler-icon]')).map((icon) => icon.dataset.tablerIcon),
        tablerSubtitleIcons: Array.from(documentPictureInPicture.window.document.querySelectorAll('.cp-cc [data-tabler-icon]')).map((icon) => icon.dataset.tablerIcon),
        topControlIcons: Array.from(documentPictureInPicture.window.document.querySelectorAll('.cp-top-controls [data-tabler-icon]')).map((icon) => icon.dataset.tablerIcon),
        iconOnlyTopControls: ['.cp-return-to-opener', '.cp-adjust-aspect', '.cp-corner-snap', '.cp-presentation'].every((selector) => {
          const button = documentPictureInPicture.window.document.querySelector(selector);
          return Boolean(button?.querySelector('[data-tabler-icon]')) && button.textContent.trim() === '' && Boolean(button.title) && Boolean(button.getAttribute('aria-label'));
        }),
        topControlLayout: (() => {
          const pipWindow = documentPictureInPicture.window;
          const read = (selector) => {
            const element = pipWindow.document.querySelector(selector);
            const style = pipWindow.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              backgroundColor: style.backgroundColor,
              backgroundImage: style.backgroundImage,
              borderRadius: style.borderRadius,
              boxShadow: style.boxShadow,
              backdropFilter: style.backdropFilter
            };
          };
          return {
            returnAction: read('.cp-top-action-left'),
            adjustAspectAction: read('.cp-top-action-adjust'),
            presentationAction: read('.cp-top-action-center'),
            snapAction: read('.cp-top-action-right')
          };
        })(),
        subtitleControlDisabled: documentPictureInPicture.window.document.querySelector('.cp-cc').disabled,
        subtitleStatusDot: documentPictureInPicture.window.getComputedStyle(documentPictureInPicture.window.document.querySelector('.cp-cc'), '::after').content,
        iconOnlyUtilityControls: ['.cp-cc', '.cp-aa'].every((selector) => {
          const button = documentPictureInPicture.window.document.querySelector(selector);
          return Boolean(button?.querySelector('[data-tabler-icon]')) && button.textContent.trim() === '' && Boolean(button.title) && Boolean(button.getAttribute('aria-label'));
        }),
        borderlessControlSurface: (() => {
          const pipWindow = documentPictureInPicture.window;
          const pipDocument = pipWindow.document;
          const controlsStyle = pipWindow.getComputedStyle(pipDocument.querySelector('.cp-controls'));
          const ccStyle = pipWindow.getComputedStyle(pipDocument.querySelector('.cp-cc'));
          return controlsStyle.borderTopWidth === '0px' && !ccStyle.boxShadow.includes('inset') && ccStyle.backgroundColor === 'rgba(0, 0, 0, 0)';
        })(),
        floatingControlRail: (() => {
          const controlsStyle = documentPictureInPicture.window.getComputedStyle(documentPictureInPicture.window.document.querySelector('.cp-controls'));
          return {
            backgroundColor: controlsStyle.backgroundColor,
            backgroundImage: controlsStyle.backgroundImage,
            borderRadius: controlsStyle.borderRadius,
            boxShadow: controlsStyle.boxShadow,
            backdropFilter: controlsStyle.backdropFilter
          };
        })(),
        volumeSlider: Boolean(documentPictureInPicture.window.document.querySelector('.cp-volume-slider')),
        manualSizeControl: Boolean(documentPictureInPicture.window.document.querySelector('.cp-size-control, .cp-size-slider, .cp-size-output')),
        redundantCloseButton: Boolean(documentPictureInPicture.window.document.querySelector('.cp-close')),
        targetVideoWidth: Number(documentPictureInPicture.window.document.documentElement.dataset.targetVideoWidth || 0),
        targetVideoHeight: Number(documentPictureInPicture.window.document.documentElement.dataset.targetVideoHeight || 0),
        requestedVideoWidth: Number(documentPictureInPicture.window.document.documentElement.dataset.requestedVideoWidth || 0),
        requestedVideoHeight: Number(documentPictureInPicture.window.document.documentElement.dataset.requestedVideoHeight || 0),
        frameCalibrationEnvironment: documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationEnvironment,
        frameCalibrationApplied: documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationApplied === 'true',
        frameCalibrationLearning: documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationLearning === 'true',
        frameCalibrationStatus: documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationStatus,
        frameWidthCorrection: Number(documentPictureInPicture.window.document.documentElement.dataset.pipFrameWidthCorrection),
        frameHeightCorrection: Number(documentPictureInPicture.window.document.documentElement.dataset.pipFrameHeightCorrection),
        frameWidth: Number(documentPictureInPicture.window.document.documentElement.dataset.pipFrameWidth),
        frameHeight: Number(documentPictureInPicture.window.document.documentElement.dataset.pipFrameHeight),
        sizingMode: documentPictureInPicture.window.document.documentElement.dataset.sizingMode,
        mediaObjectFit: documentPictureInPicture.window.getComputedStyle(documentPictureInPicture.window.document.querySelector('.cp-stage video')).objectFit,
        pipInnerWidth: documentPictureInPicture.window.innerWidth,
        pipInnerHeight: documentPictureInPicture.window.innerHeight,
        pipOuterWidth: documentPictureInPicture.window.outerWidth,
        pipOuterHeight: documentPictureInPicture.window.outerHeight,
        controlLayout: (() => {
          const pipDocument = documentPictureInPicture.window.document;
          const bounds = (selector) => {
            const rect = pipDocument.querySelector(selector).getBoundingClientRect();
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
          };
          return {
            controls: bounds('.cp-controls'),
            primaryRow: bounds('.cp-primary-row'),
            transport: bounds('.cp-transport'),
            subtitleActions: bounds('.cp-subtitle-actions'),
            progressRow: bounds('.cp-progress-row'),
            timeline: bounds('.cp-timeline'),
            play: bounds('.cp-play'),
            back: bounds('.cp-back'),
            forward: bounds('.cp-forward'),
            timeCurrent: bounds('.cp-time-current'),
            timeDuration: bounds('.cp-time-duration'),
            currentText: pipDocument.querySelector('.cp-time-current').textContent,
            durationText: pipDocument.querySelector('.cp-time-duration').textContent,
            volume: bounds('.cp-volume-control'),
            mute: bounds('.cp-mute'),
            volumeSlider: bounds('.cp-volume-slider'),
            volumeOrientation: pipDocument.querySelector('.cp-volume-slider').getAttribute('aria-orientation'),
            volumePopup: Boolean(pipDocument.querySelector('.cp-volume-popover')),
            cc: bounds('.cp-cc'),
            aa: bounds('.cp-aa')
          };
        })(),
        pickerHosts: document.querySelectorAll('[data-caption-pip-picker-host]').length
      })`,
    );
    const frameProfileStored =
      activeState.frameCalibrationApplied && activeState.frameCalibrationStatus === 'applied';
    const topActionSurfaces = Object.values(activeState.topControlLayout);
    const topActionSurfacesAreStyled = topActionSurfaces.every(
      (surface) =>
        surface.top >= 0 &&
        surface.backgroundColor === 'rgba(10, 11, 16, 0.82)' &&
        surface.backgroundImage.includes('linear-gradient') &&
        surface.backgroundImage.includes('radial-gradient') &&
        surface.borderRadius === '50%' &&
        Math.abs(surface.width - surface.height) <= 1 &&
        surface.boxShadow !== 'none' &&
        surface.backdropFilter === 'none',
    );
    if (
      !activeState.placeholder ||
      !activeState.placeholderCover ||
      activeState.placeholderGeometry.anchorVisibility !== 'hidden' ||
      activeState.placeholderGeometry.coverZIndex !== '2147483647' ||
      Math.abs(activeState.placeholderGeometry.left - activeState.placeholderGeometry.original.left) > 1 ||
      Math.abs(activeState.placeholderGeometry.top - activeState.placeholderGeometry.original.top) > 1 ||
      Math.abs(activeState.placeholderGeometry.width - activeState.placeholderGeometry.original.width) > 1 ||
      Math.abs(activeState.placeholderGeometry.height - activeState.placeholderGeometry.original.height) > 1 ||
      !activeState.videoMoved ||
      !activeState.captionUi ||
      activeState.controls < 6 ||
      !activeState.timeline ||
      !activeState.volumeIcon ||
      activeState.tablerControlIcons !== 10 ||
      activeState.tablerJumpIcons.join(',') !== 'rewind-backward-10,rewind-forward-10' ||
      activeState.tablerVolumeIcons.join(',') !== 'volume-4,volume-2,volume,volume-off' ||
      activeState.tablerSubtitleIcons.join(',') !== 'subtitles' ||
      activeState.topControlIcons.join(',') !== 'arrow-back-up,aspect-ratio,maximize,magnet' ||
      !activeState.iconOnlyTopControls ||
      Math.abs(activeState.topControlLayout.returnAction.left - 8) > 1 ||
      activeState.topControlLayout.returnAction.right >= activeState.topControlLayout.adjustAspectAction.left ||
      activeState.topControlLayout.adjustAspectAction.right >= activeState.topControlLayout.presentationAction.left ||
      Math.abs((activeState.topControlLayout.presentationAction.left + activeState.topControlLayout.presentationAction.right) / 2 - activeState.pipInnerWidth / 2) > 1 ||
      Math.abs(activeState.pipInnerWidth - activeState.topControlLayout.snapAction.right - 8) > 1 ||
      activeState.topControlLayout.presentationAction.right >= activeState.topControlLayout.snapAction.left ||
      !topActionSurfacesAreStyled ||
      activeState.subtitleControlDisabled ||
      activeState.subtitleStatusDot !== 'none' ||
      !activeState.iconOnlyUtilityControls ||
      !activeState.borderlessControlSurface ||
      activeState.floatingControlRail.backgroundColor !== 'rgba(10, 11, 16, 0.82)' ||
      !activeState.floatingControlRail.backgroundImage.includes('linear-gradient') ||
      !activeState.floatingControlRail.backgroundImage.includes('radial-gradient') ||
      activeState.floatingControlRail.borderRadius !== '6px' ||
      activeState.floatingControlRail.boxShadow === 'none' ||
      activeState.floatingControlRail.backdropFilter !== 'none' ||
      !activeState.volumeSlider ||
      activeState.manualSizeControl ||
      activeState.redundantCloseButton ||
      activeState.targetVideoWidth < 2 ||
      activeState.targetVideoHeight < 2 ||
      activeState.requestedVideoWidth < 2 ||
      activeState.requestedVideoHeight < 2 ||
      activeState.requestedVideoWidth !== activeState.targetVideoWidth + activeState.frameWidthCorrection ||
      activeState.requestedVideoHeight !== activeState.targetVideoHeight + activeState.frameHeightCorrection ||
      activeState.pipOuterWidth < 2 ||
      activeState.pipOuterHeight < 2 ||
      activeState.sizingMode !== 'stored-frame-profile' ||
      activeState.mediaObjectFit !== 'contain' ||
      !activeState.frameCalibrationEnvironment ||
      !activeState.frameCalibrationApplied ||
      activeState.frameCalibrationLearning ||
      !frameProfileStored ||
      !Number.isFinite(activeState.frameWidthCorrection) ||
      !Number.isFinite(activeState.frameHeightCorrection) ||
      activeState.frameWidth < 0 ||
      activeState.frameHeight < 0 ||
      (headedSmoke && Math.abs(activeState.targetVideoWidth - activeState.pipInnerWidth) > 1) ||
      (headedSmoke && Math.abs(activeState.targetVideoHeight - activeState.pipInnerHeight) > 1) ||
      activeState.pickerHosts !== 0 ||
      (await evaluate(
        embedded,
        "document.querySelectorAll('[data-caption-pip-picker-host]').length",
      )) !== 0
    ) {
      throw new Error(`PiP UI assertion failed: ${JSON.stringify(activeState)}`);
    }
    if (headedSmoke) {
      console.log(
        `Headed PiP geometry: requested ${activeState.requestedVideoWidth}x${activeState.requestedVideoHeight}, ` +
          `native viewport ${activeState.pipInnerWidth}x${activeState.pipInnerHeight}, ` +
          `native outer ${activeState.pipOuterWidth}x${activeState.pipOuterHeight}.`,
      );
    }
    const railLayout = activeState.controlLayout;
    const compactInitialRail = activeState.pipInnerHeight <= 300;
    const expectedRailPadding = compactInitialRail ? 6 : 14;
    const expectedRailBottom = compactInitialRail ? 6 : 8;
    const precisionRailLayoutIsValid =
      railLayout.controls.height >= (compactInitialRail ? 60 : 70) &&
      Math.abs(railLayout.controls.left - 8) <= 1 &&
      Math.abs(activeState.pipInnerWidth - railLayout.controls.right - 8) <= 1 &&
      (compactInitialRail
        ? railLayout.controls.bottom <= activeState.pipInnerHeight + 1 &&
          railLayout.controls.bottom >= activeState.pipInnerHeight - expectedRailBottom - 1
        : Math.abs(activeState.pipInnerHeight - railLayout.controls.bottom - expectedRailBottom) <= 1) &&
      railLayout.primaryRow.bottom <= railLayout.progressRow.top + 1 &&
      Math.abs(railLayout.primaryRow.left - railLayout.controls.left - expectedRailPadding) <= 1 &&
      Math.abs(railLayout.controls.right - railLayout.primaryRow.right - expectedRailPadding) <= 1 &&
      Math.abs(railLayout.progressRow.left - railLayout.primaryRow.left) <= 1 &&
      Math.abs(railLayout.progressRow.right - railLayout.primaryRow.right) <= 1 &&
      Math.abs((railLayout.transport.left + railLayout.transport.right) / 2 - activeState.pipInnerWidth / 2) <= 1 &&
      Math.abs(railLayout.volume.left - railLayout.primaryRow.left) <= 1 &&
      railLayout.back.left < railLayout.play.left &&
      railLayout.play.left < railLayout.forward.left &&
      Math.abs(railLayout.subtitleActions.right - railLayout.primaryRow.right) <= 1 &&
      railLayout.volumeSlider.left >= railLayout.mute.right + 2 &&
      railLayout.volumeSlider.right <= railLayout.volume.right + 1 &&
      railLayout.volumeSlider.width > railLayout.volumeSlider.height &&
      railLayout.volumeOrientation === "horizontal" &&
      !railLayout.volumePopup &&
      railLayout.cc.right <= railLayout.aa.left + 1 &&
      railLayout.timeCurrent.right < railLayout.timeline.left &&
      railLayout.timeline.right < railLayout.timeDuration.left &&
      railLayout.timeline.width > railLayout.timeCurrent.width &&
      /^\d{2,}:\d{2}:\d{2}$/.test(railLayout.currentText) &&
      /^\d{2,}:\d{2}:\d{2}$/.test(railLayout.durationText);
    if (!precisionRailLayoutIsValid) {
      throw new Error(`Precision Rail control layout is invalid: ${JSON.stringify({
        pipInnerWidth: activeState.pipInnerWidth,
        pipInnerHeight: activeState.pipInnerHeight,
        railLayout,
      })}`);
    }
    await waitFor(
      async () =>
        (await evaluate(
          page,
          "documentPictureInPicture.window.document.querySelector('.cp-cc').disabled",
        )) === false,
      6_000,
      "always-enabled subtitle control",
    );
    const subtitleIconStates = await evaluate(
      page,
      `(() => {
        const pipWindow = documentPictureInPicture.window;
        const button = pipWindow.document.querySelector('.cp-cc');
        const icon = button.querySelector('[data-tabler-icon]');
        icon.style.transition = 'none';
        const iconState = () => ({
          name: icon.dataset.tablerIcon,
          opacity: pipWindow.getComputedStyle(icon).opacity
        });
        const initialDisabled = button.disabled;
        const initial = iconState();
        const initialPressed = button.getAttribute('aria-pressed');
        const initialLabel = button.getAttribute('aria-label');
        button.click();
        const shown = iconState();
        const shownPressed = button.getAttribute('aria-pressed');
        const shownLabel = button.getAttribute('aria-label');
        const background = pipWindow.getComputedStyle(button).backgroundColor;
        return { initialDisabled, initial, initialPressed, initialLabel, shown, shownPressed, shownLabel, background };
      })()`,
    );
    if (
      subtitleIconStates.initialDisabled ||
      subtitleIconStates.initial.name !== "subtitles" ||
      subtitleIconStates.initial.opacity !== "0.42" ||
      subtitleIconStates.initialPressed !== "false" ||
      subtitleIconStates.initialLabel !== "Show subtitles (C)" ||
      subtitleIconStates.shown.name !== "subtitles" ||
      subtitleIconStates.shown.opacity !== "1" ||
      subtitleIconStates.shownPressed !== "true" ||
      subtitleIconStates.shownLabel !== "Hide subtitles (C)" ||
      subtitleIconStates.background !== "rgba(0, 0, 0, 0)"
    ) {
      throw new Error(`Subtitle icon state swap failed: ${JSON.stringify(subtitleIconStates)}`);
    }
    const cornerSnapControlStates = await evaluate(
      page,
      `(() => {
        const pipWindow = documentPictureInPicture.window;
        const pipDocument = pipWindow.document;
        const root = pipDocument.querySelector('.cp-root');
        const surface = pipDocument.querySelector('.cp-top-controls');
        const actionSurface = pipDocument.querySelector('.cp-top-action-left');
        const button = pipDocument.querySelector('.cp-corner-snap');
        const returnButton = pipDocument.querySelector('.cp-return-to-opener');
        const presentationButton = pipDocument.querySelector('.cp-presentation');
        const icon = button.querySelector('[data-tabler-icon]');
        icon.style.transition = 'none';
        const iconState = () => ({
          name: icon.dataset.tablerIcon,
          opacity: pipWindow.getComputedStyle(icon).opacity
        });
        const originalRootClass = root.className;
        const originalTransition = surface.style.transition;
        surface.style.transition = 'none';
        root.classList.remove('cp-controls-visible', 'cp-paused', 'cp-panel-open', 'cp-volume-active');
        const hiddenOpacity = pipWindow.getComputedStyle(surface).opacity;
        const hiddenPointerEvents = pipWindow.getComputedStyle(actionSurface).pointerEvents;
        root.classList.add('cp-controls-visible');
        const visibleOpacity = pipWindow.getComputedStyle(surface).opacity;
        const visiblePointerEvents = pipWindow.getComputedStyle(actionSurface).pointerEvents;
        root.className = originalRootClass;
        surface.style.transition = originalTransition;
        const initial = {
          icon: iconState(),
          pressed: button.getAttribute('aria-pressed'),
          label: button.getAttribute('aria-label'),
          color: pipWindow.getComputedStyle(button).color
        };
        button.click();
        const unpinned = {
          icon: iconState(),
          pressed: button.getAttribute('aria-pressed'),
          label: button.getAttribute('aria-label'),
          color: pipWindow.getComputedStyle(button).color
        };
        button.click();
        const repinned = {
          icon: iconState(),
          pressed: button.getAttribute('aria-pressed'),
          label: button.getAttribute('aria-label'),
          color: pipWindow.getComputedStyle(button).color
        };
        return {
          initial,
          unpinned,
          repinned,
          returnIcon: returnButton.querySelector('[data-tabler-icon]')?.dataset.tablerIcon,
          returnLabel: returnButton.getAttribute('aria-label'),
          presentationIcon: presentationButton.querySelector('[data-tabler-icon]')?.dataset.tablerIcon,
          presentationLabel: presentationButton.getAttribute('aria-label'),
          hiddenOpacity,
          hiddenPointerEvents,
          visibleOpacity,
          visiblePointerEvents
        };
      })()`,
    );
    if (
      cornerSnapControlStates.initial.icon.name !== 'magnet' ||
      cornerSnapControlStates.initial.icon.opacity !== '1' ||
      cornerSnapControlStates.initial.pressed !== 'true' ||
      cornerSnapControlStates.initial.label !== 'Disable screen-edge padding' ||
      cornerSnapControlStates.unpinned.icon.name !== 'magnet' ||
      cornerSnapControlStates.unpinned.icon.opacity !== '0.42' ||
      cornerSnapControlStates.unpinned.pressed !== 'false' ||
      cornerSnapControlStates.unpinned.label !== 'Enable screen-edge padding' ||
      cornerSnapControlStates.repinned.icon.name !== 'magnet' ||
      cornerSnapControlStates.repinned.icon.opacity !== '1' ||
      cornerSnapControlStates.repinned.pressed !== 'true' ||
      cornerSnapControlStates.initial.color !== cornerSnapControlStates.unpinned.color ||
      cornerSnapControlStates.initial.color !== cornerSnapControlStates.repinned.color ||
      cornerSnapControlStates.initial.color === 'rgb(169, 155, 255)' ||
      cornerSnapControlStates.returnIcon !== 'arrow-back-up' ||
      cornerSnapControlStates.returnLabel !== 'Return to original tab' ||
      cornerSnapControlStates.presentationIcon !== 'maximize' ||
      cornerSnapControlStates.presentationLabel !== 'Enter original player fullscreen' ||
      cornerSnapControlStates.hiddenOpacity !== '0' ||
      cornerSnapControlStates.hiddenPointerEvents !== 'none' ||
      cornerSnapControlStates.visibleOpacity !== '1' ||
      cornerSnapControlStates.visiblePointerEvents !== 'auto'
    ) {
      throw new Error(`Top return/pin/presentation controls failed: ${JSON.stringify(cornerSnapControlStates)}`);
    }
    await evaluate(
      page,
      "documentPictureInPicture.window.document.querySelector('.cp-corner-snap').click()",
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const surfaceDragStart = await evaluate(
      page,
      `(async () => {
        const pipWindow = documentPictureInPicture.window;
        const stage = pipWindow.document.querySelector('.cp-stage');
        const beforeX = pipWindow.screenX;
        const beforeY = pipWindow.screenY;
        const beforeWidth = pipWindow.outerWidth;
        const beforeHeight = pipWindow.outerHeight;
        const centerX = beforeX + pipWindow.outerWidth / 2;
        const centerY = beforeY + pipWindow.outerHeight / 2;
        const screenCenterX = pipWindow.screen.availLeft + pipWindow.screen.availWidth / 2;
        const screenCenterY = pipWindow.screen.availTop + pipWindow.screen.availHeight / 2;
        const deltaX = centerX >= screenCenterX ? -56 : 56;
        const deltaY = centerY >= screenCenterY ? -38 : 38;
        const pointerX = beforeX + Math.min(120, pipWindow.innerWidth / 3);
        const pointerY = beforeY + Math.min(120, pipWindow.innerHeight / 3);
        const emit = (type, x, y, buttons) => stage.dispatchEvent(new pipWindow.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 81,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons,
          clientX: 100,
          clientY: 100,
          screenX: x,
          screenY: y
        }));
        emit('pointerdown', pointerX, pointerY, 1);
        emit('pointermove', pointerX + deltaX / 5, pointerY + deltaY / 5, 1);
        await new Promise((resolve) => pipWindow.setTimeout(resolve, 100));
        for (let step = 2; step <= 5; step += 1) {
          emit('pointermove', pointerX + deltaX * step / 5, pointerY + deltaY * step / 5, 1);
          await new Promise((resolve) => pipWindow.requestAnimationFrame(() => pipWindow.requestAnimationFrame(resolve)));
        }
        emit('pointerup', pointerX + deltaX, pointerY + deltaY, 0);
        return { beforeX, beforeY, beforeWidth, beforeHeight, deltaX, deltaY };
      })()`,
      true,
    );
    await waitFor(
      async () => {
        const position = await evaluate(
          page,
          `({ x: documentPictureInPicture.window.screenX, y: documentPictureInPicture.window.screenY })`,
        );
        return Math.abs(position.x - surfaceDragStart.beforeX) >= 20 ||
          Math.abs(position.y - surfaceDragStart.beforeY) >= 20;
      },
      4_000,
      "non-control PiP surface drag",
    );
    const surfaceDragEnd = await evaluate(
      page,
      `({ x: documentPictureInPicture.window.screenX, y: documentPictureInPicture.window.screenY, width: documentPictureInPicture.window.outerWidth, height: documentPictureInPicture.window.outerHeight })`,
    );
    if (
      Math.sign(surfaceDragEnd.x - surfaceDragStart.beforeX) !== Math.sign(surfaceDragStart.deltaX) ||
      Math.sign(surfaceDragEnd.y - surfaceDragStart.beforeY) !== Math.sign(surfaceDragStart.deltaY) ||
      Math.abs(surfaceDragEnd.width - surfaceDragStart.beforeWidth) > 1 ||
      Math.abs(surfaceDragEnd.height - surfaceDragStart.beforeHeight) > 1
    ) {
      throw new Error(`PiP surface drag changed direction or accumulated size: ${JSON.stringify({ surfaceDragStart, surfaceDragEnd })}`);
    }
    const controlDragState = await evaluate(
      page,
      `(() => {
        const pipWindow = documentPictureInPicture.window;
        const button = pipWindow.document.querySelector('.cp-play');
        const beforeX = pipWindow.screenX;
        const beforeY = pipWindow.screenY;
        const emit = (type, x, y, buttons) => button.dispatchEvent(new pipWindow.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 82,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons,
          screenX: x,
          screenY: y
        }));
        emit('pointerdown', beforeX + 100, beforeY + 100, 1);
        emit('pointermove', beforeX + 160, beforeY + 140, 1);
        emit('pointerup', beforeX + 160, beforeY + 140, 0);
        return { beforeX, beforeY };
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const afterControlDrag = await evaluate(
      page,
      `({ x: documentPictureInPicture.window.screenX, y: documentPictureInPicture.window.screenY })`,
    );
    if (
      Math.abs(afterControlDrag.x - controlDragState.beforeX) > 1 ||
      Math.abs(afterControlDrag.y - controlDragState.beforeY) > 1
    ) {
      throw new Error(`Dragging a control moved PiP: ${JSON.stringify({ controlDragState, afterControlDrag })}`);
    }
    await evaluate(
      page,
      "documentPictureInPicture.window.document.querySelector('.cp-corner-snap').click()",
    );
    const appearanceLayout = await evaluate(
      page,
      `(() => {
        const pipWindow = documentPictureInPicture.window;
        const pipDocument = pipWindow.document;
        const bounds = (selector) => {
          const rect = pipDocument.querySelector(selector).getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const appearance = pipDocument.querySelector('.cp-aa');
        const panel = pipDocument.querySelector('.cp-panel');
        const panelScroller = pipDocument.querySelector('.cp-panel-scroll');
        const close = pipDocument.querySelector('.cp-panel-close');
        const captions = pipDocument.querySelector('.cp-captions');
        const rootElement = pipDocument.querySelector('.cp-root');
        const originalRootClass = rootElement.className;
        const originalTransition = captions.style.transition;
        captions.style.transition = 'none';
        rootElement.classList.remove('cp-controls-visible', 'cp-paused', 'cp-panel-open', 'cp-volume-active');
        captions.dataset.position = 'bottom';
        void captions.offsetHeight;
        const restingBottomOffset = Number.parseFloat(pipWindow.getComputedStyle(captions).bottom);
        captions.dataset.position = 'top';
        const topOffset = Number.parseFloat(pipWindow.getComputedStyle(captions).top);
        captions.dataset.position = 'bottom';
        rootElement.className = originalRootClass;
        void captions.offsetHeight;
        const visibleBottomOffset = Number.parseFloat(pipWindow.getComputedStyle(captions).bottom);
        appearance.click();
        const panelStyle = pipWindow.getComputedStyle(panel);
        const closeStyle = pipWindow.getComputedStyle(close);
        const header = pipDocument.querySelector('.cp-panel-header');
        const firstField = panelScroller.querySelector('.cp-field');
        panelScroller.scrollTop = 0;
        const headerTopBeforeScroll = header.getBoundingClientRect().top;
        const firstFieldTopBeforeScroll = firstField.getBoundingClientRect().top;
        panelScroller.scrollTop = Math.min(80, panelScroller.scrollHeight - panelScroller.clientHeight);
        void panelScroller.offsetHeight;
        const settingsScrollTop = panelScroller.scrollTop;
        const headerTopAfterScroll = header.getBoundingClientRect().top;
        const firstFieldTopAfterScroll = firstField.getBoundingClientRect().top;
        panelScroller.scrollTop = 0;
        const state = {
          root: bounds('.cp-root'),
          panel: bounds('.cp-panel'),
          controls: bounds('.cp-controls'),
          captions: bounds('.cp-captions'),
          restingBottomOffset,
          visibleBottomOffset,
          topOffset,
          panelClientHeight: panelScroller.clientHeight,
          panelScrollHeight: panelScroller.scrollHeight,
          panelOverflowY: pipWindow.getComputedStyle(panelScroller).overflowY,
          panelOverflow: panelStyle.overflow,
          panelBackground: panelStyle.backgroundColor,
          panelBackgroundImage: panelStyle.backgroundImage,
          panelBoxShadow: panelStyle.boxShadow,
          panelBackdropFilter: panelStyle.backdropFilter,
          headerParentIsPanel: header.parentElement === panel,
          headerTopBeforeScroll,
          headerTopAfterScroll,
          firstFieldTopBeforeScroll,
          firstFieldTopAfterScroll,
          settingsScrollTop,
          panelCornerRadii: [panelStyle.borderTopLeftRadius, panelStyle.borderTopRightRadius, panelStyle.borderBottomRightRadius, panelStyle.borderBottomLeftRadius],
          scrollbarWidth: pipWindow.getComputedStyle(panelScroller, '::-webkit-scrollbar').width,
          closeIcon: close.querySelector('[data-tabler-icon]')?.dataset.tablerIcon,
          closeText: close.textContent.trim(),
          closeBackground: closeStyle.backgroundColor,
          closeBorderWidth: closeStyle.borderWidth,
          hasReset: Boolean(pipDocument.querySelector('.cp-reset')),
          hasDetectionSublabel: Boolean(pipDocument.querySelector('.cp-detection'))
        };
        appearance.click();
        captions.style.transition = originalTransition;
        return state;
      })()`,
    );
    const restingBottomOffsetRatio = appearanceLayout.restingBottomOffset / appearanceLayout.root.height;
    const visibleRailGapRatio =
      (appearanceLayout.visibleBottomOffset - (appearanceLayout.root.bottom - appearanceLayout.controls.top)) /
      appearanceLayout.root.height;
    const topOffsetRatio = appearanceLayout.topOffset / appearanceLayout.root.height;
    const expectedPanelInset = appearanceLayout.root.height <= 300 ? 8 : 10;
    const appearanceLayoutIsValid =
      appearanceLayout.panel.left >= appearanceLayout.root.left + expectedPanelInset - 1 &&
      appearanceLayout.panel.top >= appearanceLayout.root.top + expectedPanelInset - 1 &&
      appearanceLayout.panel.right <= appearanceLayout.root.right - expectedPanelInset + 1 &&
      appearanceLayout.panel.bottom <= appearanceLayout.controls.top - 5 &&
      appearanceLayout.panelClientHeight <= appearanceLayout.panelScrollHeight &&
      appearanceLayout.panelOverflowY === "auto" &&
      appearanceLayout.panelOverflow === "hidden" &&
      appearanceLayout.panelBackground === "rgba(10, 11, 16, 0.82)" &&
      appearanceLayout.panelBackgroundImage.includes("linear-gradient") &&
      appearanceLayout.panelBackgroundImage.includes("radial-gradient") &&
      appearanceLayout.panelBoxShadow !== "none" &&
      appearanceLayout.panelBackdropFilter === "none" &&
      appearanceLayout.headerParentIsPanel &&
      Math.abs(appearanceLayout.headerTopAfterScroll - appearanceLayout.headerTopBeforeScroll) <= 1 &&
      (appearanceLayout.panelClientHeight < appearanceLayout.panelScrollHeight
        ? appearanceLayout.settingsScrollTop >= 30 &&
          appearanceLayout.firstFieldTopBeforeScroll - appearanceLayout.firstFieldTopAfterScroll >= appearanceLayout.settingsScrollTop - 1
        : appearanceLayout.settingsScrollTop === 0 &&
          Math.abs(appearanceLayout.firstFieldTopBeforeScroll - appearanceLayout.firstFieldTopAfterScroll) <= 1) &&
      appearanceLayout.panelCornerRadii.every((radius) => radius === "14px") &&
      appearanceLayout.scrollbarWidth === "6px" &&
      appearanceLayout.closeIcon === "x" &&
      appearanceLayout.closeText === "" &&
      appearanceLayout.closeBackground === "rgba(0, 0, 0, 0)" &&
      appearanceLayout.closeBorderWidth === "0px" &&
      !appearanceLayout.hasReset &&
      !appearanceLayout.hasDetectionSublabel &&
      Math.abs(restingBottomOffsetRatio - 0.1) <= 0.002 &&
      Math.abs(visibleRailGapRatio - 0.1) <= 0.002 &&
      Math.abs(topOffsetRatio - 0.1) <= 0.002 &&
      appearanceLayout.captions.left >= appearanceLayout.root.left + 7 &&
      appearanceLayout.captions.right <= appearanceLayout.root.right - 7;
    if (!appearanceLayoutIsValid) {
      throw new Error(`Subtitle appearance layout escaped the PiP viewport: ${JSON.stringify({ ...appearanceLayout, restingBottomOffsetRatio, visibleRailGapRatio, topOffsetRatio })}`);
    }

    const timelinePresentation = await evaluate(
      page,
      `(() => {
        const pipWindow = documentPictureInPicture.window;
        const timeline = pipWindow.document.querySelector('.cp-timeline');
        const duration = Number(timeline.max);
        timeline.value = String(duration / 2);
        timeline.dispatchEvent(new pipWindow.Event('input', { bubbles: true }));
        return {
          progress: timeline.style.getPropertyValue('--cp-progress'),
          current: pipWindow.document.querySelector('.cp-time-current')?.textContent,
          duration: pipWindow.document.querySelector('.cp-time-duration')?.textContent
        };
      })()`,
    );
    if (
      Math.abs(Number.parseFloat(timelinePresentation.progress) - 50) > 2 ||
      !timelinePresentation.current ||
      !timelinePresentation.duration
    ) {
      throw new Error(`Precision Rail progress presentation is invalid: ${JSON.stringify(timelinePresentation)}`);
    }

    if (visualOutput) {
      await evaluate(
        page,
        `(() => {
          const pipWindow = documentPictureInPicture.window;
          const pipDocument = pipWindow.document;
          const video = pipDocument.querySelector('#regular-video');
          const timeline = pipDocument.querySelector('.cp-timeline');
          if (!video.paused) pipDocument.querySelector('.cp-play').click();
          if (video.muted) pipDocument.querySelector('.cp-mute').click();
          timeline.value = String(Number(timeline.max) * 0.63);
          timeline.dispatchEvent(new pipWindow.Event('input', { bubbles: true }));
        })()`,
      );
      await waitFor(
        async () =>
          (await evaluate(
            page,
            `(() => {
              const pipDocument = documentPictureInPicture.window.document;
              return pipDocument.querySelector('#regular-video').paused &&
                pipDocument.querySelector('.cp-mute').dataset.muted !== 'true';
            })()`,
          )) === true,
        3_000,
        "reference-matched visual state",
      );
      await new Promise((resolve) => setTimeout(resolve, 180));
      await capturePipScreenshot(debugPort, pageTarget.targetId, visualOutput);
      await evaluate(page, "documentPictureInPicture.window.document.querySelector('.cp-play').click()");
      await waitFor(
        async () =>
          (await evaluate(
            page,
            "documentPictureInPicture.window.document.querySelector('#regular-video').paused",
          )) === false,
        3_000,
        "visual capture playback restoration",
      );
    }

    if (panelVisualOutput) {
      await evaluate(
        page,
        `(() => {
          const pipWindow = documentPictureInPicture.window;
          const pipDocument = pipWindow.document;
          const video = pipDocument.querySelector('#regular-video');
          if (!video.paused) pipDocument.querySelector('.cp-play').click();
          if (pipDocument.querySelector('.cp-panel').hidden) pipDocument.querySelector('.cp-aa').click();
        })()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 180));
      await capturePipScreenshot(debugPort, pageTarget.targetId, panelVisualOutput);
      await evaluate(
        page,
        `(() => {
          const pipDocument = documentPictureInPicture.window.document;
          if (!pipDocument.querySelector('.cp-panel').hidden) pipDocument.querySelector('.cp-aa').click();
          pipDocument.querySelector('.cp-play').click();
        })()`,
      );
    }

    if (responsiveCheck) {
      const responsiveControls = await verifyResponsivePipControls(
        browser,
        debugPort,
        pageTarget.targetId,
        { width: activeState.pipOuterWidth, height: activeState.pipOuterHeight },
      );
      if (!responsiveControls.valid) {
        throw new Error(
          `Precision Rail controls overflowed a compact PiP window: ${JSON.stringify(responsiveControls.compactState)}`,
        );
      }
    }

    const volumeGeometry = await evaluate(
      page,
      `(() => {
        const pipDocument = documentPictureInPicture.window.document;
        const bounds = (selector) => {
          const rect = pipDocument.querySelector(selector).getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        return {
          root: bounds('.cp-root'),
          control: bounds('.cp-volume-control'),
          button: bounds('.cp-mute'),
          slider: bounds('.cp-volume-slider'),
          orientation: pipDocument.querySelector('.cp-volume-slider').getAttribute('aria-orientation'),
          popup: Boolean(pipDocument.querySelector('.cp-volume-popover'))
        };
      })()`,
    );
    const embeddedVolumeLayoutIsValid =
      volumeGeometry.slider.left >= volumeGeometry.button.right + 2 &&
      volumeGeometry.slider.right <= volumeGeometry.control.right + 1 &&
      volumeGeometry.slider.top >= volumeGeometry.control.top &&
      volumeGeometry.slider.bottom <= volumeGeometry.control.bottom &&
      volumeGeometry.slider.width > volumeGeometry.slider.height &&
      volumeGeometry.orientation === "horizontal" &&
      !volumeGeometry.popup;
    if (!embeddedVolumeLayoutIsValid) {
      throw new Error(`Volume control geometry is invalid: ${JSON.stringify(volumeGeometry)}`);
    }

    const verifyDirectVolumeLevel = async (volume, expectedLevel, expectedIcon, expectedBars) => {
      await evaluate(
        page,
        `(() => {
          const pipWindow = documentPictureInPicture.window;
          const slider = pipWindow.document.querySelector('.cp-volume-slider');
          slider.value = '${volume}';
          slider.dispatchEvent(new pipWindow.Event('input', { bubbles: true }));
        })()`,
      );
      return waitFor(async () => {
        const state = await evaluate(
          page,
          `(() => {
            const pipWindow = documentPictureInPicture.window;
            const pipDocument = pipWindow.document;
            const button = pipDocument.querySelector('.cp-mute');
            const icon = Array.from(button.querySelectorAll('[data-tabler-icon]'))
              .find((item) => pipWindow.getComputedStyle(item).display !== 'none');
            return {
              muted: pipDocument.querySelector('#regular-video').muted,
              volume: pipDocument.querySelector('#regular-video').volume,
              level: button.dataset.level,
              icon: icon?.dataset.tablerIcon,
              bars: Math.max(0, (icon?.querySelectorAll('path').length || 1) - 1),
              opacity: icon ? pipWindow.getComputedStyle(icon).opacity : ''
            };
          })()`,
        );
        return !state.muted &&
          Math.abs(state.volume - volume) < 0.01 &&
          state.level === expectedLevel &&
          state.icon === expectedIcon &&
          state.bars === expectedBars &&
          state.opacity === '1'
          ? state
          : false;
      }, 3_000, `${expectedLevel} direct volume icon`);
    };
    await verifyDirectVolumeLevel(0.2, "low", "volume-4", 0);
    await verifyDirectVolumeLevel(0.5, "medium", "volume-2", 1);
    await verifyDirectVolumeLevel(0.9, "high", "volume", 2);
    await verifyDirectVolumeLevel(0.37, "medium", "volume-2", 1);
    await evaluate(
      page,
      "documentPictureInPicture.window.document.querySelector('.cp-mute').click()",
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          "(() => { const pipWindow = documentPictureInPicture.window; const pipDocument = pipWindow.document; const button = pipDocument.querySelector('.cp-mute'); const icon = Array.from(button.querySelectorAll('[data-tabler-icon]')).find((item) => pipWindow.getComputedStyle(item).display !== 'none'); return pipDocument.querySelector('#regular-video').muted && button.dataset.muted === 'true' && button.dataset.level === 'high' && icon?.dataset.tablerIcon === 'volume-off' && Number(pipWindow.getComputedStyle(icon).opacity) < 0.5; })()",
        )) === true,
      3_000,
      "direct mute icon",
    );
    await evaluate(
      page,
      "documentPictureInPicture.window.document.querySelector('.cp-mute').click()",
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          "(() => { const pipWindow = documentPictureInPicture.window; const pipDocument = pipWindow.document; const video = pipDocument.querySelector('#regular-video'); const button = pipDocument.querySelector('.cp-mute'); const icon = Array.from(button.querySelectorAll('[data-tabler-icon]')).find((item) => pipWindow.getComputedStyle(item).display !== 'none'); return !video.muted && Math.abs(video.volume - 0.37) < 0.01 && button.dataset.muted === 'false' && button.dataset.level === 'high' && icon?.dataset.tablerIcon === 'volume' && pipWindow.getComputedStyle(icon).opacity === '1'; })()",
        )) === true,
      3_000,
      "direct unmute with remembered volume",
    );
    const embeddedVolumeRemainsInteractive = await evaluate(
      page,
      "(() => { const pipWindow = documentPictureInPicture.window; const pipDocument = pipWindow.document; const slider = pipDocument.querySelector('.cp-volume-slider'); const control = pipDocument.querySelector('.cp-volume-control'); slider.focus(); control.dispatchEvent(new pipWindow.PointerEvent('pointerleave')); const valid = control.contains(slider) && pipDocument.querySelector('.cp-root').classList.contains('cp-volume-active') && !pipDocument.querySelector('.cp-volume-popover'); slider.blur(); return valid; })()",
    );
    if (!embeddedVolumeRemainsInteractive) {
      throw new Error("The embedded volume slider did not remain interactive after pointer hover ended.");
    }

    await waitFor(
      async () =>
        (await evaluate(
          page,
          "Boolean(documentPictureInPicture.window.document.querySelector('.cp-caption-text')?.textContent.trim())",
        )) === true,
      3_000,
      "rendered subtitle cue",
    );

    await evaluate(
      page,
      `(() => {
        const video = documentPictureInPicture.window.document.querySelector('#regular-video');
        video.style.cssText = 'position:absolute;left:1280px;top:652.5px;width:2560px;height:1711px;transform:matrix(1,0,0,1,-1280,-855.5);object-fit:fill';
      })()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `(() => {
            const pipDocument = documentPictureInPicture.window.document;
            const stageRect = pipDocument.querySelector('.cp-stage').getBoundingClientRect();
            const video = pipDocument.querySelector('#regular-video');
            const videoRect = video.getBoundingClientRect();
            const style = pipDocument.defaultView.getComputedStyle(video);
            return Math.abs(videoRect.left - stageRect.left) < 1 &&
              Math.abs(videoRect.top - stageRect.top) < 1 &&
              Math.abs(videoRect.width - stageRect.width) < 1 &&
              Math.abs(videoRect.height - stageRect.height) < 1 &&
              style.transform === 'none' &&
              (style.objectFit === 'contain' || style.objectFit === 'cover');
          })()`,
        )) === true,
      3_000,
      "PiP geometry isolation after source-player resize mutation",
    );

    await evaluate(
      page,
      `documentPictureInPicture.window.document.querySelector('.cp-root')
        .dispatchEvent(new PointerEvent('pointermove'))`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    await evaluate(
      page,
      `documentPictureInPicture.window.document.querySelector('.cp-root')
        .dispatchEvent(new PointerEvent('pointermove'))`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_150));
    const controlsStable = await evaluate(
      page,
      `documentPictureInPicture.window.document.querySelector('.cp-root')
        .classList.contains('cp-controls-visible')`,
    );
    if (!controlsStable) {
      throw new Error("PiP controls were hidden by a stale cursor inactivity timer.");
    }
    const controlsSurvivePointerExit = await evaluate(
      page,
      `(() => {
        const root = documentPictureInPicture.window.document.querySelector('.cp-root');
        root.dispatchEvent(new MouseEvent('mouseleave'));
        return root.classList.contains('cp-controls-visible');
      })()`,
    );
    if (!controlsSurvivePointerExit) {
      throw new Error("PiP controls disappeared immediately when the pointer left the content area.");
    }

    const subtitleCustomizationState = await evaluate(
      page,
      `(() => {
        const pipWindow = documentPictureInPicture.window;
        const pipDocument = pipWindow.document;
        const appearance = pipDocument.querySelector('.cp-aa');
        const panel = pipDocument.querySelector('.cp-panel');
        if (panel.hidden) appearance.click();
        const captionText = pipDocument.querySelector('.cp-caption-text');
        const size = pipDocument.querySelector('.cp-size-range');
        const edge = pipDocument.querySelector('.cp-edge-select');
        const initial = {
          sizeMin: size.min,
          edge: edge.value,
          textShadow: captionText.style.textShadow,
          edgeOptions: Array.from(edge.options).map((option) => [option.value, option.textContent])
        };
        const update = (selector, value, eventName) => {
          const input = pipDocument.querySelector(selector);
          input.value = String(value);
          input.dispatchEvent(new pipWindow.Event(eventName, { bubbles: true }));
          return input.value;
        };
        update('.cp-font-select', 'serif', 'change');
        update('.cp-size-range', 8, 'input');
        update('.cp-text-color', '#f0e14a', 'input');
        update('.cp-text-opacity', 0.65, 'input');
        update('.cp-background-color', '#123456', 'input');
        update('.cp-background-opacity', 0.35, 'input');
        update('.cp-weight-select', 500, 'change');
        update('.cp-edge-select', 'raised', 'change');
        pipDocument.querySelector('.cp-position-field button[data-value="top"]').click();
        const close = pipDocument.querySelector('.cp-panel-close');
        const closeStyle = pipWindow.getComputedStyle(close);
        const state = {
          initial,
          panelOpenBeforeClose: !panel.hidden,
          close: {
            icon: close.querySelector('[data-tabler-icon]')?.dataset.tablerIcon,
            text: close.textContent.trim(),
            background: closeStyle.backgroundColor,
            borderWidth: closeStyle.borderWidth,
            ariaLabel: close.getAttribute('aria-label')
          },
          values: {
            font: pipDocument.querySelector('.cp-font-select').value,
            size: Number(size.value),
            color: pipDocument.querySelector('.cp-text-color').value,
            textOpacity: Number(pipDocument.querySelector('.cp-text-opacity').value),
            background: pipDocument.querySelector('.cp-background-color').value,
            backgroundOpacity: Number(pipDocument.querySelector('.cp-background-opacity').value),
            weight: Number(pipDocument.querySelector('.cp-weight-select').value),
            edge: edge.value,
            position: pipDocument.querySelector('.cp-position-field button[aria-pressed="true"]')?.dataset.value
          },
          captionStyle: {
            fontSize: captionText.style.fontSize,
            fontWeight: captionText.style.fontWeight,
            textShadow: captionText.style.textShadow
          }
        };
        close.click();
        return state;
      })()`,
    );
    if (
      subtitleCustomizationState.initial.sizeMin !== "8" ||
      subtitleCustomizationState.initial.edge !== "none" ||
      subtitleCustomizationState.initial.textShadow !== "none" ||
      JSON.stringify(subtitleCustomizationState.initial.edgeOptions) !==
        JSON.stringify([["none", "None"], ["raised", "Raised"], ["shadow", "Drop shadow"]]) ||
      !subtitleCustomizationState.panelOpenBeforeClose ||
      subtitleCustomizationState.close.icon !== "x" ||
      subtitleCustomizationState.close.text !== "" ||
      subtitleCustomizationState.close.background !== "rgba(0, 0, 0, 0)" ||
      subtitleCustomizationState.close.borderWidth !== "0px" ||
      subtitleCustomizationState.close.ariaLabel !== "Close subtitle settings" ||
      JSON.stringify(subtitleCustomizationState.values) !== JSON.stringify(customSubtitleSettings) ||
      subtitleCustomizationState.captionStyle.fontSize !== "8px" ||
      subtitleCustomizationState.captionStyle.fontWeight !== "500" ||
      !subtitleCustomizationState.captionStyle.textShadow.includes("-1px -1px")
    ) {
      throw new Error(`Subtitle customization controls are invalid: ${JSON.stringify(subtitleCustomizationState)}`);
    }
    await waitFor(
      async () =>
        (await evaluate(
          page,
          "documentPictureInPicture.window.document.querySelector('.cp-panel').hidden",
        )) === true,
      2_000,
      "subtitle settings close action",
    );

    const presentationPipTarget = await findPipTarget(debugPort, pageTarget.targetId);
    const presentationPip = new CdpClient(presentationPipTarget.webSocketDebuggerUrl);
    await presentationPip.ready;
    await presentationPip.call("Runtime.evaluate", {
      expression: "document.querySelector('.cp-presentation').click()",
      userGesture: true,
      returnByValue: true,
    }).catch(() => {});
    presentationPip.close();
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `document.fullscreenElement === document.querySelector('.player-shell') && window.__fixtureFullscreenClicks === 1 && document.querySelector('#regular-video').parentElement === document.querySelector('.player-shell') && !document.querySelector('[data-caption-pip-placeholder]') && !document.querySelector('[data-caption-pip-placeholder-cover]') && (!documentPictureInPicture.window || documentPictureInPicture.window.closed)`,
        )) === true,
      4_000,
      "original player fullscreen-control handoff",
    );
    const presentationState = await evaluate(
      page,
      `(() => {
        const player = document.querySelector('.player-shell');
        const video = document.querySelector('#regular-video');
        const websiteControl = document.querySelector('.fixture-fullscreen');
        const controlStyle = getComputedStyle(websiteControl);
        const controlRect = websiteControl.getBoundingClientRect();
        return {
          originalPlayerIsFullscreen: document.fullscreenElement === player,
          originalPlayerStillOwnsVideo: video.parentElement === player,
          websiteControlInsideFullscreenPlayer: player.contains(websiteControl),
          websiteControlLabel: websiteControl.getAttribute('aria-label'),
          websiteControlVisible: controlStyle.display !== 'none' && controlStyle.visibility !== 'hidden' && controlStyle.opacity === '1' && controlRect.width > 0 && controlRect.height > 0,
          websiteControlClicks: window.__fixtureFullscreenClicks,
          extensionPresentationNodes: document.querySelectorAll('[data-caption-pip-presentation-host], [data-caption-pip-presentation-player], [data-caption-pip-presentation-backdrop], [data-caption-pip-presentation-controls]').length
        };
      })()`,
    );
    if (
      !presentationState.originalPlayerIsFullscreen ||
      !presentationState.originalPlayerStillOwnsVideo ||
      !presentationState.websiteControlInsideFullscreenPlayer ||
      presentationState.websiteControlLabel !== "Exit fullscreen" ||
      !presentationState.websiteControlVisible ||
      presentationState.websiteControlClicks !== 1 ||
      presentationState.extensionPresentationNodes !== 0
    ) {
      throw new Error(`Original player fullscreen handoff is invalid: ${JSON.stringify(presentationState)}`);
    }
    await evaluate(
      page,
      `document.querySelector('.fixture-fullscreen').click()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `!document.fullscreenElement && window.__fixtureFullscreenClicks === 2 && document.querySelector('.fixture-fullscreen').getAttribute('aria-label') === 'Enter fullscreen' && document.querySelector('#regular-video').parentElement.classList.contains('player-shell') && getComputedStyle(document.querySelector('.player-shell')).position === 'relative'`,
        )) === true,
      4_000,
      "original player fullscreen-control exit",
    );

    const repeatedDirectSizing = [];
    for (let reopening = 0; reopening < 3; reopening += 1) {
      await browser.call("Extensions.triggerAction", {
        id: extensionId,
        targetId: tabTargetId,
      });
      await waitFor(
        async () =>
          (await evaluate(
            page,
            `Boolean(documentPictureInPicture.window?.document.querySelector('.cp-root'))`,
          )) === true,
        6_000,
        `regular video PiP reopening ${reopening + 1}`,
      );
      await waitFor(
        async () =>
          (await evaluate(
            page,
            headedSmoke && frameProfileStored
              ? `(() => {
                  const pipWindow = documentPictureInPicture.window;
                  const root = pipWindow.document.documentElement;
                  return root.dataset.pipFrameCalibrationStatus === 'applied' &&
                    Math.abs(pipWindow.innerWidth - Number(root.dataset.targetVideoWidth)) <= 1 &&
                    Math.abs(pipWindow.innerHeight - Number(root.dataset.targetVideoHeight)) <= 1;
                })()`
              : `documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationStatus !== 'measuring'`,
          )) === true,
        15_000,
        `stable regular video PiP reopening ${reopening + 1}`,
      );
      const reopeningSizing = await evaluate(
        page,
        `(() => {
          const pipWindow = documentPictureInPicture.window;
          const root = pipWindow.document.documentElement;
          return {
            targetWidth: Number(root.dataset.targetVideoWidth),
            targetHeight: Number(root.dataset.targetVideoHeight),
            requestedWidth: Number(root.dataset.requestedVideoWidth),
            requestedHeight: Number(root.dataset.requestedVideoHeight),
            innerWidth: pipWindow.innerWidth,
            innerHeight: pipWindow.innerHeight,
            calibrationApplied: root.dataset.pipFrameCalibrationApplied === 'true',
            calibrationStatus: root.dataset.pipFrameCalibrationStatus,
            widthCorrection: Number(root.dataset.pipFrameWidthCorrection),
            heightCorrection: Number(root.dataset.pipFrameHeightCorrection),
            sizingMode: root.dataset.sizingMode,
            subtitlePressed: pipWindow.document.querySelector('.cp-cc').getAttribute('aria-pressed'),
            subtitleIcon: Array.from(pipWindow.document.querySelectorAll('.cp-cc [data-tabler-icon]'))
              .find((icon) => pipWindow.getComputedStyle(icon).display !== 'none')?.dataset.tablerIcon
          };
        })()`,
      );
      repeatedDirectSizing.push(reopeningSizing);
      if (
        (frameProfileStored && (
          reopeningSizing.requestedWidth !== reopeningSizing.targetWidth + activeState.frameWidthCorrection ||
          reopeningSizing.requestedHeight !== reopeningSizing.targetHeight + activeState.frameHeightCorrection ||
          !reopeningSizing.calibrationApplied ||
          reopeningSizing.calibrationStatus !== 'applied' ||
          reopeningSizing.sizingMode !== 'stored-frame-profile' ||
          reopeningSizing.widthCorrection !== activeState.frameWidthCorrection ||
          reopeningSizing.heightCorrection !== activeState.frameHeightCorrection ||
          (headedSmoke && Math.abs(reopeningSizing.innerWidth - reopeningSizing.targetWidth) > 1) ||
          (headedSmoke && Math.abs(reopeningSizing.innerHeight - reopeningSizing.targetHeight) > 1)
        )) ||
        (!frameProfileStored && (
          reopeningSizing.requestedWidth !== reopeningSizing.targetWidth ||
          reopeningSizing.requestedHeight !== reopeningSizing.targetHeight ||
          reopeningSizing.calibrationApplied ||
          reopeningSizing.calibrationStatus !== 'rejected' ||
          reopeningSizing.sizingMode !== 'first-run-welcome-calibration'
        )) ||
        reopeningSizing.subtitlePressed !== 'true' ||
        reopeningSizing.subtitleIcon !== 'subtitles'
      ) {
        throw new Error(
          `Repeated regular PiP opening changed aspect: ${JSON.stringify(repeatedDirectSizing)}`,
        );
      }
      await evaluate(page, "documentPictureInPicture.window.close()");
      await waitFor(
        async () =>
          (await evaluate(
            page,
            `Boolean(document.querySelector('#regular-video')) && !document.querySelector('[data-caption-pip-placeholder]') && !document.querySelector('[data-caption-pip-placeholder-cover]')`,
          )) === true,
        4_000,
        `regular player restoration ${reopening + 1}`,
      );
    }

    const storedSubtitleSettings = await waitFor(
      async () => {
        const workerTarget = (await listTargets(debugPort)).find(
          (target) => target.type === "service_worker" && target.url.includes("src/service-worker.js"),
        );
        if (!workerTarget?.webSocketDebuggerUrl) return false;
        const worker = new CdpClient(workerTarget.webSocketDebuggerUrl);
        await worker.ready;
        try {
          const stored = await evaluate(
            worker,
            `(async () => (await chrome.storage.local.get('subtitleSettings')).subtitleSettings)()`,
            true,
          );
          return Object.keys(stored || {}).length === Object.keys(customSubtitleSettings).length &&
            Object.entries(customSubtitleSettings).every(([key, value]) => stored?.[key] === value)
            ? stored
            : false;
        } finally {
          worker.close();
        }
      },
      4_000,
      "persistent subtitle settings storage",
    );
    if (
      Object.keys(storedSubtitleSettings).length !== Object.keys(customSubtitleSettings).length ||
      !Object.entries(customSubtitleSettings).every(
        ([key, value]) => storedSubtitleSettings[key] === value,
      )
    ) {
      throw new Error(`The complete subtitle settings object was not persisted: ${JSON.stringify(storedSubtitleSettings)}`);
    }

    await evaluate(
      page,
      "document.querySelector('#regular-video').style.display = 'none'",
    );
    await evaluate(
      embedded,
      `(() => {
        window.__fixtureCaptionGap = true;
        document.querySelector('.fixture-caption-text').textContent = '';
      })()`,
    );
    await browser.call("Extensions.triggerAction", {
      id: extensionId,
      targetId: tabTargetId,
    });

    await waitFor(
      async () =>
        (await evaluate(
          page,
          `Boolean(window.documentPictureInPicture?.window?.document.querySelector('.cp-root'))`,
        )) === true,
      6_000,
      "embedded Document Picture-in-Picture window",
    );
    const reopenedSubtitleSettings = await evaluate(
      page,
      `(() => {
        const pipDocument = documentPictureInPicture.window.document;
        const captionText = pipDocument.querySelector('.cp-caption-text');
        return {
          values: {
            font: pipDocument.querySelector('.cp-font-select').value,
            size: Number(pipDocument.querySelector('.cp-size-range').value),
            color: pipDocument.querySelector('.cp-text-color').value,
            textOpacity: Number(pipDocument.querySelector('.cp-text-opacity').value),
            background: pipDocument.querySelector('.cp-background-color').value,
            backgroundOpacity: Number(pipDocument.querySelector('.cp-background-opacity').value),
            weight: Number(pipDocument.querySelector('.cp-weight-select').value),
            edge: pipDocument.querySelector('.cp-edge-select').value,
            position: pipDocument.querySelector('.cp-position-field button[aria-pressed="true"]')?.dataset.value
          },
          sizeMin: pipDocument.querySelector('.cp-size-range').min,
          fontSize: captionText.style.fontSize,
          textShadow: captionText.style.textShadow
        };
      })()`,
    );
    if (
      JSON.stringify(reopenedSubtitleSettings.values) !== JSON.stringify(customSubtitleSettings) ||
      reopenedSubtitleSettings.sizeMin !== "8" ||
      reopenedSubtitleSettings.fontSize !== "8px" ||
      !reopenedSubtitleSettings.textShadow.includes("-1px -1px")
    ) {
      throw new Error(`Subtitle settings did not survive PiP reopen: ${JSON.stringify(reopenedSubtitleSettings)}`);
    }
    try {
      await waitFor(
        async () =>
          (await evaluate(
            page,
            `documentPictureInPicture.window.document.querySelector('.cp-loading')?.hidden === true`,
          )) === true,
        8_000,
        "embedded player relay",
      );
    } catch (error) {
      const uiDebug = await evaluate(
        page,
        `({
          loading: documentPictureInPicture.window.document.querySelector('.cp-loading')?.textContent,
          frameSrc: documentPictureInPicture.window.document.querySelector('iframe')?.src,
          hasLiveVideo: Boolean(documentPictureInPicture.window.document.querySelector('.cp-stage video')?.srcObject),
          frameCanvas: Boolean(documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.width),
          usingOriginal: !document.querySelector('#embedded-player')
        })`,
      );
      const targetDebug = [];
      for (const target of (await listTargets(debugPort)).filter((item) => item.url === embeddedUrl)) {
        const client = new CdpClient(target.webSocketDebuggerUrl);
        await client.ready;
        targetDebug.push({
          type: target.type,
          state: await evaluate(
            client,
            `({
              ready: document.querySelector('#embedded-video')?.readyState,
              focusStyle: Boolean(document.querySelector('[data-caption-pip-focus-style]')),
              position: document.querySelector('#embedded-video')?.style.position
            })`,
          ),
        });
        client.close();
      }
      const workerTarget = (await listTargets(debugPort)).find(
        (target) => target.type === "service_worker" && target.url.includes("src/service-worker.js"),
      );
      let workerDebug = null;
      if (workerTarget) {
        const workerClient = new CdpClient(workerTarget.webSocketDebuggerUrl);
        await workerClient.ready;
        workerDebug = await evaluate(
          workerClient,
          `({ sessions: [...embeddedSessions] })`,
        );
        workerClient.close();
      }
      throw new Error(`${error.message}; UI=${JSON.stringify(uiDebug)}; targets=${JSON.stringify(targetDebug)}; worker=${JSON.stringify(workerDebug)}`);
    }
    const initialSubtitleGapState = await waitFor(
      async () => {
        const state = await evaluate(
          page,
          `(() => {
            const pipDocument = documentPictureInPicture.window.document;
            const button = pipDocument.querySelector('.cp-cc');
            return {
              disabled: button.disabled,
              ariaLabel: button.getAttribute('aria-label'),
              ariaPressed: button.getAttribute('aria-pressed'),
              icon: Array.from(button.querySelectorAll('[data-tabler-icon]'))
                .find((icon) => pipDocument.defaultView.getComputedStyle(icon).display !== 'none')?.dataset.tablerIcon,
              iconOpacity: pipDocument.defaultView.getComputedStyle(button.querySelector('[data-tabler-icon]')).opacity,
              captionText: pipDocument.querySelector('.cp-caption-text').textContent,
              captionEmpty: pipDocument.querySelector('.cp-captions').classList.contains('cp-empty'),
              captionHidden: pipDocument.querySelector('.cp-captions').classList.contains('cp-hidden')
            };
          })()`,
        );
        return !state.disabled && state.captionText === "" && state.captionEmpty && state.captionHidden
          ? state
          : false;
      },
      3_000,
      "subtitle availability when PiP opens during an empty cue gap",
    );
    if (
      initialSubtitleGapState.ariaLabel !== "Show subtitles (C)" ||
      initialSubtitleGapState.ariaPressed !== "false" ||
      initialSubtitleGapState.icon !== "subtitles" ||
      initialSubtitleGapState.iconOpacity !== "0.42"
    ) {
      throw new Error(`A new source did not open with PiP subtitles hidden: ${JSON.stringify(initialSubtitleGapState)}`);
    }
    await evaluate(page, "documentPictureInPicture.window.document.querySelector('.cp-cc').click()");
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `(() => {
            const button = documentPictureInPicture.window.document.querySelector('.cp-cc');
            return button.getAttribute('aria-pressed') === 'true' &&
              button.getAttribute('aria-label') === 'Hide subtitles (C)';
          })()`,
        )) === true,
      2_000,
      "new embedded source subtitle preference",
    );
    await evaluate(embedded, "window.__fixtureCaptionGap = false");
    await waitFor(
      async () =>
        (await evaluate(
          page,
          headedSmoke && frameProfileStored
            ? `(() => {
                const pipWindow = documentPictureInPicture.window;
                const root = pipWindow.document.documentElement;
                return root.dataset.pipFrameCalibrationStatus === 'applied' &&
                  Math.abs(pipWindow.innerWidth - Number(root.dataset.targetVideoWidth)) <= 1 &&
                  Math.abs(pipWindow.innerHeight - Number(root.dataset.targetVideoHeight)) <= 1;
              })()`
            : `documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationStatus !== 'measuring'`,
        )) === true,
      15_000,
      "embedded PiP geometry preflight",
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          "Boolean(documentPictureInPicture.window.document.querySelector('.cp-caption-text')?.textContent.trim())",
        )) === true,
      4_000,
      "embedded subtitle cue",
    );
    const embeddedCaptionText = await evaluate(
      page,
      "documentPictureInPicture.window.document.querySelector('.cp-caption-text')?.textContent || ''",
    );
    if (!/Vidcore-style|Generated Material UI|Background subtitle updates/i.test(embeddedCaptionText)) {
      throw new Error(`Vidcore-style DOM subtitle was not detected: ${embeddedCaptionText}`);
    }
    if (/Pause|Rewind 10s|Enable captions|Enter fullscreen/i.test(embeddedCaptionText)) {
      throw new Error(`Player controls leaked into subtitles: ${embeddedCaptionText}`);
    }

    await waitFor(
      async () =>
        (await evaluate(
          page,
          "documentPictureInPicture.window.document.querySelector('.cp-stage video')?.srcObject?.getAudioTracks().length > 0",
        )) === true,
      4_000,
      "embedded captured audio track",
    );

    const embeddedState = await evaluate(
      page,
      `({
        cover: Boolean(document.querySelector('[data-caption-pip-placeholder-cover]')),
        originalPresent: Boolean(document.querySelector('#embedded-player')),
        pipFrame: Boolean(documentPictureInPicture.window.document.querySelector('.cp-stage iframe')),
        pipVideo: Boolean(documentPictureInPicture.window.document.querySelector('.cp-stage video')),
        liveStream: Boolean(documentPictureInPicture.window.document.querySelector('.cp-stage video')?.srcObject),
        capturedAudioTracks: documentPictureInPicture.window.document.querySelector('.cp-stage video')?.srcObject?.getAudioTracks().length || 0,
        pipCanvas: Boolean(documentPictureInPicture.window.document.querySelector('.cp-stage canvas')),
        frameWidth: documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.width || 0,
        frameHeight: documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.height || 0,
        targetVideoWidth: Number(documentPictureInPicture.window.document.documentElement.dataset.targetVideoWidth || 0),
        targetVideoHeight: Number(documentPictureInPicture.window.document.documentElement.dataset.targetVideoHeight || 0),
        requestedVideoWidth: Number(documentPictureInPicture.window.document.documentElement.dataset.requestedVideoWidth || 0),
        requestedVideoHeight: Number(documentPictureInPicture.window.document.documentElement.dataset.requestedVideoHeight || 0),
        frameCalibrationApplied: documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationApplied === 'true',
        frameCalibrationStatus: documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationStatus,
        frameWidthCorrection: Number(documentPictureInPicture.window.document.documentElement.dataset.pipFrameWidthCorrection),
        frameHeightCorrection: Number(documentPictureInPicture.window.document.documentElement.dataset.pipFrameHeightCorrection),
        sizingMode: documentPictureInPicture.window.document.documentElement.dataset.sizingMode,
        pipInnerWidth: documentPictureInPicture.window.innerWidth,
        pipInnerHeight: documentPictureInPicture.window.innerHeight,
        pipOuterWidth: documentPictureInPicture.window.outerWidth,
        pipOuterHeight: documentPictureInPicture.window.outerHeight,
        framePixelEnergy: (() => {
          const canvas = documentPictureInPicture.window.document.querySelector('.cp-stage canvas');
          if (!canvas?.width || !canvas?.height) return 0;
          const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
          return pixel[0] + pixel[1] + pixel[2];
        })(),
        captureMethod: documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.dataset.captureMethod,
        captureFrames: Number(documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.dataset.captureFrames || 0),
        captureErrors: documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.dataset.captureErrors || '',
        controls: documentPictureInPicture.window.document.querySelectorAll('.cp-controls button').length
      })`,
    );
    if (
      !embeddedState.cover ||
      !embeddedState.originalPresent ||
      embeddedState.pipFrame ||
      !embeddedState.pipVideo ||
      !embeddedState.liveStream ||
      embeddedState.capturedAudioTracks < 1 ||
      !embeddedState.pipCanvas ||
      embeddedState.frameWidth < 2 ||
      embeddedState.frameHeight < 2 ||
      embeddedState.framePixelEnergy < 20 ||
      embeddedState.captureMethod !== 'track' ||
      embeddedState.captureFrames < 1 ||
      embeddedState.targetVideoWidth < 2 ||
      embeddedState.targetVideoHeight < 2 ||
      embeddedState.requestedVideoWidth < 2 ||
      embeddedState.requestedVideoHeight < 2 ||
      embeddedState.pipOuterWidth < 2 ||
      embeddedState.pipOuterHeight < 2 ||
      (frameProfileStored && (
        embeddedState.requestedVideoWidth !== embeddedState.targetVideoWidth + activeState.frameWidthCorrection ||
        embeddedState.requestedVideoHeight !== embeddedState.targetVideoHeight + activeState.frameHeightCorrection ||
        embeddedState.sizingMode !== 'stored-frame-profile' ||
        !embeddedState.frameCalibrationApplied ||
        embeddedState.frameCalibrationStatus !== 'applied' ||
        embeddedState.frameWidthCorrection !== activeState.frameWidthCorrection ||
        embeddedState.frameHeightCorrection !== activeState.frameHeightCorrection ||
        (headedSmoke && Math.abs(embeddedState.pipInnerWidth - embeddedState.targetVideoWidth) > 1) ||
        (headedSmoke && Math.abs(embeddedState.pipInnerHeight - embeddedState.targetVideoHeight) > 1)
      )) ||
      (!frameProfileStored && (
        embeddedState.requestedVideoWidth !== embeddedState.targetVideoWidth ||
        embeddedState.requestedVideoHeight !== embeddedState.targetVideoHeight ||
        embeddedState.sizingMode !== 'first-run-welcome-calibration' ||
        embeddedState.frameCalibrationApplied ||
        embeddedState.frameCalibrationStatus !== 'rejected'
      )) ||
      embeddedState.controls < 6
    ) {
      throw new Error(`Embedded PiP assertion failed: ${JSON.stringify(embeddedState)}`);
    }
    const renderedFrameAspect = embeddedState.frameWidth / embeddedState.frameHeight;
    const requestedVideoAspect = embeddedState.targetVideoWidth / embeddedState.requestedVideoHeight;
    const requestedAspectError =
      Math.abs(renderedFrameAspect - requestedVideoAspect) / renderedFrameAspect;
    if (requestedAspectError > 0.01) {
      throw new Error(`Embedded PiP was not initially requested at the selected video's aspect: ${JSON.stringify(embeddedState)}`);
    }
    const frameCountBefore = Number(
      await evaluate(
        page,
        "documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.dataset.captureFrames || 0",
      ),
    );
    const sourceFrameCountBefore = Number(
      await evaluate(
        embedded,
        "document.querySelector('#embedded-video').getVideoPlaybackQuality().totalVideoFrames",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const frameCountAfter = Number(
      await evaluate(
        page,
        "documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.dataset.captureFrames || 0",
      ),
    );
    const sourceFrameCountAfter = Number(
      await evaluate(
        embedded,
        "document.querySelector('#embedded-video').getVideoPlaybackQuality().totalVideoFrames",
      ),
    );
    const relayedFrames = frameCountAfter - frameCountBefore;
    const sourceFrames = sourceFrameCountAfter - sourceFrameCountBefore;
    const minimumPreservedFrames = Math.max(1, Math.floor(sourceFrames * 0.8));
    if (!skipFrameCadenceCheck && (sourceFrames < 10 || relayedFrames < minimumPreservedFrames)) {
      throw new Error(
        `The uncapped frame relay delivered ${relayedFrames} of ${sourceFrames} source frames in 2 seconds.`,
      );
    }

    const { targetId: backgroundTargetId } = await browser.call("Target.createTarget", {
      url: "about:blank",
    });
    try {
      await browser.call("Target.activateTarget", { targetId: backgroundTargetId });
      await waitFor(
        async () => (await evaluate(embedded, "document.visibilityState")) === "hidden",
        3_000,
        "embedded player background state",
      );
      const frameSignatureExpression = `(() => {
        const canvas = documentPictureInPicture.window.document.querySelector('.cp-stage canvas');
        const context = canvas.getContext('2d');
        return [[.12,.18],[.82,.16],[.18,.82],[.84,.78]].map(([x,y]) =>
          [...context.getImageData(Math.floor(canvas.width*x), Math.floor(canvas.height*y), 1, 1).data].slice(0,3).join('-')
        ).join('|');
      })()`;
      const backgroundFrameSignatures = [];
      const backgroundCaptionSamples = [];
      for (let sample = 0; sample < 5; sample += 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        backgroundFrameSignatures.push(await evaluate(page, frameSignatureExpression));
        backgroundCaptionSamples.push(
          await evaluate(
            page,
            "documentPictureInPicture.window.document.querySelector('.cp-caption-text')?.textContent || ''",
          ),
        );
      }
      if (new Set(backgroundFrameSignatures).size < 2) {
        throw new Error(`PiP video stopped updating in the background: ${backgroundFrameSignatures.join(', ')}`);
      }
      if (new Set(backgroundCaptionSamples.filter(Boolean)).size < 2) {
        throw new Error(`PiP subtitles stopped updating in the background: ${backgroundCaptionSamples.join(', ')}`);
      }
    } finally {
      await browser.call("Target.activateTarget", { targetId: tabTargetId }).catch(() => {});
      await browser.call("Target.closeTarget", { targetId: backgroundTargetId }).catch(() => {});
    }

    await evaluate(
      page,
      "documentPictureInPicture.window.document.querySelector('.cp-play').click()",
    );
    await waitFor(
      async () => (await evaluate(embedded, "document.querySelector('#embedded-video').paused")) === true,
      3_000,
      "embedded pause control",
    );
    await evaluate(
      page,
      "documentPictureInPicture.window.document.querySelector('.cp-play').click()",
    );
    await waitFor(
      async () => (await evaluate(embedded, "document.querySelector('#embedded-video').paused")) === false,
      3_000,
      "embedded play control",
    );

    const embeddedTimeBeforeSourceUnmute = await evaluate(
      embedded,
      "document.querySelector('#embedded-video').currentTime",
    );
    await evaluate(
      page,
      "(() => { const pipDocument = documentPictureInPicture.window.document; const mute = pipDocument.querySelector('.cp-mute'); if (mute.dataset.muted !== 'true') mute.click(); mute.click(); })()",
    );

      await waitFor(
        async () =>
          (await evaluate(
            embedded,
            "(() => { const video = document.querySelector('#embedded-video'); return !video.muted && !video.paused; })()",
          )) === true,
        3_000,
        "embedded real-source unmute",
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      const embeddedSourceAfterUnmute = await evaluate(
        embedded,
        "(() => { const video = document.querySelector('#embedded-video'); return { muted: video.muted, paused: video.paused, currentTime: video.currentTime }; })()",
      );
      if (
        embeddedSourceAfterUnmute.muted ||
        embeddedSourceAfterUnmute.paused ||
        Math.abs(embeddedSourceAfterUnmute.currentTime - embeddedTimeBeforeSourceUnmute) < 0.1
      ) {
        throw new Error(`PiP did not unmute and preserve playback on the real embedded source: ${JSON.stringify(embeddedSourceAfterUnmute)}`);
      }
      await evaluate(
        page,
        "(() => { const pipWindow = documentPictureInPicture.window; const slider = pipWindow.document.querySelector('.cp-volume-slider'); slider.value = '0.42'; slider.dispatchEvent(new pipWindow.Event('input', { bubbles: true })); })()",
      );
      try {
        await waitFor(
          async () =>
            (await evaluate(
              embedded,
              "(() => { const video = document.querySelector('#embedded-video'); return !video.muted && !video.paused && Math.abs(video.volume - 0.42) < 0.01; })()",
            )) === true,
          3_000,
          "embedded real-source volume slider",
        );
      } catch (error) {
        const sourceDebug = await evaluate(
          embedded,
          "(() => { const video = document.querySelector('#embedded-video'); return { muted: video.muted, paused: video.paused, volume: video.volume }; })()",
        );
        const pipDebug = await evaluate(
          page,
          "(() => { const pipDocument = documentPictureInPicture.window.document; const mirror = pipDocument.querySelector('.cp-stage video'); return { mirrorMuted: mirror.muted, mirrorVolume: mirror.volume, uiLevel: pipDocument.querySelector('.cp-mute').dataset.level, uiVolume: pipDocument.querySelector('.cp-volume-slider').value }; })()",
        );
        throw new Error(`${error.message}; source=${JSON.stringify(sourceDebug)}; pip=${JSON.stringify(pipDebug)}`);
      }
      await evaluate(
        page,
        "documentPictureInPicture.window.document.querySelector('.cp-mute').click()",
      );
      await waitFor(
        async () => (await evaluate(embedded, "document.querySelector('#embedded-video').muted")) === true,
        3_000,
        "embedded real-source mute icon",
      );
      await evaluate(
        page,
        "documentPictureInPicture.window.document.querySelector('.cp-mute').click()",
      );
      await waitFor(
        async () =>
          (await evaluate(
            embedded,
            "(() => { const video = document.querySelector('#embedded-video'); return !video.muted && !video.paused && Math.abs(video.volume - 0.42) < 0.01; })()",
          )) === true,
        3_000,
        "embedded real-source unmute with remembered volume",
      );
      await waitFor(
        async () =>
          (await evaluate(
            page,
            "(() => { const pipDocument = documentPictureInPicture.window.document; return pipDocument.querySelector('.cp-stage video').muted && pipDocument.querySelector('.cp-mute').dataset.muted === 'false'; })()",
          )) === true,
        3_000,
        "embedded real-source audio UI synchronization",
      );
      const embeddedAudioMode = await evaluate(
        page,
        "(() => { const video = documentPictureInPicture.window.document.querySelector('.cp-stage video'); return { mirrorMuted: video.muted, uiMuted: documentPictureInPicture.window.document.querySelector('.cp-mute').dataset.muted === 'true' }; })()",
      );
      if (!embeddedAudioMode.mirrorMuted || embeddedAudioMode.uiMuted) {
        throw new Error(`Embedded PiP switched away from real-source audio unexpectedly: ${JSON.stringify(embeddedAudioMode)}`);
      }

      await evaluate(
        embedded,
        "document.querySelector('.fixture-caption-layer')?.remove()",
      );
      const subtitleGapState = await waitFor(
        async () => {
          const state = await evaluate(
            page,
            `(() => {
              const pipDocument = documentPictureInPicture.window.document;
              const button = pipDocument.querySelector('.cp-cc');
              return {
                disabled: button.disabled,
                ariaLabel: button.getAttribute('aria-label'),
                captionText: pipDocument.querySelector('.cp-caption-text').textContent,
                captionEmpty: pipDocument.querySelector('.cp-captions').classList.contains('cp-empty')
              };
            })()`,
          );
          return !state.disabled && state.captionText === "" && state.captionEmpty
            ? state
            : false;
        },
        3_000,
        "subtitle availability during an empty cue gap",
      );
      if (subtitleGapState.ariaLabel !== "Hide subtitles (C)") {
        throw new Error(`Subtitle control changed state during an empty cue gap: ${JSON.stringify(subtitleGapState)}`);
      }

      await evaluate(
        embedded,
        "document.querySelector('.ytp-subtitles-button')?.setAttribute('aria-pressed', 'false')",
      );
      const sourceToggleIsolationState = await waitFor(
        async () => {
          const state = await evaluate(
            page,
            `(() => {
              const pipWindow = documentPictureInPicture.window;
              const pipDocument = pipWindow.document;
              const button = pipDocument.querySelector('.cp-cc');
              const visibleIcon = Array.from(button.querySelectorAll('[data-tabler-icon]'))
                .find((icon) => pipWindow.getComputedStyle(icon).display !== 'none')?.dataset.tablerIcon;
              return {
                disabled: button.disabled,
                icon: visibleIcon,
                background: pipWindow.getComputedStyle(button).backgroundColor,
                ariaPressed: button.getAttribute('aria-pressed'),
                ariaLabel: button.getAttribute('aria-label'),
                captionText: pipDocument.querySelector('.cp-caption-text').textContent,
                captionHidden: pipDocument.querySelector('.cp-captions').classList.contains('cp-hidden'),
                captionEmpty: pipDocument.querySelector('.cp-captions').classList.contains('cp-empty')
              };
            })()`,
          );
          return !state.disabled && state.captionText === "" && state.captionEmpty
            ? state
            : false;
        },
        4_000,
        "PiP subtitle state isolated from website subtitle toggle",
      );
      if (
        sourceToggleIsolationState.icon !== "subtitles" ||
        sourceToggleIsolationState.background !== "rgba(0, 0, 0, 0)" ||
        sourceToggleIsolationState.ariaPressed !== "true" ||
        sourceToggleIsolationState.ariaLabel !== "Hide subtitles (C)" ||
        sourceToggleIsolationState.captionHidden ||
        !sourceToggleIsolationState.captionEmpty
      ) {
        throw new Error(`Website subtitle state leaked into PiP controls: ${JSON.stringify(sourceToggleIsolationState)}`);
      }
      if (noSubtitlesVisualOutput) {
        await evaluate(
          page,
          `(() => {
            const pipWindow = documentPictureInPicture.window;
            pipWindow.document.querySelector('.cp-root').dispatchEvent(new pipWindow.PointerEvent('pointermove', { bubbles: true }));
          })()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 180));
        await capturePipScreenshot(debugPort, pageTarget.targetId, noSubtitlesVisualOutput);
      }

    await evaluate(
      page,
      "documentPictureInPicture.window.document.querySelector('.cp-return-to-opener').click()",
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `Boolean(document.querySelector('#embedded-player')) && !document.querySelector('[data-caption-pip-placeholder-cover]')`,
        )) === true,
      4_000,
      "embedded player restoration",
    );

    await browser.call("Extensions.triggerAction", {
      id: extensionId,
      targetId: tabTargetId,
    });
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `Boolean(window.documentPictureInPicture?.window?.document.querySelector('.cp-root'))`,
        )) === true,
      6_000,
      "same embedded video reopened in Document Picture-in-Picture",
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          headedSmoke && frameProfileStored
            ? `(() => {
                const pipWindow = documentPictureInPicture.window;
                const root = pipWindow.document.documentElement;
                return root.dataset.pipFrameCalibrationStatus === 'applied' &&
                  Math.abs(pipWindow.innerWidth - Number(root.dataset.targetVideoWidth)) <= 1 &&
                  Math.abs(pipWindow.innerHeight - Number(root.dataset.targetVideoHeight)) <= 1;
              })()`
            : `documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationStatus !== 'measuring'`,
        )) === true,
      15_000,
      "same embedded PiP geometry preflight",
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `documentPictureInPicture.window.document.querySelector('.cp-loading')?.hidden === true`,
        )) === true,
      8_000,
      "same embedded player relay after reopening",
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `(() => {
            const pipDocument = documentPictureInPicture.window.document;
            return !pipDocument.querySelector('.cp-cc').disabled &&
              pipDocument.querySelector('.cp-cc').getAttribute('aria-pressed') === 'true' &&
              pipDocument.querySelector('.cp-caption-text').textContent === '';
          })()`,
        )) === true,
      3_000,
      "same-source subtitle preference after reopening",
    );
    const reopenedEmbeddedState = await evaluate(
      page,
      `({
        targetVideoWidth: Number(documentPictureInPicture.window.document.documentElement.dataset.targetVideoWidth || 0),
        targetVideoHeight: Number(documentPictureInPicture.window.document.documentElement.dataset.targetVideoHeight || 0),
        requestedVideoWidth: Number(documentPictureInPicture.window.document.documentElement.dataset.requestedVideoWidth || 0),
        requestedVideoHeight: Number(documentPictureInPicture.window.document.documentElement.dataset.requestedVideoHeight || 0),
        frameCalibrationApplied: documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationApplied === 'true',
        frameCalibrationStatus: documentPictureInPicture.window.document.documentElement.dataset.pipFrameCalibrationStatus,
        frameWidthCorrection: Number(documentPictureInPicture.window.document.documentElement.dataset.pipFrameWidthCorrection),
        frameHeightCorrection: Number(documentPictureInPicture.window.document.documentElement.dataset.pipFrameHeightCorrection),
        sizingMode: documentPictureInPicture.window.document.documentElement.dataset.sizingMode,
        pipInnerWidth: documentPictureInPicture.window.innerWidth,
        pipInnerHeight: documentPictureInPicture.window.innerHeight,
        pipOuterWidth: documentPictureInPicture.window.outerWidth,
        pipOuterHeight: documentPictureInPicture.window.outerHeight,
        frameWidth: documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.width || 0,
        frameHeight: documentPictureInPicture.window.document.querySelector('.cp-stage canvas')?.height || 0,
        subtitleDisabled: documentPictureInPicture.window.document.querySelector('.cp-cc').disabled,
        subtitleIcon: Array.from(documentPictureInPicture.window.document.querySelectorAll('.cp-cc [data-tabler-icon]'))
          .find((icon) => documentPictureInPicture.window.getComputedStyle(icon).display !== 'none')?.dataset.tablerIcon,
        captionText: documentPictureInPicture.window.document.querySelector('.cp-caption-text').textContent
      })`,
    );
    if (
      reopenedEmbeddedState.targetVideoWidth !== embeddedState.targetVideoWidth ||
      reopenedEmbeddedState.targetVideoHeight !== embeddedState.targetVideoHeight ||
      reopenedEmbeddedState.sizingMode !== embeddedState.sizingMode ||
      (frameProfileStored && (
        !reopenedEmbeddedState.frameCalibrationApplied ||
        reopenedEmbeddedState.frameCalibrationStatus !== 'applied' ||
        reopenedEmbeddedState.frameWidthCorrection !== embeddedState.frameWidthCorrection ||
        reopenedEmbeddedState.frameHeightCorrection !== embeddedState.frameHeightCorrection ||
        reopenedEmbeddedState.requestedVideoWidth !== reopenedEmbeddedState.targetVideoWidth + embeddedState.frameWidthCorrection ||
        reopenedEmbeddedState.requestedVideoHeight !== reopenedEmbeddedState.targetVideoHeight + embeddedState.frameHeightCorrection ||
        (headedSmoke && Math.abs(reopenedEmbeddedState.pipInnerWidth - reopenedEmbeddedState.targetVideoWidth) > 1) ||
        (headedSmoke && Math.abs(reopenedEmbeddedState.pipInnerHeight - reopenedEmbeddedState.targetVideoHeight) > 1)
      )) ||
      (!frameProfileStored && (
        reopenedEmbeddedState.frameCalibrationApplied ||
        reopenedEmbeddedState.frameCalibrationStatus !== 'rejected' ||
        reopenedEmbeddedState.requestedVideoWidth !== reopenedEmbeddedState.targetVideoWidth ||
        reopenedEmbeddedState.requestedVideoHeight !== reopenedEmbeddedState.targetVideoHeight
      )) ||
      reopenedEmbeddedState.frameWidth !== embeddedState.frameWidth ||
      reopenedEmbeddedState.frameHeight !== embeddedState.frameHeight ||
      reopenedEmbeddedState.subtitleDisabled ||
      reopenedEmbeddedState.subtitleIcon !== 'subtitles' ||
      reopenedEmbeddedState.captionText !== ''
    ) {
      throw new Error(
        `The same embedded video lost its aligned PiP state after close/reopen: first=${JSON.stringify(embeddedState)}, reopened=${JSON.stringify(reopenedEmbeddedState)}`,
      );
    }
    await evaluate(
      embedded,
      "document.querySelector('.ytp-subtitles-button')?.setAttribute('aria-pressed', 'true')",
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `(() => {
            const pipDocument = documentPictureInPicture.window.document;
            return !pipDocument.querySelector('.cp-cc').disabled &&
              pipDocument.querySelector('.cp-caption-text').textContent === '';
          })()`,
        )) === true,
      3_000,
      "website subtitle source changed without changing PiP preference",
    );
    await evaluate(
      embedded,
      `(() => {
        document.querySelector('.plyr__captions')?.remove();
        document.querySelector('.fixture-controls')?.remove();
      })()`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `(() => {
            const pipDocument = documentPictureInPicture.window.document;
            return !pipDocument.querySelector('.cp-cc').disabled &&
              pipDocument.querySelector('.cp-cc').getAttribute('aria-pressed') === 'true' &&
              pipDocument.querySelector('.cp-caption-text').textContent === '';
          })()`,
        )) === true,
      3_000,
      "always-enabled subtitle control after all sources are removed",
    );
    await evaluate(page, "documentPictureInPicture.window.close()");
    await waitFor(
      async () =>
        (await evaluate(
          page,
          `Boolean(document.querySelector('#embedded-player')) && !document.querySelector('[data-caption-pip-placeholder-cover]')`,
        )) === true,
      4_000,
      "same embedded player restoration after reopening",
    );

    await evaluate(
      page,
      `(() => {
        window.__captionPipNoVideoEnterCount = 0;
        documentPictureInPicture.addEventListener('enter', () => {
          window.__captionPipNoVideoEnterCount += 1;
        });
        document.querySelector('#regular-video')?.remove();
        document.querySelector('#embedded-player')?.remove();
      })()`,
    );
    await browser.call("Extensions.triggerAction", {
      id: extensionId,
      targetId: tabTargetId,
    });
    const noVideoToast = await waitFor(
      async () =>
        evaluate(
          page,
          `(() => {
            const host = document.querySelector('[data-caption-pip-toast-host]');
            return host ? {
              tone: host.getAttribute('data-caption-pip-toast-tone'),
              role: host.getAttribute('role'),
              live: host.getAttribute('aria-live'),
              label: host.getAttribute('aria-label'),
              pipEnterCount: window.__captionPipNoVideoEnterCount
            } : null;
          })()`,
        ),
      4_000,
      "no-video information toast",
    );
    if (
      noVideoToast.tone !== "info" ||
      noVideoToast.role !== "status" ||
      noVideoToast.live !== "polite" ||
      noVideoToast.label !== "No video is available in this tab." ||
      noVideoToast.pipEnterCount !== 0
    ) {
      throw new Error(`No-video toast is invalid: ${JSON.stringify(noVideoToast)}`);
    }

    console.log("Browser smoke test passed: a one-time local sizing welcome with a user-activated corrected-video handoff, one-click direct and cross-origin launch after setup, generic transformed direct-player source covers aligned through hidden restoration anchors, a no-video information toast without opening PiP, untouched video aspect with native initial inner-window alignment and complete-frame contain during untouched native user resizing, immediately available focused-wheel aspect-safe native-range sizing with no visible size control, multi-frame whole-surface PiP dragging with invariant outer dimensions, control exclusion and drag/safe-area coordination, independently surfaced top-left return, top-center fullscreen, and immediately responsive top-right persistent neutral pin actions with shared visibility and full/reduced pin opacity, a trusted handoff through the restored website player's own fullscreen control with that control visible and handling exit, no extension-made fullscreen host, hidden-by-default subtitles for each new generic source, same-source visibility persistence across PiP reopenings, a single always-enabled subtitle icon using full/reduced opacity independently of website caption state or detected cue availability, Prime-style Subtitles CC controls excluded from caption text, complete automatically persistent subtitle appearance settings with an 8px minimum and Raised edge, a static liquid-glass subtitle popup with a fixed header above independently scrolling settings, a Tabler X close action, and no Reset or detection sublabel, a static liquid-glass floating control rail with no live backdrop filter and a two-row left/center/right action hierarchy above fixed HH:MM:SS timecodes and a flexible timeline, an embedded horizontal volume slider with zero/one/two-wave audible icons plus a dimmed crossed-out mute icon, uncapped source-rate frame relay, responsive geometry isolation, background playback, real-source embedded mute/unmute with compatibility fallback, cursor-stable controls, and restoration verified.");
  } else {
    console.log("Browser smoke test passed: frame injection verified (headless Chrome did not expose Document PiP). ");
  }

  page.close();
  embedded.close();
  await browser.call("Extensions.uninstall", { id: extensionId });
  browser.close();
} finally {
  server.close();
  if (chromeProcess?.pid) terminateProcessTree(chromeProcess.pid);
  await new Promise((resolve) => setTimeout(resolve, 650));
  const resolvedProfile = path.resolve(profilePath);
  const expectedPrefix = path.resolve(os.tmpdir(), "caption-pip-smoke-");
  if (resolvedProfile.startsWith(expectedPrefix)) {
    try {
      fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 180 });
    } catch (error) {
      console.warn(`Could not remove temporary Chrome profile: ${error.message}`);
    }
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) throw new Error("Chrome was not found. Set CHROME_PATH to run the browser smoke test.");
  return match;
}

function serveFixture(request, response) {
  const pathname = new URL(request.url, "http://fixture.local").pathname;
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(fixtureRoot, relativePath);
  if (!filePath.startsWith(path.resolve(fixtureRoot)) || !fs.existsSync(filePath)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const extension = path.extname(filePath);
  const type = extension === ".html" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8";
  response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(filePath).pipe(response);
}

function listen(httpServer) {
  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve(httpServer.address().port));
  });
}

async function readDebugPort(profileDirectory) {
  const activePortFile = path.join(profileDirectory, "DevToolsActivePort");
  return waitFor(() => {
    if (!fs.existsSync(activePortFile)) return false;
    const [port] = fs.readFileSync(activePortFile, "utf8").trim().split(/\r?\n/);
    return Number(port) || false;
  }, 8_000, "Chrome debugging port");
}

async function createTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!response.ok) throw new Error(`Could not create Chrome target (${response.status})`);
  return response.json();
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`Could not list Chrome targets (${response.status})`);
  return response.json();
}

async function getBrowserTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!response.ok) throw new Error(`Could not get Chrome browser target (${response.status})`);
  return response.json();
}

async function evaluate(client, expression, awaitPromise = false) {
  const response = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || "Runtime evaluation failed");
  }
  return response.result.value;
}

async function capturePipScreenshot(port, openerTargetId, outputPath) {
  const pipTarget = await findPipTarget(port, openerTargetId);

  const pip = new CdpClient(pipTarget.webSocketDebuggerUrl);
  await pip.ready;
  await pip.call("Page.enable");
  const { data } = await pip.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  pip.close();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(data, "base64"));
}

async function findPipTarget(port, openerTargetId, selector = ".cp-root") {
  return waitFor(async () => {
    const targets = await listTargets(port);
    for (const target of targets) {
      if (
        !target.webSocketDebuggerUrl ||
        target.id === openerTargetId ||
        !["page", "other"].includes(target.type)
      ) {
        continue;
      }
      const candidate = new CdpClient(target.webSocketDebuggerUrl);
      await candidate.ready;
      try {
        if (
          await evaluate(
            candidate,
            `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
          )
        ) {
          candidate.close();
          return target;
        }
      } catch {}
      candidate.close();
    }
    return false;
  }, 4_000, "Document PiP DevTools target");
}

async function clickPipElement(port, openerTargetId, rootSelector, targetSelector) {
  const target = await findPipTarget(port, openerTargetId, rootSelector);
  const pip = new CdpClient(target.webSocketDebuggerUrl);
  await pip.ready;
  try {
    await pip.call("Page.enable");
    const point = await evaluate(
      pip,
      `(() => {
        const rect = document.querySelector(${JSON.stringify(targetSelector)})?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
      })()`,
    );
    if (!point) throw new Error(`PiP click target was not found: ${targetSelector}`);
    await pip.call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    });
    await pip.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await pip.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    pip.close();
  }
}

async function seedPipFrameCalibration(port, welcomeState) {
  const workerTarget = await waitFor(async () => {
    const targets = await listTargets(port);
    return targets.find(
      (target) =>
        target.type === "service_worker" &&
        target.url.includes("src/service-worker.js") &&
        target.webSocketDebuggerUrl,
    );
  }, 4_000, "extension service worker for headless calibration seed");
  const worker = new CdpClient(workerTarget.webSocketDebuggerUrl);
  await worker.ready;
  try {
    const frameWidth = Math.max(
      0,
      Math.min(240, Math.round(welcomeState.outerWidth - welcomeState.innerWidth)),
    );
    const frameHeight = Math.max(
      0,
      Math.min(240, Math.round(welcomeState.outerHeight - welcomeState.innerHeight)),
    );
    const record = {
      widthCorrection: 0,
      heightCorrection: 0,
      frameWidth,
      frameHeight,
      requestedWidth: Math.max(1, Math.round(welcomeState.requestedWidth)),
      requestedHeight: Math.max(1, Math.round(welcomeState.requestedHeight)),
      measuredInnerWidth: Math.max(1, Math.round(welcomeState.innerWidth)),
      measuredInnerHeight: Math.max(1, Math.round(welcomeState.innerHeight)),
      measuredAt: Date.now(),
      sampleCount: 3,
    };
    await evaluate(
      worker,
      `(async () => {
        const key = 'captionPipFrameCalibrationsV3';
        const stored = await chrome.storage.local.get({ [key]: {} });
        await chrome.storage.local.set({
          [key]: {
            ...stored[key],
            [${JSON.stringify(welcomeState.environmentId)}]: ${JSON.stringify(record)}
          }
        });
        return true;
      })()`,
      true,
    );
  } finally {
    worker.close();
  }
}

async function verifyResponsivePipControls(browser, port, openerTargetId, restoreBounds) {
  const target = await findPipTarget(port, openerTargetId);
  const { windowId } = await browser.call("Browser.getWindowForTarget", { targetId: target.id });
  await browser.call("Browser.setWindowBounds", {
    windowId,
    bounds: { width: 420, height: 300 },
  });

  const pip = new CdpClient(target.webSocketDebuggerUrl);
  await pip.ready;
  const compactState = await waitFor(async () => {
    const state = await evaluate(
      pip,
      `(() => {
        const bounds = (selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const appearance = document.querySelector('.cp-aa');
        const panelElement = document.querySelector('.cp-panel');
        const panelScroller = document.querySelector('.cp-panel-scroll');
        if (panelElement.hidden) appearance.click();
        const captionsElement = document.querySelector('.cp-captions');
        const originalCaptionTransition = captionsElement.style.transition;
        captionsElement.style.transition = 'none';
        captionsElement.dataset.position = 'bottom';
        const root = bounds('.cp-root');
        const controls = bounds('.cp-controls');
        const primaryRow = bounds('.cp-primary-row');
        const transport = bounds('.cp-transport');
        const subtitleActions = bounds('.cp-subtitle-actions');
        const progressRow = bounds('.cp-progress-row');
        const timeline = bounds('.cp-timeline');
        const play = bounds('.cp-play');
        const back = bounds('.cp-back');
        const forward = bounds('.cp-forward');
        const volume = bounds('.cp-volume-control');
        const mute = bounds('.cp-mute');
        const volumeSlider = bounds('.cp-volume-slider');
        const cc = bounds('.cp-cc');
        const aa = bounds('.cp-aa');
        const timeCurrent = bounds('.cp-time-current');
        const timeDuration = bounds('.cp-time-duration');
        const panel = bounds('.cp-panel');
        const panelHeader = document.querySelector('.cp-panel-header');
        const firstPanelField = panelScroller.querySelector('.cp-field');
        panelScroller.scrollTop = 0;
        const headerTopBeforeScroll = panelHeader.getBoundingClientRect().top;
        const firstFieldTopBeforeScroll = firstPanelField.getBoundingClientRect().top;
        panelScroller.scrollTop = Math.min(50, panelScroller.scrollHeight - panelScroller.clientHeight);
        void panelScroller.offsetHeight;
        const settingsScrollTop = panelScroller.scrollTop;
        const headerTopAfterScroll = panelHeader.getBoundingClientRect().top;
        const firstFieldTopAfterScroll = firstPanelField.getBoundingClientRect().top;
        panelScroller.scrollTop = 0;
        const bottomCaptionOffset = Number.parseFloat(getComputedStyle(captionsElement).bottom);
        captionsElement.dataset.position = 'top';
        const topCaptionOffset = Number.parseFloat(getComputedStyle(captionsElement).top);
        captionsElement.dataset.position = 'bottom';
        const state = {
          innerWidth,
          innerHeight,
          mediaObjectFit: getComputedStyle(document.querySelector('.cp-stage video')).objectFit,
          root,
          controls,
          primaryRow,
          transport,
          subtitleActions,
          progressRow,
          timeline,
          play,
          back,
          forward,
          volume,
          mute,
          volumeSlider,
          volumeOrientation: document.querySelector('.cp-volume-slider').getAttribute('aria-orientation'),
          volumePopup: Boolean(document.querySelector('.cp-volume-popover')),
          cc,
          aa,
          timeCurrent,
          timeDuration,
          currentText: document.querySelector('.cp-time-current').textContent,
          durationText: document.querySelector('.cp-time-duration').textContent,
          panel,
          headerParentIsPanel: panelHeader.parentElement === panelElement,
          headerTopBeforeScroll,
          headerTopAfterScroll,
          firstFieldTopBeforeScroll,
          firstFieldTopAfterScroll,
          settingsScrollTop,
          bottomCaptionOffset,
          topCaptionOffset,
          panelClientHeight: panelScroller.clientHeight,
          panelScrollHeight: panelScroller.scrollHeight
        };
        if (!${compactPanelVisualOutput ? "true" : "false"}) appearance.click();
        captionsElement.style.transition = originalCaptionTransition;
        return state;
      })()`,
    );
    return state.innerWidth < 470 &&
      state.innerHeight < 300 &&
      state.mediaObjectFit === 'contain'
      ? state
      : false;
  }, 4_000, "compact PiP viewport");

  const valid =
    compactState.mediaObjectFit === 'contain' &&
    compactState.controls.left >= compactState.root.left &&
    compactState.controls.right <= compactState.root.right &&
    compactState.primaryRow.bottom <= compactState.progressRow.top + 1 &&
    Math.abs((compactState.transport.left + compactState.transport.right) / 2 - compactState.root.width / 2) <= 1 &&
    compactState.back.left < compactState.play.left &&
    compactState.play.left < compactState.forward.left &&
    compactState.volume.left >= compactState.primaryRow.left &&
    compactState.subtitleActions.right <= compactState.primaryRow.right + 1 &&
    compactState.cc.right <= compactState.aa.left + 1 &&
    compactState.play.bottom <= compactState.timeline.top + 1 &&
    compactState.timeline.left >= compactState.root.left &&
    compactState.timeline.right <= compactState.root.right &&
    compactState.timeCurrent.right < compactState.timeline.left &&
    compactState.timeline.right < compactState.timeDuration.left &&
    /^\d{2,}:\d{2}:\d{2}$/.test(compactState.currentText) &&
    /^\d{2,}:\d{2}:\d{2}$/.test(compactState.durationText) &&
    compactState.volumeSlider.left >= compactState.mute.right + 1 &&
    compactState.volumeSlider.right <= compactState.volume.right + 1 &&
    compactState.volumeSlider.width > compactState.volumeSlider.height &&
    compactState.volumeOrientation === "horizontal" &&
    !compactState.volumePopup &&
    compactState.aa.right <= compactState.root.right &&
    compactState.panel.left >= compactState.root.left + 7 &&
    compactState.panel.top >= compactState.root.top + 7 &&
    compactState.panel.right <= compactState.root.right - 7 &&
    compactState.panel.bottom <= compactState.controls.top - 3 &&
    compactState.panelClientHeight < compactState.panelScrollHeight &&
    compactState.headerParentIsPanel &&
    compactState.settingsScrollTop >= 30 &&
    Math.abs(compactState.headerTopAfterScroll - compactState.headerTopBeforeScroll) <= 1 &&
    compactState.firstFieldTopBeforeScroll - compactState.firstFieldTopAfterScroll >= compactState.settingsScrollTop - 1 &&
    Math.abs(
      (compactState.bottomCaptionOffset - (compactState.root.bottom - compactState.controls.top)) /
      compactState.root.height - 0.1
    ) <= 0.003 &&
    Math.abs(compactState.topCaptionOffset / compactState.root.height - 0.1) <= 0.003;

  if (compactPanelVisualOutput) {
    await evaluate(
      pip,
      `(() => {
        const scroller = document.querySelector('.cp-panel-scroll');
        scroller.scrollTop = scroller.scrollHeight;
        return scroller.scrollTop;
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
    await capturePipScreenshot(port, openerTargetId, compactPanelVisualOutput);
    await evaluate(pip, "document.querySelector('.cp-aa').click()");
  }

  await browser.call("Browser.setWindowBounds", {
    windowId,
    bounds: {
      width: Math.round(restoreBounds.width),
      height: Math.round(restoreBounds.height),
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  pip.close();
  return { valid, compactState };
}

async function waitFor(check, timeout, label) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function terminateProcessTree(pid) {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {}
}
