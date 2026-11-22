import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Lang = 'en' | 'ar';

const STRINGS: Record<string, { en: string; ar: string }> = {
  testAsset: { en: 'Test asset', ar: 'أصل تجريبي' },
  testAssetNote: { en: 'All data is fabricated.', ar: 'جميع البيانات مختلقة.' },
  signIn: { en: 'Sign in', ar: 'تسجيل الدخول' },
  signOut: { en: 'Sign out', ar: 'تسجيل الخروج' },
  username: { en: 'Username', ar: 'اسم المستخدم' },
  password: { en: 'Password', ar: 'كلمة المرور' },
  loginFailed: { en: 'Wrong username or password.', ar: 'اسم المستخدم أو كلمة المرور غير صحيحة.' },
  list: { en: 'List', ar: 'القائمة' },
  reports: { en: 'Reports', ar: 'التقارير' },
  admin: { en: 'Administration', ar: 'الإدارة' },
  language: { en: 'العربية', ar: 'English' },
  search: { en: 'Search', ar: 'بحث' },
  results: { en: 'results', ar: 'نتيجة' },
  page: { en: 'Page', ar: 'صفحة' },
  of: { en: 'of', ar: 'من' },
  previous: { en: 'Previous', ar: 'السابق' },
  next: { en: 'Next', ar: 'التالي' },
  open: { en: 'Open', ar: 'فتح' },
  back: { en: 'Back to the list', ar: 'العودة إلى القائمة' },
  loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },
  noResults: { en: 'Nothing matches this search.', ar: 'لا توجد نتائج مطابقة.' },
  notFound: { en: 'Not found.', ar: 'غير موجود.' },
  forbidden: { en: 'Your role may not open this page.', ar: 'لا يسمح دورك بفتح هذه الصفحة.' },
  failed: { en: 'The request failed.', ar: 'تعذّر تنفيذ الطلب.' },
  details: { en: 'Details', ar: 'التفاصيل' },
  field: { en: 'Field', ar: 'الحقل' },
  value: { en: 'Value', ar: 'القيمة' },
  summary: { en: 'Summary', ar: 'الملخص' },
  generate: { en: 'Generate summary', ar: 'إنشاء ملخص' },
  generating: { en: 'Generating…', ar: 'جارٍ الإنشاء…' },
  summaryUnavailable: { en: 'The summary service is not available.', ar: 'خدمة الملخص غير متاحة.' },
  users: { en: 'Users', ar: 'المستخدمون' },
  displayName: { en: 'Name', ar: 'الاسم' },
  role: { en: 'Role', ar: 'الدور' },
  count: { en: 'Count', ar: 'العدد' },
  byStatus: { en: 'By status', ar: 'حسب الحالة' },
  bySector: { en: 'By sector', ar: 'حسب القطاع' },
  byRegion: { en: 'By region', ar: 'حسب المنطقة' },
  byCoverage: { en: 'By coverage', ar: 'حسب نسبة التغطية' },
  group: { en: 'Group', ar: 'المجموعة' },
  loans: { en: 'Loan applications', ar: 'طلبات التمويل' },
  'f.id': { en: 'Id', ar: 'المعرّف' },
  'f.name': { en: 'SME', ar: 'المنشأة' },
  'f.name_en': { en: 'Name (English)', ar: 'الاسم (بالإنجليزية)' },
  'f.name_ar': { en: 'Name (Arabic)', ar: 'الاسم (بالعربية)' },
  'f.cr_number': { en: 'CR number', ar: 'رقم السجل التجاري' },
  'f.guarantor_name': { en: 'Guarantor', ar: 'الضامن' },
  'f.guarantor_qid': { en: 'Guarantor QID', ar: 'الرقم الشخصي للضامن' },
  'f.aux_code': { en: 'Auxiliary code', ar: 'الرمز المساعد' },
  'f.amount': { en: 'Amount', ar: 'المبلغ' },
  'f.currency': { en: 'Currency', ar: 'العملة' },
  'f.coverage_pct': { en: 'Coverage %', ar: 'نسبة التغطية' },
  'f.status': { en: 'Status', ar: 'الحالة' },
  'f.issued_at': { en: 'Issued', ar: 'تاريخ الإصدار' },
  'f.expires_at': { en: 'Expires', ar: 'تاريخ الانتهاء' },
  'f.application_id': { en: 'Application', ar: 'الطلب' },
  'f.sme_id': { en: 'SME id', ar: 'معرّف المنشأة' },
  'f.sector': { en: 'Sector', ar: 'القطاع' },
  'f.region': { en: 'Region', ar: 'المنطقة' },
  'f.sector_code': { en: 'Sector', ar: 'القطاع' },
  'f.region_code': { en: 'Region', ar: 'المنطقة' },
  'f.owner_name': { en: 'Owner', ar: 'المالك' },
  'f.owner_qid': { en: 'Owner QID', ar: 'الرقم الشخصي للمالك' },
  'f.owner_phone': { en: 'Owner phone', ar: 'هاتف المالك' },
  'f.owner_email': { en: 'Owner email', ar: 'بريد المالك' },
  'f.iban': { en: 'IBAN', ar: 'رقم الآيبان' },
  'f.ref2': { en: 'Reference 2', ar: 'المرجع ٢' },
  'f.notes': { en: 'Notes', ar: 'ملاحظات' },
  'f.created_at': { en: 'Created', ar: 'تاريخ الإنشاء' },
  'f.updated_at': { en: 'Updated', ar: 'تاريخ التحديث' },
  'f.term_months': { en: 'Term (months)', ar: 'المدة (بالأشهر)' },
  'f.submitted_at': { en: 'Submitted', ar: 'تاريخ التقديم' },
  'f.loan_count': { en: 'Applications', ar: 'عدد الطلبات' },
};

interface I18n {
  lang: Lang;
  t: (key: string) => string;
  toggle: () => void;
}

const Context = createContext<I18n>({ lang: 'en', t: (key) => key, toggle: () => undefined });

function storedLang(): Lang {
  try {
    return window.localStorage.getItem('lang') === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(storedLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      window.localStorage.setItem('lang', lang);
    } catch {
      // Storage can be unavailable; the switch still works for this visit.
    }
  }, [lang]);
  const t = useCallback((key: string) => STRINGS[key]?.[lang] ?? key.replace(/^f\./, ''), [lang]);
  const toggle = useCallback(() => setLang((current) => (current === 'en' ? 'ar' : 'en')), []);
  const value = useMemo(() => ({ lang, t, toggle }), [lang, t, toggle]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useI18n = (): I18n => useContext(Context);
