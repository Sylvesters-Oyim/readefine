// Export everything to an Obsidian vault as linked Markdown notes, under a "Readefine" folder.
// Words, sources, clips and projects link to each other, so Obsidian's graph shows how your
// reading connects.
import { status, humanGap } from './store.js';
import { shortCite, reference, inText, toMarkdown } from './cite.js';

const ROOT = 'Readefine';

// Obsidian forbids \ / : and treats # ^ [ ] | specially in note names.
const safe = (s, max = 80) => String(s || 'Untitled').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim()
  .slice(0, max).replace(/[. ]+$/, '') || 'Untitled';
// Local time, as you'd read it on your own clock.
const pad = (n) => String(n).padStart(2, '0');
const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const iso = (t) => { const d = new Date(t); return `${day(t)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const yamlStr = (v) => JSON.stringify(String(v ?? ''));
const quote = (text) => String(text).split('\n').map((l) => `> ${l}`).join('\n');
const link = (path, label) => `[[${path}${label ? `|${label.replace(/[[\]|]/g, '')}` : ''}]]`;

function frontmatter(fields) {
  const lines = Object.entries(fields).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${yamlStr(x)}`).join('\n')}` : `${k}: ${typeof v === 'number' ? v : yamlStr(v)}`));
  return `---\n${lines.join('\n')}\n---\n`;
}

/** Build every note as { path: markdown }. Pure, so it can be tested without a browser. */
export function buildVault({ words, clips, sources, projects }, style = 'apa') {
  const files = {};
  const now = Date.now();

  // ----- Note names (decided up front so everything can link to everything) -----
  const wordPath = {};
  for (const [k, w] of Object.entries(words)) wordPath[k] = `${ROOT}/Words/${safe(w.word)}`;

  // A "source" is anything you read: a paper (from clips) or a web page/PDF (from word lookups).
  const srcInfo = new Map(); // key → { path, title, source? }
  const used = new Set();
  const addSource = (key, title, s) => {
    if (!key || srcInfo.has(key)) return;
    let base = s ? `${shortCite(s)} - ${s.title || title || key}` : title || key;
    base = safe(base, 140);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})`;
    used.add(name.toLowerCase());
    srcInfo.set(key, { path: `${ROOT}/Sources/${name}`, title: s?.title || title || key, source: s });
  };
  for (const [key, s] of Object.entries(sources)) addSource(key, s.title, s);
  const byUrl = new Map();
  for (const [key, s] of Object.entries(sources)) if (s.url) byUrl.set(s.url.split('#')[0], key);
  const keyOfUrl = (url) => { const u = (url || '').split('#')[0]; return byUrl.get(u) || u; };
  for (const w of Object.values(words)) for (const c of w.contexts) if (c.url) addSource(keyOfUrl(c.url), c.title);
  const srcOf = (url) => srcInfo.get(keyOfUrl(url));

  const projName = {};
  for (const p of Object.values(projects)) projName[p.id] = safe(p.name);
  const clipPath = {};
  for (const c of Object.values(clips)) {
    const s = sources[c.sourceKey];
    const words5 = c.text.split(/\s+/).slice(0, 6).join(' ');
    clipPath[c.id] = `${ROOT}/Clips/${projName[c.project] || 'Unsorted'}/${safe(`${s ? shortCite(s) : 'Clip'} - ${words5}`, 70)} (${c.id})`;
  }

  // Which words and clips belong to which source.
  const wordsBySrc = new Map();
  for (const [k, w] of Object.entries(words)) {
    for (const c of w.contexts) {
      const info = srcOf(c.url);
      if (!info) continue;
      if (!wordsBySrc.has(info.path)) wordsBySrc.set(info.path, new Set());
      wordsBySrc.get(info.path).add(k);
    }
  }
  const clipsBySrc = new Map();
  for (const c of Object.values(clips)) {
    const p = srcInfo.get(c.sourceKey)?.path;
    if (!p) continue;
    if (!clipsBySrc.has(p)) clipsBySrc.set(p, []);
    clipsBySrc.get(p).push(c);
  }

  // ----- Words -----
  for (const [k, w] of Object.entries(words)) {
    const st = status(w);
    const linked = new Set();
    for (const c of w.contexts) for (const o of wordsBySrc.get(srcOf(c.url)?.path) || []) if (o !== k) linked.add(o);
    files[wordPath[k]] = [
      frontmatter({
        type: 'word', status: st, streak: w.stage, saved: iso(w.added), next_review: day(w.due),
        lookups: w.lookups, definition_source: w.source, aliases: w.forms || [],
        tags: ['readefine/word', `readefine/${st}`],
      }),
      `# ${w.word}${w.phonetic ? ` ${w.phonetic}` : ''}\n`,
      ...w.meanings.map((m) => `**${m.pos}**\n${m.defs.map((d, i) => `${i + 1}. ${d.text}${d.example ? ` *“${d.example}”*` : ''}`).join('\n')}\n`),
      w.contexts.length ? `## Where I met it\n${w.contexts.map((c) => {
        const info = srcOf(c.url);
        return `${quote(c.sentence)}\n— ${info ? link(info.path, info.title) : c.title || 'typed in'} · ${iso(c.at)}`;
      }).join('\n\n')}\n` : '',
      linked.size ? `## Met alongside\n${[...linked].map((o) => link(wordPath[o], words[o].word)).join(' · ')}\n` : '',
      w.reviews.length ? `## My explanations\n${w.reviews.slice().reverse().map((r) =>
        `- ${r.correct ? '✅' : '❌'} ${iso(r.at)}: ${r.answer || '*(blank)*'}`).join('\n')}\n` : '',
      `*${st === 'known' ? 'Known' : 'Learning'} · ${w.due <= now ? 'due for review now' : `next review in ${humanGap(w.due - now)}`}*\n`,
    ].filter(Boolean).join('\n');
  }

  // ----- Clips -----
  for (const c of Object.values(clips)) {
    const s = sources[c.sourceKey] || {};
    const info = srcInfo.get(c.sourceKey);
    files[clipPath[c.id]] = [
      frontmatter({
        type: 'clip', project: projects[c.project]?.name, citation: shortCite(s), page: c.page || undefined,
        clipped: iso(c.created), doi: s.doi, url: s.url, tags: ['readefine/clip'],
      }),
      `${quote(c.text)}\n`,
      c.note ? `**My note:** ${c.note}\n` : '',
      `— ${toMarkdown(inText(s, style, { n: 1, page: c.page })).replace(/^\[1\]$/, shortCite(s))} · ${info ? link(info.path, 'source') : ''}\n`,
    ].filter(Boolean).join('\n');
  }

  // ----- Sources -----
  for (const [key, info] of srcInfo) {
    const s = info.source;
    const theClips = clipsBySrc.get(info.path) || [];
    const theWords = [...(wordsBySrc.get(info.path) || [])];
    files[info.path] = [
      frontmatter(s ? {
        type: 'source', title: s.title, authors: (s.authors || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')),
        year: s.year, journal: s.journal, doi: s.doi, url: s.url, tags: ['readefine/source'],
      } : { type: 'source', title: info.title, url: /^https?:/.test(key) ? key : undefined, tags: ['readefine/source'] }),
      `# ${info.title}\n`,
      s ? `${toMarkdown(reference(s, style))}\n` : /^https?:/.test(key) ? `${key}\n` : '',
      theClips.length ? `## Clips\n${theClips.sort((a, b) => a.created - b.created).map((c) => `![[${clipPath[c.id]}]]`).join('\n\n')}\n` : '',
      theWords.length ? `## Words I looked up here\n${theWords.map((k) => link(wordPath[k], words[k].word)).join(' · ')}\n` : '',
    ].filter(Boolean).join('\n');
  }

  // ----- Projects: the outline, with clips embedded so it reads as a draft -----
  for (const p of Object.values(projects)) {
    const placed = new Set(p.sections.flatMap((s) => s.clips));
    const loose = Object.values(clips).filter((c) => c.project === p.id && !placed.has(c.id));
    const srcKeys = new Set(Object.values(clips).filter((c) => c.project === p.id).map((c) => c.sourceKey));
    files[`${ROOT}/Projects/${projName[p.id]}`] = [
      frontmatter({ type: 'project', created: iso(p.created), tags: ['readefine/project'] }),
      `# ${p.name}\n`,
      ...p.sections.map((s) => `## ${s.title}\n${s.clips.filter((id) => clips[id]).map((id) => `![[${clipPath[id]}]]`).join('\n\n') || '*(empty)*'}\n`),
      loose.length ? `## Unsorted clips\n${loose.map((c) => `![[${clipPath[c.id]}]]`).join('\n\n')}\n` : '',
      srcKeys.size ? `## Sources\n${[...srcKeys].map((k) => srcInfo.get(k)).filter(Boolean).map((i) => `- ${link(i.path, i.title)}`).join('\n')}\n` : '',
    ].filter(Boolean).join('\n');
  }

  // ----- Home -----
  const counts = { known: 0, learning: 0, new: 0 };
  for (const w of Object.values(words)) counts[status(w)]++;
  files[`${ROOT}/Readefine`] = [
    frontmatter({ type: 'readefine-home', exported: iso(now) }),
    '# Readefine\n',
    `Exported ${iso(now)}. This folder is rewritten on every export, so keep your own notes outside it and link in.\n`,
    `**Words:** ${Object.keys(words).length} (${counts.known} known, ${counts.learning} learning, ${counts.new} new) · **Clips:** ${Object.keys(clips).length} · **Sources:** ${srcInfo.size}\n`,
    Object.keys(projects).length ? `## Projects\n${Object.values(projects).map((p) => `- ${link(`${ROOT}/Projects/${projName[p.id]}`, p.name)}`).join('\n')}\n` : '',
    Object.keys(words).length ? `## Words\n${Object.entries(words).sort((a, b) => a[1].word.localeCompare(b[1].word))
      .map(([k, w]) => link(wordPath[k], w.word)).join(' · ')}\n` : '',
  ].filter(Boolean).join('\n');

  return Object.fromEntries(Object.entries(files).map(([p, md]) => [`${p}.md`, md]));
}

