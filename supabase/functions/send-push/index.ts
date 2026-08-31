import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { JWT } from "https://esm.sh/google-auth-library@8.7.0";

// ---------------------------------------------------------------
// 1. Firebase Service Account Config (من متغيرات البيئة)
// ---------------------------------------------------------------
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const FIREBASE_CLIENT_EMAIL = Deno.env.get("FIREBASE_CLIENT_EMAIL")!;
// استبدال أسطر الـ Private Key الجديدة (\n)
const FIREBASE_PRIVATE_KEY = Deno.env.get("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n")!;

// ---------------------------------------------------------------
// 2. توليد Access Token لـ Firebase HTTP v1 API
// ---------------------------------------------------------------
async function getAccessToken(): Promise<string> {
  const client = new JWT({
    email: FIREBASE_CLIENT_EMAIL,
    key: FIREBASE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });

  const tokens = await client.authorize();
  return tokens.access_token!;
}

// ---------------------------------------------------------------
// 3. معالج الطلبات الرئيسي
// ---------------------------------------------------------------
serve(async (req) => {
  try {
    // التحقق من صحة الطلب والقراءة
    const payload = await req.json();
    const record = payload.record; // السطر الجديد المضاف في جدول messages

    if (!record || !record.receiver_id || !record.content) {
      return new Response(JSON.stringify({ message: "بيانات غير مكتملة" }), { status: 400 });
    }

    const receiverId = record.receiver_id;
    const messageContent = record.content;
    const conversationId = record.conversation_id || "";

    // -----------------------------------------------------------
    // 4. جلب FCM Token للمستلم من Supabase
    // -----------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: tokensData, error: tokenError } = await supabase
      .from("fcm_tokens")
      .select("token")
      .eq("user_id", receiverId);

    if (tokenError || !tokensData || tokensData.length === 0) {
      console.log(`لا يوجد FCM Token للمستخدم: ${receiverId}`);
      return new Response(JSON.stringify({ message: "لم يتم العثور على توكن للمستلم" }), { status: 200 });
    }

    // -----------------------------------------------------------
    // 5. إرسال الإشعار لجميع أجهزة المستلم عبر FCM HTTP v1
    // -----------------------------------------------------------
    const accessToken = await getAccessToken();
    const fcmEndpoint = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;

    const sendPromises = tokensData.map(async ({ token }) => {
      const fcmPayload = {
        message: {
          token: token,
          notification: {
            title: "رسالة جديدة 💬",
            body: messageContent,
          },
          data: {
            conversationId: String(conversationId),
            senderId: String(record.sender_id || ""),
          },
        },
      };

      const response = await fetch(fcmEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(fcmPayload),
      });

      return response.json();
    });

    const results = await Promise.all(sendPromises);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("خطأ أثناء إرسال الإشعار:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
