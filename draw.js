// Readefine drawing pen: draw on any page or PDF like in a printed book. Alt+D (or the popup) to start.
// Drawings are kept per page in this browser only. On web pages they're placed in page coordinates,
// so they can drift if the page's layout changes; in Readefine's PDF viewer they stick to the PDF page.
(() => {
  if (window.__readefineDraw) return;
  window.__readefineDraw = true;

  const TOOLS = {
    red: { color: '#e03131', width: 2.5, label: 'Red pen' },
    orange: { color: '#f08c00', width: 2.5, label: 'Orange pen' },
    blue: { color: '#1c7ed6', width: 2.5, label: 'Blue pen' },
    black: { color: '#1b2230', width: 2, label: 'Black pen' },
    marker: { color: '#ffd43b', width: 16, label: 'Highlighter', marker: true },
  };
  const isViewer = location.pathname.endsWith('/viewer.html');
  const pageKey = () => (window.__readefineSource || location.href).split('#')[0];
  const SVG = 'http://www.w3.org/2000/svg';

  let strokes = [];  // { id, tool, page (PDF page number or null), pts: [[x, y], …] }
  let active = false;
  let tool = 'red';
  let erasing = false;
  let current = null;

  // ---------- Surfaces: where strokes are drawn ----------
  // Web pages: one SVG at document coordinates. PDF viewer: one SVG per page, coordinates 0–1000.
  const host = document.createElement('readefine-ink');
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    svg.doc { position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
    .catcher { position: fixed; inset: 0; cursor: crosshair; touch-action: none; pointer-events: auto; }
    .catcher.erase { cursor: cell; }
    .bar { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-radius: 999px; background: #1b2230; color: #fffdf8; pointer-events: auto;
      font: 600 13px system-ui, -apple-system, 'Segoe UI', sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.3); }
    .bar i { width: 18px; height: 18px; border-radius: 50%; background: var(--c); cursor: pointer; box-shadow: 0 0 0 2px rgba(255,255,255,.2); }
    .bar i.marker { width: 26px; height: 12px; border-radius: 3px; opacity: .85; }
    .bar i.on { box-shadow: 0 0 0 2px #1b2230, 0 0 0 4px #fffdf8; }
    .bar button { border: 0; background: rgba(255,255,255,.1); color: inherit; font: inherit; border-radius: 999px;
      padding: 5px 11px; cursor: pointer; }
    .bar button:hover { background: rgba(255,255,255,.2); }
    .bar button.on { background: #fffdf8; color: #1b2230; }
    .bar .done { background: #ffd84d; color: #1b2230; }
    .bar .sep { width: 1px; height: 18px; background: rgba(255,255,255,.2); }
  </style><svg class="doc"></svg>`;
  const docSvg = shadow.querySelector('svg.doc');

  function pageSvg(n) {
    const page = document.querySelector(`.page[data-n="${n}"]`);
    if (!page) return null;
    let svg = page.querySelector(':scope > svg.rd-ink');
    if (!svg) {
      svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'rd-ink');
      svg.setAttribute('viewBox', '0 0 1000 1000');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;overflow:visible;';
      page.appendChild(svg);
    }
    return svg;
  }

  function pathD(pts) {
    if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]} l0.01 0`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i];
      const [nx, ny] = pts[i + 1];
      d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
    }
    const last = pts.at(-1);
    return `${d} L${last[0]} ${last[1]}`;
  }

  function draw(s) {
    const svg = s.page ? pageSvg(s.page) : docSvg;
    if (!svg) return; // PDF page not laid out yet; drawn when it appears
    let p = svg.querySelector(`[data-id="${s.id}"]`);
    if (!p) {
      p = document.createElementNS(SVG, 'path');
      p.dataset.id = s.id;
      const t = TOOLS[s.tool] || TOOLS.red;
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', t.color);
      p.setAttribute('stroke-width', t.width);
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      if (t.marker) { p.setAttribute('stroke-opacity', '0.4'); p.style.mixBlendMode = 'multiply'; }
      svg.appendChild(p);
    }
    p.setAttribute('d', pathD(s.pts));
  }

  function erase(id) {
    for (const p of [...docSvg.querySelectorAll(`[data-id="${id}"]`), ...document.querySelectorAll(`svg.rd-ink [data-id="${id}"]`)]) p.remove();
  }

  const redrawAll = () => strokes.forEach(draw);

  // ---------- Input ----------
  // Turn a pointer position into stroke coordinates on the right surface.
  function locate(e) {
    if (isViewer) {
      catcher.style.pointerEvents = 'none';
      const page = document.elementFromPoint(e.clientX, e.clientY)?.closest('.page');
      catcher.style.pointerEvents = 'auto';
      if (!page) return null;
      const r = page.getBoundingClientRect();
      return { page: Number(page.dataset.n), x: ((e.clientX - r.left) / r.width) * 1000, y: ((e.clientY - r.top) / r.height) * 1000, scale: 1000 / r.width };
    }
    return { page: null, x: e.clientX + window.scrollX, y: e.clientY + window.scrollY, scale: 1 };
  }
  const round = (v) => Math.round(v * 10) / 10;

  function eraseAt(at) {
    const reach = 10 * at.scale;
    const hit = strokes.filter((s) => s.page === at.page && s.pts.some(([x, y]) => Math.hypot(x - at.x, y - at.y) < reach + (TOOLS[s.tool]?.width || 2) * at.scale));
    if (!hit.length) return;
    for (const s of hit) erase(s.id);
    strokes = strokes.filter((s) => !hit.includes(s));
    save();
  }

  const catcher = document.createElement('div');
  catcher.className = 'catcher';
  catcher.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const at = locate(e);
    if (!at) return;
    catcher.setPointerCapture(e.pointerId);
    if (erasing) { eraseAt(at); current = { erasing: true }; return; }
    current = { id: crypto.randomUUID().slice(0, 8), tool, page: at.page, pts: [[round(at.x), round(at.y)]], scale: at.scale };
    draw(current);
  });
  catcher.addEventListener('pointermove', (e) => {
    if (!current) return;
    const at = locate(e);
    if (!at) return;
    if (current.erasing) { eraseAt(at); return; }
    if (at.page !== current.page) return; // stay on the PDF page the stroke started on
    const [lx, ly] = current.pts.at(-1);
    if (Math.hypot(at.x - lx, at.y - ly) < 1.5 * current.scale) return;
    current.pts.push([round(at.x), round(at.y)]);
    draw(current);
  });
  const finish = () => {
    if (current && !current.erasing) {
      delete current.scale;
      strokes.push(current);
      save();
    }
    current = null;
  };
  catcher.addEventListener('pointerup', finish);
  catcher.addEventListener('pointercancel', finish);

  // ---------- Toolbar ----------
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = `<span>✏️ Draw</span><span class="sep"></span>
    ${Object.entries(TOOLS).map(([k, t]) => `<i data-tool="${k}" class="${t.marker ? 'marker' : ''}" style="--c:${t.color}" title="${t.label}"></i>`).join('')}
    <span class="sep"></span>
    <button data-erase title="Eraser: drag over a drawing to remove it">Eraser</button>
    <button data-undo title="Undo (Ctrl+Z)">Undo</button>
    <button data-clear title="Remove all drawings on this page">Clear page</button>
    <button class="done" data-done title="Stop drawing (Esc)">Done</button>`;
  bar.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) { tool = t.dataset.tool; erasing = false; syncBar(); return; }
    if (e.target.closest('[data-erase]')) { erasing = !erasing; syncBar(); }
    else if (e.target.closest('[data-undo]')) undo();
    else if (e.target.closest('[data-clear]')) {
      if (strokes.length && confirm('Remove all drawings on this page?')) { strokes.forEach((s) => erase(s.id)); strokes = []; save(); }
    } else if (e.target.closest('[data-done]')) toggle(false);
  });
  function syncBar() {
    for (const i of bar.querySelectorAll('[data-tool]')) i.classList.toggle('on', !erasing && i.dataset.tool === tool);
    bar.querySelector('[data-erase]').classList.toggle('on', erasing);
    catcher.classList.toggle('erase', erasing);
  }

  function undo() {
    const s = strokes.pop();
    if (!s) return;
    erase(s.id);
    save();
  }

  function toggle(on = !active) {
    active = on;
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (active) {
      shadow.append(catcher, bar);
      syncBar();
    } else {
      catcher.remove();
      bar.remove();
      current = null;
    }
  }

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input,textarea,[contenteditable=""],[contenteditable="true"]');
    if (e.altKey && !e.ctrlKey && (e.key === 'd' || e.key === 'D' || e.code === 'KeyD') && !typing) {
      e.preventDefault();
      toggle();
    } else if (active && e.key === 'Escape') {
      toggle(false);
    } else if (active && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'draw') toggle();
  });

  // ---------- Saving ----------
  async function save() {
    const { drawings = {} } = await chrome.storage.local.get('drawings');
    if (strokes.length) drawings[pageKey()] = strokes; else delete drawings[pageKey()];
    await chrome.storage.local.set({ drawings });
  }

  async function start() {
    if (isViewer) {
      // Wait for the viewer to know which PDF is open, and redraw as pages are laid out or re-zoomed.
      for (let i = 0; i < 100 && !window.__readefineSource; i++) await new Promise((r) => setTimeout(r, 100));
      const doc = document.getElementById('doc');
      if (doc) new MutationObserver(() => redrawAll()).observe(doc, { childList: true });
    }
    const { drawings = {} } = await chrome.storage.local.get('drawings');
    strokes = drawings[pageKey()] || [];
    if (strokes.length) {
      if (!host.isConnected) document.documentElement.appendChild(host);
      redrawAll();
    }
  }
  start();
})();
