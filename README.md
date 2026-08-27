# تطبيق المحادثات (WhatsApp-style PWA) — دليل الإعداد

## 1. إعداد Supabase
1. أنشئ مشروعاً جديداً على https://supabase.com
2. اذهب إلى **SQL Editor** وشغّل محتوى الملف `sql/schema.sql` بالكامل. هذا سينشئ:
   - جداول: `profiles`, `conversations`, `messages`, `message_reactions`, `typing_status`
   - سياسات RLS تضمن أن كل طرف يرى محادثاته فقط
   - Trigger تلقائي ينشئ صف `profiles` عند التسجيل، ويحدد `is_admin` تلقائياً بمطابقة البريد مع القائمة الثابتة
   - Buckets تخزين: `avatars`, `attachments`, `wallpapers`
3. من **Settings > API** انسخ:
   - `Project URL` → ضعه في `js/config.js` باسم `SUPABASE_URL`
   - `anon public key` → ضعه في `js/config.js` باسم `SUPABASE_ANON_KEY`
4. من **Authentication > Providers** تأكد أن تسجيل الدخول بالبريد/كلمة المرور مُفعّل.
   (اختياري) عطّل "Confirm email" أثناء التطوير لتسريع الاختبار.
5. من **Database > Replication** تأكد أن الجداول `messages`, `typing_status`, `profiles`,
   `message_reactions` مضافة إلى `supabase_realtime` (السكربت يفعل هذا تلقائياً).

## 2. تشغيل التطبيق محلياً
التطبيق Vanilla JS بدون build step — يكفي خادم استاتيكي بسيط:

```bash
cd wa-app
python3 -m http.server 8080
# افتح http://localhost:8080
```

> ملاحظة: وحدات ES Modules (`type="module"`) لا تعمل من `file://` مباشرة، يجب تقديمها عبر خادم HTTP.

## 3. أيقونات وصوت الإشعار
المجلد `icons/` يحتاج منك إضافة:
- `icon-192.png` و `icon-512.png` (أيقونة التطبيق لتثبيت PWA)
- `notify.mp3` (صوت إشعار الرسائل الجديدة)

هذه ملفات ثنائية لم يتم توليدها هنا — أضف ملفاتك الخاصة بنفس الأسماء.

## 4. نشر التطبيق (Deploy)
يعمل على أي استضافة استاتيكة: Vercel, Netlify, GitHub Pages, Cloudflare Pages.
فقط ارفع محتوى مجلد `wa-app/` كما هو (تأكد أن `manifest.json` و `service-worker.js` في الجذر).

## 5. ما تم تنفيذه في هذا الإصدار
- تسجيل/دخول عبر البريد وكلمة المرور + حفظ الاسم في `profiles`
- توجيه حسب الدور: مستخدم عادي يرى المشرفين الستة، والمشرف يرى بقية المشرفين + محادثاته
- رسائل فورية عبر Supabase Realtime
- مؤشر "يكتب الآن..."
- حالات الرسالة: أُرسلت / وصلت / قُرئت (صح رمادي وصحين أزرق)
- عداد الرسائل غير المقروءة كشارة خضراء
- حالة الاتصال (متصل الآن) عبر Presence
- دعم عربي/إنجليزي مع تبديل RTL/LTR فوري
- وضع داكن/فاتح بألوان واتساب الرسمية
- رفع صورة شخصية وخلفية دردشة مخصصة
- إرسال صور وملفات كمرفقات
- منتقي إيموجي سريع
- PWA قابل للتثبيت + Service Worker لتخزين الواجهة (App Shell) للعمل شبه دون اتصال

## 6. المرحلة التالية (لم تُبنَ بعد — يمكن إضافتها عند الطلب)
- تسجيل وإرسال رسائل صوتية (Voice Notes) مع مشغل مخصص
- تفاعلات الإيموجي فوق كل رسالة + الرد باقتباس (Quote Reply) والسحب للرد
- تخزين كامل للمحادثات في IndexedDB مع مزامنة تلقائية عند عودة الاتصال
- Web Push Notifications الحقيقية (تتطلب سيرفر إشعارات/VAPID keys منفصل عن Supabase)
- بحث فعلي داخل قائمة المحادثات (الحقل موجود شكلياً فقط حالياً)
