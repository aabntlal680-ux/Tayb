const CACHE_NAME = "wa-clone-shell-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./partials/chat-panel.html",
  "./css/style.css",
  "./js/app.js",
  "./js/auth.js",
  "./js/config.js",
  "./js/i18n.js",
  "./js/supabaseClient.js",
  "./js/db.js",
  "./js/push.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for Supabase API/Realtime calls, cache-first for the app shell
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isSupabase = url.hostname.endsWith(".supabase.co");

  if (isSupabase) {
    event.respondWith(fetch(event.request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request)
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return response;
          })
          .catch(() => cached)
      );
    })
  );
});

// ---------------------------------------------------------------
// WEB PUSH: عرض إشعار عند وصول push من Edge Function send-push
// ---------------------------------------------------------------
self.addEventListener("push", (event) => {
  let data = { title: "رسالة جديدة", body: "" };
  try {
    data = event.data.json();
  } catch (e) {
    data.body = event.data ? event.data.text() : "";
  }

  const options = {
    body: data.body,
    icon: "./icons/icon1.png",
    badge: "./icons/icon1.png",
    dir: "auto",
    data: { conversationId: data.conversationId },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});
