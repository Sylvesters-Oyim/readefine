// Citation formatting: in-text cites, reference lists (APA 7, Vancouver, Harvard), BibTeX, RIS.
// Formatters return HTML (only <i> for italics); toMarkdown() converts for plain-text exports.

export const STYLES = { apa: 'APA 7', vancouver: 'Vancouver', harvard: 'Harvard' };

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function toMarkdown(html) {
  return html.replace(/<\/?i>/g, '*').replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const isArticle = (s) => Boolean(s.journal);
const year = (s) => s.year || 'n.d.';
const family = (a) => a.family || a.given || '';
const endDot = (t) => (/[.?!]$/.test(t) ? t : `${t}.`);
const dash = (p) => String(p).replace(/-+/g, '–');
const fmtDate = (t) => new Date(t || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const link = (s) => (s.doi ? `https://doi.org/${s.doi}` : s.url && /^https?:/.test(s.url) ? s.url : '');

function initials(given = '', dots = true) {
  return given.split(/[\s.]+/).filter(Boolean)
    .map((p) => p.split('-').map((x) => x[0].toUpperCase() + (dots ? '.' : '')).join('-'))
    .join(dots ? ' ' : '');
}

// Who to name when a source has no authors.
const corporate = (s) => s.publisher || s.site || '';

function names(s, two, many = ' et al.') {
  const a = s.authors || [];
  if (!a.length) return esc(corporate(s) || shortTitle(s));
  if (a.length === 1) return esc(family(a[0]));
  if (a.length === 2) return `${esc(family(a[0]))} ${two} ${esc(family(a[1]))}`;
  return `${esc(family(a[0]))}${many}`;
}

const shortTitle = (s) => {
  const words = (s.title || 'Untitled').split(/\s+/);
  return words.length > 4 ? `${words.slice(0, 4).join(' ')}…` : words.join(' ');
};

/** Label used on cards: "Smith et al. (2021)". Plain text. */
export function shortCite(s) {
  if (!s) return 'Unknown source';
  return toMarkdown(`${names(s, '&amp;')} (${year(s)})`);
}

/** In-text citation. `n` is the Vancouver number; `page` adds a pinpoint. */
export function inText(s, style, { page, n } = {}) {
  if (style === 'vancouver') return `[${n}]`;
  const p = page ? `, p. ${esc(page)}` : '';
  return style === 'harvard'
    ? `(${names(s, 'and')} ${esc(year(s))}${p})`
    : `(${names(s, '&amp;')}, ${esc(year(s))}${p})`;
}

function authorsAPA(a) {
  const one = (x) => (x.given ? `${esc(family(x))}, ${initials(x.given)}` : esc(family(x)));
  if (a.length === 1) return one(a[0]);
  if (a.length <= 20) return `${a.slice(0, -1).map(one).join(', ')}, &amp; ${one(a.at(-1))}`;
  return `${a.slice(0, 19).map(one).join(', ')}, … ${one(a.at(-1))}`;
}

function authorsHarvard(a) {
  const one = (x) => (x.given ? `${esc(family(x))}, ${initials(x.given)}` : esc(family(x)));
  if (a.length === 1) return one(a[0]);
  if (a.length > 3) return `${one(a[0])} et al.`;
  return `${a.slice(0, -1).map(one).join(', ')} and ${one(a.at(-1))}`;
}

function authorsVancouver(a) {
  const one = (x) => `${esc(family(x))}${x.given ? ` ${initials(x.given, false)}` : ''}`;
  return a.length > 6 ? `${a.slice(0, 6).map(one).join(', ')}, et al` : a.map(one).join(', ');
}

/** Full reference-list entry. */
export function reference(s, style) {
  const a = s.authors || [];
  const title = esc(s.title || 'Untitled');
  const journal = esc(s.journal || '');
  const site = esc(corporate(s));
  const vol = esc(s.volume || '');
  const iss = esc(s.issue || '');
  const pages = esc(s.pages || '');
  const url = esc(link(s));

  if (style === 'vancouver') {
    const who = a.length ? `${authorsVancouver(a)}. ` : '';
    if (isArticle(s)) {
      const loc = `${vol}${iss ? `(${iss})` : ''}${pages ? `:${pages}` : ''}`;
      return `${who}${endDot(title)} ${journal}. ${esc(s.year || '')}${loc ? `;${loc}` : ''}.${s.doi ? ` doi:${esc(s.doi)}` : url ? ` Available from: ${url}` : ''}`;
    }
    return `${who}${title} [Internet]. ${site ? `${site}; ` : ''}${esc(s.year || '')} [cited ${fmtDate(s.accessed)}].${url ? ` Available from: ${url}` : ''}`;
  }

  if (style === 'harvard') {
    const who = a.length ? authorsHarvard(a) : site || title;
    if (isArticle(s)) {
      const loc = [vol && `${vol}${iss ? `(${iss})` : ''}`, pages && `pp. ${dash(pages)}`].filter(Boolean).join(', ');
      return `${who} (${esc(year(s))}) ‘${title}’, <i>${journal}</i>${loc ? `, ${loc}` : ''}.${s.doi ? ` doi:${esc(s.doi)}.` : url ? ` Available at: ${url}.` : ''}`;
    }
    return `${who} (${esc(year(s))}) <i>${title}</i>${/[.?!]$/.test(s.title || '') ? '' : '.'}${url ? ` Available at: ${url}` : ''} (Accessed: ${fmtDate(s.accessed)}).`;
  }

  // APA 7
  if (!a.length) {
    const head = isArticle(s) ? endDot(title) : `<i>${endDot(title)}</i>`;
    return `${head} (${esc(year(s))}).${isArticle(s) ? ` <i>${journal}</i>.` : site ? ` ${site}.` : ''}${url ? ` ${url}` : ''}`;
  }
  const who = endDot(authorsAPA(a));
  if (isArticle(s)) {
    const loc = `${vol ? `, <i>${vol}</i>` : ''}${iss ? `(${iss})` : ''}${pages ? `, ${dash(pages)}` : ''}`;
    return `${who} (${esc(year(s))}). ${endDot(title)} <i>${journal}</i>${loc}.${url ? ` ${url}` : ''}`;
  }
  return `${who} (${esc(year(s))}). <i>${endDot(title)}</i>${site ? ` ${site}.` : ''}${url ? ` ${url}` : ''}`;
}

// ---------- Reference-manager formats ----------

const bibKey = (s) => {
  const fam = (s.authors?.[0] ? family(s.authors[0]) : corporate(s) || 'anon').replace(/[^\p{L}]/gu, '').toLowerCase();
  const word = (s.title || '').split(/\s+/).find((w) => w.length > 3)?.replace(/[^\p{L}]/gu, '').toLowerCase() || '';
  return `${fam}${s.year || ''}${word}`;
};
const bibVal = (v) => String(v).replace(/[{}]/g, '');

export function bibtex(s) {
  const fields = [
    ['title', s.title && `{${bibVal(s.title)}}`],
    ['author', s.authors?.length && s.authors.map((a) => (a.given ? `${bibVal(family(a))}, ${bibVal(a.given)}` : `{${bibVal(family(a))}}`)).join(' and ')],
    ['journal', s.journal],
    ['year', s.year],
    ['volume', s.volume],
    ['number', s.issue],
    ['pages', s.pages && s.pages.replace(/[-–]+/, '--')],
    ['publisher', !s.journal && corporate(s)],
    ['doi', s.doi],
    ['url', s.url && /^https?:/.test(s.url) && s.url],
    ['urldate', !s.journal && new Date(s.accessed || Date.now()).toISOString().slice(0, 10)],
  ].filter(([, v]) => v);
  return `@${s.journal ? 'article' : 'misc'}{${bibKey(s)},\n${fields.map(([k, v]) => `  ${k} = {${bibVal(v)}}`).join(',\n')}\n}`;
}

export function ris(s) {
  const [sp, ep] = (s.pages || '').split(/[-–]+/);
  const lines = [
    ['TY', s.journal ? 'JOUR' : 'ELEC'],
    ...(s.authors || []).map((a) => ['AU', a.given ? `${family(a)}, ${a.given}` : family(a)]),
    ['TI', s.title], ['T2', s.journal], ['PY', s.year], ['VL', s.volume], ['IS', s.issue],
    ['SP', sp], ['EP', ep], ['PB', !s.journal && corporate(s)], ['DO', s.doi], ['UR', s.url && /^https?:/.test(s.url) && s.url],
  ].filter(([, v]) => v);
  return `${lines.map(([k, v]) => `${k}  - ${v}`).join('\n')}\nER  - `;
}
