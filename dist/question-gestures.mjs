// Leave vertical reading, overflowing formulas and browser edge gestures native.
function canStart(target, question) {
  if (target.closest('input,textarea,select,a,summary,[contenteditable],.question-actions')) return false;
  const control = target.closest('[data-action],button,[role="button"]');
  if (control && !control.matches('.option,img[data-action="zoom-image"]')) return false;
  for (let element = target; element && question.contains(element); element = element.parentElement) {
    if (element.scrollWidth > element.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return false;
  }
  return true;
}

export function installQuestionGestures(root, { getSession, navigate }) {
  let gesture = null;
  root.addEventListener('touchstart', event => {
    gesture = null;
    const session = getSession(), touch = event.touches[0];
    const question = event.target.closest('.question-main');
    if (!session || !question || event.touches.length !== 1 ||
        touch.clientX < 24 || touch.clientX > innerWidth - 24 ||
        !canStart(event.target, question) || !getSelection()?.isCollapsed) return;
    gesture = { id:touch.identifier, x:touch.clientX, y:touch.clientY, time:event.timeStamp,
      session:session.id, index:session.index, question, horizontal:false };
  }, { passive:true });
  root.addEventListener('touchmove', event => {
    if (!gesture) return;
    const touch = [...event.touches].find(touch => touch.identifier === gesture.id);
    if (event.touches.length !== 1 || !touch || !gesture.question.isConnected) { gesture = null; return; }
    const dx = Math.abs(touch.clientX - gesture.x), dy = Math.abs(touch.clientY - gesture.y);
    if (!gesture.horizontal) {
      if (dx < 12 && dy < 12) return;
      if (dx <= dy * 1.6) { gesture = null; return; }
      gesture.horizontal = true;
    }
    if (event.cancelable) event.preventDefault();
    else gesture = null;
  }, { passive:false });
  root.addEventListener('touchend', event => {
    const start = gesture; gesture = null;
    if (!start || event.touches.length) return;
    const touch = [...event.changedTouches].find(touch => touch.identifier === start.id);
    if (!touch || !start.horizontal || !start.question.isConnected) return;
    const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.6 || event.timeStamp - start.time > 900) return;
    // Prevent a swipe on an option/image from also choosing it or opening zoom.
    if (event.cancelable) event.preventDefault();
    const session = getSession();
    if (!session || session.id !== start.session || session.index !== start.index) return;
    const index = session.index + (dx < 0 ? 1 : -1);
    if (index >= 0 && index < session.questionIds.length) navigate(index);
  }, { passive:false });
  root.addEventListener('touchcancel', () => { gesture = null; }, { passive:true });
}
