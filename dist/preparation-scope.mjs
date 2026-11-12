import { getBankIndex, isScorable } from './core.mjs';
import { esc, attr } from './ui.mjs';

export function descendants(chapters, id) {
  const found = new Set(), pending = [id];
  while (pending.length) {
    const current = pending.pop();
    for (const c of chapters) if (c.parentId === current && !found.has(c.id) && c.id !== id) {
      found.add(c.id); pending.push(c.id);
    }
  }
  return found;
}
export function changeScope(chapters, current, id, checked) {
  const next = new Set(current), children = descendants(chapters, id);
  next.delete(id);
  for (const child of children) next.delete(child);
  if (checked) next.add(id);
  return [...next];
}
export function preparationTreeHTML(bank, subjectId, selected) {
  const subject = getBankIndex(bank).subjects.get(subjectId);
  if (!subject) return '';
  const chapters = subject.chapters, chosen = new Set(selected);
  const counts = getBankIndex(bank).chapterQuestions.get(subjectId);
  const row = (c, root = false) => `<label class="${root ? 'preparation-root' : 'preparation-subchapter'}"><input type="checkbox" data-prepare-chapter value="${attr(c.id)}" ${chosen.has(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span><small>${counts.get(c.id).filter(isScorable).length} 题</small>${root ? `<span class="scope-selection" data-scope-selection="${attr(c.id)}"></span>` : ''}</label>`;
  return chapters.filter(c => !c.parentId).map(c => {
    const ids = descendants(chapters, c.id);
    const children = chapters.filter(ch => ids.has(ch.id));
    return `<div class="preparation-scope-group">${row(c, true)}${children.length ? `<details ${children.some(ch => chosen.has(ch.id)) && !chosen.has(c.id) ? 'open' : ''}><summary>选择小节 <span>${children.length} 个</span></summary><div class="preparation-scope-children">${children.map(ch => row(ch)).join('')}</div></details>` : ''}</div>`;
  }).join('');
}
export function syncPreparationTree(container, chapters, selected) {
  const chosen = new Set(selected), byId = new Map(chapters.map(c => [c.id, c]));
  for (const input of container.querySelectorAll('[data-prepare-chapter]')) {
    let parent = byId.get(input.value)?.parentId, inherited = false;
    const visited = new Set();
    while (parent && !visited.has(parent)) {
      visited.add(parent); inherited ||= chosen.has(parent); parent = byId.get(parent)?.parentId;
    }
    input.checked = inherited || chosen.has(input.value);
    input.disabled = inherited;
    input.indeterminate = !input.checked && [...descendants(chapters, input.value)].some(id => chosen.has(id));
    const status = container.querySelector(`[data-scope-selection="${CSS.escape(input.value)}"]`);
    if (status) status.textContent = input.checked ? '整章已选' : input.indeterminate ? '部分已选' : '未选择';
  }
}
