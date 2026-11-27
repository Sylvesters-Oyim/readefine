import {
  getWords, saveWords, getSettings, keyOf, newEntry, dueList, inQuietHours,
  ensureProject, sourceKey, newId,
} from './store.js';

const APP = chrome.runtime.getURL('app.html');
const VIEWER = chrome.runtime.getURL('viewer.html');

chrome.runtime.onInstalled.addListener(async () => {
  // v1.6: PDFs no longer open in Readefine by default. Turn it off once for anyone who had it saved as on.
  const { settings, pdfDefaultMigrated } = await chrome.storage.local.get(['settings', 'pdfDefaultMigrated']);
  if (!pdfDefaultMigrated) {
    if (settings) await chrome.storage.local.set({ settings: { ...settings, autoPdf: false } });
    await chrome.storage.local.set({ pdfDefaultMigrated: true });
  }
  chrome.alarms.create('check', { periodInMinutes: 15 });
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'define',
    title: 'Define “%s” with Readefine',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'clip',
    title: 'Clip selection to Readefine',
    contexts: ['selection'],
  });
  refreshBadge();
  injectIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(refreshBadge);

// After installing or updating, add Readefine to tabs that are already open, so they work without a refresh.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    const target = { tabId: tab.id, allFrames: true };
    chrome.scripting.insertCSS({ target, files: ['marks.css'] }).catch(() => {});
    chrome.scripting.executeScript({ target, files: ['content.js', 'draw.js'] }).catch(() => {}); // e.g. the Web Store blocks it
  }
}

// Drawing pen shortcut (Alt+Shift+D by default; changeable in chrome://extensions/shortcuts).
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-draw') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!(tab?.id >= 0)) return;
  await activate(tab.id); // the shortcut counts as a click, so this works with site access "On click"
  chrome.tabs.sendMessage(tab.id, { type: 'draw' }).catch(() => {});
});

// With site access set to "On click", Chrome only lets Readefine into a tab once you click its icon or
// use its shortcut. This switches it on in that tab. Safe to repeat: the scripts guard against running twice.
async function activate(tabId) {
  const target = { tabId, allFrames: true };
  await chrome.scripting.insertCSS({ target, files: ['marks.css'] }).catch(() => {});
  await chrome.scripting.executeScript({ target, files: ['content.js', 'draw.js'] }).catch(() => {});
}

// ---------- Dictionary lookup ----------

// Service workers have no DOMParser, so strip Wiktionary's HTML by hand.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const plain = (html = '') => html
  .replace(/<[^>]+>/g, '')
  .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e[0] === '#' ? String.fromCodePoint(Number(e.slice(1))) : m))
  .replace(/\s+/g, ' ')
  .trim();

async function fromWiktionary(word) {
  const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
  if (!res.ok) return null;
  const data = await res.json();
  // "en" also holds Translingual entries (symbols, codes); prefer the English ones.
  const all = data.en || [];
  const english = all.filter((m) => m.language === 'English');
  const meanings = (english.length ? english : all)
    .map((m) => ({
      pos: m.partOfSpeech.toLowerCase(),
      defs: m.definitions
        .map((d) => ({ text: plain(d.definition), example: plain(d.parsedExamples?.[0]?.example || d.examples?.[0]) }))
        .filter((d) => d.text)
        .slice(0, 3),
    }))
    .filter((m) => m.defs.length)
    .slice(0, 3);
  if (!meanings.length) return null;
  return {
    word,
    phonetic: '',
    meanings,
    source: 'Wiktionary',
    sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
  };
}

async function fromDictionary(word) {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!res.ok) return null;
  const data = await res.json();
  const first = data[0];
  const byPos = new Map();
  for (const entry of data) {
    for (const m of entry.meanings) {
      const defs = byPos.get(m.partOfSpeech) || [];
      for (const d of m.definitions) {
        if (defs.length < 3) defs.push({ text: d.definition, example: d.example || '' });
      }
      byPos.set(m.partOfSpeech, defs);
    }
  }
  return {
    word: first.word,
    phonetic: first.phonetic || first.phonetics?.find((p) => p.text)?.text || '',
    meanings: [...byPos].slice(0, 3).map(([pos, defs]) => ({ pos, defs })),
    source: 'Dictionary',
    sourceUrl: first.sourceUrls?.[0] || '',
  };
}

