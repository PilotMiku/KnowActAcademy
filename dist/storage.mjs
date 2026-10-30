import { storageName } from "./assets.mjs";
import { emptyBank, emptyState, upgradeBundledBank } from "./core.mjs";
let db;
let queue = Promise.resolve();
let savedBank;
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
export async function openStorage() {
  db = await new Promise((resolve, reject) => {
    // Isolate this site from Local-NEUMathe and other Pages repositories on the same origin.
    const request = indexedDB.open(storageName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他知行学习页面后重试"));
  });
  db.onversionchange = () => db.close();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction("kv");
    const store = tx.objectStore("kv");
    const version = store.get("version");
    const bank = store.get("bank"),
      state = store.get("state");
    tx.oncomplete = () => {
      savedVersion = version.result ?? 0;
      readReady = true;
      resolve({
        bank: bank.result ?? emptyBank(),
        state: state.result ?? emptyState(),
        needsSave: !bank.result || !state.result,
      });
    };
    tx.onerror = () => reject(tx.error);
  });
  savedBank = result.bank;
  const current = result.bank;
  if (
    !current.questions.length ||
    (current.managedBundle !== false && current.revision?.startsWith("pdf-"))
  ) {
    try {
      const manifestResponse = await fetch("./data/manifest.json", {
        cache: "no-store",
      });
      if (!manifestResponse.ok) throw new Error("无法检查题库版本");
      const manifest = await manifestResponse.json();
      if (!current.questions.length || manifest.revision !== current.revision) {
        const response = await fetch("./data/bank.json", { cache: "no-store" });
        if (!response.ok)
          throw new Error(
            "题库加载失败，请检查网络后刷新页面",
          );
        const candidate = await response.json();
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
  const snapshot = {
    bank: bank === savedBank ? null : structuredClone(bank),
    state: structuredClone(state),
  };
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
        if (snapshot.bank) store.put(snapshot.bank, "bank");
        store.put(snapshot.state, "state");
        store.put(savedVersion + 1, "version");
      };
      tx.oncomplete = () => {
        savedBank = bank;
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