/** Write the vault notes into a folder the user picked (their Obsidian vault). */
export async function writeVault(dir, files) {
  // Start clean so deleted words/clips don't linger, but only inside our own folder.
  try { await dir.removeEntry(ROOT, { recursive: true }); } catch { /* first export */ }
  for (const [path, md] of Object.entries(files)) {
    const parts = path.split('/');
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await w.write(md);
    await w.close();
  }
  return Object.keys(files).length;
}

// Remember the chosen vault between sessions (handles live in IndexedDB, not chrome.storage).
const db = () => new Promise((res, rej) => {
  const r = indexedDB.open('readefine', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
export async function savedVault() {
  const d = await db();
  return new Promise((res) => {
    const g = d.transaction('kv').objectStore('kv').get('vault');
    g.onsuccess = () => res(g.result || null);
    g.onerror = () => res(null);
  });
}
export async function rememberVault(handle) {
  const d = await db();
  await new Promise((res) => {
    const t = d.transaction('kv', 'readwrite');
    t.objectStore('kv').put(handle, 'vault');
    t.oncomplete = res;
  });
}

/** Export everything to the remembered vault, asking for a folder the first time (or when `pick`). */
export async function exportToObsidian({ pick = false } = {}) {
  const { getWords, getClipData } = await import('./store.js');
  let dir = pick ? null : await savedVault();
  if (dir && (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') dir = null;
  if (!dir) {
    dir = await window.showDirectoryPicker({ id: 'obsidian-vault', mode: 'readwrite' });
    await rememberVault(dir);
  }
  const { citeStyle = 'apa' } = await chrome.storage.local.get('citeStyle');
  const files = buildVault({ words: await getWords(), ...(await getClipData()) }, citeStyle);
  const n = await writeVault(dir, files);
  return { n, vault: dir.name };
}
