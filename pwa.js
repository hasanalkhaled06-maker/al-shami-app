/* Register AL SHAMI app updates on iPhone and other browsers. */
(() => {
  "use strict";

  let installPrompt = null;
  const installBanner = document.getElementById("pwa-install-banner");
  const installButton = document.getElementById("pwa-install-button");
  const installMessage = installBanner?.querySelector("span");
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const mobileInstallDevice = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const customerAccount = document.getElementById("customer-account");
  const shouldShowLaptopInstall = () => !standalone && !mobileInstallDevice &&
    !(customerAccount && !customerAccount.hidden);
  const updateInstallBannerVisibility = () => {
    if (installBanner) installBanner.hidden = !shouldShowLaptopInstall();
  };
  const installHelpCopy = {
    en: "Open this page in Microsoft Edge, then choose ⋯ > Apps > Install this site as an app.",
    ar: "افتح الصفحة بمتصفح Microsoft Edge، ثم اختر ⋯ > التطبيقات > تثبيت هذا الموقع كتطبيق.",
    tw: "Open this page in Microsoft Edge, then choose ⋯ > Apps > Install this site as an app."
  };
  const installCopy = {
    en: ["Install AL SHAMI on this laptop for quick access.", "Install app"],
    ar: ["ثبّت تطبيق الشامي على اللابتوب للوصول السريع.", "تثبيت التطبيق"],
    tw: ["Install AL SHAMI on this laptop for quick access.", "Install app"]
  };
  if (!document.getElementById("pwa-install-banner-style")) {
    const style = document.createElement("style");
    style.id = "pwa-install-banner-style";
    style.textContent = ".pwa-install-banner{position:fixed;z-index:10021;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);transform:translateX(-50%);width:min(680px,calc(100% - 24px));padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #d8e2e9;border-radius:14px;background:#f4f8fb;color:#29475b;font:600 14px/1.45 system-ui,sans-serif;box-shadow:0 12px 34px #1b252d30}.pwa-install-banner[hidden]{display:none!important}.pwa-install-banner .btn{flex:0 0 auto}@media(max-width:480px){.pwa-install-banner{padding:10px 12px;font-size:12px}.pwa-install-banner .btn{padding:9px 11px}}";
    document.head.appendChild(style);
  }
  updateInstallBannerVisibility();
  if (customerAccount && installBanner) {
    new MutationObserver(updateInstallBannerVisibility).observe(customerAccount, {
      attributes: true,
      attributeFilter: ["hidden"]
    });
  }
  if (standalone) document.documentElement.classList.add("app-installed");
  const iosGuide = document.getElementById("ios-install-guide");
  const iosGuideClose = document.getElementById("ios-install-close");
  const iosGuideOpen = document.getElementById("ios-install-help-open");
  const iosDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const iosGuideKey = "al-shami-ios-home-install-dismissed-at-v2";
  const iosGuideCopy = {
    en: ["Add AL SHAMI to your Home Screen", "Open this link in Safari.", "Tap Share ↑ at the bottom of Safari.", "Choose “Add to Home Screen”, then tap “Add”.", "The app icon will appear on your iPhone Home Screen."],
    ar: ["أضف الشامي إلى الشاشة الرئيسية", "افتح هذا الرابط في Safari.", "اضغط «مشاركة» ↑ أسفل Safari.", "اختر «إضافة إلى الشاشة الرئيسية» ثم اضغط «إضافة».", "سيظهر رمز التطبيق على الشاشة الرئيسية للآيفون."],
    tw: ["Add AL SHAMI to your Home Screen", "Open this link in Safari.", "Tap Share ↑ at the bottom of Safari.", "Choose “Add to Home Screen”, then tap “Add”.", "The app icon will appear on your iPhone Home Screen."]
  };
  if (iosGuide && iosDevice && !standalone) {
    let dismissedAt = 0;
    try { dismissedAt = Number(localStorage.getItem(iosGuideKey) || 0); } catch (_) {}
    if (!dismissedAt || Date.now() - dismissedAt > 14 * 24 * 60 * 60 * 1000) {
      window.setTimeout(() => {
        if (!window.matchMedia("(display-mode: standalone)").matches && window.navigator.standalone !== true) {
          iosGuide.hidden = false;
          iosGuideClose?.focus();
        }
      }, 650);
    }
  }
  const openIosGuide = () => {
    if (!iosGuide) return;
    iosGuide.hidden = false;
    iosGuideClose?.focus();
  };
  iosGuideOpen?.addEventListener("click", openIosGuide);
  const closeIosGuide = () => {
    if (!iosGuide) return;
    iosGuide.hidden = true;
    try { localStorage.setItem(iosGuideKey, String(Date.now())); } catch (_) {}
  };
  iosGuideClose?.addEventListener("click", closeIosGuide);
  iosGuide?.addEventListener("click", event => {
    if (event.target === iosGuide) closeIosGuide();
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && iosGuide && !iosGuide.hidden) closeIosGuide();
  });
  const updateIosGuideCopy = () => {
    const language = document.getElementById("language")?.value || "en";
    const copy = iosGuideCopy[language] || iosGuideCopy.en;
    const helpButton = document.getElementById("ios-install-help-open");
    if (helpButton) helpButton.textContent = language === "ar" ? "طريقة إضافة التطبيق إلى شاشة الآيفون" : "How to add AL SHAMI to iPhone Home Screen";
    const ids = ["ios-install-title", "ios-install-step-1", "ios-install-step-2", "ios-install-step-3", "ios-install-note"];
    ids.forEach((id, index) => {
      const node = document.getElementById(id);
      if (node) node.textContent = copy[index];
    });
  };
  updateIosGuideCopy();
  document.getElementById("language")?.addEventListener("change", updateIosGuideCopy);

  if (!document.getElementById("ios-install-guide-style")) {
    const style = document.createElement("style");
    style.id = "ios-install-guide-style";
    style.textContent = ".ios-install-guide{position:fixed;z-index:10030;inset:0;display:grid;place-items:center;padding:20px;padding-bottom:calc(20px + env(safe-area-inset-bottom,0px));background:#21151599;font:16px/1.55 system-ui,-apple-system,sans-serif;color:#382b26}.ios-install-guide[hidden]{display:none!important}.ios-install-card{position:relative;width:min(480px,100%);max-height:calc(100dvh - 40px);overflow:auto;padding:28px 24px 22px;border:1px solid #e3d2b1;border-radius:20px;background:#fffaf0;box-shadow:0 20px 60px #120a0a55}.ios-install-card h2{margin:5px 36px 14px 0;color:#641622;font-size:1.4rem;line-height:1.25}.ios-install-card ol{padding-left:24px}.ios-install-card li{margin:12px 0}.ios-install-card .ios-install-eyebrow{margin:0;color:#8d1723;font-size:.78rem;font-weight:800;letter-spacing:.08em}.ios-install-card #ios-install-note{margin:16px 0 0;color:#64554c}.ios-install-close{position:absolute;top:12px;right:12px;width:42px;height:42px;border:1px solid #d7c8b7;border-radius:50%;background:#fff;color:#641622;font-size:28px;line-height:1;cursor:pointer}.ios-install-close:focus-visible{outline:3px solid #d9b46b;outline-offset:2px}";
    document.head.appendChild(style);
  }
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
    updateInstallBannerVisibility();
  });

  installButton?.addEventListener("click", async () => {
    if (!installPrompt) {
      const language = document.getElementById("language")?.value || "en";
      if (installMessage) installMessage.textContent = installHelpCopy[language] || installHelpCopy.en;
      return;
    }
    const promptEvent = installPrompt;
    installPrompt = null;
    promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => null);
    if (choice?.outcome === "accepted" && installBanner) installBanner.hidden = true;
    if (choice?.outcome !== "accepted" && installMessage) {
      const language = document.getElementById("language")?.value || "en";
      installMessage.textContent = installHelpCopy[language] || installHelpCopy.en;
    }
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
