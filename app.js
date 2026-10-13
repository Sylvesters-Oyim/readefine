import {
  getWords, saveWords, getSettings, saveSettings, status, dueList, grade, humanGap, keyOf, progress, dayKey,
  getClipData,
} from './store.js';
import { initClips } from './clips.js';
import { exportToObsidian, savedVault } from './obsidian.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDateTime = (t) => new Date(t).toLocaleString(undefined,
  { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const shortDef = (w) => w.meanings[0]?.defs[0]?.text || '';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let words = {};
let clips = {};
let filter = 'all';

// ---------- Tabs ----------
function showTab() {
  const tab = (location.hash || '#review').slice(1);
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${tab}`;
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('on', a.dataset.tab === tab);
  document.body.classList.toggle('wide', tab === 'clips');
  $('#stats').hidden = !['review', 'words'].includes(tab);
  $('#layout').classList.toggle('split', !$('#stats').hidden);
  if (tab === 'review') startReview();
}
window.addEventListener('hashchange', showTab);

// ---------- Progress hero ----------
function ring(p) {
  const r = 48;
  const C = 2 * Math.PI * r;
  const total = p.total || 1;
  let offset = 0;
  const seg = (n, color) => {
    if (!n) return '';
    const len = (n / total) * C;
    const s = `<circle cx="56" cy="56" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${Math.max(0, len - 3)} ${C}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
    return s;
  };
  return `<div class="ring" title="${p.known} known · ${p.learning} learning · ${p.new} new">
    <svg width="112" height="112" viewBox="0 0 112 112">
      <circle class="track" cx="56" cy="56" r="${r}" fill="none" stroke-width="10"/>
      ${seg(p.known, 'var(--accent)')}${seg(p.learning, 'var(--coral)')}${seg(p.new, 'var(--marker)')}
    </svg>
    <div class="center"><b>${p.known}</b><span>known</span></div>
  </div>`;
}

function heatmap(days) {
  const WEEKS = 18;
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - (WEEKS - 1) * 7 - today.getDay());
  const level = (n) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
  let cells = '';
  let active = 0;
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d);
    const n = days.get(k) || 0;
    if (n) active++;
    const label = `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${n ? `${n} thing${n === 1 ? '' : 's'} saved or reviewed` : 'nothing yet'}`;
    cells += `<i data-l="${level(n)}" class="${k === dayKey(today) ? 'today' : ''}" title="${esc(label)}"></i>`;
  }
  return `<div class="heat"><div class="heat-grid" aria-label="Reading activity, last ${WEEKS} weeks">${cells}</div>
    <div class="heat-cap">${plural(active, 'active day')}<br>in the last ${WEEKS} weeks</div></div>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function renderStats() {
  const p = progress(words, clips);
  $('#dueBadge').textContent = p.due || '';
  const clipCount = Object.keys(clips).length;
  const headline = !p.total
    ? 'Double-click a word you don’t know, <em>wherever you read</em>.'
    : p.due
      ? `<em>${plural(p.due, 'word')}</em> ready to teach back.`
      : 'You’re all caught up. <em>Keep reading.</em>';
  const settled = $('#stats .hero') ? ' settled' : ''; // animate in once, not on every update
  $('#stats').innerHTML = `<div class="hero${settled}">
    ${ring(p)}
    <div>
      <h2>${greeting()}. ${headline}</h2>
      <p>${p.total ? `You know <b>${p.known}</b> of the <b>${p.total}</b> words you’ve saved${clipCount ? `, and you’ve clipped ${plural(clipCount, 'passage')}` : ''}.`
        : 'Every word you look up lands here, and Readefine helps you keep it.'}</p>
      <div class="chips">
        <span class="chip-stat streak"><span class="flame">🔥</span><b>${p.streak}</b> day streak</span>
        <span class="chip-stat"><span class="dot" style="background:var(--accent)"></span><b>${p.known}</b> known</span>
        <span class="chip-stat"><span class="dot" style="background:var(--coral)"></span><b>${p.learning}</b> learning</span>
        <span class="chip-stat"><span class="dot" style="background:var(--marker)"></span><b>${p.new}</b> new</span>
        ${p.today ? `<span class="chip-stat">✨ <b>${p.today}</b> today</span>` : ''}
      </div>
    </div>
    ${heatmap(p.days)}
  </div>`;
}

// ---------- Celebration ----------
function confetti(from) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = Object.assign(document.createElement('div'), { className: 'confetti' });
  const r = from.getBoundingClientRect();
  const colors = ['var(--marker)', 'var(--accent)', 'var(--coral)', '#7aa7ff'];
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('i');
    const angle = (Math.random() * Math.PI) + Math.PI; // upward fan
    const dist = 120 + Math.random() * 220;
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${colors[i % colors.length]};
      --x:${Math.cos(angle) * dist}px;--y:${Math.sin(angle) * dist + 260}px;--r:${Math.random() * 720 - 360}deg;
      --d:${0.9 + Math.random() * 0.6}s;animation-delay:${Math.random() * 0.08}s`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1800);
}

