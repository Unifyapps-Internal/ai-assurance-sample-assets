/** What differs between the fleet's web applications on the client side. */
export const APP = {
  title: { en: 'RM Workspace', ar: 'مساحة عمل مدير العلاقات' },
  listTitle: { en: 'SME portfolio', ar: 'محفظة المنشآت' },
  searchHint: { en: 'Search by SME name (English or Arabic), owner, CR number or SME id', ar: 'ابحث باسم المنشأة (بالعربية أو الإنجليزية) أو المالك أو رقم السجل التجاري أو معرّف المنشأة' },
  columns: ['id', 'name', 'cr_number', 'owner_name', 'sector_code', 'region_code', 'loan_count', 'amount'],
  reportRoles: ['analyst', 'admin'],
  adminRoles: ['admin'],
} as const;
