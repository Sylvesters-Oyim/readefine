// Readefine in-page layer: select a word → definition card. Also loaded by viewer.html for PDFs.
(() => {
  if (window.__readefine) return;
  window.__readefine = true;

  // Underline pens, like marking a printed page. R / O / B on the keyboard.
  const PENS = {
    red: { color: '#e03131', label: 'Important', key: 'r' },
    orange: { color: '#f08c00', label: 'Check later', key: 'o' },
    blue: { color: '#1c7ed6', label: 'My idea', key: 'b' },
  };

  let dblclick = true;
  chrome.storage.local.get('settings').then(({ settings = {} }) => {
    if (settings.dblclick === false) dblclick = false;
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.settings) dblclick = c.settings.newValue?.dblclick !== false;
  });

  // ---------- Shadow-DOM host so page CSS can't touch our UI ----------
  const host = document.createElement('readefine-layer');
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  // Brand serif for the card. Pages with strict font CSP just fall back to Georgia.
  try {
    for (const [file, style] of [['fraunces.woff2', 'normal'], ['fraunces-italic.woff2', 'italic']]) {
      const f = new FontFace('Readefine Serif', `url(${chrome.runtime.getURL(`fonts/${file}`)})`, { style, weight: '100 900' });
      document.fonts.add(f);
      f.load().catch(() => {});
    }
  } catch { /* FontFace unsupported */ }

  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .chip, .card {
      --ink: #1b2230; --muted: #737784; --bg: #f6f1e7; --card: #fffdf8; --line: #e6dcc8; --accent: #17695a;
      --marker: #ffd84d; --marker-soft: #fff1b8; --serif: 'Readefine Serif', Georgia, 'Times New Roman', serif;
      position: absolute; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--ink); background: var(--card); border: 1px solid var(--line);
      box-shadow: 0 2px 6px rgba(27,34,48,.08), 0 18px 44px rgba(27,34,48,.18); border-radius: 16px;
      animation: pop .18s cubic-bezier(.2,.8,.2,1) both; transform-origin: top left; }
    @keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(.97); } to { opacity: 1; transform: none; } }
    @keyframes swipe { from { background-size: 0% 50%; } to { background-size: 100% 50%; } }
    @media (prefers-reduced-motion: reduce) { .chip, .card, .word { animation: none !important; } }
    .chip { display: flex; overflow: hidden; white-space: nowrap; user-select: none; border-radius: 999px;
      background: var(--ink); border-color: var(--ink); color: var(--bg); font-weight: 600; font-size: 13px; }
    .chip span { padding: 6px 13px; cursor: pointer; }
    .chip span + span { border-left: 1px solid rgba(255,255,255,.18); }
    .chip span:hover { background: rgba(255,255,255,.12); }
    .chip .pens { display: flex; gap: 6px; align-items: center; padding: 6px 11px; }
    .chip .pens:hover { background: none; }
    .chip .pens i { width: 15px; height: 15px; border-radius: 50%; background: var(--pen); cursor: pointer;
      box-shadow: 0 0 0 2px rgba(255,255,255,.25); transition: transform .12s; }
    .chip .pens i:hover { transform: scale(1.25); }
    .pen-pop, .pen-nav { position: fixed; display: flex; align-items: center; gap: 7px; padding: 7px 10px; z-index: 1;
      font: 600 12px system-ui, sans-serif; color: #fffdf8; background: #1b2230; border-radius: 999px;
      box-shadow: 0 8px 24px rgba(0,0,0,.25); animation: pop .15s ease both; }
    .pen-pop i, .pen-nav i { width: 14px; height: 14px; border-radius: 50%; background: var(--pen); cursor: pointer;
      box-shadow: 0 0 0 2px rgba(255,255,255,.2); }
    .pen-pop i.on { box-shadow: 0 0 0 2px #fffdf8; }
    .pen-pop button { border: 0; background: none; color: #fffdf8; font: inherit; cursor: pointer; padding: 0 2px; opacity: .8; }
    .pen-pop button:hover { opacity: 1; }
    .pen-nav { position: fixed; right: 16px; bottom: 16px; gap: 10px; }
    .pen-nav span { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    .pen-nav span:hover { opacity: .8; }
    .pen-nav .x { position: static; color: #fffdf8; font-size: 14px; padding: 0 0 0 2px; }
    .card { width: 350px; max-width: calc(100vw - 24px); padding: 16px 18px 12px; }
    .card::before { content: ''; position: absolute; left: 18px; right: 18px; top: 0; height: 3px; border-radius: 0 0 3px 3px;
      background: linear-gradient(90deg, var(--accent), var(--marker)); }
    .head { display: flex; align-items: baseline; gap: 8px; padding-right: 22px; flex-wrap: wrap; }
    .word { font: 600 25px/1.15 var(--serif); letter-spacing: -.01em;
      background-image: linear-gradient(100deg, transparent 0 2%, rgba(255,216,77,.85) 3% 97%, transparent 98%);
      background-repeat: no-repeat; background-position: 0 80%; background-size: 100% 50%;
      animation: swipe .5s .1s cubic-bezier(.2,.8,.2,1) both; padding: 0 2px; }
    .ph { color: var(--muted); font-size: 13px; }
    .x { position: absolute; top: 10px; right: 12px; border: 0; background: none; font-size: 18px;
      color: var(--muted); cursor: pointer; line-height: 1; border-radius: 6px; padding: 2px 5px; }
    .x:hover { background: var(--bg); }
    .pos { margin-top: 12px; font: italic 500 14px var(--serif); color: var(--accent); }
    ol { margin: 4px 0 0; padding-left: 20px; }
    .body { max-height: 260px; overflow: auto; margin-right: -8px; padding-right: 8px; }
    li { margin: 4px 0; }
    li::marker { color: var(--muted); }
    .ex { color: var(--muted); font: italic 13.5px var(--serif); }
    .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px;
      padding-top: 10px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); gap: 8px; }
    .foot button { border: 0; background: none; color: var(--accent); cursor: pointer; font: inherit; font-weight: 600; padding: 0; }
    .foot button:hover { text-decoration: underline; }
    .saved { display: inline-flex; gap: 6px; align-items: center; color: var(--accent); font-weight: 600; }
    .saved .when { color: var(--muted); font-weight: 400; }
    .muted { color: var(--muted); }
    .quote { font: 14.5px/1.55 var(--serif); border-left: 3px solid var(--marker); padding-left: 11px; margin: 10px 0 8px;
      max-height: 100px; overflow: hidden; color: var(--ink); opacity: .85; }
    .cite { font-size: 13px; color: var(--muted); }
    .cite b { color: var(--accent); }
    textarea, select { width: 100%; font: 14px/1.45 system-ui, sans-serif; color: inherit; background: var(--bg);
      border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin-top: 10px; }
    textarea { min-height: 60px; resize: vertical; }
    textarea:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
    .row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
    .row select { margin: 0; flex: 1; }
    .btn { border: 0; background: var(--ink); color: var(--bg); border-radius: 10px; padding: 8px 14px;
      font: 600 13px system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
    .btn:hover { background: var(--accent); }
    .dots::after { content: '…'; animation: d 1s steps(3) infinite; }
    @keyframes d { 0% { content: '.'; } 33% { content: '..'; } 66% { content: '...'; } }
    @media (prefers-color-scheme: dark) {
      .chip, .card { --ink: #eee9df; --muted: #9a9ea8; --bg: #13151a; --card: #1d2027; --line: #2d313a; --accent: #6fd3b4;
        box-shadow: 0 2px 6px rgba(0,0,0,.4), 0 18px 44px rgba(0,0,0,.5); }
      .chip { background: var(--marker); border-color: var(--marker); color: #1b2230; }
      .chip span + span { border-color: rgba(0,0,0,.15); }
      .chip span:hover { background: rgba(0,0,0,.08); }
      .btn { background: var(--accent); color: #0f1a17; }
    }
  </style>`;
  const mount = () => { if (!host.isConnected) document.documentElement.appendChild(host); };

  let chip = null, card = null;
  const clear = () => { chip?.remove(); card?.remove(); chip = card = null; };

  // ---------- Selection helpers ----------
  function cleanSelection(raw) {
    const t = raw.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!t || t.length > 60 || !/\p{L}/u.test(t) || t.split(' ').length > 5) return null;
    return t;
  }

  function sentenceAround(range, text) {
    let el = range.startContainer;
    if (el.nodeType !== 1) el = el.parentElement;
    if (!el) return '';
    const block = el.closest('p,li,td,th,dd,blockquote,figcaption,h1,h2,h3,h4,h5,h6,.textLayer') || el.parentElement || el;
    // PDF text layers put each line in its own span with <br>s between: rejoin with spaces.
    const raw = block.classList.contains('textLayer')
      ? [...block.querySelectorAll('span:not(.markedContent), br')]
        .map((n) => (n.tagName === 'BR' ? ' ' : n.textContent)).join('')
      : block.textContent || '';
    const full = raw.replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    const sentences = full.match(/[^.!?]+(?:[.!?]+|$)/g) || [full];
    let s = (sentences.find((x) => x.toLowerCase().includes(lower)) || '').trim();
    if (s.length > 320) {
      const i = s.toLowerCase().indexOf(lower);
      s = `…${s.slice(Math.max(0, i - 150), i + text.length + 150).trim()}…`;
    }
    return s;
  }

  // Page coordinates just below the selection.
  function anchor(range) {
    const r = range.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.bottom + window.scrollY + 8, w: r.width };
  }

  function place(el, pos, width) {
    const maxX = window.scrollX + document.documentElement.clientWidth - width - 12;
    el.style.left = `${Math.max(window.scrollX + 12, Math.min(pos.x, maxX))}px`;
    el.style.top = `${pos.y}px`;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Card ----------
  async function define(text, pos, sentence) {
    clear();
    mount();
    card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="head"><span class="word">${esc(text)}</span></div>
      <p class="muted dots">Looking it up</p>`;
    root.appendChild(card);
    place(card, pos, 340);
    const mine = card;

    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'define', text, sentence,
        url: window.__readefineSource || location.href,
        title: window.__readefineTitle || document.title,
      });
    } catch {
      res = { ok: false, error: 'Readefine was updated — reload this page to keep using it.' };
    }
    if (card !== mine) return; // closed or replaced while we waited

    if (!res.ok) {
      card.innerHTML = `<button class="x" title="Close">×</button>
        <div class="head"><span class="word">${esc(text)}</span></div>
        <p class="muted">${esc(res.error || 'No definition found. Try selecting a single word or the base form.')}</p>`;
    } else {
      const w = res.entry;
      card.innerHTML = `<button class="x" title="Close">×</button>
        <div class="head"><span class="word">${esc(w.word)}</span><span class="ph">${esc(w.phonetic)}</span></div>
        <div class="body">${w.meanings.map((m) => `<div class="pos">${esc(m.pos)}</div><ol>${m.defs.slice(0, 2).map((d) =>
          `<li>${esc(d.text)}${d.example ? ` <span class="ex">“${esc(d.example)}”</span>` : ''}</li>`).join('')}</ol>`).join('')}</div>
        <div class="foot">
          <span class="saved">${res.repeat ? `Looked up ${w.lookups}×` : `Saved ✓ <span class="when">${new Date(w.added).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>`}
            ${res.repeat ? '' : '<button data-undo>Undo</button>'}</span>
          <span>${esc(w.source)} · <button data-open>My words</button></span>
        </div>`;
      card.querySelector('[data-undo]')?.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'remove', key: res.key });
        card.querySelector('.saved').textContent = 'Not saved';
      });
      card.querySelector('[data-open]').addEventListener('click', () =>
        chrome.runtime.sendMessage({ type: 'openApp', hash: '#words' }));
    }
    card.querySelector('.x').addEventListener('click', clear);
  }

  // ---------- Clips: save a passage with its citation ----------

  // PDF selections break lines (and hyphenate words) mid-sentence: stitch them back.
  const cleanClip = (raw) => raw.replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2').replace(/\s+/g, ' ').trim().slice(0, 8000);

  function parseAuthor(s) {
    s = s.replace(/\s+/g, ' ').trim();
    if (s.includes(',')) {
      const [family, given] = s.split(/,\s*/);
      return { family, given: given || '' };
    }
    const parts = s.split(' ');
    return parts.length > 1 ? { family: parts.pop(), given: parts.join(' ') } : { family: s, given: '' };
  }

  // Journals embed citation metadata in <meta> tags (Google Scholar's citation_* convention).
  function pageCitation() {
    if (window.__readefineCitation) return window.__readefineCitation;
    const all = (...names) => names.flatMap((n) =>
      [...document.querySelectorAll(`meta[name="${n}" i], meta[property="${n}" i]`)].map((m) => (m.content || '').trim()))
      .filter(Boolean);
    const one = (...names) => all(...names)[0] || '';
    let authors = all('citation_author');
    if (!authors.length) authors = all('dc.creator', 'author', 'article:author', 'parsely-author').filter((a) => !/^https?:/.test(a));
    if (authors.length === 1 && authors[0].includes(';')) authors = authors[0].split(';');
    const doiRaw = one('citation_doi', 'prism.doi', 'bepress_citation_doi', 'dc.identifier')
      || (location.href.match(/10\.\d{4,9}\/[^\s?#&]+/) || [''])[0];
    const doi = doiRaw.replace(/^(doi:\s*|https?:\/\/(dx\.)?doi\.org\/)/i, '');
    const date = one('citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date',
      'prism.publicationDate', 'article:published_time');
    const first = one('citation_firstpage');
    const last = one('citation_lastpage');
    return {
      title: one('citation_title', 'dc.title', 'og:title') || document.title,
      authors: authors.map(parseAuthor),
      year: (date.match(/\b(1[89]|20)\d{2}\b/) || [''])[0],
      journal: one('citation_journal_title', 'prism.publicationName', 'citation_conference_title'),
      publisher: one('citation_publisher', 'dc.publisher', 'og:site_name') || location.hostname.replace(/^www\./, ''),
      volume: one('citation_volume', 'prism.volume'),
      issue: one('citation_issue', 'prism.number'),
      pages: first && last ? `${first}-${last}` : first,
      doi: /^10\.\d{4,9}\//.test(doi) ? doi : '',
      url: document.querySelector('link[rel=canonical]')?.href || location.href,
    };
  }

  const pageOf = (range) => {
    let el = range.startContainer;
    if (el.nodeType !== 1) el = el.parentElement;
    return Number(el?.closest('.page')?.dataset.n) || null;
  };

  const shortCite = (s) => {
    const a = s.authors || [];
    const who = !a.length ? (s.publisher || s.title || '') : a.length === 1 ? a[0].family
      : a.length === 2 ? `${a[0].family} & ${a[1].family}` : `${a[0].family} et al.`;
    return `${who} (${s.year || 'n.d.'})`;
  };

  async function clipIt(text, pos, page) {
    clear();
    mount();
    card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="head"><span class="word" style="font-size:16px">📌 Clipping</span></div>
      <div class="quote">${esc(text)}</div><p class="muted dots">Finding the citation</p>`;
    root.appendChild(card);
    place(card, pos, 340);
    const mine = card;

    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'clip', text, page, citation: pageCitation(),
        url: window.__readefineSource || location.href, pdf: Boolean(window.__readefineCitation),
      });
    } catch {
      res = { ok: false };
    }
    if (card !== mine) return;
    if (!res?.ok) {
      card.innerHTML = '<button class="x" title="Close">×</button><p class="muted">Couldn\'t clip that — reload the page and try again.</p>';
      card.querySelector('.x').addEventListener('click', clear);
      return;
    }
    const s = res.source;
    card.innerHTML = `<button class="x" title="Close">×</button>
      <div class="head"><span class="word" style="font-size:16px">📌 Clipped</span></div>
      <div class="quote">${esc(text)}</div>
      <div class="cite"><b>${esc(shortCite(s))}${page ? `, p. ${page}` : ''}</b> · ${esc(s.journal || s.title || '')} · ${new Date(res.clip.created).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
      <textarea placeholder="Your thought: why this matters, how you'll use it (optional)"></textarea>
      <div class="row">
        <select title="Project">${res.projects.map((p) =>
          `<option value="${esc(p.id)}" ${p.id === res.currentProject ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <button class="btn" data-done>Done</button>
      </div>
      <div class="foot"><span class="muted">Ctrl + Enter to save</span><button data-open>Open clips</button></div>`;
    const note = card.querySelector('textarea');
    const project = card.querySelector('select');
    const save = async () => {
      await chrome.runtime.sendMessage({ type: 'updateClip', id: res.clip.id, note: note.value.trim(), project: project.value });
    };
    note.focus();
    note.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) save().then(clear); });
    project.addEventListener('change', save);
    card.querySelector('[data-done]').addEventListener('click', () => save().then(clear));
    card.querySelector('[data-open]').addEventListener('click', () => save().then(() =>
      chrome.runtime.sendMessage({ type: 'openApp', hash: '#clips' })));
    card.querySelector('.x').addEventListener('click', () => save().then(clear));
  }

  function showChip(word, range) {
    clear();
    mount();
    const pos = anchor(range);
    const text = cleanClip(window.getSelection().toString());
    const sentence = word ? sentenceAround(range, word) : '';
    const page = pageOf(range);
    chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `${word ? '<span data-define>📖 Define</span>' : ''}<span data-clip>📌 Clip</span>
      <span class="pens">${Object.entries(PENS).map(([c, p]) =>
        `<i data-pen="${c}" style="--pen:${p.color}" title="Underline: ${p.label} (press ${p.key.toUpperCase()})"></i>`).join('')}</span>`;
    chip.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
    chip.querySelector('[data-define]')?.addEventListener('click', () => define(word, pos, sentence));
    chip.querySelector('[data-clip]').addEventListener('click', () => clipIt(text, pos, page));
    for (const pen of chip.querySelectorAll('[data-pen]')) {
      pen.addEventListener('click', () => { underlineSelection(pen.dataset.pen); clear(); });
    }
    root.appendChild(chip);
    place(chip, pos, word ? 260 : 170);
  }

  // ---------- Events ----------
  const editable = (el) => el?.closest?.('input,textarea,[contenteditable=""],[contenteditable="true"]');

  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || e.composedPath().includes(host) || editable(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const raw = sel.toString();
      const word = cleanSelection(raw);
      const range = sel.getRangeAt(0);
      if (e.detail === 2 && dblclick && word) define(word, anchor(range), sentenceAround(range, word));
      else if (e.detail !== 2 && /\p{L}/u.test(raw)) showChip(word, range); // drag or triple-click (paragraph)
    }, 10);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!e.composedPath().includes(host)) {
      chip?.remove(); chip = null;
      if (card && e.detail < 2) { card.remove(); card = null; }
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clear();
    // Pen shortcuts: select text, then R / O / B. Only with a selection and outside text fields.
    if (e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
    const pen = Object.keys(PENS).find((c) => PENS[c].key === e.key.toLowerCase());
    const sel = window.getSelection();
    if (!pen || !sel || sel.isCollapsed || !/\S/.test(sel.toString())) return;
    e.preventDefault();
    e.stopPropagation();
    underlineSelection(pen);
    clear();
  }, true);

  // Right-click menu → "Define with Readefine" / "Clip selection to Readefine"
  chrome.runtime.onMessage.addListener((msg) => {
    const sel = window.getSelection();
    if (msg.type === 'clipSelection') {
      const text = cleanClip(sel?.toString() || msg.text || '');
      if (!text) return;
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      clipIt(text, range ? anchor(range) : { x: window.scrollX + 40, y: window.scrollY + 40 }, range ? pageOf(range) : null);
      return;
    }
    if (msg.type !== 'show') return;
    const text = cleanSelection(msg.text || '');
    if (!text) return;
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      define(text, anchor(range), sentenceAround(range, text));
    } else {
      define(text, { x: window.scrollX + 40, y: window.scrollY + 40 }, '');
    }
  });
  // ---------- Saved words, underlined wherever you read ----------
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE',
    'SVG', 'MATH', 'TITLE', 'HEAD', 'READEFINE-MARK', 'READEFINE-LAYER', 'READEFINE-UL', 'BUTTON']);
  let matcher = null; // { re, info: Map(lowercase form → { status, title }) }
  let marking = true;
  let observer = null;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

  function buildMatcher(words) {
    const info = new Map();
    for (const w of Object.values(words || {})) {
      const status = !w.reviews?.length ? 'new' : w.stage >= 4 ? 'known' : 'learning';
      const def = w.meanings?.[0]?.defs?.[0]?.text || '';
      const title = `${w.word}: ${def.length > 140 ? `${def.slice(0, 140)}…` : def}  (Readefine · ${status})`;
      for (const f of [w.word, ...(w.forms || [])]) if (f && f.length >= 3) info.set(f.toLowerCase(), { status, title });
    }
    if (!info.size) return null;
    const alts = [...info.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    // Whole words only, allowing simple endings: obfuscate → obfuscated, obfuscates, obfuscating.
    return { info, re: new RegExp(`(?<![\\p{L}\\p{N}])(${alts})(?:s|es|d|ed|ing)?(?![\\p{L}\\p{N}])`, 'giu') };
  }

  function skippable(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName) || e.isContentEditable) return true;
    }
    return false;
  }

  function markIn(rootNode) {
    if (!matcher || !rootNode) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.data.length < 3 || skippable(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const targets = [];
    for (let n, count = 0; (n = walker.nextNode()) && count < 20000; count++) {
      matcher.re.lastIndex = 0;
      if (matcher.re.test(n.data)) targets.push(n);
    }
    for (const node of targets) {
      const frag = document.createDocumentFragment();
      let last = 0;
      matcher.re.lastIndex = 0;
      for (const m of node.data.matchAll(matcher.re)) {
        const meta = matcher.info.get(m[1].toLowerCase());
        if (!meta) continue;
        frag.append(node.data.slice(last, m.index));
        const mark = document.createElement('readefine-mark');
        mark.textContent = m[0];
        mark.dataset.status = meta.status;
        mark.title = meta.title;
        frag.append(mark);
        last = m.index + m[0].length;
      }
      if (!last) continue;
      frag.append(node.data.slice(last));
      node.replaceWith(frag);
    }
  }

  function unmarkAll() {
    for (const m of document.querySelectorAll('readefine-mark')) {
      const parent = m.parentNode;
      m.replaceWith(...m.childNodes); // keep any pen underline inside the word
      parent?.normalize();
    }
  }

  function refreshMarks(words) {
    observer?.disconnect();
    unmarkAll();
    matcher = marking ? buildMatcher(words) : null;
    if (!matcher || !document.body) return;
    markIn(document.body);
    // Pages that load content later (feeds, PDF text layers): mark new bits as they arrive.
    let pending = [];
    let timer = null;
    observer = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && n.tagName !== 'READEFINE-MARK' && n !== host) pending.push(n);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const batch = pending.filter((n) => n.isConnected);
        pending = [];
        observer.disconnect();
        for (const n of batch) markIn(n);
        observer.observe(document.body, { childList: true, subtree: true });
      }, 600);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  chrome.storage.local.get(['words', 'settings']).then(({ words, settings = {} }) => {
    marking = settings.highlightSaved !== false;
    idle(() => refreshMarks(words));
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.settings) marking = c.settings.newValue?.highlightSaved !== false;
    if (c.words || c.settings) chrome.storage.local.get('words').then(({ words }) => idle(() => refreshMarks(words)));
  });

  // ---------- Pens: coloured underlines that stay on the page (never clips or words) ----------
  // Stored per page and found again on your next visit by their text plus a little of what precedes it.
  const pageKey = () => (window.__readefineSource || location.href).split('#')[0];
  const NO_INDEX = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TITLE']);
  let lines = [];   // underlines saved for this page
  let pending = []; // saved but not found yet (page still loading, PDF page not rendered)
  let pop = null;
  let nav = null;
  let navHidden = false;
  const cycle = {};

  async function saveLines() {
    const { underlines = {} } = await chrome.storage.local.get('underlines');
    if (lines.length) underlines[pageKey()] = lines; else delete underlines[pageKey()];
    await chrome.storage.local.set({ underlines });
  }

  // Page text as non-space characters, with where each one lives. Ignoring whitespace makes
  // selections across paragraphs, line breaks and PDF text layers line up with what's stored.
  function textIndex() {
    let hay = '';
    const map = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (NO_INDEX.has(n.parentElement?.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n; (n = walker.nextNode());) {
      for (let i = 0; i < n.data.length; i++) {
        if (!/\s/.test(n.data[i])) { hay += n.data[i]; map.push([n, i]); }
      }
    }
    return { hay, map };
  }

  function wrap(map, start, end, line) {
    // Group the characters by text node, then wrap each node's slice in its own element.
    const groups = [];
    for (let k = start; k < end; k++) {
      const [n, i] = map[k];
      const g = groups.at(-1);
      if (g && g.node === n) g.to = i + 1; else groups.push({ node: n, from: i, to: i + 1 });
    }
    for (const { node, from, to } of groups) {
      let mid = node;
      if (from > 0) mid = node.splitText(from);
      if (to - from < mid.data.length) mid.splitText(to - from);
      const el = document.createElement('readefine-ul');
      el.dataset.color = line.color;
      el.dataset.id = line.id;
      el.title = `${PENS[line.color].label} · ${new Date(line.created).toLocaleString(undefined,
        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · click to change`;
      mid.replaceWith(el);
      el.append(mid);
    }
  }

  function underlineSelection(color) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const { hay, map } = textIndex();
    let start = -1;
    let end = -1;
    for (let k = 0; k < map.length; k++) {
      const [n, i] = map[k];
      if (!range.intersectsNode(n) || range.comparePoint(n, i) < 0) continue;
      if (range.comparePoint(n, i + 1) > 0) break;
      if (start < 0) start = k;
      end = k + 1;
    }
    if (start < 0) return;
    const line = {
      id: crypto.randomUUID().slice(0, 8), color, created: Date.now(),
      text: hay.slice(start, end), before: hay.slice(Math.max(0, start - 32), start),
    };
    wrap(map, start, end, line);
    sel.removeAllRanges();
    lines.push(line);
    saveLines();
    renderNav();
  }

  // Best match for a stored underline: same text, preferring the spot whose preceding text matches.
  function locate(hay, line) {
    let best = -1;
    let bestScore = -1;
    for (let at = hay.indexOf(line.text); at >= 0; at = hay.indexOf(line.text, at + 1)) {
      let score = 0;
      while (score < line.before.length && hay[at - 1 - score] === line.before[line.before.length - 1 - score]) score++;
      if (score > bestScore) { best = at; bestScore = score; }
      if (score === line.before.length) break;
    }
    return best;
  }

  function restore() {
    if (!pending.length || !document.body) return;
    let { hay, map } = textIndex();
    const found = [];
    pending = pending.filter((line) => {
      const at = locate(hay, line);
      if (at < 0) return true;
      found.push({ line, at });
      return false;
    });
    // Wrap from the bottom of the page up, so earlier positions in the index stay valid.
    found.sort((a, b) => b.at - a.at);
    let floor = Infinity;
    for (const { line, at } of found) {
      if (at + line.text.length > floor) ({ hay, map } = textIndex()); // overlapping underlines: re-index
      const pos = at + line.text.length > floor ? locate(hay, line) : at;
      if (pos >= 0) wrap(map, pos, pos + line.text.length, line);
      floor = Math.min(floor, pos);
    }
    if (found.length) renderNav();
  }

  function elementsOf(id) { return document.querySelectorAll(`readefine-ul[data-id="${CSS.escape(id)}"]`); }

  function removeLine(id) {
    for (const el of elementsOf(id)) {
      const parent = el.parentNode;
      el.replaceWith(...el.childNodes);
      parent?.normalize();
    }
    lines = lines.filter((l) => l.id !== id);
    saveLines();
    renderNav();
  }

  function recolour(id, color) {
    const line = lines.find((l) => l.id === id);
    if (!line) return;
    line.color = color;
    for (const el of elementsOf(id)) el.dataset.color = color;
    saveLines();
    renderNav();
  }

  function closePop() { pop?.remove(); pop = null; }

  function showPop(el, x, y) {
    closePop();
    mount();
    const id = el.dataset.id;
    pop = document.createElement('div');
    pop.className = 'pen-pop';
    pop.innerHTML = `${Object.entries(PENS).map(([c, p]) =>
      `<i data-pen="${c}" class="${c === el.dataset.color ? 'on' : ''}" style="--pen:${p.color}" title="${p.label}"></i>`).join('')}
      <button data-remove title="Remove underline">Remove</button>`;
    pop.style.left = `${Math.min(x, window.innerWidth - 170)}px`;
    pop.style.top = `${Math.min(y + 14, window.innerHeight - 50)}px`;
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    for (const i of pop.querySelectorAll('[data-pen]')) i.addEventListener('click', () => { recolour(id, i.dataset.pen); closePop(); });
    pop.querySelector('[data-remove]').addEventListener('click', () => { removeLine(id); closePop(); });
    root.appendChild(pop);
  }

  // Corner pill: how many underlines of each colour, click a colour to jump through them.
  function renderNav() {
    const ids = {};
    for (const el of document.querySelectorAll('readefine-ul')) (ids[el.dataset.color] ||= new Set()).add(el.dataset.id);
    const total = Object.values(ids).reduce((n, s) => n + s.size, 0);
    if (!total || navHidden) { nav?.remove(); nav = null; return; }
    mount();
    if (!nav) {
      nav = document.createElement('div');
      nav.className = 'pen-nav';
      nav.addEventListener('mousedown', (e) => e.preventDefault());
      nav.addEventListener('click', (e) => {
        if (e.target.closest('.x')) { navHidden = true; renderNav(); return; }
        const color = e.target.closest('[data-color]')?.dataset.color;
        if (color) jump(color);
      });
      root.appendChild(nav);
    }
    nav.innerHTML = `${Object.keys(PENS).filter((c) => ids[c]).map((c) =>
      `<span data-color="${c}" title="Jump to the next ${PENS[c].label.toLowerCase()} underline"><i style="--pen:${PENS[c].color}"></i>${ids[c].size}</span>`).join('')}
      <button class="x" title="Hide">×</button>`;
  }

  function jump(color) {
    // Underlines of this colour in page order, one entry per underline.
    const seen = new Set();
    const firsts = [...document.querySelectorAll(`readefine-ul[data-color="${color}"]`)]
      .filter((el) => !seen.has(el.dataset.id) && seen.add(el.dataset.id));
    if (!firsts.length) return;
    cycle[color] = ((cycle[color] ?? -1) + 1) % firsts.length;
    const el = firsts[cycle[color]];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    for (const part of elementsOf(el.dataset.id)) {
      part.classList.remove('rd-flash');
      void part.offsetWidth; // restart the animation
      part.classList.add('rd-flash');
    }
  }

  document.addEventListener('click', (e) => {
    const ul = e.target.closest?.('readefine-ul');
    if (!ul || e.target.closest('a') || !window.getSelection().isCollapsed) return;
    showPop(ul, e.clientX, e.clientY);
  }, true);
  document.addEventListener('mousedown', (e) => { if (pop && !e.composedPath().includes(host)) closePop(); }, true);

  async function startPens() {
    // In the PDF viewer, wait until it knows which PDF is open so underlines are filed under that PDF.
    if (location.pathname.endsWith('/viewer.html')) {
      for (let i = 0; i < 100 && !window.__readefineSource; i++) await new Promise((r) => setTimeout(r, 100));
    }
    const { underlines = {} } = await chrome.storage.local.get('underlines');
    lines = underlines[pageKey()] || [];
    pending = [...lines];
    restore();
    if (!pending.length) return;
    // Content that arrives later (feeds, PDF pages as you scroll): keep looking until all are found.
    let timer = null;
    const watcher = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        watcher.disconnect();
        restore();
        if (pending.length) watcher.observe(document.body, { childList: true, subtree: true });
      }, 700);
    });
    watcher.observe(document.body, { childList: true, subtree: true });
  }
  idle(() => startPens());
})();
