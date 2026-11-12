// Keep bundled question JSON byte-for-byte intact. Adapt transport paths only.
export function questionImageURL(value, base = new URL('./', import.meta.url)) {
  const raw = String(value ?? '');
  if (/^\/api\/question-image\/[a-z0-9-]+\/(stem|analysis|option-[A-H])\/\d+\.webp(?:\?[^#]*)?$/.test(raw)) {
    return new URL('./question-images/' + raw.slice('/api/question-image/'.length), base).href;
  }
  return new URL(raw, base).href;
}

export const storageName = 'zhixing-study:' + new URL('./', import.meta.url).pathname;

const nativeFigureChunks = new Map();
const nativeFigureIndexes = new Map();
function cached(cache, url, request, mode, validate) {
  if (!cache.has(url)) {
    const pending = (async () => {
      const response = await request(url, { cache: mode });
      if (!response.ok) {
        if (response.status === 404 && cache === nativeFigureIndexes) return null;
        throw new Error("题目插图加载失败");
      }
      return validate(await response.json());
    })();
    cache.set(url, pending);
    pending.catch(() => { if (cache.get(url) === pending) cache.delete(url); });
    if (cache.size > 64) cache.delete(cache.keys().next().value);
  }
  const value = cache.get(url);
  cache.delete(url); cache.set(url, value);
  return value;
}
export function nativeFigureID(value) {
  return /^\/api\/question-figure\/(?:[a-f0-9]{16}\/)?([a-f0-9]{24})$/.exec(String(value ?? ''))?.[1] ?? null;
}
export function nativeFigureChunk(value) {
  return /^\/api\/question-figure\/([a-f0-9]{16})\/[a-f0-9]{24}$/.exec(String(value ?? ''))?.[1] ?? '';
}

export async function loadNativeFigure(id, base = new URL('./', import.meta.url), request = fetch, chunk = '') {
  if (!/^[a-f0-9]{24}$/.test(String(id))) throw new Error('题目插图 ID 无效');
  if (chunk && !/^[a-f0-9]{16}$/.test(chunk)) throw new Error('题目插图版本无效');
  let pack = null;
  if (chunk) {
    const indexURL = new URL(`./figure-index/${id.slice(0, 2)}-${chunk}.json`, base).href;
    const entries = await cached(nativeFigureIndexes, indexURL, request, 'no-cache', data => {
      if (data.format !== 'zhixing.figure-index.v1' || !data.packs || typeof data.packs !== 'object')
        throw new Error('题目插图索引格式错误');
      return data.packs;
    });
    if (entries) {
      pack = entries[id];
      if (!/^[a-f0-9]{16}$/.test(pack ?? '')) throw new Error('题目插图索引无效');
    }
  }
  const url = new URL(pack ? `./figure-packs/${pack}.json`
    : `./question-figures/${id.slice(0, 2)}${chunk ? '-' + chunk : ''}.json`, base).href;
  const figures = await cached(nativeFigureChunks, url, request, 'force-cache', data => {
    if (data.format !== 'zhixing.figure-chunk.v1' || !data.figures || typeof data.figures !== 'object')
      throw new Error('题目插图文件格式错误');
    return data.figures;
  });
  const source = figures[id];
  if (typeof source !== 'string' || source.length > 16 * 1024 * 1024 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(source))
    throw new Error('题目插图内容无效');
  return source;
}
