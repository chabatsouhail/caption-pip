# Caption PiP

Caption PiP is a Manifest V3 Chrome extension that puts webpage videos in a floating Document Picture-in-Picture window with locally rendered subtitles, custom controls, and subtitle appearance settings.

It is designed for desktop Chrome 130 and newer. Compatibility is best-effort because websites use many different player, caption, embedding, and DRM implementations.

## Features

- Regular HTML video and cross-origin embedded-player support, including background-safe, uncapped source-frame-rate playback for compatible blob/MSE players
- One-click toolbar launch with a near-full-slot, background-free custom Caption PiP mark built from Tabler-style PiP and `IconBadgeCc` geometry; it switches per tab between dark gray on light themes and white on dark themes, then automatically selects the most likely active, visible video across page frames
- Informational in-page toast with a Tabler icon when the current tab has no usable video, replacing the ambiguous `0` toolbar badge
- Native `TextTrack`/WebVTT subtitle detection plus common DOM-caption detection, with an always-enabled PiP subtitle toggle that is independent of the website player
- A newly encountered video source starts with PiP subtitles hidden; reopening the same source restores its last show/hide choice using a locally stored, hashed source identity
- Two-row Precision Rail controls nested in a static liquid-glass floating bar with 6px corners: volume on the left, Tabler 10-second back/play/forward controls centered, and subtitle on/off plus appearance controls on the right; the second row shows `hh:mm:ss` elapsed time, a flexible timeline, and `hh:mm:ss` duration
- Speaker-icon mute with a neutral gray-white persistent horizontal volume slider and zero-, one-, and two-wave audible glyphs; muting switches to a crossed-out volume icon and lowers its opacity, while keyboard controls operate the real website player first, including muted-start embedded players
- Stable auto-hiding controls with throttled cursor activity and a pointer-leave grace period
- Typography-icon menu for font, 8–48px size, text color and opacity, background color and opacity, weight, Character edge (`None` by default, `Raised`, or `Drop shadow`), and position
- Every subtitle appearance setting is saved automatically and shared across tabs in the current Chrome profile
- Viewport-contained static liquid-glass subtitle appearance panel with a fixed title/X header, independently scrolling settings, a subtle shadow, four rounded corners, and a slim custom scrollbar
- Performance-safe glass styling shared by the control rail, top actions, loading surface, subtitle panel, and information toast: translucent layered tints, fixed specular highlights, and inset light replace live backdrop blur, distortion, canvas sampling, and animated material effects
- Top and bottom subtitles sit 10% inward from the corresponding video edge
- When the control rail is visible, bottom subtitles stay 10% above the rail's top edge and return to the video-edge position when it hides
- Initial PiP content width is capped at 30% of the available screen width (and 720px), with no extension-defined 320/360px minimum; height follows the selected video's untouched aspect ratio
- Every new PiP is initially placed at the bottom-right of the monitor Chrome chose with 15px of usable-screen/taskbar padding; this opening placement applies even when ongoing Pin protection is disabled
- Cross-browser native-frame sizing for Chrome, Edge, and Brave: the initial request uses the browser's passively learned request correction (with the proven Chrome 34px/other-Chromium 0px values as first-run fallbacks), while opening Adjust, wheel, and settled-resize operations use that PiP window's actual measured title-bar/frame insets. Learning itself remains passive
- The document is painted black immediately and shows a centered animated Tabler loader with **Loading...** while video selection and PiP registration finish. Registration reads the matched native PiP window's real outer bounds, then automatically runs the same aspect correction as the Adjust button during this loading phase before attaching the video. After a freeform native resize, the complete frame remains visible while the pointer is moving; once movement stops, Caption PiP performs one aspect correction to the nearest device-pixel-aligned size using that measured frame model
- Focused-wheel aspect-safe sizing with no visible size control or initialization wait: once PiP has focus and no PiP scroll surface is open, scroll up to enlarge it or down to reduce it while the pointer is over either PiP or any ordinary webpage/frame where Caption PiP runs; hovering PiP is no longer required. If the subtitle appearance view is open, it owns the wheel everywhere and PiP sizing pauses until it closes. The opening size is not a limit; resizing spans Chromium's native 240×52 minimum inner bounds through its 80%-of-display maximum, constrained to the source video's aspect ratio and usable taskbar-aware area. The screen-nearest horizontal and vertical edges remain fixed so the window grows or shrinks toward the screen interior
- Optional pinned safe-area padding with immediate registration: PiP keeps its freely chosen position, but any edge closer than 15px to the selected monitor's usable screen or taskbar boundary is nudged inward only as far as necessary, preserving its current size and native resizing
- Whole-surface PiP dragging: grab the video, canvas, or empty background anywhere outside the top controls, bottom rail, and subtitle popup to move the native PiP window; pointer capture and frame-batched updates keep the gesture continuous, each update locks the outer dimensions captured at drag start so native frame pixels cannot accumulate into window growth, and the pin setting is applied only after release
- Four standalone circular static-glass top actions: return-to-tab and Tabler `IconAspectRatio` are grouped at the top-left, presentation remains anchored at the exact top-center, and Tabler `IconMagnet` remains at the top-right. **Adjust aspect ratio** uses the latest source-video ratio and current PiP width, then runs the same measured-frame, screen-edge-anchored resize path as wheel sizing. The actions share the bottom rail's reveal/dismiss timing; pinning uses full opacity and enforces 15px usable-edge padding while unpinning uses a 42% tint and permits unrestricted placement, and presentation restores the original player and enters its webpage fullscreen mode
- Geometry isolation for reactive players so resizing or unmaximizing the source window cannot offset the PiP video; media and rendered content are explicitly anchored at the stage's physical top-left origin (`0,0`) instead of center-positioned onto a possible half pixel
- A generic hidden two-frame compositor refresh after moving a live video between documents, followed by an opening-safe `contain` to `cover` handoff once the first layout is stable. The resize-settling stabilizer likewise uses `contain` throughout active resizing, waits 140ms after the last size change, snaps once to the closest source-aspect dimensions with the lowest physical-pixel error, and then applies stable micro-overscan so integer rounding cannot toggle a one-pixel edge on and off
- Netflix-safe ±10-second and timeline seeking through the site's own local player interface
- Netflix source-tab visibility recovery that preserves playback across tab/app switches without overriding an intentional PiP pause
- A measured top-level “Playing in Picture-in-Picture” cover on the source page, paired with a hidden transformed layout anchor so every direct player is completely covered and restores in place
- Automatic player restoration when PiP closes
- Local-only processing with no analytics, telemetry, or extension-owned network requests

