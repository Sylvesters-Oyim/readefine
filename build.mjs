// Packages Readefine for Chrome-family browsers and for Firefox from the same source.
//   node build.mjs   →   dist/readefine-chrome-<version>.zip
//                        dist/readefine-firefox-<version>.zip  (+ unpacked dist/firefox/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './zip.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const SKIP = new Set(['.git', 'dist', 'build.mjs', '.gitignore']);

function collect(dir, base = '') {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, collect(path.join(dir, e.name), rel));
    else out[rel] = new Uint8Array(fs.readFileSync(path.join(dir, e.name)));
  }
  return out;
}

const files = collect(root);
const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
const { version } = manifest;

// Firefox: event-page background instead of a service worker, plus the add-on ID Mozilla requires.
const firefox = structuredClone(manifest);
firefox.background = { scripts: ['background.js'], type: 'module' };
firefox.browser_specific_settings = {
  gecko: {
    id: 'readefine@readefine.app',
    strict_min_version: '140.0',
    // Looked-up words and DOIs go to Wiktionary, Wikipedia and Crossref; nothing goes to the developer.
    data_collection_permissions: { required: ['websiteContent'] },
  },
};

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const write = (name, m) => {
  const entries = { ...files, 'manifest.json': `${JSON.stringify(m, null, 2)}\n` };
  fs.writeFileSync(path.join(dist, name), makeZip(entries));
  return entries;
};
write(`readefine-chrome-${version}.zip`, manifest);
const ff = write(`readefine-firefox-${version}.zip`, firefox);

// Unpacked Firefox copy, for about:debugging → Load Temporary Add-on → pick its manifest.json.
for (const [rel, data] of Object.entries(ff)) {
  const p = path.join(dist, 'firefox', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}

console.log(`Built ${version}:`);
for (const f of fs.readdirSync(dist)) console.log(`  dist/${f}`);
