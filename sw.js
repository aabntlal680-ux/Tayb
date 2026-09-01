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
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
        // التأكد من أن الاستجابة صالحة والطلب من نوع GET قبل التخزين
          if (!response || response.status !== 200 || response.type !== 'basic' || event.request.method !== 'GET') {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        })
        .catch(() => cached);
    })
  );
});

// ---------------------------------------------------------------
// NOTIFICATION CLICK
// ---------------------------------------------------------------
// ملاحظة معمارية: أحداث push الفعلية أصبحت تُعالَج حصرياً في
// firebase-messaging-sw.js (نطاق منفصل، مسجَّل من js/push.js) بعد التحول
// إلى Firebase Cloud Messaging — لذلك أُزيل مستمع "push" القديم من هنا
// لتفادي تعارض عاملين على نفس الحدث. لكن نُبقي "notificationclick" هنا لأن
// أي إشعار يُعرض مباشرة من صفحة التطبيق نفسها عبر
// (navigator.serviceWorker.ready).showNotification(...) — كما يحدث في
// معالج الرسائل الواردة أثناء فتح التطبيق (foreground) داخل js/push.js —
// يتبع تسجيل هذا العامل تحديداً (نطاق الجذر "./")، وليس firebase-messaging-sw.js.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const conversationId = data.conversationId || "";
  const targetUrl = conversationId ? "./index.html#chat" : "./index.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if (conversationId) {
            client.postMessage({ type: "OPEN_CONVERSATION", conversationId });
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
