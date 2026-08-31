import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getMessaging, onBackgroundMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-sw.js";


const firebaseConfig = {
  apiKey: "AIzaSyDeg6RBNC9bww1QYxBkYtCu...",
  authDomain: "studio-6422025604-b97aa.firebaseapp.com",
  projectId: "studio-6422025604-b97aa",
  storageBucket: "studio-6422025604-b97aa.appspot.com",
  messagingSenderId: "599267399266",
  appId: "1:599267399266:web:329e49e2429..."
};


// ---------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------

const messaging = firebase.messaging();

// ---------------------------------------------------------------
// Background Messages
// ---------------------------------------------------------------

messaging.onBackgroundMessage((payload) => {

  console.log(
    "[firebase-messaging-sw.js] Background message:",
    payload
  );

  const notification =
    payload.notification || {};

  const data =
    payload.data || {};

  const title =
    notification.title ||
    data.title ||
    "رسالة جديدة";

  const body =
    notification.body ||
    data.body ||
    "لديك رسالة جديدة";

  const notificationOptions = {
    body,

    icon:
      data.icon ||
      "/icons/icon.png",

    badge:
      data.badge ||
      "/icons/icon.png",

    tag:
      data.conversationId ||
      "whatsapp-message",

    renotify: true,

    data: {
      ...data,
    },

    // صوت إشعار النظام
    // ملاحظة: المتصفح/النظام هو من يتحكم في الصوت
    sound: "/icons/notify.mp3",
  };

  return self.registration.showNotification(
    title,
    notificationOptions
  );
});

// ---------------------------------------------------------------
// Notification Click
// ---------------------------------------------------------------

self.addEventListener(
  "notificationclick",
  (event) => {

    event.notification.close();

    const data =
      event.notification.data || {};

    const conversationId =
      data.conversationId || "";

    const targetUrl =
      conversationId
        ? `/#chat`
        : "/";

    event.waitUntil(
      clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      }).then((clientList) => {

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
          return clients.openWindow(
            targetUrl
          );
        }

        return null;
      })
    );
  }
);
