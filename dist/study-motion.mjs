export function reducedMotion() {
  return document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let previousScene = null;
let pendingFocus = null;
const updates = new WeakMap();
export function renderStudyLayout(root, html, scene = null) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const sameSession = scene && previousScene?.key === scene.key;
  if (!sameSession) pendingFocus = null;
  const focused = document.activeElement;
  if (sameSession && root.contains(focused) && ['next-question', 'navigate-question'].includes(focused.dataset.action))
    pendingFocus = { action: focused.dataset.action, index: focused.dataset.index };
  const bars = new Map([...root.querySelectorAll('[data-progress-key]')].map(bar => [bar.dataset.progressKey, bar]));
  // Move existing bars into the new view so updates interpolate from their actual width.
  for (const fresh of template.content.querySelectorAll('[data-progress-key]')) {
    const existing = bars.get(fresh.dataset.progressKey);
    if (!existing || !existing.querySelector('span')) continue;
    const width = fresh.querySelector('span').style.width;
    const previous = existing.querySelector('span').style.width;
    for (const attribute of [...existing.attributes]) if (!fresh.hasAttribute(attribute.name)) existing.removeAttribute(attribute.name);
    for (const attribute of fresh.attributes) existing.setAttribute(attribute.name, attribute.value);
    fresh.replaceWith(existing);
    const update = {};
    updates.set(existing, update);
    requestAnimationFrame(() => {
      if (!existing.isConnected || updates.get(existing) !== update) return;
      existing.querySelector('span').style.width = width;
      if (width === '100%' && previous !== '100%' && !reducedMotion())
        existing.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 260 });
    });
  }
  if (sameSession) {
    for (const selector of ['.local-header', '.question-nav', '.save-indicator', '.footer']) {
      const existing = root.querySelector(selector), fresh = template.content.querySelector(selector);
      if (!existing || !fresh) continue;
      if (selector === '.question-nav') existing.replaceChildren(...fresh.childNodes);
      if (selector === '.local-header') {
        const oldNav = existing.querySelector('.local-nav'), newNav = fresh.querySelector('.local-nav');
        oldNav.className = newNav.className;
        // Keep header controls while refreshing dynamic badges and current-page labels.
        oldNav.replaceChildren(...newNav.childNodes);
      }
      fresh.replaceWith(existing);
    }
    const main = root.querySelector('.local-main'), fresh = template.content.querySelector('.local-main');
    if (main && fresh) { main.replaceChildren(...fresh.childNodes); fresh.replaceWith(main); }
  }
  root.replaceChildren(template.content);
  const main = root.querySelector('.local-main');
  if (main) main.toggleAttribute('data-study-session', !!scene);
  if (scene && sameSession && scene.questionId && scene.questionId !== previousScene.questionId && !reducedMotion()) {
    // A transformed card would make its fixed mobile action bar scroll with it.
    for (const content of root.querySelectorAll('.question-main > .question-title, .question-main > .options, .question-main > .blank-answer'))
      content.animate([
        { opacity: 0, transform: `translateX(${scene.index < previousScene.index ? -8 : 8}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ], { duration: 160, easing: 'ease-out' });
  }
  if (scene?.questionId && pendingFocus) {
    const candidates = [...root.querySelectorAll(`[data-action="${pendingFocus.action}"]`)];
    candidates.find(el => !el.disabled && (pendingFocus.index === undefined || el.dataset.index === pendingFocus.index))?.focus({ preventScroll: true });
    pendingFocus = null;
  }
  // Keep the last visible question across a loading state, for direction and focus.
  previousScene = sameSession && !scene.questionId ? previousScene : scene;
}

// Expand only the new feedback, keeping the statement and selected options fixed.
export function animateFeedback(element) {
  if (!element || reducedMotion()) return;
  element.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 180, easing: 'ease-out' });
}
