/** What differs between the fleet's web applications on the client side. */
export const APP = {
  title: { en: 'SME Onboarding Portal', ar: 'بوابة تسجيل المنشآت' },
  listTitle: { en: 'SMEs', ar: 'المنشآت' },
  searchHint: { en: 'Search by SME name, CR number or SME id', ar: 'ابحث باسم المنشأة أو رقم السجل التجاري أو معرّف المنشأة' },
  columns: ['id', 'name', 'cr_number', 'owner_name', 'sector_code', 'region_code', 'loan_count'],
  reportRoles: ['manager', 'admin'],
  adminRoles: ['admin'],
} as const;
