# Readefine

Read + define. Highlight a word you don't know while reading, get its meaning on the spot, and
Readefine keeps it — with the sentence you found it in — then asks you to explain it back
(teach-back) on a spaced schedule until you know it.

## Install (Chrome or Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `readefine` folder.
4. Pin the green **R** to the toolbar. `Alt+Shift+R` opens it too.

For local PDFs (`file://`), also switch on **Allow access to file URLs** on Readefine's card in
`chrome://extensions`. After editing any file here, press the ↻ reload button on that card.

## Using it

- **Double-click** a word → definition card, saved automatically (Undo if you didn't mean it).
- **Select** a word or short phrase → a small *Define* chip appears. Right-click → *Define with
  Readefine* works too.
- **PDFs** open in Readefine's own viewer automatically, so highlighting works there as well.
  "Browser viewer" in the toolbar switches back to Chrome's viewer.
- **Review** (dashboard or the reminder notification): type what the word means in your own
  words, compare with the definition, and mark *I got it* / *Not yet*.

## Clips: literature-review cards

- **Select a passage** (drag, or triple-click a paragraph) → **📌 Clip**. It's saved with its full
  citation: read from the journal page's metadata, or for PDFs from the DOI via Crossref. Add a
  note on the spot and pick which **project** it belongs to.
- **Clips tab** in the dashboard: each project has its own clips and its own **outline**. Drag
  clips into sections in the order your argument flows; add your thought under each one.
- **Edit citation** (⋯ on any card) fixes a source once for every clip from it; *Fill from DOI*
  completes it automatically.
- **Export**: *Copy draft* pastes straight into Word / Google Docs with in-text citations and a
  reference list (APA 7, Vancouver or Harvard). *Download* gives the whole project as Word
  (.doc) or Markdown, or the references as BibTeX / RIS for Zotero, EndNote and Mendeley.
  Single cards can be copied or downloaded from their ⋯ menu.

## How the schedule works

First quiz an hour after you look a word up. Each correct explanation pushes the next one out:
1 → 3 → 7 → 14 → 30 → 90 days. After four in a row the word counts as **known**. A miss sends it
back to the start. Reminders come at most every few hours (Settings) and stay quiet overnight.

Definitions come from Wiktionary, with Wikipedia as the fallback for technical terms, drug and
gene names, and phrases. Inflected forms ("polymorphisms", "ran") are filed under their base word.

## Files

| File | Role |
| --- | --- |
| `background.js` | Lookups, saving, reminders, badge, PDF redirect |
| `content.js` | The in-page card (also loaded by the PDF viewer) |
| `store.js` | Storage + spaced-repetition rules, shared by everything |
| `app.*` | Dashboard: Review, Words, Clips, Readings, Settings |
| `clips.js` | Clips tab: projects, outline, drag and drop, exports |
| `cite.js` | Citation styles, BibTeX and RIS |
| `popup.*` | Toolbar popup |
| `viewer.*` | PDF viewer built on pdf.js (`lib/`, Apache-2.0) |
| `fonts/` | Fraunces typeface (SIL Open Font License) |

All data lives in the browser (`chrome.storage.local`). Settings → *Export* makes a JSON backup.