## Install

1. Open `chrome://extensions` in desktop Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder (the folder containing `manifest.json`).
5. Pin **Caption PiP** from Chrome's extensions menu if desired.

## Use

1. Start the video and enable subtitles in the website player if the desired language is not already active.
2. Click the Caption PiP toolbar icon, or press `Alt+Shift+P`.
3. Caption PiP automatically chooses the strongest active/visible video candidate, applies the browser's learned request correction, measures the matched native PiP frame, and attaches the video.
4. Close the floating window or choose **Stop PiP** in the webpage placeholder to restore the player.

Choose the maximize icon in the PiP top controls to leave PiP and continue with the original website player in fullscreen. Caption PiP restores the live media and generically finds and activates that player's own fullscreen control, including controls exposed through open shadow roots. The website therefore owns the fullscreen surface, its controls, and its normal exit behavior. If no player control is exposed, Caption PiP requests fullscreen in place on the native video, original iframe, or nearest player container. It never moves the player into an extension-made fullscreen host, and the service worker only activates and focuses the source tab—it never changes the normal Chrome window's state.

If the tab has no usable video, Caption PiP shows an informational toast on the page without opening or flashing an empty floating window.

Each frame keeps a small in-memory hint containing its strongest video's score and aspect ratio. The toolbar click uses the latest hint to request Chrome's user-authorized PiP window immediately at the likely selected video's ratio while the extension confirms the final selection across all frames. When several players exist, visible area and active playback are prioritized.

