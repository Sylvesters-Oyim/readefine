// Clips tab: per-project library of clipped passages + a drag-and-drop outline, with exports.
import { getClipData, newProject, newId, ensureProject } from './store.js';
import { STYLES, esc, shortCite, inText, reference, bibtex, ris, toMarkdown } from './cite.js';
import { exportToObsidian } from './obsidian.js';

let root;
let D = { clips: {}, sources: {}, projects: {}, currentProject: '' };
let style = 'apa';
let dragId = null;
let dirty = false;
const filter = { search: '', source: '' };

const project = () => D.projects[D.currentProject];
const editing = () => root.contains(document.activeElement) && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName);
const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'readefine';
const linkOf = (s) => (s.doi ? `https://doi.org/${s.doi}` : /^https?:/.test(s.url || '') ? s.url : '');

// Read-modify-write on fresh data so we never clobber a clip saved from another tab meanwhile.
async function mutate(fn) {
  const d = await getClipData();
  fn(d);
  await chrome.storage.local.set({ clips: d.clips, sources: d.sources, projects: d.projects, currentProject: d.currentProject });
}

const unplace = (d, id) => {
  for (const p of Object.values(d.projects)) for (const s of p.sections) s.clips = s.clips.filter((x) => x !== id);
};

function debounce(fn, ms = 400) {
  const timers = new Map();
  return (key, ...args) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => fn(key, ...args), ms));
  };
}

function toast(msg) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function download(name, text, type) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([text], { type })),
    download: name,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyRich(html, text) {
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

// ---------- Rendering ----------

function card(c, inOutline) {
  const s = D.sources[c.sourceKey] || {};
  const url = linkOf(s);
  const p = project();
  const others = Object.values(D.projects).filter((x) => x.id !== p.id);
  return `<article class="clip" draggable="true" data-id="${esc(c.id)}">
    <span class="stamp">Clipped ${new Date(c.created).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
    <blockquote title="Click to expand">${esc(c.text)}</blockquote>
    <textarea class="note" data-note="${esc(c.id)}" rows="2" placeholder="Your thought: how will you use this?">${esc(c.note)}</textarea>
    <footer>
      <span class="cite" title="${esc(toMarkdown(reference(s, style)))}">${esc(shortCite(s))}${c.page ? `, p. ${esc(c.page)}` : ''}</span>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="Open the source">↗</a>` : ''}
      <span class="spacer"></span>
      ${!inOutline && p.sections.length ? `<select data-act="place" title="Put in a section"><option value="">Add to…</option>
        ${p.sections.map((x) => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('')}</select>` : ''}
      <details class="menu"><summary title="More">⋯</summary><div>
        <button data-act="copyCard">Copy card</button>
        <button data-act="dlCard">Download card (.md)</button>
        <button data-act="editSource">Edit citation</button>
        ${others.map((o) => `<button data-act="move" data-to="${esc(o.id)}">Move to “${esc(o.name)}”</button>`).join('')}
        ${inOutline ? '<button data-act="unplace">Back to clips</button>' : ''}
        <button data-act="delClip" class="danger">Delete clip</button>
      </div></details>
    </footer>
  </article>`;
}

function libraryClips() {
  const p = project();
  const placed = new Set(p.sections.flatMap((s) => s.clips));
  const q = filter.search.toLowerCase();
  return Object.values(D.clips)
    .filter((c) => c.project === p.id && !placed.has(c.id))
    .filter((c) => !filter.source || c.sourceKey === filter.source)
    .filter((c) => !q || `${c.text} ${c.note} ${D.sources[c.sourceKey]?.title || ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.created - a.created);
}

function renderLibrary() {
  const lib = libraryClips();
  root.querySelector('.lib').innerHTML = lib.map((c) => card(c, false)).join('')
    || `<p class="drop-hint">${Object.values(D.clips).some((c) => c.project === D.currentProject)
      ? 'Everything is in the outline. Drag a card back here to unplace it.'
      : 'No clips yet. Select a passage on any page or PDF and press 📌 Clip.'}</p>`;
  root.querySelector('.lib-count').textContent = `${lib.length} not in the outline`;
}

