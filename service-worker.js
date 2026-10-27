/* AL SHAMI PWA service worker. Same-origin static files only; Supabase API is never cached. */
"use strict";

const CACHE_PREFIX = "al-shami-static-";
const CACHE_NAME = CACHE_PREFIX + "v128";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./install.html",
  "./history.html",
  "./admin.html",
  "./style.css",
  "./app-refresh.css",
  "./dark-theme.css",
  "./app-refresh.css?v=light-premium-20261023b",
  "./dark-theme.css?v=deep-accents-20261023i",
  "./dark-theme.css?v=modern-wine-gold-20261024a",
  "./dark-theme.css?v=olive-sand-copper-20261026a",
  "./assets/al-shami-chef-3d.webp",
  "./style.css?v=radical-ui-20261023a",
  "./dark-theme.css?v=shami-wordmark-cleanup-20261023q",
  "./style.css?v=modern-ui-20261023a",
  "./config.js",
  "./customer.js",
  "./customer.js?v=auth-choice-20261024a",
  "./customer.js?v=auto-status-20261023a",
  "./customer.js?v=loyalty-20261025a",
  "./customer.js?v=scroll-refresh-fix-20261025a",
  "./customer.js?v=active-orders-page-20261025a",
  "./customer.js?v=customer-points-20261025a",
  "./customer.js?v=delivery-complete-20261025a",
  "./customer.js?v=catalog-refresh-20261027a",
  "./customer.js?v=push-notifications-20261027a",
  "./customer.js?v=login-persistence-20261027a",
  "./customer.js?v=usability-batch1-20261027a",
  "./customer-features.js?v=account-settings-20261025c",
  "./customer-features.js?v=customer-points-20261025a",
  "./customer-features.js?v=delivery-complete-20261025a",
  "./customer-features.js?v=push-notifications-20261027a",
  "./admin-delivery-ops.js?v=operations-settings-20261025c",
  "./rider-ops.js?v=delivery-ops-20261025b",
  "./admin.js",
  "./admin.js?v=staff-user-roles-20261026d",
  "./admin.js?v=cashier-stages-20261027b",
  "./admin.js?v=login-persistence-20261027a",
  "./admin.js?v=usability-batch1-20261027a",
  "./order-workflow.js?v=order-flow-guard-20261026a",
  "./admin-operations.js",
  "./admin-operations.js?v=radical-ui-20261023a",
  "./rider.html",
  "./rider.js",
  "./rider.js?v=auto-location-out-20261024a",
  "./rider.css",
  "./rider.css?v=radical-ui-20261023a",
  "./rider.webmanifest",
  "./icons/al-shami-rider.svg",
  "./pwa.js",
  "./manifest.webmanifest",
  "./manifest.webmanifest?v=customer-splash-20261027a",
  "./admin.webmanifest",
  "./icons/al-shami.svg",
  "./icons/al-shami-customer.svg?v=icon-20261024",
  "./icons/al-shami-admin.svg",
  "./icons/apple-touch-icon.png",
  "./icons/al-shami-pwa-192.png",
  "./icons/al-shami-pwa-512.png",
  "./icons/al-shami-pwa-192.png?v=customer-pwa-20261027a",
  "./icons/al-shami-pwa-512.png?v=customer-pwa-20261027a",
  "./icons/al-shami-pwa-192.png?v=customer-pwa-20261027c",
  "./icons/al-shami-pwa-512.png?v=customer-pwa-20261027c",
  "./icons/al-shami-pwa-maskable-512.png?v=customer-pwa-20261027c",
  "./icons/apple-touch-icon-customer.png?v=customer-pwa-20261027c",
  "./icons/apple-touch-icon-admin.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(SHELL_FILES.map(path => cache.add(path)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Push notifications belong to the customer app. Never route customers into admin or rider pages.

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
    const title = String(data.title || "AL SHAMI");
    const options = {
      body: String(data.body || "You have an update from AL SHAMI."),
      icon: "./icons/al-shami-pwa-192.png",
      badge: "./icons/al-shami-pwa-192.png",
      tag: String(data.tag || "al-shami-update"),
      renotify: true,
      data: { url: String(data.url || "./index.html") }
    };
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  let targetUrl;
  try {
    const candidate = new URL(event.notification.data?.url || "./index.html", self.registration.scope);
    targetUrl = candidate.origin === self.location.origin && candidate.pathname.startsWith(new URL(self.registration.scope).pathname)
      ? candidate.href
      : new URL("./index.html", self.registration.scope).href;
  } catch {
    targetUrl = new URL("./index.html", self.registration.scope).href;
  }
  event.waitUntil((async () => {
    const openClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const customerClient = openClients.find(client => {
      try {
        const url = new URL(client.url);
        return url.origin === self.location.origin &&
          !/\/(admin|rider|history|install)\.html$/i.test(url.pathname) &&
          (url.pathname.endsWith("/") || url.pathname.endsWith("/index.html"));
      } catch { return false; }
    });
    if (customerClient) {
      if (customerClient.url !== targetUrl && typeof customerClient.navigate === "function") {
        await customerClient.navigate(targetUrl);
      }
      return customerClient.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first ensures published app updates are picked up while online.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request, { cache: "no-store" });
      if (response && response.ok && request.url.startsWith(self.location.origin)) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const path = url.pathname.endsWith("/admin.html") ? "./admin.html" : (url.pathname.endsWith("/rider.html") ? "./rider.html" : (url.pathname.endsWith("/history.html") ? "./history.html" : "./index.html"));
        return (await cache.match(path)) || Response.error();
      }
      return Response.error();
    }
  })());
});