Drag the horizontal slider beside the speaker icon to adjust volume. Click the speaker itself to mute or unmute; unmuting restores the last audible volume.

Every newly opened PiP starts in the bottom-right of the monitor where Chrome created it, inset 15px from the usable right and bottom edges so it clears the taskbar. This is a one-time opening placement, not corner attraction. To reposition PiP afterward, drag anywhere on its video or empty background. Interactive controls are excluded, so sliders and buttons continue to work normally. The drag records the native outer width and height once and includes those same dimensions with every position update, preventing repeated moves from slowly enlarging the PiP frame. When pinning is enabled, the released position is retained unless an edge violates the 15px usable-screen boundary; only the violating horizontal and/or vertical coordinate is moved inward. When pinning is disabled, the window remains exactly where it was released. Chrome intentionally blocks page-level `moveTo()`/`moveBy()` for Document PiP, so Caption PiP performs this user-driven gesture through its locally matched extension window rather than a website positioning API.

For embedded players, PiP first applies mute/unmute and volume to the real website video, matching the direct-player and Netflix behavior. If Chrome rejects an unmute because that iframe only began playing through muted autoplay, Caption PiP restores source playback and uses its already-local captured audio as a compatibility fallback instead of freezing the video.

Subtitle appearance changes are stored in `chrome.storage.local` and restored when PiP is reopened, Chrome is restarted, or the laptop is restarted. They remain attached to the current browser profile until the extension is removed or its extension data is cleared.

Changes preview and save automatically. Use the X button in the header as an additional way to close the appearance panel.

Chrome owns the Document PiP title bar, including the displayed site origin and close button, so webpage CSS and extension code cannot collapse it. Caption PiP hides Chrome's native return-to-opener action and supplies an icon-only return control inside the PiP content; selecting it focuses the original tab and closes PiP.

### PiP keyboard controls

| Key | Action |
| --- | --- |
| `Space` or `K` | Play/pause |
| `←` or `J` | Back 10 seconds |
| `→` or `L` | Forward 10 seconds |
| `M` | Mute/unmute |
| `C` | Show/hide subtitles |
| `Home` | Seek to start |
| `End` | Seek to end |
| `Esc` | Close the subtitle appearance panel, then close PiP |

## How subtitles are detected

Caption PiP first looks for HTML media `TextTrack` captions/subtitles and renders the active cues in its own overlay. If a site draws captions as DOM text, it also checks visible caption-like elements used by common players. The PiP subtitle toggle does not inspect or mirror the website player’s subtitle-enabled state and is never disabled because a cue or source is absent. It only shows or hides Caption PiP’s own overlay. Subtitle text is inserted with `textContent`; website markup is not executed in the PiP UI.

Each generic video source is identified from its page, media descriptor, and containing-frame path, then reduced to a local hash. A source without a stored choice starts hidden. Toggling subtitles stores only that source hash and a boolean, so reopening the same source restores the choice while a different source starts hidden.

Interactive subtitle controls are excluded even when a player gives them caption-like test IDs. This prevents Prime Video labels such as “Subtitles CC” from being rendered as a stuck caption while leaving its non-interactive cue text detectable.

For Vidcore-based players that expose many unusable hidden text tracks, Caption PiP detects the active Material UI subtitle overlay by its position and presentation relative to the video. This avoids depending on the player's generated class hash and keeps working when its cue text changes.

Canvas-rendered captions and captions rendered inside inaccessible closed shadow roots cannot be read generically. Site-specific support can be added to `SPECIFIC_CAPTION_SELECTORS` in `src/content.js` when a site exposes its captions as DOM text.

## Embedded-player behavior

