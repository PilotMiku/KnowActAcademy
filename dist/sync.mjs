export const PROGRESS_FORMAT = 'zhixing.progress.v1';

export function apiEndpoint(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('请输入 HTTPS 后端地址；本机调试可使用 HTTP');
  }
  return url.href.replace(/\/+$/, '');
}

export function validateRemote(value) {
  if (!Number.isSafeInteger(value?.version) || value.version < 0 ||
      (value.version === 0 ? value.payload !== null :
        (!value.payload || value.payload.format !== PROGRESS_FORMAT ||
         typeof value.payload.bankRevision !== 'string' || !value.payload.state))) {
    throw new Error('服务器返回的学习数据格式不正确');
  }
  return value;
}

export function createSyncClient(fetcher = fetch) {
  let base = '', token = '', version = null, busy = false;
  async function exclusive(operation) {
    if (busy) throw new Error('同步正在进行，请稍候');
    busy = true;
    try { return await operation(); } finally { busy = false; }
  }
  async function request(endpoint, secret, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(endpoint + '/v1/progress', {
        ...options,
        headers: { Authorization: 'Bearer ' + secret, ...options.headers },
        signal: controller.signal, cache: 'no-store', credentials: 'omit',
        redirect: 'error', referrerPolicy: 'no-referrer',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `同步失败（${response.status}）`);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接超时，学习记录已保存在当前浏览器');
      if (error instanceof TypeError) throw new Error('无法连接同步服务器，请检查地址、网络及服务器的允许来源');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  return {
    get connected() { return version !== null; },
    get base() { return base; },
    get version() { return version; },
    async connect(endpoint, secret) {
      return exclusive(async () => {
        const candidate = apiEndpoint(endpoint);
        if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('同步密钥格式不正确');
        const remote = validateRemote(await request(candidate, secret));
        base = candidate; token = secret; version = remote.version;
        return remote;
      });
    },
    async read() {
      return exclusive(async () => {
        if (version === null) throw new Error('请先连接同步服务器');
        const remote = validateRemote(await request(base, token));
        version = remote.version;
        return remote;
      });
    },
    async upload(payload) {
      return exclusive(async () => {
        if (version === null) throw new Error('请先连接同步服务器');
        const result = await request(base, token, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(version) },
          body: JSON.stringify(payload),
        });
        if (!Number.isSafeInteger(result.version) || result.version !== version + 1)
          throw new Error('服务器同步版本不正确，请重新连接核对');
        version = result.version;
        return result;
      });
    },
    disconnect() {
      if (busy) throw new Error('同步正在进行，请稍候');
      base = ''; token = ''; version = null;
    },
  };
}