// ---------- Review (teach-back) ----------
let queue = [];
let qi = 0;
let tally = { got: 0, missed: 0 };

function startReview(early = false) {
  queue = early ? Object.values(words).sort((a, b) => a.due - b.due).slice(0, 10) : dueList(words);
  qi = 0;
  tally = { got: 0, missed: 0 };
  renderReview();
}

function markWord(sentence, word) {
  const i = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return esc(sentence);
  return esc(sentence.slice(0, i)) + `<mark>${esc(sentence.slice(i, i + word.length))}</mark>` + esc(sentence.slice(i + word.length));
}

function renderReview() {
  const el = $('#tab-review');
  if (qi >= queue.length) {
    const all = Object.values(words);
    const next = all.length ? Math.min(...all.map((w) => w.due)) - Date.now() : null;
    const finished = queue.length > 0;
    el.innerHTML = `<div class="review done">
      <div class="big">${finished ? (tally.got === queue.length ? '🏆' : '🌱') : all.length ? '☕' : '📖'}</div>
      <h2>${finished ? (tally.got === queue.length ? 'Perfect session!' : 'Session done') : all.length ? 'All caught up' : 'Your word bank is empty'}</h2>
      ${finished ? `<div class="tally">
        <span class="chip-stat"><span class="dot" style="background:var(--accent)"></span><b>${tally.got}</b> explained well</span>
        <span class="chip-stat"><span class="dot" style="background:var(--coral)"></span><b>${tally.missed}</b> coming back soon</span></div>` : ''}
      <p class="hint">${all.length
        ? `The next word is due in ${humanGap(next)}.`
        : 'Double-click any word you don’t know on a web page or PDF. An hour later it shows up here for you to explain back.'}</p>
      ${all.length ? '<p><button id="early">Practise a few early</button></p>' : ''}
    </div>`;
    if (finished && tally.got === queue.length) confetti($('.done .big'));
    $('#early')?.addEventListener('click', () => startReview(true));
    return;
  }
  const w = queue[qi];
  const ctx = w.contexts[0];
  el.innerHTML = `<div class="review">
    <div class="bar"><i style="width:${(qi / queue.length) * 100}%"></i></div>
    <div class="count"><span>Word ${qi + 1} of ${queue.length}</span>
      <span>${w.reviews.length ? `${'●'.repeat(Math.min(w.stage, 6))}${'○'.repeat(Math.max(0, 6 - w.stage))}` : 'First teach-back'}</span></div>
    <h2><span class="mark">${esc(w.word)}</span></h2>
    ${ctx?.sentence ? `<div class="ctx">${markWord(ctx.sentence, w.word)}</div>` : ''}
    <p class="prompt">Explain it as if you were teaching a friend.</p>
    <textarea id="answer" placeholder="It means…"></textarea>
    <div class="row">
      <button class="primary" id="check">Check my explanation</button>
      <button id="dunno">I don't remember</button>
      <span class="hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd></span>
    </div>
  </div>`;
  const answer = $('#answer');
  answer.focus();
  const reveal = () => renderReveal(w, answer.value);
  $('#check').onclick = reveal;
  $('#dunno').onclick = () => renderReveal(w, '');
  answer.onkeydown = (e) => { if (e.key === 'Enter' && e.ctrlKey) reveal(); };
}

function renderReveal(w, answer) {
  const el = $('.review');
  el.querySelector('.prompt')?.remove();
  el.querySelector('.row').remove();
  $('#answer').replaceWith(Object.assign(document.createElement('div'), {
    className: 'compare',
    innerHTML: `<div><h4>You said</h4>${answer.trim() ? esc(answer) : '<span class="hint">(nothing yet, and that’s fine)</span>'}</div>
      <div><h4>Definition · ${esc(w.source)}</h4>${w.meanings.map((m) =>
        `<div><em class="hint">${esc(m.pos)}</em> ${m.defs.slice(0, 2).map((d) => esc(d.text)).join(' · ')}</div>`).join('')}</div>`,
  }));
  const row = document.createElement('div');
  row.className = 'row verdict';
  row.innerHTML = `<span class="hint">Did you get the meaning?</span>
    <button class="bad" id="miss">Not yet <kbd>N</kbd></button><button class="good" id="got">I got it <kbd>G</kbd></button>`;
  el.appendChild(row);
  const done = async (correct, btn) => {
    document.removeEventListener('keydown', keys);
    if (correct) { tally.got++; confetti(btn); } else tally.missed++;
    const fresh = await getWords();
    const k = keyOf(w.word);
    if (fresh[k]) {
      grade(fresh[k], correct, answer);
      await saveWords(fresh);
      words = fresh;
    }
    qi++;
    setTimeout(() => { renderReview(); renderStats(); }, correct ? 450 : 150);
  };
  const keys = (e) => {
    if (e.key === 'g' || e.key === 'G') done(true, $('#got'));
    else if (e.key === 'n' || e.key === 'N') done(false, $('#miss'));
  };
  document.addEventListener('keydown', keys);
  $('#got').onclick = (e) => done(true, e.currentTarget);
  $('#miss').onclick = (e) => done(false, e.currentTarget);
  $('#got').focus();
}

