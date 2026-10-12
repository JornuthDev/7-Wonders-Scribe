// Indented bullet strings keep old releases and the existing DB schema compatible.
export function parseNotes(notes) {
  const roots = [], stack = [];
  for (const raw of notes) {
    const match = /^(\s*)[-•*]\s+(.+)$/.exec(raw);
    const requested = match ? Math.floor(match[1].replaceAll('\t', '    ').length / 2) : 0;
    const depth = Math.min(requested, stack.length);
    const node = {text: match ? match[2].trim() : raw.trim(), children: []};
    if (!node.text) continue;
    (depth ? stack[depth - 1].children : roots).push(node);
    stack.length = depth;
    stack.push(node);
  }
  return roots;
}

export function noteList(notes, document = globalThis.document) {
  function render(nodes) {
    const list = document.createElement('ul');
    for (const node of nodes) {
      const item = document.createElement('li');
      item.textContent = node.text;
      if (node.children.length) item.append(render(node.children));
      list.append(item);
    }
    return list;
  }
  return render(parseNotes(notes));
}
