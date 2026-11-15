/* Explicit chapter downloads only. Cache names and messages stay within this scope. */
const base = new URL('./', self.location.href);
const version = new URL(self.location.href).searchParams.get('version');
const prefix = 'zhixing-offline-v1:' + encodeURIComponent(base.pathname) + ':';
const cacheName = prefix + version;
const manifestURL = new URL('offline-manifest.json', base).href;
let manifestPromise, busy = false;
const urlFor = path => new URL(path, base).href;
function validPath(path) {
  return typeof path === 'string' && !path.includes('..') && !/[?#\\]/.test(path) && /^[a-zA-Z0-9_./-]+$/.test(path) && !path.startsWith('/') && urlFor(path).startsWith(base.href);
}
async function manifest() {
  if (!manifestPromise) manifestPromise = (async () => {
    if (!/^[a-f0-9]{64}$/.test(version ?? '')) throw new Error('离线版本无效');
    const cache = await caches.open(cacheName);
    const saved = await cache.match(manifestURL);
    const response = saved ?? await fetch(manifestURL, { cache:'no-store', redirect:'error' });
    if (!response.ok) throw new Error('无法读取离线资源清单');
    const data = await response.json();
    if (data.format !== 'zhixing.offline.v1' || data.version !== version || !Array.isArray(data.shell) || !Array.isArray(data.chapters) || !data.files ||
        Object.entries(data.files).some(([path,file]) => !validPath(path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)))
      throw new Error('离线资源版本不一致，请重新检查更新');
    if (data.shell.some(path => !Object.hasOwn(data.files,path)) || data.chapters.some(chapter => !Array.isArray(chapter.assets) || chapter.assets.some(path => !Object.hasOwn(data.files,path))))
      throw new Error('离线清单的资源关联不完整');
    return data;
  })().catch(error => { manifestPromise = null; throw error; });
  return manifestPromise;
}
const recordURL = id => urlFor('__offline_package__/' + encodeURIComponent(id));
async function records(cache) {
  const result = [];
  for (const request of await cache.keys()) if (request.url.startsWith(urlFor('__offline_package__/'))) result.push(await (await cache.match(request)).json());
  return result;
}
async function download(ids, notify) {
  const data = await manifest(), cache = await caches.open(cacheName);
  const chapters = ids.map(id => data.chapters.find(chapter => chapter.id === id));
  if (chapters.some(chapter => !chapter)) throw new Error('所选章节已变化，请检查更新');
  const paths = [...new Set([...data.shell, ...chapters.flatMap(chapter => chapter.assets)])];
  const total = paths.reduce((sum,path) => sum + data.files[path].bytes, 0);
  const created = [];
  const oldManifest = await cache.match(manifestURL);
  const previousRecords = await Promise.all(chapters.map(async chapter => [recordURL(chapter.id), await cache.match(recordURL(chapter.id))]));
  let offset = 0, done = 0;
  try {
    const outcomes = await Promise.allSettled(Array.from({ length:4 }, async () => {
      while (offset < paths.length) {
        const path = paths[offset++], expected = data.files[path], url = urlFor(path);
        if (!await cache.match(url)) {
          const response = await fetch(url, { cache:'reload', redirect:'error' });
          if (!response.ok) { offset = paths.length; throw new Error('下载失败：' + path); }
          const bytes = await response.arrayBuffer();
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2,'0')).join('');
          if (bytes.byteLength !== expected.bytes || digest !== expected.sha256) throw new Error('资源版本发生变化，请检查更新后重试');
          await cache.put(url, new Response(bytes, { headers:{'Content-Type':response.headers.get('Content-Type') || 'application/octet-stream','X-Content-Type-Options':'nosniff'} })); created.push(url);
        }
        done += expected.bytes; notify({ progress:true, done, total });
      }
    }));
    const failure = outcomes.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    await cache.put(manifestURL, new Response(JSON.stringify(data), { headers:{ 'Content-Type':'application/json' } }));
    for (const chapter of chapters) await cache.put(recordURL(chapter.id), new Response(JSON.stringify({ id:chapter.id, name:chapter.name,
      subjectId:chapter.subjectId, chapterId:chapter.chapterId, subjectName:chapter.subjectName,
      questions:chapter.questions, bytes:chapter.bytes, assets:chapter.assets, savedAt:Date.now(), version })));
  } catch (error) {
    await Promise.allSettled(created.map(url => cache.delete(url)));
    for (const [url, previous] of previousRecords) {
      await cache.delete(url);
      if (previous) await cache.put(url, previous);
    }
    if (oldManifest) await cache.put(manifestURL,oldManifest);
    else await cache.delete(manifestURL);
    throw error;
  }
  return { version, packages:(await records(cache)).map(({ assets, ...row }) => row) };
}
self.addEventListener('install', event => event.waitUntil(manifest()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (!event.source?.url?.startsWith(base.href)) return;
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil((async () => {
    const { type, ids = [], id } = event.data ?? {};
    const notify = value => port.postMessage(value);
    if (type === 'activate') { await self.skipWaiting(); return { activated:true }; }
    const cache = await caches.open(cacheName);
    if (type === 'status') {
      const all = [];
      for (const name of await caches.keys()) if (name.startsWith(prefix)) all.push(...await records(await caches.open(name)));
      const packages = new Map();
      for (const item of all) if (!packages.has(item.id) || item.version === version) packages.set(item.id,item);
      return { version, packages:[...packages.values()].map(({ assets, ...row }) => row) };
    }
    if (busy) throw new Error('另一项离线操作正在进行，请稍候');
    busy = true;
    try {
      if (type === 'download') {
        if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== 'string')) throw new Error('请选择下载章节');
        return await download(ids, notify);
      }
      if (type === 'remove') {
        for (const name of await caches.keys()) if (name.startsWith(prefix)) {
          const current = await caches.open(name), rows = await records(current), removing = rows.find(row => row.id === id);
          if (!removing) continue;
          const source = await current.match(manifestURL);
          const shell = source ? (await source.json()).shell : [];
          const keep = new Set([...shell, ...rows.filter(row => row.id !== id).flatMap(row => row.assets)]);
          for (const path of removing.assets) if (!keep.has(path)) await current.delete(urlFor(path));
          await current.delete(recordURL(id));
        }
        return { removed:true };
      }
      if (type === 'clean') {
        for (const name of await caches.keys()) if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
        return { cleaned:true };
      }
      throw new Error('未知离线操作');
    } finally { busy = false; }
  })().then(result => port.postMessage({ result })).catch(error => port.postMessage({ error:error.name === 'QuotaExceededError' ? '设备离线空间不足，请移除部分离线包后重试' : error.message })));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.searchParams.has('check')) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const key = event.request.mode === 'navigate' ? urlFor('index.html') : url.origin + url.pathname;
    const cached = await cache.match(key);
    if (cached) return cached;
    return fetch(event.request);
  })());
});
