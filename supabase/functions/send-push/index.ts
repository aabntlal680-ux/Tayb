import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { JWT } from "https://esm.sh/google-auth-library@8.7.0";

// ---------------------------------------------------------------
// 1. Firebase Service Account Config (مباشرة من الملف)
// ---------------------------------------------------------------
const FIREBASE_PROJECT_ID = "studio-6422025604-b97aa";
const FIREBASE_CLIENT_EMAIL = "firebase-adminsdk-fbsvc@studio-6422025604-b97aa.iam.gserviceaccount.com";
const FIREBASE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC8cFm7JzC5dZIz
un5W0HKNjITyoP1ZsVctb7YCOMBUoLoh5EGooG4qlf8sQvXLPIm8GMLXEnv4tsaI
lLXAcmQ4M0wKwZEJSNMa5bcac+qSlWEIJLTtrl7uN6hI66k6tEeLWm3q2x/I301m
XHdw5ZNi4Hx9mIniIjeLNu1nj/jQrOACvZ1IcG1ZiN2Ismljez0iyDj3wBIwghKs
EJ80WXltIzHsV4jHqwe2vabWg5o3z2727MlRnI/1QhtgbkZtq/MJoJuACm/cVGw9
FRN4gwr+5EmMAIxj72q/E4ZWydbzDi+FO7rthZONkvYjwZzLFY3ZDX0IU2DGqCtN
WjT7Ok+PAgMBAAECggEAEISlYPyk+UTfSC3gtZnNHi+uAcTEoJr6jNmTh1X+igyS
ybYZXqo9g08lu0qyrW+aP++duL5T5AVFmaMLhu9Kw2BqbzDw6/Ltym2jjivmE+uz
Qe78ddnzVAdzTCfC7F9G5uYfkixGI39rk1L8sgagflTg+h4nzAz6zcxxUBg0k+TE
t1Bj7u+TWzICLMtwI/rGHL3wm/NjVuhcFmoF0c8Go+tPMaYugs44rkAfCewfkaV0
1Wf1I4WChLrPfdAwdKxAMm9P8kexyGgdItl0v9tsVZhcI+xuXTUrHy4sb1fstPxz
P33vnJkXk7Jvr7/H0QxYz1MdbTJdkPllOwdj02WJMQKBgQD6WyhX7cRz9s4q0hOh
CbBuswhiEilc/uPrr66dwbMW4hq16sKCgTE/RkmV7CY0KYGJ/sgdxHO9WJHrWXYv
Ktme4XB3iy6n3xpnKFeonOXaJAG9M6fPLOQ7tsBaWYdZ4Wj4tlTYeA6GobiDNrqF
mg9aGzQlWTOHsWxetaB5IL2ZPwKBgQDAr9wCV0yuPg+b4lwqZ7qgWfxthUDxcWn4
fQFoV1Fz0/2N5ksn/okEKwzAZdiCJcHrWQekv84C7btAWJ7Z8Vau2q4KSs3zC9NC
K1+JQ8bkYt0u0c+6gWLaDXGaNkwxfwIA6c8bNO41U3GqxpwHKhC3tCNL5BpPg1Ul
Tb9igHLlsQKBgQDgrXRsTN7Ub3cgqL2i9S4YeqWYVdI3OizTtCuSOmZ9r9bm0dNU
CZtnvK2HVZIHmARAEp4HUOnJ0LXLr9LHi74XvxwOvKLXVvq7/1GD6aLB/TRuVvBP
lmsRR/YiX1yABjINmpxUVJI8suADKdeE1PjYFbfbmM0NBuZJrNhiPEbLQwKBgDg9
G8GzKTZR9sxQrQXTcK0MlpiApAvURlG4aojBs4xS+1ZHOPhbWjJVPkuJbj/ONWMz
gP+c28wPBvAo7XQ+9EXknZdzbdjaQra1YhT2Kz7NfDEGG9MboHZ0JgwUfPiVUUhi
9YfDUyNNT4fAoBmXNXnoocSstuEuO9O/dXSSePaBAoGBAMItOxE80wrAqXWeF139
J5n0t13cpT/VP8xC6d/IFNxASfjN9JBVUlEkL/woJiyno5yCkO7OLwaI4T/Z340D
IgDLA8f8NMrmlQsyiq8fD0qx7SsxPBWLjQ64GprIfbg27Xw2zsSWzT32nTbP4lvA
VCfIpNbLfUQuK0M5Pvp3BSvT
-----END PRIVATE KEY-----`;

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
                          const payload = await req.json();
                              const record = payload.record;

                                  if (!record || !record.receiver_id || !record.content) {
                                        return new Response(JSON.stringify({ message: "بيانات غير مكتملة" }), { status: 400 });
                                            }

                                                const receiverId = record.receiver_id;
                                                    const messageContent = record.content;
                                                        const conversationId = record.conversation_id || "";

                                                            // -----------------------------------------------------------
                                                                // 4. جلب FCM Token للمستلم من Supabase
                                                                    // -----------------------------------------------------------
                                                                        const supabaseUrl = "https://eqzmvhwyfpoopqascgox.supabase.co";
                                                                            const supabaseServiceKey = Deno.env.get("SERVICE_KEY") || "";
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
                                                                                                                                  // 5. إرسال الإشعار عبر FCM HTTP v1
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
                                                                                                                                                                                                                                                                                                                                                                                                              
