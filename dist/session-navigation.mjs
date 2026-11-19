import { getBankIndex, hasResponse, isScorable } from './core.mjs';
import { attr, button, esc } from './ui.mjs';
import { descendants } from './preparation-scope.mjs';

export function pendingQuestionIndices(session, bank, exam = false) {
  const questions = getBankIndex(bank).questions;
  return session.questionIds.flatMap((id, index) => {
    const question = questions.get(id), response = session.responses?.[id];
    if (!isScorable(question)) return [];
    const complete = exam ? hasResponse(question, session.answers[id]) : response?.graded && typeof response.correct === 'boolean';
    return complete ? [] : [index];
  });
}
export function nextPendingIndex(indices, current) {
  return indices.find(index => index > current) ?? indices.find(index => index < current) ?? null;
}
export function nextPracticeSection(session, bank, pending) {
  if (!session || session.temporary || !['sequential', 'random'].includes(session.mode)) return null;
  if ((pending ?? pendingQuestionIndices(session, bank)).length) return null;

  const index = getBankIndex(bank);
  const ids = new Set(session.questionIds.filter(id => isScorable(index.questions.get(id))));
  const first = index.questions.get(ids.values().next().value);
  if (!first) return null;

  const { subjectId, chapterId } = first;
  const chapters = index.subjects.get(subjectId).chapters;
  const byId = index.chapters.get(subjectId);
  const pools = index.chapterQuestions.get(subjectId);
  // Older saved sessions have no explicit scope. Match the full scorable pool
  // so a filtered or partial round cannot be mistaken for a finished chapter.
  const visited = new Set();
  for (let id = chapterId; id && !visited.has(id); id = byId.get(id)?.parentId) {
    visited.add(id);
    const scorable = pools.get(id)?.filter(isScorable) ?? [];
    if (scorable.length !== ids.size || !scorable.every(q => ids.has(q.id))) continue;

    const subtree = descendants(chapters, id);
    subtree.add(id);
    const last = chapters.findLastIndex(chapter => subtree.has(chapter.id));
    const parents = new Set(chapters.map(chapter => chapter.parentId));
    const next = chapters.slice(last + 1).find(chapter =>
      !parents.has(chapter.id) && pools.get(chapter.id)?.some(isScorable));
    if (!next) return null;
    return { subjectId, chapter: next, questionIds: pools.get(next.id).map(q => q.id) };
  }
  return null;
}

function chapterContinuationHTML(session, bank, pending) {
  const next = nextPracticeSection(session, bank, pending);
  if (!next) return '';
  return button(`跳转至下一小节 <small>${esc(next.chapter.name)}</small>`, 'next-practice-section', '', 'btn primary chapter-continuation');
}

export function sessionNavigationHTML(session, bank, exam = false) {
  const pending = pendingQuestionIndices(session, bank, exam);
  const id = 'question-jump-' + session.id;
  return `${!exam ? '<div class="navigation-legend" aria-label="题号状态说明"><span><i class="legend-correct" aria-hidden="true">✓</i>答对</span><span><i class="legend-wrong" aria-hidden="true">×</i>答错</span><span><i class="legend-pending" aria-hidden="true"></i>待完成</span></div>' : ''}<div class="navigation-tools"><form data-question-jump data-session-id="${attr(session.id)}">
    <label for="${attr(id)}">跳至题号</label><div class="question-jump-row"><input id="${attr(id)}" class="input" name="questionNumber" type="number" inputmode="numeric" min="1" max="${session.questionIds.length}" step="1" required value="${session.index + 1}"><button type="submit" class="btn small">跳转</button></div>
    </form><p data-pending-count class="muted">${exam ? '未答' : '待完成'} ${pending.length} 题</p>
    ${button(exam ? '下一道未答' : '下一道待完成', 'next-pending-question', nextPendingIndex(pending, session.index) === null ? 'disabled' : '', 'btn small')}
    ${!exam && ['prepare-diagnostic', 'prepare-training'].includes(session.mode) ? button('完成本组', 'finish-preparation', pending.length ? 'hidden' : '', 'btn primary') : ''}${exam ? '' : `<div data-chapter-continuation>${chapterContinuationHTML(session, bank, pending)}</div>`}</div>`;
}
export function updateSessionNavigation(root, session, bank, exam = false) {
  const controls = root.querySelector('.navigation-tools');
  if (!controls) return;
  const pending = pendingQuestionIndices(session, bank, exam);
  controls.querySelector('[data-pending-count]').textContent = `${exam ? '未答' : '待完成'} ${pending.length} 题`;
  controls.querySelector('[data-action="next-pending-question"]').disabled = nextPendingIndex(pending, session.index) === null;
  const finish = controls.querySelector('[data-action="finish-preparation"]');
  if (finish) finish.hidden = pending.length > 0;
  const continuation = controls.querySelector('[data-chapter-continuation]');
  if (continuation && !continuation.firstElementChild)
    continuation.innerHTML = chapterContinuationHTML(session, bank, pending);
}
