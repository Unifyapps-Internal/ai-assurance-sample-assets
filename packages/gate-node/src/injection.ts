/** Folds case, compatibility forms, Arabic diacritics, tatweel and letter variants so one phrase list covers them. */
export function normaliseText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Rule {
  name: string;
  pattern: RegExp;
}

/** Heuristics, written against normalised text (so Arabic patterns use ا for every alef and ه for ta marbuta). */
const RULES: Rule[] = [
  {
    name: 'instruction override',
    pattern:
      /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|any|your|system|safety)\b.{0,30}\b(instructions?|rules?|prompts?|guidelines|directions|policies|restrictions)\b/,
  },
  { name: 'instruction override', pattern: /\bnew (instructions?|rules?)\s*:/ },
  { name: 'instruction override', pattern: /\b(from now on|henceforth)\b.{0,40}\b(you (will|must|shall)|obey|only follow)\b/ },
  { name: 'instruction override', pattern: /(^|\s)(تجاهل\S*|تجاوز\S*|انسي?|اهمل\S*|الغي?|الغاء)\s.{0,40}(التعليمات|القواعد|الاوامر|التوجيهات|القيود|الارشادات)/ },
  { name: 'instruction override', pattern: /(تعليمات|اوامر) جديده\s*:/ },
  {
    name: 'system prompt extraction',
    pattern:
      /\b(reveal|show|print|repeat|display|output|leak|tell me|give me|what (is|are|were))\b.{0,40}\b(system prompt|system message|hidden prompt|initial prompt|developer message|your (instructions|prompt|rules|guidelines))\b/,
  },
  {
    name: 'system prompt extraction',
    pattern:
      /(اكشف|اظهر|اعرض|اطبع|كرر|اخبرني|اعطني|ما هي|ما هو).{0,40}(تعليمات النظام|رساله النظام|موجه النظام|تعليماتك|التعليمات السريه|التعليمات المخفيه|التعليمات الاصليه)/,
  },
  { name: 'role-play jailbreak', pattern: /\b(dan mode|do anything now|developer mode|jailbreak|jailbroken|unrestricted mode|god mode)\b/ },
  {
    name: 'role-play jailbreak',
    pattern:
      /\b(pretend|act as|role-?play|you are now|imagine you are)\b.{0,80}\b(no (rules|restrictions|limits|filters)|without (any )?(rules|restrictions|limits|filters)|unrestricted|unfiltered|uncensored)\b/,
  },
  { name: 'role-play jailbreak', pattern: /(تظاهر|تصرف|تقمص|تخيل انك).{0,60}(بلا قيود|بدون قيود|دون قيود|بلا قواعد|بدون قواعد|غير مقيد)/ },
  { name: 'role-play jailbreak', pattern: /وضع المطور/ },
];

/** Returns the name of the first heuristic the text trips, or null. */
export function detectInjection(text: string): string | null {
  const normalised = normaliseText(text);
  return RULES.find((rule) => rule.pattern.test(normalised))?.name ?? null;
}
