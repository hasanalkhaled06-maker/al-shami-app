/* AL SHAMI PWA service worker. Same-origin static files only; Supabase API is never cached. */
"use strict";

const CACHE_PREFIX = "al-shami-static-";
const CACHE_NAME = CACHE_PREFIX + "v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./admin.html",
  "./style.css",
  "./config.js",
  "./customer.js",
  "./admin.js",
  "./admin-operations.js",
  "./manifest.webmanifest",
  "./admin.webmanifest",
  "./icons/al-shami.svg",
  "./icons/al-shami-admin.svg"
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
