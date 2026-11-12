export function createRestoreGuard(readContext) {
  let current = null;
  const cancel = () => { current?.controller.abort(); current = null; };
  return {
    get pending() { return current !== null; }, cancel,
    start() {
      cancel();
      current = { context: readContext(), controller: new AbortController() };
      return current;
    },
    assert(token) {
      if (current !== token || token.controller.signal.aborted)
        throw new DOMException('恢复已取消', 'AbortError');
      const latest = readContext();
      if (Object.keys(token.context).some(key => latest[key] !== token.context[key]))
        throw new Error('本机学习记录已变化，请重新选择恢复');
    },
    finish(token) { if (current === token) current = null; },
  };
}
