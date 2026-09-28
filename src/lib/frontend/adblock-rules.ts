/**
 * Nama kelas/id yang aman dari pemblokir iklan (uBlock, AdBlock, AdGuard, Brave). Daftar filter
 * umum seperti EasyList memuat ribuan aturan kosmetik GENERIK (`##.ad-card`, `##.ad-title`,
 * `###sponsor-box`) yang berlaku di semua situs: elemen bernama begitu disembunyikan `display:none`
 * walau isinya info mitra pihak pertama. Karena itu UI memakai nama netral (`partner-*`, `brand-*`).
 * Aturan murni (tanpa DOM); pemindaian berkas ada di test.
 */
const PRONE_NAME = /^(?:ads?|adv|advert\w*|sponsor\w*)(?:[-_]|$)/i;

export function isAdBlockProneName(name: string): boolean {
  return PRONE_NAME.test(name);
}

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_CLASS = /\.(-?[A-Za-z_][\w-]*)/g;

/** Nama kelas dari selector CSS; komentar dan angka desimal (`0.5`) tidak ikut. */
export function cssClassNames(css: string): string[] {
  return [...css.replace(CSS_COMMENT, " ").matchAll(CSS_CLASS)].map(match => match[1] ?? "");
}

const MARKUP_ATTR = /\b(?:className|id)=(?:"([^"]*)"|\{`((?:[^`\\]|\\.)*)`\}|\{([^{}`]*)\})/g;
const TEMPLATE_EXPR = /\$\{[^{}]*\}/g;
const QUOTED = /"([^"]*)"|'([^']*)'/g;

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);
const quotedWords = (code: string): string[] => [...code.matchAll(QUOTED)].flatMap(match => words(match[1] ?? match[2] ?? ""));

/**
 * Nilai `className`/`id` di TSX: literal biasa, bagian statis template literal, dan string yang
 * muncul di dalam ekspresi (`cond ? "on" : undefined`). Nama variabel di ekspresi tidak ikut.
 */
export function markupNames(tsx: string): string[] {
  return [...tsx.matchAll(MARKUP_ATTR)].flatMap(([, plain, template, expression]) => {
    if (plain !== undefined) return words(plain);
    if (template !== undefined) {
      const expressions = [...template.matchAll(TEMPLATE_EXPR)].map(match => match[0]);
      return [...words(template.replace(TEMPLATE_EXPR, " ")), ...expressions.flatMap(quotedWords)];
    }
    return quotedWords(expression ?? "");
  });
}