Document Picture-in-Picture windows can only be opened by a top-level browsing context. For a video inside another origin's iframe, Caption PiP:

1. Relays the user's selection to the top page locally.
2. Opens Document PiP from the top page.
3. For blob/MSE players, reads the captured video track with `MediaStreamTrackProcessor` and transfers every source-produced browser-native frame into the PiP canvas without imposing an extension frame-rate cap. This keeps frame delivery independent of background-throttled animation callbacks and preserves variable or high source frame rates as far as the browser and device can process them. Captured audio and other player types use a server-free local peer connection with no STUN/TURN servers.
4. Keeps the original iframe and its authorization/session state untouched beneath the webpage placeholder. PiP controls the real embedded video’s audio state first. Only when Chrome explicitly rejects that transition does the extension keep the source muted and route its captured audio through the PiP controls as a compatibility fallback.
5. Relays controls, state, and detected caption text to the original player through extension/frame messaging.
6. Stops the local mirror and reveals the still-live original player when PiP closes.

This live-first path avoids reloading one-time or referrer-protected embeds. Caption PiP tries the background-safe media-track frame reader first for blob/MSE video, then direct frame callbacks, media-track capture, and compatibility-canvas capture before reconnecting a copy of the embed. Protected players may still fall back to Chrome's native video PiP or fail cleanly.

For a regular top-level player, Caption PiP moves the live video element into the PiP document. The PiP stage continuously owns its sizing, centering, transform, and aspect containment so page resize handlers cannot reapply source-window geometry to the floating player.

Netflix terminates its playback session if an extension changes the moved media element's `currentTime` directly. On Netflix only, Caption PiP routes seek requests to the site's local player interface instead. Timeline dragging previews continuously but commits one seek when released; no account, video, or subtitle data leaves the browser.

Netflix can also issue a pause when its original tab becomes hidden or its window loses focus, even though the live video is already inside Document PiP. Caption PiP now remembers whether PiP playback was intended, performs a short bounded recovery during that hide/blur transition, and cancels recovery immediately when the PiP play/pause control requests a pause.

Caption PiP calculates the target video-content width and height before requesting Document Picture-in-Picture. On first use, genuine Google Chrome starts with its proven 34px request allowance while Edge, Brave, and other Chromium browsers start with an unmodified content request. Once the native PiP is matched, Caption PiP compares the requested and delivered content viewports and passively remembers that browser's request correction for later openings. Separately, it measures the actual native outer-to-inner frame insets for window-manager operations. Keeping those two values separate handles the different Document PiP request semantics across Chrome, Edge, and Brave. During the black loading phase, one automatic Adjust pass keeps the delivered inner width, calculates its matching source-video height, and atomically updates the native bounds while preserving the nearest screen edges. Media is attached afterward and remains anchored at `0 0`.

After attachment, a generic resize stabilizer observes only the PiP content viewport. Opening starts with `contain`; after two animation frames, it switches to `cover` only if the viewport stayed unchanged, absorbing fractional one-pixel opening gaps without resizing the window. During a native edge or corner drag it returns to `contain`, so the complete frame remains visible and no rounding threshold can make the fit mode flicker. After 140ms without another size change, it searches nearby integer dimensions for the source-aspect size with the smallest device-pixel error and requests that single correction while preserving the opposite, screen-nearest edges. Once settled, a stable `cover` fit absorbs any fractional compositor remainder. A new drag immediately returns to `contain`; there is no site-specific player branch or continuously fighting aspect-lock loop. Focused mouse-wheel input and the Adjust action use the same aspect-resize request path and are enabled as soon as the PiP UI exists. Each resize starts from the current inner width, uses the source video's ratio, clamps to Chromium's native Document PiP range, converts content bounds through the current PiP's measured native frame, stays inside the monitor's usable work area, anchors the nearest screen edges, and atomically updates `left`, `top`, `width`, and `height`. While the scrolling subtitle appearance view is open, all local and relayed PiP wheel input is routed to that view—even at its scroll limits—so it can never spill into a window resize. Every Document PiP request also opts out of reuse of previous bounds.

