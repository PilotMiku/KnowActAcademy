import { storageName } from "./assets.mjs";
import { emptyBank, emptyState, upgradeBundledBank } from "./core.mjs";
import { fetchJSON } from "./resources.mjs";
let db;
let queue = Promise.resolve();
let savedBank;
let savedAttempts, savedAttemptCount = 0, savedLastAttempt, logReady = false;
const attemptRange = () => IDBKeyRange.bound("attempt:", "attempt;");
const attemptKey = index => "attempt:" + String(index).padStart(16, "0");
let savedVersion = 0;
let conflict = false;
let readReady = false;
const listeners = new Set();
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(storageName) : null;
export class StorageConflictError extends Error {
  constructor() {
    super("其他页面已保存新的学习记录，请加载最新记录后继续");
    this.name = "StorageConflictError";
  }
}
function markConflict() {
  if (conflict) return;
  conflict = true;
  for (const listener of listeners) listener();
}
export function onStorageConflict(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function storageConflicted() { return conflict; }
channel?.addEventListener("message", ({ data }) => {
  if (Number.isSafeInteger(data?.version) && data.version > savedVersion && readReady) markConflict();
});
// The transaction check remains authoritative when notifications are unavailable.
globalThis.addEventListener?.("storage", (event) => {
  if (event.key === storageName + ":version" && Number(event.newValue) > savedVersion && readReady) markConflict();
});
async function readSnapshot(connection, includeBank = true) {
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('kv'), store = tx.objectStore('kv');
    const bank = includeBank ? store.get('bank') : null, state = store.get('state'), version = store.get('version');
    const count = store.get('attemptCount'), attempts = store.getAll(attemptRange());
    tx.oncomplete = () => {
      const data = state.result ?? emptyState();
      const storedLog = Number.isSafeInteger(count.result) && data._attemptLog === count.result;
      if (storedLog) {
        if (attempts.result.length !== count.result) { reject(new Error('作答记录不完整，请保留备份后重试')); return; }
        data.attempts = attempts.result;
      }
      delete data._attemptLog;
      resolve({ bank: bank?.result ?? emptyBank(), state: data, version: version.result ?? 0,
        storedLog, needsSave: (includeBank && !bank?.result) || !state.result || !storedLog });
    };
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('读取学习数据失败'));
  });
}

// Read a portable snapshot without changing this document's conflict/version state.
export async function readSavedData({ includeBank = true } = {}) {
  const connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open(storageName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try { return await readSnapshot(connection, includeBank); } finally { connection.close(); }
}
export async function readSavedState() { return (await readSavedData({ includeBank: false })).state; }

export async function openStorage() {
  db = await new Promise((resolve, reject) => {
    // Isolate this site from Local-NEUMathe and other Pages repositories on the same origin.
    const request = indexedDB.open(storageName, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他知行学习页面后重试"));
  });
  db.onversionchange = () => { db.close(); markConflict(); };
  const result = await readSnapshot(db);
  savedVersion = result.version;
  savedAttempts = result.state.attempts;
  savedAttemptCount = savedAttempts.length;
  savedLastAttempt = savedAttempts.at(-1);
  logReady = result.storedLog;
  readReady = true;
  savedBank = result.bank;
  const current = result.bank;
  if (
    !current.questions.length ||
    (current.managedBundle !== false && current.revision?.startsWith("pdf-"))
  ) {
    try {
      const manifest = await fetchJSON("./data/manifest.json", { timeout: current.questions.length ? 3000 : 12000, cache: 'no-store' });
      if (!current.questions.length || manifest.revision !== current.revision) {
        const candidate = await fetchJSON("./data/bank.json", { timeout: 45000 });
        if (candidate.revision !== manifest.revision)
          throw new Error("题库文件版本不一致，请重新构建并部署网站");
        result.bank = upgradeBundledBank(current, candidate);
        result.needsSave = true;
      }
    } catch (error) {
      if (!current.questions.length) throw error;
      result.notice = `题库暂未更新：${error.message}。已保留现有学习数据。`;
    }
  }
  return result;
}
export function saveStorage(bank, state) {
  if (conflict) return Promise.reject(new StorageConflictError());
  // Attempts are immutable append-only records. Imports replace their array and
  // atomically rebuild the log; ordinary saves only clone and write new records.
  const replace = !logReady || state.attempts !== savedAttempts || state.attempts.length < savedAttemptCount ||
    state.attempts[savedAttemptCount - 1] !== savedLastAttempt;
  const start = replace ? 0 : savedAttemptCount;
  const snapshot = {
    bank: bank === savedBank ? null : structuredClone(bank),
    state: structuredClone({ ...state, attempts: [] }),
    attempts: structuredClone(state.attempts.slice(start)),
    count: state.attempts.length, start, replace, array: state.attempts, last: state.attempts.at(-1),
  };
  snapshot.state._attemptLog = snapshot.count;
  // Live timers belong to this document. A reopened tab starts a new active span.
  if (snapshot.state.practice) snapshot.state.practice.questionStartedAt = null;
  if (snapshot.state.preparation?.session) snapshot.state.preparation.session.questionStartedAt = null;
  for (const exam of snapshot.state.exams) exam.questionStartedAt = null;
  const write = () =>
    new Promise((resolve, reject) => {
      if (conflict) { reject(new StorageConflictError()); return; }
      const tx = db.transaction("kv", "readwrite");
      const store = tx.objectStore("kv");
      const version = store.get("version");
      let stale = false;
      version.onsuccess = () => {
        if ((version.result ?? 0) !== savedVersion) {
          stale = true;
          tx.abort();
          markConflict();
          return;
        }
        const apply = () => {
          for (const [offset, attempt] of snapshot.attempts.entries())
            store.put(attempt, attemptKey(snapshot.start + offset));
          if (snapshot.bank) store.put(snapshot.bank, 'bank');
          store.put(snapshot.state, 'state');
          store.put(snapshot.count, 'attemptCount');
          store.put(savedVersion + 1, 'version');
        };
        if (snapshot.replace) {
          const keys = store.getAllKeys(attemptRange());
          keys.onsuccess = () => { for (const key of keys.result) store.delete(key); apply(); };
        } else apply();
      };
      tx.oncomplete = () => {
        savedBank = bank;
        savedAttempts = snapshot.array;
        savedAttemptCount = snapshot.count;
        savedLastAttempt = snapshot.last;
        logReady = true;
        savedVersion++;
        channel?.postMessage({ version: savedVersion });
        try { localStorage.setItem(storageName + ":version", String(savedVersion)); } catch { /* Optional notification. */ }
        resolve();
      };
      tx.onabort = () => reject(stale ? new StorageConflictError() : tx.error ?? new Error("保存失败"));
      tx.onerror = () => reject(tx.error);
    });
  const pending = queue.catch(() => {}).then(write);
  queue = pending;
  return pending;
}
