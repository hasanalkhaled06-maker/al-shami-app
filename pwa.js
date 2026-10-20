/* Register AL SHAMI app updates on iPhone and other browsers. */
(() => {
  "use strict";

  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (standalone) document.documentElement.classList.add("app-installed");

  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;

  let hasControlledPage = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // First controller on install needs no reload; a replacement controller means new app code is ready.
    if (hasControlledPage) {
      location.reload();
      return;
    }
    hasControlledPage = true;
  });

  navigator.serviceWorker.register("./service-worker.js", {
    scope: "./",
    updateViaCache: "none"
  }).then(registration => {
    registration.update().catch(() => {});
    window.addEventListener("pageshow", () => registration.update().catch(() => {}));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        registration.update().catch(() => {});
      }
    });
  }).catch(error => {
    console.warn("AL SHAMI: app updates could not be registered.", error);
  });
})();
