import { reducedMotion } from './study-motion.mjs';
const animations = new WeakMap();
export function installDisclosureMotion() {
  document.addEventListener('click', event => {
    const summary = event.target.closest('summary');
    const details = summary?.parentElement;
    if (!details?.matches('details') || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || reducedMotion()) return;
    if (!details.matches('.related-learning,.method-hint,.revision-editor,.preparation-scope-group details')) return;
    event.preventDefault();
    const previous = animations.get(details);
    const start = details.getBoundingClientRect().height;
    const closing = previous ? !previous.closing : details.open;
    previous?.animation.cancel();
    details.open = true;
    const end = closing ? summary.getBoundingClientRect().height + parseFloat(getComputedStyle(details).paddingTop) + parseFloat(getComputedStyle(details).paddingBottom) + 2 : details.scrollHeight;
    details.style.overflow = 'hidden';
    const animation = details.animate([{ height:start+'px' }, { height:end+'px' }], { duration:180, easing:'ease-out' });
    const entry = { animation, closing }; animations.set(details, entry);
    animation.finished.then(() => {
      if (animations.get(details) !== entry) return;
      details.open = !closing; details.style.overflow = ''; animations.delete(details);
    }).catch(() => {});
  });
}
const menus = new WeakMap();
export function toggleMenuMotion(menu, open) {
  if (!menu) return;
  menus.get(menu)?.cancel(); menus.delete(menu);
  if (open || reducedMotion() || !menu.classList.contains('open') || !matchMedia('(max-width:1100px)').matches) { menu.classList.toggle('open', open); return; }
  const animation = menu.animate([{ opacity:1 }, { opacity:0 }], { duration:120 });
  menus.set(menu, animation);
  animation.finished.then(() => { if (menus.get(menu) === animation) { menu.classList.remove('open'); menus.delete(menu); } }).catch(() => {});
}
