import { learningCardsHTML } from './question-learning.mjs';
import { renderRich } from './rich-content.mjs';
import { reducedMotion } from './study-motion.mjs';

let trigger = null, closing = null, previousPosition = null;
export function closeLearningPanel({ focus = true } = {}) {
  const panel = document.getElementById('learning-panel');
  if (!panel || panel.hidden) return;
  const finish = () => {
    panel.hidden = true; document.body.classList.remove('learning-panel-open');
    if (focus && previousPosition?.hash === location.hash && previousPosition.questionId === document.querySelector('.question-main')?.dataset.questionId)
      window.scrollTo({ top:previousPosition.y, behavior:'instant' });
    previousPosition = null;
    if (focus) (trigger?.isConnected ? trigger : document.querySelector('[data-action="question-learning"]'))?.focus({ preventScroll:true });
  };
  closing?.cancel();
  if (reducedMotion()) finish();
  else {
    const animation = panel.animate([{ opacity:1, transform:'translateY(0)' }, { opacity:0, transform:'translateY(6px)' }], { duration:120 });
    closing = animation;
    animation.finished.then(() => { if (closing === animation) { closing = null; finish(); } }).catch(() => {});
  }
}
export function openLearningPanel(question, bank, state, { reveal = true } = {}) {
  const panel = document.getElementById('learning-panel');
  if (panel.hidden) previousPosition = { hash:location.hash, questionId:question.id, y:scrollY };
  closing?.cancel(); closing = null;
  if (!panel.contains(document.activeElement)) trigger = document.activeElement;
  panel.querySelector('[data-learning-content]').innerHTML = learningCardsHTML(question, bank, state, { expanded:true });
  panel.dataset.questionId = question.id;
  renderRich(panel); panel.hidden = false; panel.scrollTop = 0;
  document.body.classList.add('learning-panel-open');
  if (!reducedMotion()) panel.animate([{ opacity:0, transform:'translateY(6px)' }, { opacity:1, transform:'translateY(0)' }], { duration:160 });
  if (reveal) panel.querySelector('[data-action="close-learning"]')?.focus({ preventScroll:true });
  if (reveal && matchMedia('(max-width:1099px)').matches) {
    const title = document.querySelector('.question-main > .question-title');
    if (title) window.scrollTo({ top:Math.max(0,scrollY + title.getBoundingClientRect().top - 90), behavior:reducedMotion()?'instant':'smooth' });
  }
}
export function syncLearningPanel(question, bank, state, active) {
  const panel = document.getElementById('learning-panel');
  if (!panel || panel.hidden) return;
  if (!active) { closeLearningPanel({ focus:false }); return; }
  if (!question) {
    panel.dataset.questionId = '';
    panel.querySelector('[data-learning-content]').innerHTML = '<p role="status">正在加载下一题的知识卡片…</p>';
    return;
  }
  if (panel.dataset.questionId !== question.id) {
    const focus = document.activeElement;
    openLearningPanel(question, bank, state, { reveal:false });
    if (focus?.isConnected && !panel.contains(focus)) focus.focus({ preventScroll:true });
  }
}
