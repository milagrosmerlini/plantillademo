// SW de desactivacion: borra caches y se desregistra.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      try {
        await self.registration.unregister();
      } catch {}
      try {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clients) client.navigate(client.url);
      } catch {}
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
