import { getWords, getClipData, dueList, progress } from './store.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const words = await getWords();
const { clips } = await getClipData();
const p = progress(words, clips);
const due = dueList(words);

$('#streak').innerHTML = `<span class="flame">🔥</span><b>${p.streak}</b> day${p.streak === 1 ? '' : 's'}`;
$('#nWords').textContent = p.total;
$('#nClips').textContent = Object.keys(clips).length;

// Small version of the dashboard ring.
const r = 30;
const C = 2 * Math.PI * r;
const known = p.total ? (p.known / p.total) * C : 0;
const learning = p.total ? ((p.learning + p.new) / p.total) * C : 0;
$('#today').innerHTML = `
  <div class="ring"><svg width="72" height="72" viewBox="0 0 72 72">
    <circle class="track" cx="36" cy="36" r="${r}" fill="none" stroke-width="8"/>
    ${known ? `<circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${Math.max(0, known - 2)} ${C}"/>` : ''}
    ${learning ? `<circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--marker)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${Math.max(0, learning - 2)} ${C}" stroke-dashoffset="${-known}"/>` : ''}
  </svg><div class="center"><b>${p.known}</b><span>known</span></div></div>
  <div>
    <h3>${due.length ? `<em>${due.length} word${due.length === 1 ? '' : 's'}</em> ready to teach back` : p.total ? 'All caught up. <em>Nice.</em>' : 'Your word bank is <em>empty</em>'}</h3>
    ${due.length ? `<div class="due">${due.slice(0, 3).map((w) => `<span>${esc(w.word)}</span>`).join('')}${due.length > 3 ? `<span>+${due.length - 3}</span>` : ''}</div>` : ''}
    <button class="${due.length ? 'primary' : ''}" id="review">${due.length ? 'Start review →' : 'Open dashboard'}</button>
  </div>`;

const open = async (hash) => {
  await chrome.runtime.sendMessage({ type: 'openApp', hash });
  window.close();
};
$('#review').onclick = () => open('#review');
$('#words').onclick = () => open('#words');
$('#clips').onclick = () => open('#clips');
$('#draw').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'draw' });
    window.close();
  } catch {
    $('#result').innerHTML = '<span class="hint">Can’t draw here. Refresh the page first (it won’t work on browser pages like the Web Store).</span>';
  }
};

// If the current tab looks like a PDF, open that one; otherwise open an empty viewer to pick a file.
$('#pdf').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const viewer = chrome.runtime.getURL('viewer.html');
  const url = tab?.url && /^(https?|file):/.test(tab.url) && /\.pdf([?#]|$)/i.test(tab.url)
    ? `${viewer}?file=${encodeURIComponent(tab.url.replace(/#readefine-off$/, ''))}`
    : viewer;
  await chrome.tabs.create({ url });
  window.close();
};

$('#q').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#word').value.trim();
  if (!text) return;
  $('#result').innerHTML = '<span class="hint">Looking it up…</span>';
  const res = await chrome.runtime.sendMessage({ type: 'define', text, title: 'Typed in Readefine' });
  if (!res.ok) {
    $('#result').innerHTML = '<span class="hint">No definition found. Try the base form of the word.</span>';
    return;
  }
  const w = res.entry;
  $('#result').innerHTML = `<span class="w"><span class="mark">${esc(w.word)}</span></span>
    ${w.meanings.slice(0, 2).map((m) => `<div><em class="hint">${esc(m.pos)}</em> ${esc(m.defs[0].text)}</div>`).join('')}
    <div class="hint" style="margin-top:6px">${res.repeat ? `Looked up ${w.lookups}×` : 'Saved ✓ · first teach-back in an hour'}</div>`;
};
