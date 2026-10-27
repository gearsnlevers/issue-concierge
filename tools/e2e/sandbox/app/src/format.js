// Joins items into the text the app prints: one item per line, with a final newline.
export function formatLines(items) {
  return items.map((item) => `${item}\n`).join('');
}