// ---------- Words ----------
function wordsBySource() {
  const map = new Map();
  for (const [k, w] of Object.entries(words)) {
    for (const c of w.contexts) {
      if (!c.url) continue;
      if (!map.has(c.url)) map.set(c.url, { url: c.url, title: c.title, at: c.at, keys: new Set() });
      const r = map.get(c.url);
      r.keys.add(k);
      r.at = Math.max(r.at, c.at);
    }
  }
  return map;
}

function sourceLink(c) {
  const label = esc(c.title || c.url);
  return /^https?:|^file:/.test(c.url) ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${label}</a>` : label;
}

function mastery(w) {
  const st = status(w);
  const bars = Array.from({ length: 6 }, (_, i) => `<i class="${i < w.stage ? 'on' : ''}"></i>`).join('');
  return `<span class="mastery ${st}" title="${st}: ${w.stage} correct in a row">${bars}</span>`;
}

function renderWords() {
  const q = $('#search').value.trim().toLowerCase();
  const now = Date.now();
  const sources = wordsBySource();
  const list = Object.entries(words)
    .filter(([, w]) => filter === 'all' || (filter === 'due' ? w.due <= now : status(w) === filter))
    .filter(([k, w]) => !q || k.includes(q) || shortDef(w).toLowerCase().includes(q))
    .sort((a, b) => b[1].added - a[1].added);

  $('#wordList').innerHTML = list.length ? list.map(([k, w]) => {
    const st = status(w);
    // Words met in the same readings: the "linked notes" of your vocabulary.
    const linked = new Set();
    for (const c of w.contexts) for (const other of sources.get(c.url)?.keys || []) if (other !== k) linked.add(other);
    return `<li><details data-k="${esc(k)}">
      <summary>${mastery(w)}<span class="w">${esc(w.word)}</span><span class="short">${esc(shortDef(w))}</span>
        <span class="stamp" title="Saved">${fmtDateTime(w.added)}</span><span class="tag ${st}">${st}</span></summary>
      <div class="detail">
        ${w.meanings.map((m) => `<h5>${esc(m.pos)}</h5><ol>${m.defs.map((d) => `<li>${esc(d.text)}</li>`).join('')}</ol>`).join('')}
        ${w.contexts.length ? `<h5>Where you met it</h5>${w.contexts.map((c) =>
          `<p class="ctx">${markWord(c.sentence, w.word)}<br><span class="meta">${sourceLink(c)} · ${fmtDateTime(c.at)}</span></p>`).join('')}` : ''}
        ${linked.size ? `<h5>Met alongside</h5><div class="links">${[...linked].map((o) =>
          `<button data-goto="${esc(o)}">${esc(words[o]?.word || o)}</button>`).join('')}</div>` : ''}
        ${w.reviews.length ? `<h5>Your explanations</h5><ul class="answers">${w.reviews.slice().reverse().map((r) =>
          `<li><span class="${r.correct ? 'ok' : 'miss'}">${r.correct ? '✓' : '✗'}</span> ${r.answer ? esc(r.answer) : '<span class="hint">(blank)</span>'}
            <span class="meta">· ${fmtDateTime(r.at)}</span></li>`).join('')}</ul>` : ''}
        <p class="meta">Saved ${fmtDateTime(w.added)} · looked up ${w.lookups}× ·
          ${w.due <= now ? 'due now' : `next review in ${humanGap(w.due - now)}`} · from ${esc(w.source)}
          ${w.sourceUrl ? `(<a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">source</a>)` : ''}</p>
        <button class="bad" data-del="${esc(k)}">Delete word</button>
      </div></details></li>`;
  }).join('') : `<li class="empty"><span class="art">${Object.keys(words).length ? '🔍' : '🌱'}</span>${Object.keys(words).length
    ? 'No words match.' : 'No words yet. Double-click one while you read.'}</li>`;
}

function goto(k) {
  location.hash = '#words';
  $('#search').value = '';
  filter = 'all';
  syncFilters();
  renderWords();
  const d = document.querySelector(`details[data-k="${CSS.escape(k)}"]`);
  if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

$('#wordList').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  const go = e.target.closest('[data-goto]');
  if (del && confirm(`Delete “${words[del.dataset.del]?.word}” and its history?`)) {
    const fresh = await getWords();
    delete fresh[del.dataset.del];
    await saveWords(fresh);
  } else if (go) {
    goto(go.dataset.goto);
  }
});

function syncFilters() {
  for (const b of document.querySelectorAll('#filters button')) b.classList.toggle('on', b.dataset.f === filter);
}
$('#filters').addEventListener('click', (e) => {
  if (!e.target.dataset.f) return;
  filter = e.target.dataset.f;
  syncFilters();
  renderWords();
});
$('#search').addEventListener('input', renderWords);

// ---------- Readings ----------
function renderReadings() {
  const rs = [...wordsBySource().values()].sort((a, b) => b.at - a.at);
  $('#readingList').innerHTML = rs.length ? rs.map((r) => `<li><div class="detail" style="border:0;padding-top:14px">
      <div><strong>${sourceLink(r)}</strong></div>
      <p class="meta">Last read ${fmtDateTime(r.at)} · ${plural(r.keys.size, 'word')}</p>
      <div class="links">${[...r.keys].map((k) => `<button data-goto="${esc(k)}">${esc(words[k]?.word || k)}</button>`).join('')}</div>
    </div></li>`).join('') : '<li class="empty"><span class="art">📚</span>Readings appear here once you define words while reading.</li>';
}
$('#readingList').addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) goto(go.dataset.goto);
});

// ---------- Settings ----------
async function renderSettings() {
  const s = await getSettings();
  const f = $('#settings');
  for (const [k, v] of Object.entries(s)) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = v; else input.value = v;
  }
}
$('#settings').addEventListener('change', async () => {
  const f = $('#settings');
  await saveSettings({
    reminders: f.elements.reminders.checked,
    everyHours: Number(f.elements.everyHours.value),
    quietStart: Number(f.elements.quietStart.value),
    quietEnd: Number(f.elements.quietEnd.value),
    dblclick: f.elements.dblclick.checked,
    autoPdf: f.elements.autoPdf.checked,
  });
  $('#saved').textContent = 'Saved.';
  setTimeout(() => { $('#saved').textContent = ''; }, 1500);
});
async function obsidian(pick) {
  const out = $('#obsidianStatus');
  try {
    out.textContent = 'Exporting…';
    const { n, vault } = await exportToObsidian({ pick });
    out.textContent = `Done: ${n} notes written to “${vault}/Readefine”. Open Obsidian to see them.`;
    $('#obsidian').textContent = `Export again to “${vault}”`;
  } catch (err) {
    out.textContent = err.name === 'AbortError' ? '' : `Export failed: ${err.message}`;
  }
}
$('#obsidian').onclick = () => obsidian(false);
$('#obsidianPick').onclick = () => obsidian(true);
savedVault().then((v) => { if (v) $('#obsidian').textContent = `Export again to “${v.name}”`; }).catch(() => {});
$('#testNotify').onclick = () => chrome.runtime.sendMessage({ type: 'testNotify' });
$('#export').onclick = async () => {
  const d = await getClipData();
  const backup = { app: 'readefine', version: 2, exported: new Date().toISOString(), words,
    clips: d.clips, sources: d.sources, projects: d.projects };
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })),
    download: `readefine-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#import').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.words) throw new Error('not a Readefine backup');
    // Merge: anything already here wins, so importing never loses current progress.
    await saveWords({ ...data.words, ...(await getWords()) });
    if (data.clips) {
      const d = await getClipData();
      await chrome.storage.local.set({
        clips: { ...data.clips, ...d.clips },
        sources: { ...data.sources, ...d.sources },
        projects: { ...data.projects, ...d.projects },
      });
    }
    $('#saved').textContent = `Imported ${plural(Object.keys(data.words).length, 'word')}${data.clips ? ` and ${plural(Object.keys(data.clips).length, 'clip')}` : ''}.`;
  } catch (err) {
    $('#saved').textContent = `Import failed: ${err.message}`;
  }
};

// ---------- Boot ----------
async function load() {
  words = await getWords();
  ({ clips } = await getClipData());
  renderStats();
  renderWords();
  renderReadings();
}
chrome.storage.onChanged.addListener((c) => {
  if (c.clips) { clips = c.clips.newValue || {}; renderStats(); }
  if (!c.words) return;
  words = c.words.newValue || {};
  renderStats();
  renderWords();
  renderReadings();
});

await load();
await renderSettings();
await initClips($('#tab-clips'));
showTab();