When PiP is the focused Chrome window, Caption PiP relays wheel events from ordinary website content and embedded frames to the PiP size controller, so the pointer can sit outside the PiP window. Chrome extensions do not receive global mouse-wheel input from the Windows desktop, Chrome's toolbar/internal pages, or other applications; supporting those surfaces would require a separately installed native helper. Page scrolling resumes immediately when PiP loses focus.

## Compatibility limits

- DRM/EME and origin-protected media tracks may prohibit capture, moving, seeking, or Picture-in-Picture.
- Canvas- or WebGL-rendered video/captions are not regular HTML media and may be inaccessible.
- Obfuscated players may not expose usable text tracks, DOM captions, or controls.
- An embed's `sandbox`, Permissions Policy, CSP, frame restrictions, or single-use state may block both live capture and the reconnecting fallback.
- In native-PiP fallback mode, the custom `Aa` subtitle overlay is unavailable.
- Chrome internal pages, the Chrome Web Store, and other protected browser pages do not allow normal content-script access.

## Permissions

- Site access on all URLs: finds videos and caption text, places the temporary selector and placeholder, and controls the chosen media in any origin frame.
- `system.display`: reads each monitor's usable work area so pinned 15px padding respects taskbars, launchers, and negative multi-monitor coordinates.
- `webNavigation`: enumerates every frame in the current tab so the toolbar action can choose the strongest video candidate.
- `storage`: persistently saves the subtitle appearance configuration and the boolean show/hide choice associated with each locally hashed video-source identity in `chrome.storage.local`.

See [PRIVACY.md](PRIVACY.md) for the data-handling details.

## Development and validation

No build step or third-party runtime dependency is required. The committed files are the extension.

### UI conventions

- Prefer a familiar icon over a visible text label for compact controls. Keep the action name in `title` and `aria-label` attributes.
- Use [Tabler Icons](https://github.com/tabler/tabler-icons) for interface icons. Their SVG paths are bundled locally, so the extension makes no runtime icon requests.
- Because Chrome has no manifest-level light/dark action-icon pair, publish the top page's live `prefers-color-scheme` state and select the matching background-free icon per tab: dark gray on light themes and white on dark themes.
- Use filled color and surface changes for hover, focus, and active states instead of visible outline or border treatments.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the Tabler Icons license.

```powershell
node --check src/service-worker.js
node --check src/page-bridge.js
node --check src/content.js
node tests/static-validation.mjs
node tests/page-bridge-validation.mjs
node tests/corner-snap-validation.mjs
node tests/browser-smoke.mjs
```

The browser smoke test uses a temporary Chrome profile and locally generated videos. On current Chrome and Brave it loads the unpacked extension through the DevTools Protocol, triggers the real toolbar action, and verifies one-click direct and cross-origin PiP, the real final inner aspect across repeated openings, multi-update whole-surface PiP dragging with control exclusion and invariant outer dimensions, hidden-by-default subtitles for a new source, same-source show/hide persistence, independence from the website subtitle toggle, interactive-control label filtering, automatic appearance-setting persistence, subtitle rendering, uncapped 30 fps frame delivery, embedded horizontal volume controls, and a trusted handoff that invokes the restored website player's own fullscreen control while leaving its controls visible. Deterministic window tests separately reproduce headed Chrome's opening races and position-only frame inflation, verify size-locked surface-drag deltas and drag/safe-area coordination, verify free interior placement plus 15px clamping across primary and negative-coordinate secondary monitors without changing the PiP size, and confirm that fullscreen routing focuses the source tab/window without setting its browser-window state. Another deterministic test simulates Netflix's visibility- and blur-triggered pauses and verifies both automatic recovery and explicit-pause protection.

Regenerate the committed PNG icons on Windows with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/generate-icons.ps1
```
