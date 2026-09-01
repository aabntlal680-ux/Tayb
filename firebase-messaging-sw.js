// ===================================================================
// firebase-messaging-sw.js
// خدمة عامل مخصصة حصراً لـ Firebase Cloud Messaging (خلفية/عند إغلاق التطبيق).
// تعمل بمعزل عن sw.js الرئيسي (نطاق مختلف يُحدَّد عند التسجيل في push.js)
// لتفادي أي تعارض بين اثنين من Service Workers على نفس الصفحة.
// ===================================================================

// السبب الجذري لخطأ "ServiceWorker script evaluation failed" سابقاً:
// كان يتم استدعاء firebase.messaging() مباشرة دون استدعاء
// firebase.initializeApp(firebaseConfig) قبله — وهذا يُسقط تنفيذ الملف
// بالكامل فور تحميله. تم إصلاح ذلك أدناه.
try {
  importScripts(
    "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"
  );
  importScripts(
    "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js"
  );
} catch (err) {
  // إن فشل تحميل مكتبات Firebase (حجب شبكي، عدم اتصال أثناء أول تثبيت...)
  // نسجّل الخطأ بوضوح بدل ترك "importScripts is not defined" أو فشل غامض،
  // ونوقف بقية الملف بأمان دون تعطيل بقية دورة حياة الـ Service Worker.
  console.error(
    "[firebase-messaging-sw.js] فشل تحميل مكتبات Firebase عبر importScripts:",
    err
  );
}

// ---------------------------------------------------------------
// Firebase Configuration
// ⚠️ يجب أن تكون مطابقة تماماً (بلا اختصار/حذف أحرف) لنفس القيم
// الموجودة في js/push.js — أي اختلاف بينهما (كما كان الحال سابقاً مع
// apiKey وappId المبتورين بـ "...") يمنع تهيئة Firebase بشكل صحيح.
// ---------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDeg6RBNC9bWw1QYxBkYtCuMMFPBzxpw4o",
  authDomain: "studio-6422025604-b97aa.firebaseapp.com",
  projectId: "studio-6422025604-b97aa",
  storageBucket: "studio-6422025604-b97aa.firebasestorage.app",
  messagingSenderId: "599267399266",
  appId: "1:599267399266:web:329e49e24298af60f5e33b",
};

let messaging = null;

try {
  if (typeof firebase === "undefined") {
    throw new Error(
      "لم يتم تحميل مكتبة firebase (تحقق من نجاح importScripts أعلاه)."
    );
  }

  // *** هذا هو الإصلاح الجوهري: تهيئة التطبيق قبل استخدام أي خدمة ***
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  messaging = firebase.messaging();
} catch (err) {
  console.error(
    "[firebase-messaging-sw.js] فشل تهيئة Firebase Messaging:",
    err
  );
}

// ---------------------------------------------------------------
// Background Messages
// ---------------------------------------------------------------
if (messaging) {
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

    // *** استخدام registration.showNotification() حصرياً (وليس new Notification) ***
    // هذا هو المسار الوحيد المسموح به من داخل Service Worker أصلاً، وهو أيضاً
    // ما يُصلح مشكلة عدم ظهور الإشعار المرئي رغم سماع الصوت على متصفحات الأندرويد.
    return self.registration.showNotification(title, notificationOptions);
  });
} else {
  console.warn(
    "[firebase-messaging-sw.js] لن تصل إشعارات الخلفية لأن Messaging لم تُهيَّأ."
  );
}

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
