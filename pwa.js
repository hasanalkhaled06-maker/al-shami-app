/* Register AL SHAMI app updates on iPhone and other browsers. */
(() => {
  "use strict";

  let installPrompt = null;
  const installBanner = document.getElementById("pwa-install-banner");
  const installButton = document.getElementById("pwa-install-button");
  const installMessage = installBanner?.querySelector("span");
  const installCopy = {
    en: ["Install AL SHAMI on this device for quick access.", "Install app"],
    ar: ["ثبّت تطبيق الشامي على هذا الجهاز للوصول السريع.", "تثبيت التطبيق"],
    tw: ["Install AL SHAMI on this device for quick access.", "Install app"]
  };
  const updateInstallCopy = () => {
    const language = document.getElementById("language")?.value || "en";
    const copy = installCopy[language] || installCopy.en;
    if (installMessage) installMessage.textContent = copy[0];
    if (installButton) installButton.textContent = copy[1];
  };
  updateInstallCopy();
  document.getElementById("language")?.addEventListener("change", updateInstallCopy);

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    if (installBanner) installBanner.hidden = false;
  });

  installButton?.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    if (installBanner) installBanner.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (installBanner) installBanner.hidden = true;
  });

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
