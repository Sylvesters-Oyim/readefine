import * as pdfjs from './lib/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const docEl = $('doc');
let pdf = null;
let zoom = 1; // relative to fit-width
let observer = null;

async function open(source, name, originalUrl = '') {
  $('err').textContent = '';
  try {
    pdf = await pdfjs.getDocument({ ...source, isEvalSupported: false }).promise;
  } catch (e) {
    $('err').textContent = originalUrl.startsWith('file:')
      ? 'Chrome blocked reading this local file. Use “Open PDF…”, or enable “Allow access to file URLs” for Readefine in chrome://extensions.'
      : `Couldn't open this PDF (${e.message}).`;
    return;
  }
  const meta = await pdf.getMetadata().catch(() => null);
  const title = meta?.info?.Title?.trim() || name;
  document.title = title;
  $('name').textContent = title;
  $('pages').textContent = `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`;
  // Tells content.js where words were found.
  window.__readefineSource = originalUrl || `pdf:${name}`;
  window.__readefineTitle = title;
  if (originalUrl && !originalUrl.startsWith('file:')) {
    $('original').hidden = false;
    $('original').href = `${originalUrl}#readefine-off`;
  }
  await layout();
  if (target) goToTarget();
  window.__readefineCitation = await pdfCitation(meta, title, window.__readefineSource);
}

// Best-effort citation for clips. A DOI is what matters: Crossref fills in the rest.
async function pdfCitation(meta, title, url) {
  let doi = '';
  try { doi = meta?.metadata?.get('prism:doi') || ''; } catch { /* no XMP metadata */ }
  if (!doi) {
    for (let n = 1; n <= Math.min(2, pdf.numPages) && !doi; n++) {
      const text = (await (await pdf.getPage(n)).getTextContent()).items.map((i) => i.str).join(' ');
      doi = (text.match(/\b10\.\d{4,9}\/[^\s"<>]+/) || [''])[0].replace(/[.,;)\]]+$/, '');
    }
  }
  const author = meta?.info?.Author?.trim() || '';
  const authors = author
    ? author.split(/\s*(?:;|\band\b|&)\s*/).filter(Boolean).map((a) => {
      if (a.includes(',')) { const [family, given = ''] = a.split(/,\s*/); return { family, given }; }
      const parts = a.split(/\s+/);
      return { family: parts.pop(), given: parts.join(' ') };
    })
    : [];
  return { title, authors, doi, url, publisher: '' };
}

async function layout() {
  observer?.disconnect();
  docEl.textContent = '';
  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const fit = Math.min((docEl.clientWidth - 32) / base.width, 1.6);
  const scale = fit * zoom;
  $('zoom').textContent = `${Math.round(zoom * 100)}%`;

  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !e.target.dataset.done) {
        e.target.dataset.done = '1';
        e.target.rendered = renderPage(e.target, Number(e.target.dataset.n), scale);
      }
    }
  }, { rootMargin: '800px 0px' });

  for (let n = 1; n <= pdf.numPages; n++) {
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.n = n;
    // Placeholder size from page 1; corrected when the page renders.
    div.style.width = `${base.width * scale}px`;
    div.style.height = `${base.height * scale}px`;
    docEl.appendChild(div);
    observer.observe(div);
  }
}

async function renderPage(div, n, scale) {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale });
  div.style.width = `${viewport.width}px`;
  div.style.height = `${viewport.height}px`;
  div.style.setProperty('--scale-factor', scale);

  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  div.appendChild(canvas);
  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport,
    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
  }).promise;

  const text = document.createElement('div');
  text.className = 'textLayer';
  div.appendChild(text);
  await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
  const end = document.createElement('div');
  end.className = 'endOfContent';
  text.appendChild(end);
  text.addEventListener('mousedown', () => text.classList.add('selecting'));
  document.addEventListener('mouseup', () => text.classList.remove('selecting'));
}

// ---------- Opened from a clip: #page=N&text=… → scroll there and highlight the passage ----------
const target = (() => {
  const h = new URLSearchParams(location.hash.slice(1));
  return h.get('page') || h.get('text') ? { page: Number(h.get('page')) || null, text: h.get('text') || '' } : null;
})();

// Compare on letters and digits only: PDF text layers split lines, hyphenate and space oddly.
const squash = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

async function findPage(text) {
  const needle = squash(text).slice(0, 60);
  for (let n = 1; n <= pdf.numPages; n++) {
    const items = (await (await pdf.getPage(n)).getTextContent()).items;
    if (squash(items.map((i) => i.str).join('')).includes(needle)) return n;
  }
  return null;
}

function findRange(layer, text) {
  let hay = '';
  const map = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    for (let i = 0; i < node.data.length; i++) {
      const ch = node.data[i];
      if (/[\p{L}\p{N}]/u.test(ch)) { hay += ch.toLowerCase(); map.push([node, i]); }
    }
  }
  const needle = squash(text);
  let len = needle.length;
  let at = hay.indexOf(needle);
  if (at < 0) { len = Math.min(60, needle.length); at = hay.indexOf(needle.slice(0, len)); }
  if (at < 0 || !len) return null;
  const range = document.createRange();
  range.setStart(map[at][0], map[at][1]);
  const [endNode, endOff] = map[at + len - 1];
  range.setEnd(endNode, endOff + 1);
  return range;
}

async function goToTarget() {
  if (!target.page && target.text) target.page = await findPage(target.text);
  const div = docEl.querySelector(`.page[data-n="${target.page || 1}"]`);
  if (!div) return;
  div.scrollIntoView({ block: 'start' });
  if (!target.text) return;
  for (let i = 0; i < 50 && !div.rendered; i++) await new Promise((r) => setTimeout(r, 100));
  await div.rendered;
  const range = findRange(div.querySelector('.textLayer'), target.text);
  if (!range) return;
  if (window.CSS?.highlights && window.Highlight) CSS.highlights.set('readefine-clip', new Highlight(range));
  else { getSelection().removeAllRanges(); getSelection().addRange(range); }
  range.startContainer.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function setZoom(z) {
  if (!pdf) return;
  const ratio = window.scrollY / Math.max(1, document.body.scrollHeight);
  zoom = Math.min(3, Math.max(0.5, z));
  layout().then(() => window.scrollTo(0, ratio * document.body.scrollHeight));
}

$('zoomIn').onclick = () => setZoom(zoom + 0.15);
$('zoomOut').onclick = () => setZoom(zoom - 0.15);

async function openFile(file) {
  if (!file) return;
  open({ data: new Uint8Array(await file.arrayBuffer()) }, file.name);
}
$('pick').onchange = (e) => openFile(e.target.files[0]);
document.addEventListener('dragover', (e) => { e.preventDefault(); $('drop')?.classList.add('over'); });
document.addEventListener('drop', (e) => { e.preventDefault(); openFile(e.dataTransfer.files[0]); });

const file = new URLSearchParams(location.search).get('file');
if (file) {
  const name = decodeURIComponent(file.split(/[?#]/)[0].split('/').pop() || 'document.pdf');
  open({ url: file }, name, file);
}
