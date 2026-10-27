export function createSaveScheduler(save, onError = () => {}, delay = 250) {
  let timer = null, pending = false;
  const cancel = () => { clearTimeout(timer); timer = null; pending = false; };
  const flush = () => {
    if (!pending) return Promise.resolve();
    cancel();
    try { return Promise.resolve(save()); } catch (error) { return Promise.reject(error); }
  };
  return { cancel, flush, get pending() { return pending; }, schedule() {
    clearTimeout(timer); pending = true;
    timer = setTimeout(() => { flush().catch(onError); }, delay);
  } };
}
