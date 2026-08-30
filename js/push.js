// ===============================================================
// Firebase Cloud Messaging - Push Notifications
// ===============================================================

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getMessaging,
  getToken,
  onMessage,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

// ---------------------------------------------------------------
// Firebase Configuration
// ---------------------------------------------------------------
// ⚠️ استبدل القيم التالية بإعدادات مشروع Firebase الفعلية
// Firebase Console → Project settings → Your apps → Web app
// ---------------------------------------------------------------

const firebaseConfig = {
  apiKey: "AIzaSyDeg6RBNC9bWw1QYxBkYtCuMMFPBzxpw4o",
  authDomain: "studio-6422025604-b97aa.firebaseapp.com",
  projectId: "studio-6422025604-b97aa",
  storageBucket: "studio-6422025604-b97aa.firebasestorage.app",
  messagingSenderId: "599267399266",
  appId: "1:599267399266:web:329e49e24298af60f5e33b"
};

// ---------------------------------------------------------------
// VAPID PUBLIC KEY
// ---------------------------------------------------------------

const VAPID_KEY =
  "BAxTu3HSXPEgeTyTRPoXvpkLQWu8llJQfsPEoUr0MDjHKRJ0VSzPFcJw5RFv-s6BTnZYeWEHW8NSQzAjfOxo";

// ---------------------------------------------------------------
// Firebase Initialization
// ---------------------------------------------------------------

let firebaseApp = null;
let messaging = null;

try {
  firebaseApp = getApps().length
    ? getApps()[0]
    : initializeApp(firebaseConfig);

  messaging = getMessaging(firebaseApp);
} catch (error) {
  console.error("[FCM] Firebase initialization failed:", error);
}

// ---------------------------------------------------------------
// Service Worker Registration
// ---------------------------------------------------------------

let firebaseServiceWorkerRegistration = null;

async function registerFirebaseServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker غير مدعوم في هذا المتصفح.");
  }

  if (!window.isSecureContext) {
    throw new Error(
      "إشعارات Firebase Web تتطلب HTTPS أو localhost."
    );
  }

  // نستخدم ملف Firebase المخصص
  firebaseServiceWorkerRegistration =
    await navigator.serviceWorker.register(
      "./firebase-messaging-sw.js",
      {
        scope: "./",
      }
    );

  await navigator.serviceWorker.ready;

  return firebaseServiceWorkerRegistration;
}

// ---------------------------------------------------------------
// Enable Push Notifications
// ---------------------------------------------------------------

export async function enablePushNotifications(userId = null) {
  try {
    if (!messaging) {
      throw new Error("Firebase Messaging غير مهيأ.");
    }

    if (!("Notification" in window)) {
      throw new Error("هذا المتصفح لا يدعم الإشعارات.");
    }

    if (!("serviceWorker" in navigator)) {
      throw new Error("Service Worker غير مدعوم.");
    }

    if (!window.isSecureContext) {
      throw new Error(
        "يجب تشغيل الموقع عبر HTTPS لتفعيل الإشعارات."
      );
    }

    // -----------------------------------------------------------
    // Request Notification Permission
    // -----------------------------------------------------------

    let permission = Notification.permission;

    if (permission !== "granted") {
      permission = await Notification.requestPermission();
    }

    if (permission !== "granted") {
      console.warn("[FCM] Notification permission denied.");
      return false;
    }

    // -----------------------------------------------------------
    // Register Firebase Messaging Service Worker
    // -----------------------------------------------------------

    const registration =
      await registerFirebaseServiceWorker();

    // -----------------------------------------------------------
    // Get FCM Token
    // -----------------------------------------------------------

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      console.warn(
        "[FCM] لم يتم الحصول على FCM Token."
      );
      return false;
    }

    console.log("[FCM] FCM Token:", token);

    // -----------------------------------------------------------
    // Save Token
    // -----------------------------------------------------------

    localStorage.setItem(
      "fcm_token",
      token
    );

    if (userId) {
      localStorage.setItem(
        "fcm_user_id",
        String(userId)
      );
    }

    // -----------------------------------------------------------
    // Optional: Save token to your backend
    // -----------------------------------------------------------
    //
    // إذا كان لديك جدول fcm_tokens في Supabase يمكنك تفعيل
    // الكود التالي.
    //
    // const { error } = await supabase
    //   .from("fcm_tokens")
    //   .upsert({
    //     user_id: userId,
    //     token,
    //     platform: "web",
    //     updated_at: new Date().toISOString(),
    //   }, {
    //     onConflict: "token",
    //   });
    //
    // if (error) console.error(error);
    //
    // -----------------------------------------------------------

    return true;

  } catch (error) {
    console.error(
      "[FCM] enablePushNotifications:",
      error
    );

    return false;
  }
}

// ---------------------------------------------------------------
// Disable Push Notifications
// ---------------------------------------------------------------

export async function disablePushNotifications() {
  try {
    localStorage.removeItem("fcm_token");
    localStorage.removeItem("fcm_user_id");

    console.log("[FCM] تم تعطيل الإشعارات محليًا.");

    return true;
  } catch (error) {
    console.error(
      "[FCM] disablePushNotifications:",
      error
    );

    return false;
  }
}

// ---------------------------------------------------------------
// Foreground Messages
// ---------------------------------------------------------------

export function listenForForegroundMessages({
  onNotification = null,
  soundUrl = "./sounds/notification.mp3",
} = {}) {

  if (!messaging) {
    console.warn(
      "[FCM] Messaging غير مهيأ."
    );
    return () => {};
  }

  return onMessage(
    messaging,
    async (payload) => {

      console.log(
        "[FCM] Foreground message:",
        payload
      );

      // ---------------------------------------------------------
      // Notification Data
      // ---------------------------------------------------------

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

      // ---------------------------------------------------------
      // Play Sound
      // ---------------------------------------------------------

      try {
        const audio = new Audio(soundUrl);

        audio.volume = 1;

        await audio.play().catch(() => {
          console.warn(
            "[FCM] تشغيل الصوت التلقائي محظور من المتصفح."
          );
        });
      } catch (error) {
        console.warn(
          "[FCM] Audio error:",
          error
        );
      }

      // ---------------------------------------------------------
      // Optional Browser Notification
      // ---------------------------------------------------------

      if (
        Notification.permission === "granted" &&
        document.visibilityState === "visible"
      ) {
        try {
          const notificationObject =
            new Notification(title, {
              body,
              icon: "./icon.png",
              badge: "./icon.png",
              tag: "whatsapp-web-message",
              data,
            });

          notificationObject.onclick = () => {
            window.focus();

            if (data.conversationId) {
              window.location.hash = "chat";
            }

            notificationObject.close();
          };
        } catch (error) {
          console.warn(
            "[FCM] Browser notification error:",
            error
          );
        }
      }

      // ---------------------------------------------------------
      // Callback
      // ---------------------------------------------------------

      if (typeof onNotification === "function") {
        onNotification({
          payload,
          title,
          body,
          data,
        });
      }
    }
  );
}

// ---------------------------------------------------------------
// Get Current Token
// ---------------------------------------------------------------

export function getCurrentFcmToken() {
  return localStorage.getItem("fcm_token");
}

// ---------------------------------------------------------------
// Export Messaging Instance
// ---------------------------------------------------------------

export { messaging };
