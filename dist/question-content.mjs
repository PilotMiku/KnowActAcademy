import { normalizeBank, getBankIndex } from './core.mjs';
import { fetchJSON } from './resources.mjs';

const caches = new WeakMap(), fullLoads = new WeakMap();
function cacheFor(bank) {
  if (!caches.has(bank)) caches.set(bank, { chunks: new Map(), questions: new Map() });
  return caches.get(bank);
}
export function loadedQuestion(bank, id) {
  return bank.contentCatalog ? cacheFor(bank).questions.get(id) : getBankIndex(bank).questions.get(id);
}
export async function loadQuestionContent(bank, ids, request = fetchJSON, { signal } = {}) {
  if (!bank.contentCatalog) return;
  const cache = cacheFor(bank), index = getBankIndex(bank).questions;
  const chunks = new Set(ids.filter(id => !cache.questions.has(id)).map(id => {
    const chunk = index.get(id)?.contentChunk;
    if (!/^[a-f0-9]{16}$/.test(chunk ?? '')) throw new Error('题目内容索引无效');
    return chunk;
  }));
  const loaded = new Map(await Promise.all([...chunks].map(async chunk => {
    if (!cache.chunks.has(chunk)) {
      const pending = (async () => {
        const data = await request(`./question-content/${chunk}.json`, { cache: 'force-cache' });
        if (data.format !== 'zhixing.question-chunk.v1' || data.revision !== bank.revision || !Array.isArray(data.questions))
          throw new Error('题目内容版本不一致，请刷新后重试');
        const full = normalizeBank({ ...bank, contentCatalog: undefined, questions: data.questions });
        for (const q of full.questions) {
          const entry = index.get(q.id);
          if (!entry || entry.contentChunk !== chunk || q.subjectId !== entry.subjectId || q.chapterId !== entry.chapterId ||
              q.type !== entry.type || JSON.stringify(q.answer) !== JSON.stringify(entry.answer))
            throw new Error('题目内容与目录不匹配');
        }
        return new Map(full.questions.map(q => [q.id, q]));
      })();
      cache.chunks.set(chunk, pending);
      pending.catch(() => { if (cache.chunks.get(chunk) === pending) cache.chunks.delete(chunk); });
      if (cache.chunks.size > 24) cache.chunks.delete(cache.chunks.keys().next().value);
    }
    return [chunk, await cache.chunks.get(chunk)];
  })));
  if (signal?.aborted) throw new DOMException('题目加载已取消', 'AbortError');
  for (const id of ids) if (!cache.questions.has(id)) {
    const q = loaded.get(index.get(id)?.contentChunk)?.get(id);
    if (!q) throw new Error('题目正文不完整，请重试');
    cache.questions.set(id, q);
  }
  const wanted = new Set(ids);
  for (const id of cache.questions.keys()) if (cache.questions.size > Math.max(256, ids.length) && !wanted.has(id)) cache.questions.delete(id);
}

// Full exports preserve every original field; catalog placeholders are never exported.
export async function materializeBank(bank, request = fetchJSON) {
  if (!bank.contentCatalog) return bank;
  if (!fullLoads.has(bank)) fullLoads.set(bank, (async () => {
    const raw = await request('./data/bank.json', { timeout: 45000 });
    if (raw.revision !== bank.revision || raw.questions?.length !== bank.questions.length)
      throw new Error('完整题库版本已变化，请刷新网站后重新导出');
    const full = normalizeBank(raw), index = getBankIndex(full).questions;
    if (bank.questions.some(q => !index.has(q.id))) throw new Error('完整题库与目录不匹配');
    full.managedBundle = bank.managedBundle;
    full.importedAt = bank.importedAt;
    return full;
  })());
  try { return await fullLoads.get(bank); } finally { fullLoads.delete(bank); }
}
