// Returns the widgets sorted by name, ignoring case, as a new array. The input is not changed.
export function listWidgets(widgets) {
  return [...widgets].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
