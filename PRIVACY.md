# Caption PiP privacy

Caption PiP processes video state and detected subtitle text locally in Chrome. It contains no analytics, telemetry, advertising, account system, or remote service, and its code makes no `fetch`, `XMLHttpRequest`, WebSocket, or upload request.

## Data handled

- Video metadata needed for the UI, such as playback time, duration, mute state, and aspect ratio
- Active subtitle/caption text from HTML text tracks or visible caption DOM elements
- Subtitle appearance preferences and the corner-snapping enabled/disabled choice
- A boolean PiP subtitle show/hide preference keyed by a locally hashed video-source identity
- Native PiP frame dimensions and request-to-content corrections keyed by a locally hashed browser/display environment identity
- Temporary pointer coordinates used only while the user is actively dragging the PiP surface, and transient mouse-wheel deltas used only to resize a focused PiP

Video state, local connection descriptions, caption text, active-drag pointer coordinates, transient wheel deltas, and the original player's temporary PiP restoration data are kept in memory only for the active session. They are relayed locally between the selected frame, the extension service worker, and browser pages where Caption PiP runs so an embedded player can be mirrored, controlled, kept at the video's aspect ratio, repositioned under a direct user drag, resized while its PiP window is focused, or restored before its own fullscreen control is activated. They are not written to persistent extension storage.

The data persisted across browser restarts is the subtitle appearance object, per-source PiP subtitle visibility booleans, the user's corner-snapping enabled/disabled choice, and up to twelve recent PiP frame profiles in `chrome.storage.local`. The appearance object contains font, size, text/background colors and opacity, weight, Character edge style, and position. Each visibility key is derived locally by hashing the generic page/media/frame identity; raw source URLs are not written as preference keys. Each frame profile contains requested and observed PiP dimensions, native frame width/height, the resulting width/height correction, measurement time, and sample count. Its key is derived locally by hashing browser brand/version, platform, display geometry, and display scale; those raw environment values are not persisted. While PiP is active, its browser-window ID, source-tab ID, corner-snap readiness time, and active pin state are held temporarily in `chrome.storage.session` so anchoring survives service-worker sleep. That temporary record is removed when PiP or its source tab closes and is discarded when the browser exits. Chrome keeps persistent preferences and frame profiles in the current browser profile across browser and computer restarts until the extension or its stored data is removed.

## Network behavior

The extension itself makes no network requests. For blob/MSE players, its preferred cross-origin path reads frames locally from a captured `MediaStreamTrack`, transfers temporary browser-native video frames between the selected iframe and the current tab, then releases each frame after drawing it in PiP. This uses no ICE or network socket. Other capture paths and captured audio use a local `RTCPeerConnection` with no STUN or TURN servers. Neither video, audio, nor subtitles are sent to a remote endpoint.

If local capture is blocked and Caption PiP uses its reconnecting fallback, the website's player can reload its own embed URL and make the same kinds of media, authentication, advertising, or analytics requests the website normally makes. Those requests belong to the website/player, not Caption PiP.

## Site access

Universal video and iframe support requires the content script to run on all ordinary website origins and in matching child frames. It reads only the page state needed to locate media, detect captions, display the selector/placeholder, and control the user-selected player.

Corner anchoring reads Chrome's current monitor work areas locally after a PiP move so taskbars and multi-monitor coordinates are respected. The one-time PiP welcome measures its settled native inner/outer bounds and reads the current display geometry and scale locally to derive its hashed environment key. Raw display information is neither retained nor transmitted.

On `www.netflix.com` only, a small page-context bridge receives local seek times from Caption PiP and calls Netflix's existing player seek interface. This prevents Netflix from terminating playback when the moved media element is sought directly. The bridge does not access account details and makes no network requests.

Caption PiP does not sell, share, or transmit user data to its developer or any third party.