function render() {
  const p = project();
  if (!p) return;
  const mine = Object.values(D.clips).filter((c) => c.project === p.id);
  const sourceKeys = [...new Set(mine.map((c) => c.sourceKey))];
  if (filter.source && !sourceKeys.includes(filter.source)) filter.source = '';
  root.innerHTML = `
    <div class="clipbar">
      <label class="proj">Project
        <select data-act="project">${Object.values(D.projects).sort((a, b) => a.created - b.created).map((x) =>
          `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          <option value="__new">＋ New project…</option></select></label>
      <button data-act="renameProject">Rename</button>
      <button data-act="deleteProject">Delete</button>
      <span class="spacer"></span>
      <select data-act="style" title="Citation style">${Object.entries(STYLES).map(([k, v]) =>
        `<option value="${k}" ${k === style ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="primary" data-act="copyDraft" title="Paste straight into Word or Google Docs">Copy draft</button>
      <details class="menu right"><summary>Download ▾</summary><div>
        <button data-act="dlDoc">Whole project as Word draft (.doc)</button>
        <button data-act="dlMd">Whole project as Markdown (.md)</button>
        <button data-act="dlBib">References as BibTeX (.bib)</button>
        <button data-act="dlRis">References for Zotero / EndNote / Mendeley (.ris)</button>
        <button data-act="obsidian">Everything to my Obsidian vault</button>
      </div></details>
    </div>
    <div class="board">
      <aside class="library">
        <h3>Clips <span class="hint lib-count"></span></h3>
        <input type="search" data-act="search" placeholder="Search clips…" value="${esc(filter.search)}">
        <select data-act="source"><option value="">All sources (${sourceKeys.length})</option>${sourceKeys.map((k) =>
          `<option value="${esc(k)}" ${k === filter.source ? 'selected' : ''}>${esc(shortCite(D.sources[k]))} · ${esc((D.sources[k]?.title || '').slice(0, 50))}</option>`).join('')}</select>
        <div class="zone lib" data-zone="lib"></div>
      </aside>
      <section class="outline">
        <h3>Outline <span class="hint">drag clips into sections, in the order your argument flows</span></h3>
        ${p.sections.map((s, i) => `<div class="sec" data-sec="${esc(s.id)}">
          <header>
            <input class="sec-title" data-title="${esc(s.id)}" value="${esc(s.title)}" aria-label="Section title">
            <button data-act="secUp" title="Move up" ${i ? '' : 'disabled'}>↑</button>
            <button data-act="secDown" title="Move down" ${i < p.sections.length - 1 ? '' : 'disabled'}>↓</button>
            <button data-act="secDel" title="Remove section (its clips go back to the list)">✕</button>
          </header>
          <div class="zone" data-zone="${esc(s.id)}">${s.clips.map((id) => D.clips[id]).filter(Boolean).map((c) => card(c, true)).join('')
            || '<p class="drop-hint">Drop clips here</p>'}</div>
        </div>`).join('')}
        <button data-act="addSection" class="add">＋ Add section</button>
      </section>
    </div>`;
  renderLibrary();
}

async function reload() {
  D = await getClipData();
  render();
}

// ---------- Drafts & exports ----------

function draftBlocks() {
  const p = project();
  const used = [];
  const num = (k) => {
    let i = used.indexOf(k);
    if (i < 0) { used.push(k); i = used.length - 1; }
    return i + 1;
  };
  const blocks = [{ t: 'h1', h: esc(p.name) }];
  const addClips = (list) => {
    for (const c of list) {
      const s = D.sources[c.sourceKey] || {};
      const n = num(c.sourceKey);
      if (c.note) blocks.push({ t: 'p', h: `${esc(c.note)} ${inText(s, style, { n })}` });
      blocks.push({ t: 'q', h: `“${esc(c.text)}” ${inText(s, style, { n, page: c.page })}` });
    }
  };
  for (const sec of p.sections) {
    blocks.push({ t: 'h2', h: esc(sec.title) });
    addClips(sec.clips.map((id) => D.clips[id]).filter(Boolean));
  }
  const placed = new Set(p.sections.flatMap((s) => s.clips));
  const loose = Object.values(D.clips).filter((c) => c.project === p.id && !placed.has(c.id)).sort((a, b) => a.created - b.created);
  if (loose.length) {
    blocks.push({ t: 'h2', h: 'Unsorted clips' });
    addClips(loose);
  }
  if (used.length) {
    blocks.push({ t: 'h2', h: 'References' });
    const refs = used.map((k) => reference(D.sources[k] || {}, style));
    const list = style === 'vancouver'
      ? refs.map((r, i) => `${i + 1}. ${r}`)
      : refs.sort((a, b) => toMarkdown(a).localeCompare(toMarkdown(b)));
    for (const r of list) blocks.push({ t: 'ref', h: r });
  }
  return blocks;
}

const blocksToHtml = (blocks) => blocks.map(({ t, h }) => ({
  h1: `<h1>${h}</h1>`, h2: `<h2>${h}</h2>`, p: `<p>${h}</p>`,
  q: `<blockquote style="margin-left:2em;color:#444">${h}</blockquote>`,
  ref: `<p style="padding-left:2em;text-indent:-2em">${h}</p>`,
}[t])).join('\n');

const blocksToMd = (blocks) => blocks.map(({ t, h }) => {
  const m = toMarkdown(h);
  return { h1: `# ${m}`, h2: `## ${m}`, p: m, q: `> ${m}`, ref: m }[t];
}).join('\n\n');

const wordDoc = (title, body) => `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt;line-height:1.5} h1{font-size:20pt} h2{font-size:15pt;margin-top:18pt}</style>
</head><body>${body}</body></html>`;

function projectSources() {
  const keys = new Set(Object.values(D.clips).filter((c) => c.project === D.currentProject).map((c) => c.sourceKey));
  return [...keys].map((k) => D.sources[k]).filter(Boolean);
}

function cardBlocks(c) {
  const s = D.sources[c.sourceKey] || {};
  return [
    { t: 'q', h: `“${esc(c.text)}” ${inText(s, style, { n: 1, page: c.page })}` },
    ...(c.note ? [{ t: 'p', h: `<i>My note:</i> ${esc(c.note)}` }] : []),
    { t: 'ref', h: `${style === 'vancouver' ? '1. ' : ''}${reference(s, style)}` },
  ];
}

// ---------- Citation editor ----------

const dlg = document.createElement('dialog');
dlg.className = 'srcdlg';
dlg.innerHTML = `<form method="dialog">
  <h3>Edit citation</h3>
  <p class="hint">Changes apply to every clip from this source.</p>
  <label>Title <input name="title"></label>
  <label>Authors <span class="hint">one per line, “Family, Given”</span><textarea name="authors" rows="4"></textarea></label>
  <div class="grid"><label>Year <input name="year"></label><label>Volume <input name="volume"></label>
    <label>Issue <input name="issue"></label><label>Pages <input name="pages"></label></div>
  <label>Journal <span class="hint">leave empty for web pages</span><input name="journal"></label>
  <label>Publisher / website <input name="publisher"></label>
  <label>DOI <span class="doirow"><input name="doi" placeholder="10.xxxx/…"><button type="button" data-doi>Fill from DOI</button></span></label>
  <label>URL <input name="url"></label>
  <div class="row"><button value="cancel" formnovalidate>Cancel</button><button value="save" class="primary">Save</button></div>
</form>`;
let editingKey = null;
const FIELDS = ['title', 'year', 'volume', 'issue', 'pages', 'journal', 'publisher', 'doi', 'url'];

function fillForm(s) {
  const f = dlg.querySelector('form');
  for (const k of FIELDS) f.elements[k].value = s[k] || '';
  f.elements.authors.value = (s.authors || []).map((a) => (a.given ? `${a.family}, ${a.given}` : a.family)).join('\n');
}

function openEditor(key) {
  editingKey = key;
  fillForm(D.sources[key] || {});
  dlg.showModal();
}

dlg.querySelector('[data-doi]').addEventListener('click', async (e) => {
  const f = dlg.querySelector('form');
  const doi = f.elements.doi.value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (!doi) return;
  e.target.textContent = 'Looking up…';
  const r = await chrome.runtime.sendMessage({ type: 'crossref', doi });
  e.target.textContent = 'Fill from DOI';
  if (r) fillForm({ ...Object.fromEntries(FIELDS.map((k) => [k, f.elements[k].value])), ...r });
  else toast('No record found for that DOI.');
});

dlg.addEventListener('close', async () => {
  if (dlg.returnValue !== 'save' || !editingKey) return;
  const f = dlg.querySelector('form');
  const edited = Object.fromEntries(FIELDS.map((k) => [k, f.elements[k].value.trim()]));
  edited.authors = f.elements.authors.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [family, given = ''] = l.split(/,\s*/);
    return { family, given };
  });
  const key = editingKey;
  await mutate((d) => { d.sources[key] = { ...d.sources[key], ...edited, key, edited: true }; });
});

