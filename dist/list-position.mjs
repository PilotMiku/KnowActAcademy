// A single animation frame can run before fonts, entrance animations and scroll
// anchoring have finished changing a restored list's layout.
export function restoreListPosition(root, { hash, y, x = 0 }) {
  let frame, stopped = false, ready = false, stableFrames = 0, lastHeight = -1;
  const previousAnchor = root.style.overflowAnchor;
  root.style.overflowAnchor = 'none';
  const valid = () => !stopped && root.isConnected && location.hash === hash;
  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    root.style.overflowAnchor = previousAnchor;
    for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown'])
      window.removeEventListener(type, stop, true);
  }
  for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown'])
    window.addEventListener(type, stop, { capture:true, passive:true });
  const animations = root.getAnimations({ subtree:true }).filter(animation =>
    animation.effect?.getComputedTiming().iterations !== Infinity);
  Promise.allSettled([document.fonts.ready, ...animations.map(animation => animation.finished)])
    .then(() => { ready = true; });
  function restore() {
    if (!valid()) { stop(); return; }
    const height = document.documentElement.scrollHeight;
    stableFrames = height === lastHeight ? stableFrames + 1 : 0;
    lastHeight = height;
    window.scrollTo({ left:x, top:y, behavior:'instant' });
    if (ready && stableFrames >= 2) { stop(); return; }
    frame = requestAnimationFrame(restore);
  }
  frame = requestAnimationFrame(restore);
  return stop;
}
