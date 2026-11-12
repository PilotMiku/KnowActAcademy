const pending = new Map();
let observer;

export function pruneLazyImages() {
  for (const element of pending.keys()) if (!element.isConnected) {
    observer?.unobserve(element);
    pending.delete(element);
  }
}

export function loadImageWhenVisible(element, load, lazy = false) {
  if (!lazy || typeof IntersectionObserver !== 'function') { load(); return; }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const start = pending.get(entry.target);
      pending.delete(entry.target);
      observer.unobserve(entry.target);
      if (entry.target.isConnected) start?.();
    }
  }, { rootMargin: '200px' });
  pending.set(element, load);
  observer.observe(element);
}