// ---------- Events ----------

const saveNote = debounce((id, value) => mutate((d) => { if (d.clips[id]) d.clips[id].note = value; }));
const saveTitle = debounce((id, value) => mutate((d) => {
  const s = d.projects[d.currentProject]?.sections.find((x) => x.id === id);
  if (s) s.title = value || 'Untitled section';
}));

async function onClick(e) {
  const quote = e.target.closest('.clip blockquote');
  if (quote) { quote.classList.toggle('open'); return; }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.closest('.clip')?.dataset.id;
  const secId = btn.closest('.sec')?.dataset.sec;
  btn.closest('details')?.removeAttribute('open');
  const p = project();

  if (act === 'renameProject') {
    const name = prompt('Rename project', p.name)?.trim();
    if (name) await mutate((d) => { d.projects[d.currentProject].name = name; });
  } else if (act === 'deleteProject') {
    const n = Object.values(D.clips).filter((c) => c.project === p.id).length;
    if (!confirm(`Delete “${p.name}”${n ? ` and its ${n} clip${n === 1 ? '' : 's'}` : ''}? This can't be undone.`)) return;
    await mutate((d) => {
      for (const c of Object.values(d.clips)) if (c.project === p.id) delete d.clips[c.id];
      delete d.projects[p.id];
      d.currentProject = Object.keys(d.projects)[0] || '';
    });
    await ensureProject();
  } else if (act === 'copyDraft') {
    const blocks = draftBlocks();
    await copyRich(blocksToHtml(blocks), blocksToMd(blocks));
    toast('Draft copied: paste it into Word or Google Docs.');
  } else if (act === 'dlDoc') {
    download(`${slug(p.name)}.doc`, wordDoc(p.name, blocksToHtml(draftBlocks())), 'application/msword');
  } else if (act === 'dlMd') {
    download(`${slug(p.name)}.md`, blocksToMd(draftBlocks()), 'text/markdown');
  } else if (act === 'dlBib') {
    download(`${slug(p.name)}.bib`, projectSources().map(bibtex).join('\n\n'), 'application/x-bibtex');
  } else if (act === 'dlRis') {
    download(`${slug(p.name)}.ris`, projectSources().map(ris).join('\n\n'), 'application/x-research-info-systems');
  } else if (act === 'obsidian') {
    try {
      const { n, vault } = await exportToObsidian();
      toast(vault ? `${n} notes written to “${vault}/Readefine”.` : `Downloaded ${n} notes as a zip: unzip it into your vault.`);
    } catch (err) {
      if (err.name !== 'AbortError') toast(`Obsidian export failed: ${err.message}`);
    }
  } else if (act === 'copyCard') {
    const blocks = cardBlocks(D.clips[id]);
    await copyRich(blocksToHtml(blocks), blocksToMd(blocks));
    toast('Card copied with its citation.');
  } else if (act === 'dlCard') {
    const c = D.clips[id];
    const name = `${slug(shortCite(D.sources[c.sourceKey]))}-${slug(c.text.split(/\s+/).slice(0, 5).join(' '))}.md`;
    download(name, blocksToMd(cardBlocks(c)), 'text/markdown');
  } else if (act === 'editSource') {
    openEditor(D.clips[id].sourceKey);
  } else if (act === 'move') {
    const to = btn.dataset.to;
    await mutate((d) => { unplace(d, id); d.clips[id].project = to; });
    toast(`Moved to “${D.projects[to]?.name}”.`);
  } else if (act === 'unplace') {
    await mutate((d) => unplace(d, id));
  } else if (act === 'delClip') {
    if (!confirm('Delete this clip?')) return;
    await mutate((d) => { unplace(d, id); delete d.clips[id]; });
  } else if (act === 'addSection') {
    await mutate((d) => d.projects[d.currentProject].sections.push({ id: newId(), title: 'New section', clips: [] }));
    await reload();
    const inputs = root.querySelectorAll('.sec-title');
    inputs[inputs.length - 1]?.select();
  } else if (act === 'secUp' || act === 'secDown') {
    await mutate((d) => {
      const secs = d.projects[d.currentProject].sections;
      const i = secs.findIndex((s) => s.id === secId);
      const j = act === 'secUp' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < secs.length) [secs[i], secs[j]] = [secs[j], secs[i]];
    });
  } else if (act === 'secDel') {
    await mutate((d) => {
      const pr = d.projects[d.currentProject];
      pr.sections = pr.sections.filter((s) => s.id !== secId);
    });
  }
}

