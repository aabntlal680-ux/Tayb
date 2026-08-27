// ============================================================
// إعدادات الاتصال — عدّل القيم التالية بمعلومات مشروعك في Supabase
// ============================================================
export const SUPABASE_URL = "https://ludoyidbumhzomjotrqc.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1ZG95aWRidW1oem9tam90cnFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MTA0MzIsImV4cCI6MjEwMzA4NjQzMn0.PR7qnskKcXWgjN9Y-1IBqAu8URm348sXeCPMCIo9mDA";

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
