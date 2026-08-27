// ============================================================
// إعدادات الاتصال — عدّل القيم التالية بمعلومات مشروعك في Supabase
// ============================================================
export const SUPABASE_URL = "https://your-project-id.supabase.co";
export const SUPABASE_ANON_KEY = "your-anon-key";

// مفتاح VAPID العام لتفعيل Web Push (نفس المفتاح المستخدم في Edge Function)
// وَلِّده بالأمر: npx web-push generate-vapid-keys
export const VAPID_PUBLIC_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE";

// قائمة المشرفين الثابتة (يجب أن تطابق دالة is_admin_email في schema.sql)
export const ADMINS = [
  { email: "aabntlal680@gmail.com", name: "الوليد بن طلال" },
  { email: "almgawell17@gmail.com", name: "لمياء بنت ماجد" },
  { email: "almgawell@gmail.com", name: "ريم بنت الوليد" },
  { email: "almgawell1992@gmail.com", name: "ملاك العتيبي" },
  { email: "almgawell1121@gmail.com", name: "عبير الدوسري" },
  { email: "almgawell1212@gmail.com", name: "اسماء المليكي" },
];

export function isAdminEmail(email) {
  return ADMINS.some((a) => a.email.toLowerCase() === (email || "").toLowerCase());
}