async function onChange(e) {
  const act = e.target.dataset.act;
  if (act === 'project') {
    if (e.target.value === '__new') {
      const name = prompt('Name the new project (e.g. “Thesis chapter 2”)')?.trim();
      if (!name) { e.target.value = D.currentProject; return; }
      const pr = newProject(name);
      await mutate((d) => { d.projects[pr.id] = pr; d.currentProject = pr.id; });
    } else {
      filter.source = '';
      await chrome.storage.local.set({ currentProject: e.target.value });
    }
  } else if (act === 'style') {
    style = e.target.value;
    await chrome.storage.local.set({ citeStyle: style });
    render();
  } else if (act === 'source') {
    filter.source = e.target.value;
    renderLibrary();
  } else if (act === 'place' && e.target.value) {
    const id = e.target.closest('.clip').dataset.id;
    const to = e.target.value;
    await mutate((d) => {
      unplace(d, id);
      d.projects[d.currentProject].sections.find((s) => s.id === to)?.clips.push(id);
    });
  }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.note) saveNote(t.dataset.note, t.value);
  else if (t.dataset.title) saveTitle(t.dataset.title, t.value.trim());
  else if (t.dataset.act === 'search') { filter.search = t.value; renderLibrary(); }
}

// Drag and drop between the library and outline sections.
const ph = Object.assign(document.createElement('div'), { className: 'ph' });

