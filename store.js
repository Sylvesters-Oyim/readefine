// Shared storage + spaced-repetition logic (background, dashboard, popup).

const HOUR = 36e5;
const DAY = 24 * HOUR;

// Gap before the next teach-back after each correct answer in a row.
export const INTERVALS = [1, 3, 7, 14, 30, 90].map((d) => d * DAY);
// First quiz comes an hour after you look a word up; a miss brings it back in an hour too.
export const FIRST_GAP = HOUR;
export const KNOWN_STAGE = 4; // four correct in a row (1, 3, 7, 14 days) = known

export const DEFAULT_SETTINGS = {
  reminders: true,
  everyHours: 3,
  quietStart: 22,
  quietEnd: 8,
  dblclick: true,
  autoPdf: true,
};

export async function getWords() {
  const { words = {} } = await chrome.storage.local.get('words');
  return words;
}

export async function saveWords(words) {
  await chrome.storage.local.set({ words });
}

export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export const keyOf = (text) => text.trim().toLowerCase();

export function status(w) {
  if (!w.reviews.length) return 'new';
  return w.stage >= KNOWN_STAGE ? 'known' : 'learning';
}

export function isDue(w, now = Date.now()) {
  return w.due <= now;
}

export function dueList(words, now = Date.now()) {
  return Object.values(words)
    .filter((w) => isDue(w, now))
    .sort((a, b) => a.due - b.due);
}

export function newEntry(lookup, ctx) {
  const now = Date.now();
  return {
    word: lookup.word,
    phonetic: lookup.phonetic || '',
    meanings: lookup.meanings,
    source: lookup.source,
    sourceUrl: lookup.sourceUrl || '',
    contexts: ctx.sentence ? [ctx] : [],
    lookups: 1,
    added: now,
    stage: 0,
    due: now + FIRST_GAP,
    reviews: [],
  };
}

// Apply a teach-back result. Mutates and returns the word.
export function grade(w, correct, answer) {
  const now = Date.now();
  w.reviews.push({ at: now, correct, answer: answer.trim() });
  if (correct) {
    w.due = now + INTERVALS[Math.min(w.stage, INTERVALS.length - 1)];
    w.stage += 1;
  } else {
    w.stage = 0;
    w.due = now + FIRST_GAP;
  }
  return w;
}

export function inQuietHours(s, date = new Date()) {
  const h = date.getHours();
  return s.quietStart > s.quietEnd
    ? h >= s.quietStart || h < s.quietEnd
    : h >= s.quietStart && h < s.quietEnd;
}

export function humanGap(ms) {
  const abs = Math.abs(ms);
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / 6e4))} min`;
  if (Math.round(abs / HOUR) < 24) return `${Math.round(abs / HOUR)} h`;
  const d = Math.round(abs / DAY);
  return d === 1 ? '1 day' : `${d} days`;
}

// ---------- Clips (literature-review cards), sources and projects ----------
// clips:    { id: { id, text, note, page, sourceKey, project, created } }
// sources:  { key: { key, title, authors: [{ family, given }], year, journal, volume, issue, pages,
//                    doi, url, publisher, accessed, edited } }
// projects: { id: { id, name, created, sections: [{ id, title, clips: [clipId] }] } }

export async function getClipData() {
  const { clips = {}, sources = {}, projects = {}, currentProject = '' } =
    await chrome.storage.local.get(['clips', 'sources', 'projects', 'currentProject']);
  return { clips, sources, projects, currentProject };
}

export const newId = () => crypto.randomUUID().slice(0, 8);

export function newProject(name) {
  return { id: newId(), name, created: Date.now(), sections: [{ id: newId(), title: 'Introduction', clips: [] }] };
}

// The project new clips go to; creates a first one if there are none.
export async function ensureProject() {
  let { projects = {}, currentProject = '' } = await chrome.storage.local.get(['projects', 'currentProject']);
  if (!projects[currentProject]) {
    currentProject = Object.keys(projects)[0];
    if (!currentProject) {
      const p = newProject('My literature review');
      projects[p.id] = p;
      currentProject = p.id;
    }
    await chrome.storage.local.set({ projects, currentProject });
  }
  return { projects, currentProject };
}

export function sourceKey(c) {
  return c.doi ? `doi:${c.doi.toLowerCase()}` : (c.url || '').split('#')[0];
}

// ---------- Progress: streak and activity, derived from what's already stored ----------

export const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function progress(words, clips = {}) {
  const all = Object.values(words);
  const count = { new: 0, learning: 0, known: 0 };
  const days = new Map();
  const bump = (t) => days.set(dayKey(t), (days.get(dayKey(t)) || 0) + 1);
  for (const w of all) {
    count[status(w)]++;
    bump(w.added);
    for (const c of w.contexts.slice(1)) bump(c.at);
    for (const r of w.reviews) bump(r.at);
  }
  for (const c of Object.values(clips)) bump(c.created);

  // Consecutive active days, ending today (or yesterday, so the streak survives until you read today).
  let streak = 0;
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }

  return {
    total: all.length, ...count, due: dueList(words).length, streak, days,
    today: days.get(dayKey(Date.now())) || 0,
  };
}
