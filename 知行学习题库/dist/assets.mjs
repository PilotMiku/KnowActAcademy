// Keep bundled question JSON byte-for-byte intact. Adapt transport paths only.
export function questionImageURL(value, base = new URL('./', import.meta.url)) {
  const raw = String(value ?? '');
  if (/^\/api\/question-image\/[a-z0-9-]+\/(stem|analysis|option-[A-H])\/\d+\.webp(?:\?[^#]*)?$/.test(raw)) {
    return new URL('./question-images/' + raw.slice('/api/question-image/'.length), base).href;
  }
  return new URL(raw, base).href;
}

export const storageName = 'zhixing-study:' + new URL('./', import.meta.url).pathname;