function onDragStart(e) {
  const c = e.target.closest?.('.clip');
  if (!c) return;
  dragId = c.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  requestAnimationFrame(() => c.classList.add('dragging'));
}

function onDragOver(e) {
  const zone = e.target.closest('.zone');
  if (!zone || !dragId) return;
  e.preventDefault();
  const after = [...zone.querySelectorAll('.clip:not(.dragging)')]
    .find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
  zone.insertBefore(ph, after || null);
}

async function onDrop(e) {
  const zone = e.target.closest('.zone');
  if (!zone || !dragId) return;
  e.preventDefault();
  const id = dragId;
  const index = [...zone.children].filter((n) => n === ph || (n.classList.contains('clip') && !n.classList.contains('dragging')))
    .indexOf(ph);
  ph.remove();
  dragId = null;
  await mutate((d) => {
    unplace(d, id);
    if (zone.dataset.zone !== 'lib') {
      d.projects[d.currentProject].sections.find((s) => s.id === zone.dataset.zone)?.clips.splice(Math.max(0, index), 0, id);
    }
  });
}

function onDragEnd() {
  ph.remove();
  dragId = null;
  root.querySelector('.dragging')?.classList.remove('dragging');
}

export async function initClips(el) {
  root = el;
  document.body.appendChild(dlg);
  ({ citeStyle: style = 'apa' } = await chrome.storage.local.get('citeStyle'));
  await ensureProject();
  await reload();

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  // Typing in a note shouldn't start dragging its card.
  root.addEventListener('mousedown', (e) => {
    const c = e.target.closest('.clip');
    if (c) c.draggable = !e.target.closest('textarea,input,select,button,a,summary');
  });
  root.addEventListener('dragstart', onDragStart);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('drop', onDrop);
  root.addEventListener('dragend', onDragEnd);

  chrome.storage.onChanged.addListener((c) => {
    if (!(c.clips || c.sources || c.projects || c.currentProject)) return;
    if (editing()) { dirty = true; return; } // don't yank the textarea out from under the cursor
    reload();
  });
  root.addEventListener('focusout', () => setTimeout(() => {
    if (dirty && !editing()) { dirty = false; reload(); }
  }, 0));
}
