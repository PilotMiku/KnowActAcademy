const base = new URL('./', import.meta.url);
export const offlineSupported = () => 'serviceWorker' in navigator && 'caches' in globalThis && !!globalThis.crypto?.subtle;
export function workerRequest(worker, message, onProgress = () => {}) {
  return new Promise((resolve,reject) => {
    if (!worker) { reject(new Error('离线服务尚未准备好')); return; }
    const channel = new MessageChannel();
    let timer;
    const finish = (error,value) => { clearTimeout(timer); channel.port1.close(); error ? reject(error) : resolve(value); };
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => finish(new Error('离线操作超时，请重试')), 60000); };
    channel.port1.onmessage = ({data}) => {
      if (data.progress) { reset(); onProgress(data); }
      else finish(data.error ? new Error(data.error) : null, data.result);
    };
    reset(); worker.postMessage(message,[channel.port2]);
  });
}
async function waitForWorker(registration) {
  if (registration.waiting || registration.active) return registration.waiting ?? registration.active;
  const worker = registration.installing;
  if (!worker) throw new Error('离线服务安装失败');
  await new Promise((resolve,reject) => {
    const changed = () => {
      if (['installed','activated'].includes(worker.state)) { worker.removeEventListener('statechange',changed); resolve(); }
      if (worker.state === 'redundant') { worker.removeEventListener('statechange',changed); reject(new Error('离线版本安装失败，已下载内容仍保留')); }
    };
    worker.addEventListener('statechange',changed); changed();
  });
  return worker;
}
async function fetchManifest(fresh = false) {
  const response = await fetch(new URL('offline-manifest.json' + (fresh ? '?check=' + Date.now() : ''),base), { cache:'no-store' });
  if (!response.ok) throw new Error('暂时无法获取离线版本，请联网后重试');
  const data = await response.json();
  if (data.format !== 'zhixing.offline.v1' || !/^[a-f0-9]{64}$/.test(data.version) || !Array.isArray(data.chapters)) throw new Error('离线版本信息无效');
  return data;
}
export function createOfflineManager(onChange) {
  const state = { ready:false, attempted:false, busy:false, error:'', message:'', manifest:null, packages:[], progress:null, update:null, selectedSubject:null, selectedChapter:null };
  let registration, initializing, reloadPending = false;
  if (offlineSupported()) navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloadPending) location.reload(); });
  const notify = kind => onChange(kind);
  async function status() {
    const result = await workerRequest(registration.active ?? registration.waiting, {type:'status'});
    state.packages = result.packages;
    state.version = result.version;
  }
  async function ensure() {
    if (state.ready) return;
    if (initializing) return initializing;
    state.attempted = true;
    initializing = (async () => {
      if (!offlineSupported()) throw new Error('当前浏览器未提供离线存储服务，请使用支持 Service Worker 的 HTTPS 浏览器');
      registration = await navigator.serviceWorker.getRegistration(base.href);
      if (registration?.scope !== base.href) registration = null;
      if (!registration) {
        const data = await fetchManifest(true);
        registration = await navigator.serviceWorker.register(new URL('sw.js?version=' + data.version,base), { scope:base.pathname, updateViaCache:'none' });
        await waitForWorker(registration);
      }
      await status(); state.manifest = await fetchManifest();
      state.ready = true; state.error = ''; notify('state');
    })().catch(error => { state.error = error.message; notify('state'); }).finally(() => { initializing = null; });
    return initializing;
  }
  async function action(type, id, beforeReload) {
    await ensure();
    if (!state.ready || state.busy) return;
    state.busy = true; state.error = ''; state.message = ''; state.progress = null; notify('state');
    try {
      if (type === 'download') {
        await workerRequest(registration.active ?? registration.waiting, {type:'download',ids:[id]}, progress => { state.progress=progress; notify('progress'); });
        await status(); state.message = '章节已完整下载，可以离线练习';
      } else if (type === 'remove') {
        await workerRequest(registration.active ?? registration.waiting, {type:'remove',id}); await status(); state.message = '已移除该离线包，作答记录继续保留';
      } else if (type === 'clean') {
        await workerRequest(registration.active ?? registration.waiting, {type:'clean'}); await status(); state.message='旧版本离线资源已清理';
      } else if (type === 'check') {
        const latest = await fetchManifest(true);
        state.update = latest.version !== state.version ? latest : null;
        state.message = state.update ? '发现新版本，更新后刷新页面使用' : '当前离线内容已是最新版本';
      } else if (type === 'update') {
        if (!state.update) return;
        registration = await navigator.serviceWorker.register(new URL('sw.js?version='+state.update.version,base), {scope:base.pathname,updateViaCache:'none'});
        // register() may return an existing active worker while its replacement installs.
        if (!registration.waiting && !registration.installing && new URL(registration.active.scriptURL).searchParams.get('version') !== state.update.version)
          await new Promise(resolve => registration.addEventListener('updatefound',resolve,{once:true}));
        let worker = registration.waiting ?? registration.installing;
        if (worker && !['installed','activated'].includes(worker.state)) {
          await new Promise((resolve,reject) => {
            const changed = () => { if (worker.state==='installed') { worker.removeEventListener('statechange',changed); resolve(); } else if(worker.state==='redundant') { worker.removeEventListener('statechange',changed); reject(new Error('新版本安装失败')); } };
            worker.addEventListener('statechange',changed); changed();
          });
        }
        worker = registration.waiting ?? registration.active;
        const ids = state.packages.map(row => row.id).filter(id => state.update.chapters.some(chapter => chapter.id === id));
        await workerRequest(worker,{type:'download',ids},progress => {state.progress=progress;notify('progress');});
        await beforeReload();
        reloadPending = true;
        await workerRequest(worker,{type:'activate'});
        if (navigator.serviceWorker.controller?.scriptURL === worker.scriptURL) location.reload();
      }
    } catch(error) { state.error = error.message; }
    finally { state.busy = false; state.progress = null; notify('state'); }
  }
  return {state, ensure, action};
}
