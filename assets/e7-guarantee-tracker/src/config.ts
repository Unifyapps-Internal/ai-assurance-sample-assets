/** What differs between the fleet's web applications on the client side. */
export const APP = {
  title: { en: 'Guarantee Tracker', ar: 'متابعة الضمانات' },
  listTitle: { en: 'Guarantees', ar: 'الضمانات' },
  searchHint: { en: 'Search by SME name (English or Arabic), guarantor, CR number or guarantee id', ar: 'ابحث باسم المنشأة (بالعربية أو الإنجليزية) أو الضامن أو رقم السجل التجاري أو رقم الضمان' },
  columns: ['id', 'name', 'guarantor_name', 'amount', 'coverage_pct', 'status', 'expires_at'],
  reportRoles: ['manager', 'admin'],
  adminRoles: ['admin'],
} as const;
