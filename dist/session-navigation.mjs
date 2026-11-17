import { getBankIndex, hasResponse, isScorable } from './core.mjs';
import { attr, button } from './ui.mjs';

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
export function sessionNavigationHTML(session, bank, exam = false) {
  const pending = pendingQuestionIndices(session, bank, exam);
  const id = 'question-jump-' + session.id;
  return `${!exam ? '<div class="navigation-legend" aria-label="题号状态说明"><span><i class="legend-correct" aria-hidden="true">✓</i>答对</span><span><i class="legend-wrong" aria-hidden="true">×</i>答错</span><span><i class="legend-pending" aria-hidden="true"></i>待完成</span></div>' : ''}<div class="navigation-tools"><form data-question-jump data-session-id="${attr(session.id)}">
    <label for="${attr(id)}">跳至题号</label><div class="question-jump-row"><input id="${attr(id)}" class="input" name="questionNumber" type="number" inputmode="numeric" min="1" max="${session.questionIds.length}" step="1" required value="${session.index + 1}"><button type="submit" class="btn small">跳转</button></div>
    </form><p data-pending-count class="muted">${exam ? '未答' : '待完成'} ${pending.length} 题</p>
    ${button(exam ? '下一道未答' : '下一道待完成', 'next-pending-question', nextPendingIndex(pending, session.index) === null ? 'disabled' : '', 'btn small')}
    ${!exam && ['prepare-diagnostic', 'prepare-training'].includes(session.mode) ? button('完成本组', 'finish-preparation', pending.length ? 'hidden' : '', 'btn primary') : ''}</div>`;
}
export function updateSessionNavigation(root, session, bank, exam = false) {
  const controls = root.querySelector('.navigation-tools');
  if (!controls) return;
  const pending = pendingQuestionIndices(session, bank, exam);
  controls.querySelector('[data-pending-count]').textContent = `${exam ? '未答' : '待完成'} ${pending.length} 题`;
  controls.querySelector('[data-action="next-pending-question"]').disabled = nextPendingIndex(pending, session.index) === null;
  const finish = controls.querySelector('[data-action="finish-preparation"]');
  if (finish) finish.hidden = pending.length > 0;
}
