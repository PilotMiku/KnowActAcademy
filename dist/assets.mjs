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
export function nativeFigureID(value) {
  return /^\/api\/question-figure\/(?:[a-f0-9]{16}\/)?([a-f0-9]{24})$/.exec(String(value ?? ''))?.[1] ?? null;
}
export function nativeFigureChunk(value) {
  return /^\/api\/question-figure\/([a-f0-9]{16})\/[a-f0-9]{24}$/.exec(String(value ?? ''))?.[1] ?? '';
}

export async function loadNativeFigure(id, base = new URL('./', import.meta.url), request = fetch, chunk = '') {
  if (!/^[a-f0-9]{24}$/.test(String(id))) throw new Error('题目插图 ID 无效');
  if (chunk && !/^[a-f0-9]{16}$/.test(chunk)) throw new Error('题目插图版本无效');
  const url = new URL(`./question-figures/${id.slice(0, 2)}${chunk ? '-' + chunk : ''}.json`, base).href;
  if (!nativeFigureChunks.has(url)) {
    const pending = (async () => {
      const response = await request(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error('题目插图加载失败');
      const chunk = await response.json();
      if (chunk.format !== 'zhixing.figure-chunk.v1' || !chunk.figures || typeof chunk.figures !== 'object')
        throw new Error('题目插图文件格式错误');
      return chunk.figures;
    })();
    nativeFigureChunks.set(url, pending);
    pending.catch(() => nativeFigureChunks.delete(url));
  }
  const source = (await nativeFigureChunks.get(url))[id];
  if (typeof source !== 'string' || source.length > 16 * 1024 * 1024 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(source))
    throw new Error('题目插图内容无效');
  return source;
}
