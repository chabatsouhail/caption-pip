(() => {
  "use strict";

  const GLOBAL_GUARD = "__captionPipThemeIconV1";
  const TOOLBAR_THEME_MESSAGE = "CAPTION_PIP_TOOLBAR_THEME";
  if (window.top !== window || globalThis[GLOBAL_GUARD]) return;
  globalThis[GLOBAL_GUARD] = true;

  const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const publishTheme = () => {
    try {
      chrome.runtime
        .sendMessage({
          type: TOOLBAR_THEME_MESSAGE,
          theme: darkScheme.matches ? "dark" : "light",
        })
        .catch(() => {});
    } catch {}
  };

  publishTheme();
  darkScheme.addEventListener("change", publishTheme);
  window.addEventListener("pageshow", publishTheme);
})();
