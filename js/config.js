// ============================================================
// إعدادات الاتصال — عدّل القيم التالية بمعلومات مشروعك في Supabase
// ============================================================
export const SUPABASE_URL = "https://gqocavvhhfwgkzscrjms.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxb2NhdnZoaGZ3Z2t6c2Nyam1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MzE2MDMsImV4cCI6MjEwNDIwNzYwM30.x4HxOcAiusptsdflVje61wY8t9IfMOAGsCdUg3pIGaQ";

export const VAPID_PUBLIC_KEY = "BAxTu3HSXPEgeTyTRPoXvpkLQWu8llJQfsPEoUr0MDjHKRJ0VSzPFcJw5RFv-s6BTnZYeWEHW8NSQzAjfOxoJfo";

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
