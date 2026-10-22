// Prepends a release section to CHANGELOG.md (harness-only release tooling).
// Used by the release workflow when no LLM key is configured and the notes come
// from GitHub's generated release notes.
//
//   node tools/update-changelog.mjs --tag v1.2.0 --notes RELEASE_NOTES.md [--file CHANGELOG.md] [--date 2026-10-22]
import fs from 'node:fs';

const HEADER = '# Changelog\n';

/**
 * Moves every heading in the notes one level down (GitHub's generated notes start with
 * `## What's Changed`, which would otherwise sit at the level of the release heading it
 * belongs under). Headings inside fenced code blocks are left alone.
 */
export function demoteHeadings(notes) {
  let fenced = false;
  return String(notes)
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      return !fenced && /^#{1,5}\s/.test(line) ? `#${line}` : line;
    })
    .join('\n');
}

/** Returns the changelog text with a new section for `tag` after the title. Throws if the tag is already present. */
export function addRelease(existing, { tag, date, notes }) {
  const heading = `## [${tag}] - ${date}`;
  const text = existing && existing.trim() ? existing : HEADER;
  if (text.includes(`## [${tag}]`)) throw new Error(`CHANGELOG already has a section for ${tag}`);
  const section = `${heading}\n\n${demoteHeadings(String(notes).trim())}\n`;
  const lines = text.split('\n');
  const titleIdx = lines.findIndex((l) => /^# /.test(l));
  if (titleIdx === -1) return `${HEADER}\n${section}\n${text}`;
  // Insert before the first existing release section (or at the end of the preamble).
  let at = lines.findIndex((l, i) => i > titleIdx && /^## /.test(l));
  if (at === -1) at = lines.length;
  const before = lines.slice(0, at).join('\n').replace(/\n+$/, '\n');
  const after = lines.slice(at).join('\n');
  return `${before}\n${section}${after ? `\n${after}` : ''}`.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

export function main(argv = process.argv.slice(2)) {
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const tag = arg('--tag');
  const notesPath = arg('--notes');
  if (!tag || !notesPath) {
    console.error('--tag and --notes are required');
    return 2;
  }
  const file = arg('--file') || 'CHANGELOG.md';
  const date = arg('--date') || new Date().toISOString().slice(0, 10);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  try {
    fs.writeFileSync(file, addRelease(existing, { tag, date, notes: fs.readFileSync(notesPath, 'utf8') }));
  } catch (e) {
    console.error(`::error::${e.message}`);
    return 1;
  }
  console.log(`added ${tag} to ${file}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
