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

  const connectionCopy = {
    en: { offline: "You are offline. Ordering and live updates need an internet connection.", retry: "Retry", online: "Connection restored. Reconnecting…" },
    ar: { offline: "ما في اتصال بالإنترنت. الطلبات والتحديثات المباشرة بحاجة لاتصال.", retry: "إعادة المحاولة", online: "رجع الاتصال. عم نعيد الاتصال…" },
    tw: { offline: "Internet connection is unavailable. Ordering and live updates need internet.", retry: "Retry", online: "Connection restored. Reconnecting…" }
  };
  let connectionBanner = null;
  let connectionMessage = null;
  let connectionRetry = null;
  let connectionHideTimer = 0;
  let wasOffline = navigator.onLine === false;

  function connectionLanguage() {
    const selected = document.getElementById("language")?.value;
    return selected && connectionCopy[selected] ? selected : (document.documentElement.lang === "ar" ? "ar" : "en");
  }

  function updateConnectionBanner(state) {
    if (!connectionBanner) {
      const style = document.createElement("style");
      style.id = "al-shami-network-banner-style";
      style.textContent = "#al-shami-network-banner{position:fixed;z-index:10020;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);width:min(680px,calc(100% - 20px));display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border:1px solid #bd8d3e;border-radius:12px;background:#fff6df;color:#49350c;box-shadow:0 8px 28px #17212b2e;font:700 14px/1.4 system-ui,sans-serif}#al-shami-network-banner[data-online=true]{border-color:#5b9c70;background:#e9f5ed;color:#17482a}#al-shami-network-banner[hidden]{display:none!important}#al-shami-network-banner button{flex:0 0 auto;min-height:38px;padding:7px 12px;border:0;border-radius:9px;background:#294f68;color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer}@media(max-width:420px){#al-shami-network-banner{font-size:12px;padding:9px 11px;gap:8px}#al-shami-network-banner button{min-height:36px}}";
      document.head.appendChild(style);
      connectionBanner = document.createElement("div");
      connectionBanner.id = "al-shami-network-banner";
      connectionBanner.setAttribute("role", "status");
      connectionBanner.setAttribute("aria-live", "polite");
      connectionMessage = document.createElement("span");
      connectionRetry = document.createElement("button");
      connectionRetry.type = "button";
      connectionBanner.append(connectionMessage, connectionRetry);
      document.body.appendChild(connectionBanner);
      connectionRetry.addEventListener("click", () => {
        if (navigator.onLine) location.reload();
        else updateConnectionBanner("offline");
      });
      document.getElementById("language")?.addEventListener("change", () => {
        if (!connectionBanner.hidden) updateConnectionBanner(connectionBanner.dataset.online === "true" ? "online" : "offline");
      });
    }
    const text = connectionCopy[connectionLanguage()];
    window.clearTimeout(connectionHideTimer);
    if (state === "offline") {
      wasOffline = true;
      connectionBanner.hidden = false;
      connectionBanner.dataset.online = "false";
      connectionBanner.dir = connectionLanguage() === "ar" ? "rtl" : "ltr";
      connectionMessage.textContent = text.offline;
      connectionRetry.textContent = text.retry;
      return;
    }
    if (state === "online" && wasOffline) {
      wasOffline = false;
      connectionBanner.hidden = false;
      connectionBanner.dataset.online = "true";
      connectionBanner.dir = connectionLanguage() === "ar" ? "rtl" : "ltr";
      connectionMessage.textContent = text.online;
      connectionRetry.textContent = text.retry;
      connectionHideTimer = window.setTimeout(() => { connectionBanner.hidden = true; }, 3000);
      return;
    }
    connectionBanner.hidden = true;
  }

  window.addEventListener("offline", () => updateConnectionBanner("offline"));
  window.addEventListener("online", () => updateConnectionBanner("online"));
  if (wasOffline) updateConnectionBanner("offline");

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
