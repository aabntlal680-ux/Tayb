// 1. الاستيراد المباشر في أعلى الملف بدون try...catch
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// 2. إعدادات فايربيس
const firebaseConfig = {
  apiKey: "AIzaSyDeg6RBNC9bWw1QYxBkYtCuMMFPBzxpw4o",
  authDomain: "studio-6422025604-b97aa.firebaseapp.com",
  projectId: "studio-6422025604-b97aa",
  storageBucket: "studio-6422025604-b97aa.firebasestorage.app",
  messagingSenderId: "599267399266",
  appId: "1:599267399266:web:329e49e24298af60f5e33b",
};

// 3. التهيئة المباشرة
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// 4. دالة استقبال رسائل الخلفية
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Background message:", payload);

  const notification = payload.notification || {};
  const data = payload.data || {};

  const title = notification.title || data.title || "رسالة جديدة";
  const body = notification.body || data.body || "لديك رسالة جديدة";

  const notificationOptions = {
    body,
    icon: data.icon || "./icons/icon.png",
    badge: data.badge || "./icons/icon.png",
    tag: data.conversationId || "whatsapp-message",
    renotify: true,
    data: { ...data },
    vibrate: [100, 50, 100],
  };

  return self.registration.showNotification(title, notificationOptions);
});

// ---------------------------------------------------------------
// Notification Click
// ---------------------------------------------------------------
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const conversationId = data.conversationId || "";
  const targetUrl = conversationId ? "./index.html#chat" : "./index.html";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            if (conversationId) {
              client.postMessage({
                type: "OPEN_CONVERSATION",
                conversationId,
              });
            }
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
        return null;
      })
  );
});
