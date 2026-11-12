export async function fetchJSON(url, { timeout = 12000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { cache: 'no-cache', ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`资源加载失败（${response.status}）`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('资源加载超时，请检查网络后重试');
    throw error;
  } finally { clearTimeout(timer); }
}
