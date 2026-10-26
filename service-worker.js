/* AL SHAMI PWA service worker. Same-origin static files only; Supabase API is never cached. */
"use strict";

const CACHE_PREFIX = "al-shami-static-";
const CACHE_NAME = CACHE_PREFIX + "v116";
const SHELL_FILES = [
  "./",
  "./index.html",
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
  "./customer-features.js?v=account-settings-20261025c",
  "./customer-features.js?v=customer-points-20261025a",
  "./customer-features.js?v=delivery-complete-20261025a",
  "./admin-delivery-ops.js?v=operations-settings-20261025c",
  "./rider-ops.js?v=delivery-ops-20261025b",
  "./admin.js",
  "./admin.js?v=staff-user-roles-20261026c",
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
  "./admin.webmanifest",
  "./icons/al-shami.svg",
  "./icons/al-shami-customer.svg?v=icon-20261024",
  "./icons/al-shami-admin.svg",
  "./icons/apple-touch-icon.png",
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

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = new URL("./admin.html", self.registration.scope).href;
  event.waitUntil((async () => {
    const openClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appClient = openClients.find(client => client.url.startsWith(self.registration.scope));
    if (appClient) {
      if (appClient.url !== targetUrl && typeof appClient.navigate === "function") {
        await appClient.navigate(targetUrl);
      }
      return appClient.focus();
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
