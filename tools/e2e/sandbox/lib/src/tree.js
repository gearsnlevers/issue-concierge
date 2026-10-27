// Flattens a tree of { id, children } nodes into a list of ids, depth first, parent before children.
// One list of visited ids is shared by the whole walk, so a node that appears under two parents is listed once,
// under the first parent that reaches it.
export function flattenTree(node, visited = []) {
  if (visited.includes(node.id)) return [];
  visited.push(node.id);
  const ids = [node.id];
  for (const child of node.children ?? []) {
    ids.push(...flattenTree(child, visited));
  }
  return ids;
}
