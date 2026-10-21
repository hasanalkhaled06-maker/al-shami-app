/* AL SHAMI PWA service worker. Same-origin static files only; Supabase API is never cached. */
"use strict";

const CACHE_PREFIX = "al-shami-static-";
const CACHE_NAME = CACHE_PREFIX + "v28";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./history.html",
  "./admin.html",
  "./style.css",
  "./config.js",
  "./customer.js",
  "./customer.js?v=customer-phone-password-auth-20261021h",
  "./admin.js",
  "./admin.js?v=order-audio-recovery-20261021d",
  "./admin-operations.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./admin.webmanifest",
  "./icons/al-shami.svg",
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
        const path = url.pathname.endsWith("/admin.html") ? "./admin.html" : "./index.html";
        return (await cache.match(path)) || Response.error();
      }
      return Response.error();
    }
  })());
});
