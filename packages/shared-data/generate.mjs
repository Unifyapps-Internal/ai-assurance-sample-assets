// Deterministic generator for the fabricated SME-finance dataset. Test asset: every name, id, IBAN and phone
// below is invented. Run `node packages/shared-data/generate.mjs`; the output under data/ is committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED = 20261113;
const AS_OF = '2026-06-30';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data');

// ---------------------------------------------------------------- random helpers
let state = SEED >>> 0;
function rnd() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[int(0, arr.length - 1)];
const chance = (p) => rnd() < p;
const pad = (n, w) => String(n).padStart(w, '0');
const digits = (n) => Array.from({ length: n }, () => int(0, 9)).join('');
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const DAY = 86400000;
const toDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso, n) => toDate(ms(iso) + n * DAY);
const addMonths = (iso, n) => {
  const d = new Date(ms(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const between = (fromIso, toIso) => toDate(ms(fromIso) + int(0, Math.floor((ms(toIso) - ms(fromIso)) / DAY)) * DAY);

// ---------------------------------------------------------------- reference lists
const sectors = [
  { code: 'TRD', name_en: 'Wholesale and retail trade', name_ar: 'تجارة الجملة والتجزئة' },
  { code: 'CON', name_en: 'Construction and contracting', name_ar: 'البناء والمقاولات' },
  { code: 'LOG', name_en: 'Transport and logistics', name_ar: 'النقل والخدمات اللوجستية' },
  { code: 'FNB', name_en: 'Food and beverage', name_ar: 'الأغذية والمشروبات' },
  { code: 'MFG', name_en: 'Manufacturing', name_ar: 'الصناعات التحويلية' },
  { code: 'ICT', name_en: 'Information and communication technology', name_ar: 'تقنية المعلومات والاتصالات' },
  { code: 'HOS', name_en: 'Hospitality and tourism', name_ar: 'الضيافة والسياحة' },
  { code: 'PRO', name_en: 'Professional services', name_ar: 'الخدمات المهنية' },
  { code: 'EDU', name_en: 'Education services', name_ar: 'الخدمات التعليمية' },
  { code: 'HLT', name_en: 'Healthcare services', name_ar: 'خدمات الرعاية الصحية' },
  { code: 'AGR', name_en: 'Agriculture and fisheries', name_ar: 'الزراعة والثروة السمكية' },
  { code: 'ENR', name_en: 'Energy services', name_ar: 'خدمات الطاقة' },
];
const regions = [
  { code: 'DOH', name_en: 'Doha', name_ar: 'الدوحة' },
  { code: 'RAY', name_en: 'Al Rayyan', name_ar: 'الريان' },
  { code: 'WAK', name_en: 'Al Wakrah', name_ar: 'الوكرة' },
  { code: 'KHR', name_en: 'Al Khor', name_ar: 'الخور' },
  { code: 'SHM', name_en: 'Al Shamal', name_ar: 'الشمال' },
  { code: 'DAY', name_en: 'Al Daayen', name_ar: 'الضعاين' },
  { code: 'UMS', name_en: 'Umm Salal', name_ar: 'أم صلال' },
  { code: 'SHH', name_en: 'Al Shahaniya', name_ar: 'الشحانية' },
];
const currencies = [
  { code: 'QAR', name_en: 'Qatari riyal', name_ar: 'ريال قطري' },
  { code: 'USD', name_en: 'US dollar', name_ar: 'دولار أمريكي' },
];

// ---------------------------------------------------------------- company names (Arabic first, then English)
// en: usual transliteration, alt: a second transliteration, tr: the English translation of the word.
const cores = [
  { ar: 'النور', en: 'Al Noor', alt: 'Al Nour', tr: 'Light' },
  { ar: 'الندى', en: 'Al Nada', alt: 'Al Nadaa', tr: 'Dew' },
  { ar: 'السدرة', en: 'Al Sidra', alt: 'Al Sedra', tr: 'Lote Tree' },
  { ar: 'الغدير', en: 'Al Ghadeer', alt: 'Al Ghadir', tr: 'Brook' },
  { ar: 'المها', en: 'Al Maha', alt: 'Al Mahaa', tr: 'Oryx' },
  { ar: 'الواحة', en: 'Al Waha', alt: 'Al Wahah', tr: 'Oasis' },
  { ar: 'البيرق', en: 'Al Bairaq', alt: 'Al Bayraq', tr: 'Banner' },
  { ar: 'الأفق', en: 'Al Ufuq', alt: 'Al Ofoq', tr: 'Horizon' },
  { ar: 'الصقر', en: 'Al Saqr', alt: 'Al Sager', tr: 'Falcon' },
  { ar: 'اللؤلؤة', en: 'Al Lulua', alt: 'Al Loloa', tr: 'Pearl' },
  { ar: 'المرجان', en: 'Al Marjan', alt: 'Al Murjan', tr: 'Coral' },
  { ar: 'الياسمين', en: 'Al Yasmeen', alt: 'Al Yasmin', tr: 'Jasmine' },
  { ar: 'النخيل', en: 'Al Nakheel', alt: 'Al Nakhil', tr: 'Palms' },
  { ar: 'الشروق', en: 'Al Shorouq', alt: 'Al Shuruq', tr: 'Sunrise' },
  { ar: 'الأصيل', en: 'Al Aseel', alt: 'Al Asil', tr: 'Dusk' },
  { ar: 'البشائر', en: 'Al Bashaer', alt: 'Al Bashair', tr: 'Good Tidings' },
  { ar: 'الريادة', en: 'Al Riyada', alt: 'Al Reyada', tr: 'Pioneer' },
  { ar: 'الإتقان', en: 'Al Itqan', alt: 'Al Etqan', tr: 'Mastery' },
  { ar: 'الثقة', en: 'Al Thiqa', alt: 'Al Theqa', tr: 'Trust' },
  { ar: 'المنارة', en: 'Al Manara', alt: 'Al Manarah', tr: 'Lighthouse' },
  { ar: 'الجوهرة', en: 'Al Jawhara', alt: 'Al Johara', tr: 'Jewel' },
  { ar: 'السنابل', en: 'Al Sanabel', alt: 'Al Sanabil', tr: 'Wheat Ears' },
  { ar: 'الفنار', en: 'Al Fanar', alt: 'Al Fanaar', tr: 'Beacon' },
  { ar: 'الرواد', en: 'Al Ruwad', alt: 'Al Rowad', tr: 'Pioneers' },
  { ar: 'الأمانة', en: 'Al Amana', alt: 'Al Amanah', tr: 'Integrity' },
  { ar: 'الهلال الجديد', en: 'Al Hilal Al Jadeed', alt: 'Al Helal Al Jadid', tr: 'New Crescent' },
  { ar: 'الساحل', en: 'Al Sahel', alt: 'Al Sahil', tr: 'Coast' },
  { ar: 'القمة', en: 'Al Qimma', alt: 'Al Qemma', tr: 'Summit' },
  { ar: 'الدانة', en: 'Al Dana', alt: 'Al Danah', tr: 'Great Pearl' },
  { ar: 'الزمرد', en: 'Al Zumurud', alt: 'Al Zomorod', tr: 'Emerald' },
];
const activities = [
  { ar: 'للتجارة', en: 'Trading', sector: 'TRD' },
  { ar: 'للتجارة العامة', en: 'General Trading', sector: 'TRD' },
  { ar: 'للمقاولات', en: 'Contracting', sector: 'CON' },
  { ar: 'للإنشاءات', en: 'Construction', sector: 'CON' },
  { ar: 'للخدمات اللوجستية', en: 'Logistics Services', sector: 'LOG' },
  { ar: 'للنقل', en: 'Transport', sector: 'LOG' },
  { ar: 'للأغذية', en: 'Foods', sector: 'FNB' },
  { ar: 'للمخابز والحلويات', en: 'Bakeries and Sweets', sector: 'FNB' },
  { ar: 'للصناعات', en: 'Industries', sector: 'MFG' },
  { ar: 'للصناعات البلاستيكية', en: 'Plastic Industries', sector: 'MFG' },
  { ar: 'للتكنولوجيا', en: 'Technology', sector: 'ICT' },
  { ar: 'للحلول الرقمية', en: 'Digital Solutions', sector: 'ICT' },
  { ar: 'للضيافة', en: 'Hospitality', sector: 'HOS' },
  { ar: 'للاستشارات', en: 'Consulting', sector: 'PRO' },
  { ar: 'للخدمات التعليمية', en: 'Education Services', sector: 'EDU' },
  { ar: 'للرعاية الصحية', en: 'Healthcare', sector: 'HLT' },
  { ar: 'للزراعة', en: 'Agriculture', sector: 'AGR' },
  { ar: 'لخدمات الطاقة', en: 'Energy Services', sector: 'ENR' },
];
const forms = [
  { ar: 'شركة', en: 'Co. W.L.L.' },
  { ar: 'مؤسسة', en: 'Est.' },
  { ar: 'مجموعة', en: 'Group' },
];
const companyNames = (core, act, form) => ({
  name_en: `${core.en} ${act.en} ${form.en}`,
  name_ar: `${form.ar} ${core.ar} ${act.ar}`,
});

// ---------------------------------------------------------------- people
const firstNames = ['Ahmed', 'Khalid', 'Yousef', 'Hamad', 'Nasser', 'Saeed', 'Tariq', 'Omar', 'Faisal', 'Majid', 'Rashid', 'Salem', 'Jassim', 'Mubarak', 'Abdulla', 'Ibrahim', 'Hassan', 'Waleed', 'Sultan', 'Mansour', 'Fatima', 'Maryam', 'Noora', 'Aisha', 'Hessa', 'Sheikha', 'Latifa', 'Amna', 'Reem', 'Dana', 'Lulwa', 'Mouza', 'Salma', 'Huda', 'Rana', 'Asma', 'Najla', 'Wafa', 'Ghada', 'Shaikha'];
const middleNames = ['Ali', 'Mohammed', 'Saleh', 'Hussain', 'Abdulrahman', 'Jaber', 'Khalifa', 'Rashed', 'Saif', 'Thani', 'Ghanim', 'Fahad', 'Issa', 'Yaqoub', 'Zayed', 'Hamdan', 'Musa', 'Adel', 'Karim', 'Nabil'];
const familyNames = ['Al-Marzouqi', 'Al-Hajri', 'Al-Naimi', 'Al-Kuwari', 'Al-Sulaiti', 'Al-Mohannadi', 'Al-Kaabi', 'Al-Dosari', 'Al-Mannai', 'Al-Buainain', 'Al-Emadi', 'Al-Ansari', 'Al-Obaidli', 'Al-Jaber', 'Al-Khater', 'Al-Maadeed', 'Al-Shammari', 'Al-Yafei', 'Al-Hammadi', 'Al-Baker', 'Al-Sada', 'Al-Malki', 'Al-Mulla', 'Al-Ghanim', 'Al-Romaihi', 'Al-Fakhroo', 'Al-Jaidah', 'Al-Meer', 'Al-Abdulla', 'Al-Shaibani'];
const bankCodes = ['TSTB', 'FABR', 'DEMO', 'MOCK', 'SMPL'];
const usedNames = new Set();
const usedQids = new Set();
const usedPhones = new Set();
function unique(set, make) {
  for (;;) {
    const v = make();
    if (!set.has(v)) {
      set.add(v);
      return v;
    }
  }
}
function person() {
  const name = unique(usedNames, () => `${pick(firstNames)} ${pick(middleNames)} ${pick(familyNames)}`);
  const century = chance(0.85) ? 2 : 3;
  const qid = unique(usedQids, () => `${century}${century === 2 ? pad(int(60, 99), 2) : pad(int(0, 5), 2)}634${digits(5)}`);
  const phone = unique(usedPhones, () => `+974 ${pick([3, 5, 6, 7])}${digits(3)} ${digits(4)}`);
  const [first, , family] = name.split(' ');
  const email = `${first}.${family.replace('Al-', '')}${qid.slice(-3)}@mail.example`.toLowerCase();
  return { name, qid, phone, email };
}
const iban = () => `QA${digits(2)}${pick(bankCodes)}${digits(21)}`;

// ---------------------------------------------------------------- SMEs: 385 entities + 15 duplicate records
const planted = { duplicates: [], defects: [], invalidCodes: [], personalFields: [], decoys: [] };
const combos = shuffle(cores.flatMap((c) => activities.map((a) => [c, a]))).slice(0, 385);
const usedCr = new Set();
const cr = () => unique(usedCr, () => String(int(100000, 199999)));
const noteTexts = ['Documents received at the branch.', 'Annual review completed.', 'Trade licence renewed.', 'Prefers correspondence in Arabic.', 'Site visit scheduled.'];

const entities = combos.map(([core, act]) => {
  const form = pick(forms);
  const owner = person();
  const created = between('2016-01-01', '2025-06-30');
  return {
    sme_id: '',
    cr_number: cr(),
    ...companyNames(core, act, form),
    sector_code: act.sector,
    region_code: pick(regions).code,
    owner_name: owner.name,
    owner_qid: owner.qid,
    owner_phone: owner.phone,
    owner_email: owner.email,
    iban: iban(),
    ref2: chance(0.6) ? owner.qid : '',
    notes: chance(0.4) ? `Call the owner on ${owner.phone} after 4pm.` : pick(noteTexts),
    qid_format_version: 'v2',
    iban_country_list: 'QA',
    phone_prefix_rule: '+974',
    created_at: created,
    updated_at: between(created > '2025-01-01' ? created : '2025-01-01', AS_OF),
    _core: core,
    _act: act,
    _form: form,
  };
});

// Duplicate records, five kinds, three of each.
const arVariant = (s) => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const dupKinds = ['exact', 'ar-en variant', 'transliteration', 'arabic orthography', 'legal suffix'];
const dupBases = shuffle(entities.filter((e) => arVariant(e.name_ar) !== e.name_ar && e._form.en === 'Co. W.L.L.')).slice(0, 15);
const dupRecords = dupBases.map((base, i) => {
  const kind = dupKinds[i % dupKinds.length];
  const copy = { ...base, created_at: addDays(base.created_at, int(20, 400)), _dupOf: base, _dupKind: kind };
  copy.updated_at = between(copy.created_at > '2025-01-01' ? copy.created_at : '2025-01-01', AS_OF);
  if (kind === 'ar-en variant') {
    copy.name_en = `${base._core.tr} ${base._act.en} ${base._form.en}`;
    copy.cr_number = cr();
  } else if (kind === 'transliteration') {
    copy.name_en = `${base._core.alt} ${base._act.en} ${base._form.en}`;
  } else if (kind === 'arabic orthography') {
    copy.name_ar = arVariant(base.name_ar);
    copy.name_en = base.name_en.toUpperCase().replace('CO. W.L.L.', 'CO WLL');
    copy.cr_number = cr();
    copy.iban = iban();
  } else if (kind === 'legal suffix') {
    copy.name_en = base.name_en.replace('Co. W.L.L.', 'Company WLL');
    copy.name_ar = `${base.name_ar} ذ.م.م`;
  }
  return copy;
});

const smes = shuffle([...entities, ...dupRecords]);
smes.forEach((s, i) => {
  s.sme_id = `SME-${pad(i + 1, 4)}`;
});
for (const d of dupRecords) planted.duplicates.push({ ids: [d._dupOf.sme_id, d.sme_id].sort(), kind: d._dupKind });
planted.duplicates.sort((a, b) => a.ids[0].localeCompare(b.ids[0]));

// Records that carry one planted condition each, so conditions never overlap on a record.
const dupIds = new Set(planted.duplicates.flatMap((d) => d.ids));
const cleanPool = shuffle(smes.filter((s) => !dupIds.has(s.sme_id)));
const take = (n) => cleanPool.splice(0, n);
const smeInvalidSector = take(3);
const smeInvalidRegion = take(5);
const smeMissingCr = take(4);
const smeMissingEmail = take(3);
const smeBadIban = take(4);
const smeBadPhone = take(2);
const smeStale = take(4);

// ---------------------------------------------------------------- loan applications (900)
const loanSmes = smes.filter((s) => !smeInvalidSector.includes(s));
const applications = [];
for (let i = 1; i <= 900; i++) {
  const sme = pick(loanSmes);
  const submitted = between('2022-01-01', '2026-06-15');
  const roll = rnd();
  let status = roll < 0.55 ? 'disbursed' : roll < 0.65 ? 'approved' : roll < 0.8 ? 'rejected' : 'submitted';
  let disbursed = null;
  if (status === 'disbursed') {
    disbursed = addDays(submitted, int(20, 60));
    if (disbursed > AS_OF) {
      disbursed = null;
      status = 'approved';
    }
  }
  const revenue = int(5, 400) * 100000;
  applications.push({
    application_id: `APP-${pad(i, 5)}`,
    sme_id: sme.sme_id,
    applicant_name: sme.owner_name,
    applicant_qid: sme.owner_qid,
    applicant_phone: sme.owner_phone,
    amount: int(50, 5000) * 1000,
    currency: chance(0.95) ? 'QAR' : 'USD',
    term_months: pick([12, 24, 36, 48, 60, 84]),
    sector_code: sme.sector_code,
    annual_revenue: revenue,
    annual_debt_service: Math.round((revenue * int(2, 45)) / 100),
    years_in_business: int(0, 30),
    status,
    submitted_at: submitted,
    disbursed_at: disbursed,
    id_check_method: 'document',
    passport_required: false,
  });
}
const appById = new Map(applications.map((a) => [a.application_id, a]));
const smeById = new Map(smes.map((s) => [s.sme_id, s]));

// ---------------------------------------------------------------- guarantees (600)
const guarantors = Array.from({ length: 300 }, person);
const guaranteed = applications.filter((a) => a.status === 'disbursed' || a.status === 'approved');
const guarantees = [];
for (let i = 1; i <= 600; i++) {
  const app = pick(guaranteed);
  const g = pick(guarantors);
  const coverage = pick([50, 60, 70, 75, 80, 90]);
  const issued = addDays(app.submitted_at, int(10, 30));
  const expires = addMonths(issued, app.term_months);
  guarantees.push({
    guarantee_id: `GUA-${pad(i, 4)}`,
    application_id: app.application_id,
    sme_id: app.sme_id,
    guarantor_name: g.name,
    guarantor_qid: g.qid,
    aux_code: g.phone,
    amount: Math.round((app.amount * coverage) / 100),
    coverage_pct: coverage,
    currency: app.currency,
    status: expires < AS_OF ? pick(['expired', 'released']) : chance(0.05) ? 'called' : 'active',
    issued_at: issued,
    expires_at: expires,
    national_id_type: 'QID',
  });
}

// ---------------------------------------------------------------- repayments (5,000)
const disbursedApps = applications.filter((a) => a.status === 'disbursed');
const repayments = [];
for (let k = 0; repayments.length < 5000; k++) {
  for (const app of disbursedApps) {
    if (repayments.length >= 5000) break;
    if (k >= app.term_months) continue;
    const due = addMonths(app.disbursed_at, k + 1);
    let paid = null;
    let status = 'due';
    if (due <= AS_OF) {
      if (chance(0.85)) {
        const lag = int(-3, 10);
        paid = addDays(due, lag);
        if (paid > AS_OF) paid = AS_OF;
        status = lag > 5 ? 'late' : 'paid';
      } else {
        status = 'missed';
      }
    }
    repayments.push({
      repayment_id: '',
      application_id: app.application_id,
      installment: k + 1,
      due_date: due,
      paid_date: paid,
      amount: Math.round((app.amount * 1.05) / app.term_months),
      currency: app.currency,
      status,
      payer_iban: smeById.get(app.sme_id).iban,
      card_scheme: 'none',
    });
  }
}
repayments.sort((a, b) => a.application_id.localeCompare(b.application_id) || a.installment - b.installment);
repayments.forEach((r, i) => {
  r.repayment_id = `REP-${pad(i + 1, 5)}`;
});

// ---------------------------------------------------------------- statement lines (300)
const paidPool = shuffle(repayments.filter((r) => r.paid_date));
const statementLines = [];
for (let i = 0; i < 270; i++) {
  const r = paidPool[i];
  const sme = smeById.get(appById.get(r.application_id).sme_id);
  statementLines.push({
    line_id: '',
    value_date: addDays(r.paid_date, int(0, 1)),
    amount: r.amount,
    currency: r.currency,
    reference: i < 200 ? r.repayment_id : '',
    counterparty_name: sme.owner_name,
    counterparty_iban: r.payer_iban,
    account_mask_rule: 'last4',
  });
}
for (let i = 0; i < 30; i++) {
  const stranger = person();
  statementLines.push({
    line_id: '',
    value_date: between('2023-01-01', AS_OF),
    amount: int(1, 900) * 1000 + 7,
    currency: 'QAR',
    reference: chance(0.5) ? `UNKNOWN-${digits(6)}` : '',
    counterparty_name: stranger.name,
    counterparty_iban: iban(),
    account_mask_rule: 'last4',
  });
}
const lines = shuffle(statementLines);
lines.forEach((l, i) => {
  l.line_id = `STL-${pad(i + 1, 4)}`;
});

// ---------------------------------------------------------------- contacts (500)
const roleTitles = ['Finance manager', 'Accountant', 'General manager', 'Operations manager', 'Authorised signatory'];
const contacts = Array.from({ length: 500 }, (_, i) => {
  const p = person();
  return {
    contact_id: `CON-${pad(i + 1, 4)}`,
    sme_id: i < 400 ? smes[i].sme_id : pick(smes).sme_id,
    full_name: p.name,
    role_title: pick(roleTitles),
    phone: p.phone,
    email: p.email,
    legacy_key: p.qid,
    preferred_language: chance(0.5) ? 'ar' : 'en',
    email_template: 'welcome-v3',
    dob_format: 'DD/MM/YYYY',
  };
});

// ---------------------------------------------------------------- planted conditions
const defect = (dataset, id, field, dimension, kind) => planted.defects.push({ dataset, id, field, dimension, kind });
const invalid = (dataset, id, field, value) => planted.invalidCodes.push({ dataset, id, field, value });

['XX9', 'RETAIL', '00'].forEach((v, i) => {
  smeInvalidSector[i].sector_code = v;
  invalid('smes', smeInvalidSector[i].sme_id, 'sector_code', v);
});
['DXB', 'QA-1', 'ZZZ', 'doha', '99'].forEach((v, i) => {
  smeInvalidRegion[i].region_code = v;
  invalid('smes', smeInvalidRegion[i].sme_id, 'region_code', v);
});
const appPool = shuffle(applications);
['TRDG', 'ZZZ', '17', 'N/A'].forEach((v, i) => {
  appPool[i].sector_code = v;
  invalid('loan_applications', appPool[i].application_id, 'sector_code', v);
});

for (const s of smeMissingCr) {
  s.cr_number = '';
  defect('smes', s.sme_id, 'cr_number', 'completeness', 'missing CR number');
}
for (const s of smeMissingEmail) {
  s.owner_email = '';
  defect('smes', s.sme_id, 'owner_email', 'completeness', 'missing owner email');
}
smeBadIban.forEach((s, i) => {
  s.iban = [s.iban.slice(0, 20), `QA${s.iban.slice(4)}`, s.iban.replace('QA', 'QQ'), `${s.iban.slice(0, 12)} ${s.iban.slice(12, 20)}`][i];
  defect('smes', s.sme_id, 'iban', 'validity', 'malformed IBAN');
});
smeBadPhone.forEach((s, i) => {
  s.owner_phone = [s.owner_phone.slice(0, 10), s.owner_phone.replace('+974 ', '00974-')][i];
  defect('smes', s.sme_id, 'owner_phone', 'validity', 'malformed phone number');
});
for (const s of smeStale) {
  s.created_at = between('2016-01-01', '2018-12-31');
  s.updated_at = between('2019-01-01', '2021-12-31');
  defect('smes', s.sme_id, 'updated_at', 'timeliness', 'stale record, not updated for over three years');
}

const inStatement = new Set(lines.map((l) => l.reference).filter(Boolean));
const earlyPaid = shuffle(repayments.filter((r) => r.paid_date && r.installment === 1 && !inStatement.has(r.repayment_id))).slice(0, 4);
for (const r of earlyPaid) {
  r.paid_date = addDays(appById.get(r.application_id).disbursed_at, -int(5, 40));
  defect('repayments', r.repayment_id, 'paid_date', 'consistency', 'repayment dated before disbursement');
}
const guaPool = shuffle(guarantees);
const overGuaranteed = guaPool.slice(0, 2);
for (const g of overGuaranteed) {
  g.amount = appById.get(g.application_id).amount + int(1, 9) * 100000;
  defect('guarantees', g.guarantee_id, 'amount', 'consistency', 'guarantee amount exceeds the loan amount');
}
const lapsed = guaPool.filter((g) => !overGuaranteed.includes(g) && g.expires_at < AS_OF).slice(0, 2);
for (const g of lapsed) {
  g.status = 'active';
  defect('guarantees', g.guarantee_id, 'status', 'timeliness', 'guarantee past its expiry date but still active');
}
planted.defects.sort((a, b) => a.dimension.localeCompare(b.dimension) || a.id.localeCompare(b.id));

const personal = (dataset, field, kind, misleading = false) => planted.personalFields.push({ dataset, field, kind, misleading });
personal('smes', 'owner_name', 'person name');
personal('smes', 'owner_qid', 'national id');
personal('smes', 'owner_phone', 'phone');
personal('smes', 'owner_email', 'email');
personal('smes', 'iban', 'bank account');
personal('smes', 'ref2', 'national id', true);
personal('smes', 'notes', 'phone in free text', true);
personal('loan_applications', 'applicant_name', 'person name');
personal('loan_applications', 'applicant_qid', 'national id');
personal('loan_applications', 'applicant_phone', 'phone');
personal('guarantees', 'guarantor_name', 'person name');
personal('guarantees', 'guarantor_qid', 'national id');
personal('guarantees', 'aux_code', 'phone', true);
personal('repayments', 'payer_iban', 'bank account');
personal('statement_lines', 'counterparty_name', 'person name');
personal('statement_lines', 'counterparty_iban', 'bank account');
personal('contacts', 'full_name', 'person name');
personal('contacts', 'phone', 'phone');
personal('contacts', 'email', 'email');
personal('contacts', 'legacy_key', 'national id', true);

const decoy = (dataset, field, holds) => planted.decoys.push({ dataset, field, holds });
decoy('smes', 'qid_format_version', 'a format version label');
decoy('smes', 'iban_country_list', 'a country code');
decoy('smes', 'phone_prefix_rule', 'a dialling prefix');
decoy('loan_applications', 'id_check_method', 'a method label');
decoy('loan_applications', 'passport_required', 'a boolean flag');
decoy('guarantees', 'national_id_type', 'a document type label');
decoy('repayments', 'card_scheme', 'a scheme label');
decoy('statement_lines', 'account_mask_rule', 'a display rule label');
decoy('contacts', 'email_template', 'a template name');
decoy('contacts', 'dob_format', 'a date format string');

// ---------------------------------------------------------------- write
const strip = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))));
function write(name, rows) {
  const body = Array.isArray(rows) ? `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n` : `${JSON.stringify(rows, null, 2)}\n`;
  writeFileSync(join(OUT, name), body);
}
mkdirSync(OUT, { recursive: true });
write('smes.json', strip(smes));
write('loan_applications.json', applications);
write('guarantees.json', guarantees);
write('repayments.json', repayments);
write('statement_lines.json', lines);
write('contacts.json', contacts);
write('sectors.json', sectors);
write('regions.json', regions);
write('currencies.json', currencies);
write('planted.json', planted);
write('meta.json', {
  notice: 'Test asset. Every record is fabricated.',
  seed: SEED,
  asOf: AS_OF,
  counts: {
    smes: smes.length,
    loan_applications: applications.length,
    guarantees: guarantees.length,
    repayments: repayments.length,
    statement_lines: lines.length,
    contacts: contacts.length,
  },
});
console.log(`shared-data written to ${OUT}`);