// Fallback for technical terms, drug names and multi-word phrases.
async function fromWikipedia(term) {
  const title = encodeURIComponent(term.replace(/\s+/g, '_'));
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}?redirect=true`);
  if (!res.ok) return null;
  const d = await res.json();
  if (d.type === 'disambiguation' || !d.extract) return null;
  return {
    word: term,
    phonetic: '',
    meanings: [{ pos: d.description || 'term', defs: [{ text: d.extract, example: '' }] }],
    source: 'Wikipedia',
    sourceUrl: d.content_urls?.desktop?.page || '',
  };
}

// "plural of polymorphism", "simple past of run" → the word to define instead.
const FORM_OF = /^(?:[\w-]+ ){0,6}(?:plural|past|participle|singular|comparative|superlative|spelling|form)(?: [\w-]+){0,4} of ([\p{L}'-]+)\.?$/u;

function baseForm(found) {
  const m = found.meanings[0].defs[0].text.match(FORM_OF);
  return m && m[1].toLowerCase() !== found.word.toLowerCase() ? m[1] : null;
}

async function lookup(text) {
  let found = await lookupExact(text);
  // Up to two hops: metabolised → metabolise → metabolize.
  for (let hop = 0; hop < 2 && found?.source === 'Wiktionary'; hop++) {
    const base = baseForm(found);
    const real = base && await fromWiktionary(base).catch(() => null);
    if (!real) break;
    found = { ...real, seenAs: text };
  }
  return found;
}

async function lookupExact(text) {
  const lower = text.toLowerCase();
  const wikt = [() => fromWiktionary(lower)];
  if (lower !== text) wikt.push(() => fromWiktionary(text)); // e.g. proper nouns, gene names
  const tries = /\s/.test(text)
    ? [() => fromWikipedia(text), ...wikt, () => fromDictionary(lower)]
    : [...wikt, () => fromWikipedia(text), () => fromDictionary(lower)];
  for (const t of tries) {
    try {
      const r = await t();
      if (r) return r;
    } catch { /* network hiccup: try the next source */ }
  }
  return null;
}

// ---------- Saving ----------

async function define({ text, sentence = '', url = '', title = '' }) {
  let key = keyOf(text);
  const words = await getWords();
  const ctx = { sentence, url, title, at: Date.now() };
  // Inflected forms we've already resolved ("polymorphisms") point at their base word.
  const alias = Object.entries(words).find(([, v]) => v.forms?.includes(key));
  if (alias) key = alias[0];
  let w = words[key];
  let found = null;
  if (!w) {
    found = await lookup(text);
    if (!found) return { ok: false, text };
    key = keyOf(found.word);
    w = words[key];
  }
  if (w) {
    if (found?.seenAs && !w.forms?.includes(keyOf(found.seenAs))) w.forms = [...(w.forms || []), keyOf(found.seenAs)];
    w.lookups += 1;
    if (sentence && !w.contexts.some((c) => c.sentence === sentence)) {
      w.contexts.unshift(ctx);
      w.contexts = w.contexts.slice(0, 8);
    }
    await saveWords(words);
    return { ok: true, key, entry: w, repeat: true };
  }
  w = newEntry(found, ctx);
  if (found.seenAs) w.forms = [keyOf(found.seenAs)];
  words[key] = w;
  await saveWords(words);
  refreshBadge();
  return { ok: true, key, entry: w, repeat: false };
}

async function remove(key) {
  const words = await getWords();
  delete words[key];
  await saveWords(words);
  refreshBadge();
}

// ---------- Clips (literature-review cards) ----------

const strip = (s) => plain(String(s || '')).replace(/\s+([,.;:])/g, '$1');
const filled = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v && (!Array.isArray(v) || v.length)));

// Crossref turns a DOI into a clean citation; it fixes messy page/PDF metadata.
async function crossref(doi) {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const m = (await res.json()).message;
  return filled({
    title: strip(m.title?.[0]),
    authors: (m.author || []).map((a) => ({ family: a.family || a.name || '', given: a.given || '' })),
    year: String(m.issued?.['date-parts']?.[0]?.[0] || m.published?.['date-parts']?.[0]?.[0] || ''),
    journal: strip(m['container-title']?.[0]),
    volume: m.volume, issue: m.issue, pages: m.page,
    publisher: m.publisher,
    doi: m.DOI,
  });
}

async function clip({ text, page = null, citation = {}, url = '', pdf = false }) {
  const key = sourceKey(citation);
  let { sources = {} } = await chrome.storage.local.get('sources');
  let src = sources[key];
  if (!src?.edited) {
    let merged = { ...src, ...filled(citation) };
    if (merged.doi && !src?.enriched) {
      const cr = await crossref(merged.doi).catch(() => null);
      if (cr) merged = { ...merged, ...cr, enriched: true };
    }
    src = { ...merged, key, accessed: src?.accessed || Date.now() };
  }
  const { currentProject } = await ensureProject();
  // Re-read just before writing: the Crossref call may have taken a few seconds.
  ({ sources = {} } = await chrome.storage.local.get('sources'));
  const { clips = {} } = await chrome.storage.local.get('clips');
  sources[key] = src;
  const id = newId();
  clips[id] = { id, text, note: '', page, url, pdf, sourceKey: key, project: currentProject, created: Date.now() };
  await chrome.storage.local.set({ clips, sources });
  return { ok: true, clip: clips[id], source: src, ...(await projectList()) };
}

async function projectList() {
  const { projects, currentProject } = await ensureProject();
  return {
    currentProject,
    projects: Object.values(projects).sort((a, b) => a.created - b.created).map(({ id, name }) => ({ id, name })),
  };
}

// Change a clip's note and/or project. Moving project also takes it out of the old outline.
async function updateClip({ id, note, project }) {
  const { clips = {}, projects = {} } = await chrome.storage.local.get(['clips', 'projects']);
  const c = clips[id];
  if (!c) return { ok: false };
  if (note !== undefined) c.note = note;
  const out = { clips };
  if (project && project !== c.project) {
    for (const s of projects[c.project]?.sections || []) s.clips = s.clips.filter((x) => x !== id);
    c.project = project;
    out.projects = projects;
    out.currentProject = project; // next clip goes where you just put this one
  }
  await chrome.storage.local.set(out);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'define') define(msg).then(reply);
  else if (msg.type === 'clip') clip(msg).then(reply);
  else if (msg.type === 'updateClip') updateClip(msg).then(reply);
  else if (msg.type === 'crossref') crossref(msg.doi).then((r) => reply(r || null), () => reply(null));
  else if (msg.type === 'remove') remove(msg.key).then(() => reply({ ok: true }));
  else if (msg.type === 'openApp') openApp(msg.hash).then(() => reply({ ok: true }));
  else if (msg.type === 'testNotify') notify(true).then(() => reply({ ok: true }));
  else return false;
  return true; // keep the channel open for the async reply
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id >= 0) {
    const type = info.menuItemId === 'clip' ? 'clipSelection' : 'show';
    chrome.tabs.sendMessage(tab.id, { type, text: info.selectionText }, { frameId: info.frameId })
      .catch(() => {});
  }
});

// ---------- Reminders ----------

async function refreshBadge() {
  const n = dueList(await getWords()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#2f6f5e' });
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

async function notify(force = false) {
  const s = await getSettings();
  const due = dueList(await getWords());
  if (!force) {
    if (!s.reminders || !due.length || inQuietHours(s)) return;
    const { lastNotified = 0 } = await chrome.storage.local.get('lastNotified');
    if (Date.now() - lastNotified < s.everyHours * 36e5) return;
  }
  const pick = due.length ? due[Math.floor(Math.random() * due.length)] : null;
  await chrome.notifications.create('review', {
    type: 'basic',
    iconUrl: 'icons/128.png',
    title: 'Readefine · teach it back',
    message: pick
      ? `What does “${pick.word}” mean? Explain it in your own words.${due.length > 1 ? ` (${due.length} words ready)` : ''}`
      : 'Nothing due right now — this is what a reminder looks like.',
    priority: 1,
  });
  await chrome.storage.local.set({ lastNotified: Date.now() });
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'check') return;
  await refreshBadge();
  await notify();
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  openApp('#review');
});

async function openApp(hash = '') {
  const [existing] = await chrome.tabs.query({ url: `${APP}*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true, url: APP + hash });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP + hash });
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.words) refreshBadge();
});

// ---------- PDFs: open them in Readefine's viewer so highlighting works ----------

const PDF_URL = /^(https?|file):\/\/[^?#]+\.pdf([?#].*)?$/i;

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url || !PDF_URL.test(change.url) || change.url.endsWith('#readefine-off')) return;
  const { autoPdf } = await getSettings();
  if (!autoPdf) return;
  chrome.tabs.update(tabId, { url: `${VIEWER}?file=${encodeURIComponent(change.url)}` });
});
