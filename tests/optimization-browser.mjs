import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

const rawBank = JSON.parse(await readFile('dist/data/bank.json', 'utf8'));
const browser = await chromium.launch(browserOptions);
const report = {}, errors = [];
try {
  const legacyContext = await browser.newContext();
  const legacyPage = await legacyContext.newPage();
  await legacyPage.goto(baseURL + '/config.json');
  await legacyPage.evaluate(async () => {
    const { emptyState, normalizeBank } = await import('./core.mjs');
    const bank = normalizeBank(await (await fetch('./data/bank.json')).json());
    const state = emptyState(), q = bank.questions[0];
    state.attempts.push({ id: 'legacy-kept', questionId: q.id, answer: q.answer, correct: true, at: Date.now() });
    const name = 'zhixing-study:' + new URL('./', location.href).pathname;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv');
      store.put(bank, 'bank'); store.put(state, 'state'); store.put(1, 'version');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    window.oldConnection = db;
    db.onversionchange = () => { db.close(); window.oldConnectionClosed = true; };
  });
  const upgraded = await legacyContext.newPage();
  await upgraded.goto(baseURL + '/#/practice');
  await upgraded.locator('.practice-start').waitFor();
  assert.equal(await legacyPage.evaluate(() => window.oldConnectionClosed), true);
  assert.equal(await legacyPage.evaluate(() => {
    try { window.oldConnection.transaction('kv', 'readwrite'); return false; } catch { return true; }
  }), true);
  assert.equal(await upgraded.evaluate(async () => (await (await import('./storage.mjs')).readSavedState()).attempts[0].id), 'legacy-kept');
  await upgraded.reload(); await upgraded.locator('.practice-start').waitFor();
  assert.equal(await upgraded.evaluate(async () => (await (await import('./storage.mjs')).readSavedState()).attempts.length), 1);
  report.legacyMigration = true;
  await legacyContext.close();

  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce', acceptDownloads: true });
  let page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const held = [];
  await page.route('**/config.json', route => held.push(route));
  await page.route('**/data/knowledge.json', route => held.push(route));
  await page.goto(baseURL + '/#/practice');
  await page.locator('.practice-start').waitFor();
  assert.equal(held.length, 2);
  await page.locator('[data-action="practice-one"]').first().click();
  await page.locator('.question-main').waitFor();
  await page.evaluate(() => { window.auditQuestion = document.querySelector('.question-main'); });
  const knowledgeLoaded = page.waitForResponse(response => response.url().endsWith('/data/knowledge.json'));
  for (const route of held) await route.continue();
  await (await knowledgeLoaded).finished();
  assert.equal(await page.evaluate(() => window.auditQuestion === document.querySelector('.question-main')), true);
  report.independentBoot = true;
  await page.goto(baseURL + '/#/');
  await page.locator('.local-hero').waitFor();

  const ids = Array.from({ length: 25 }, (_, i) => rawBank.questions[(i * 319 + 77) % rawBank.questions.length].id);
  const metrics = await page.evaluate(async ({ ids, api, key }) => {
    const storage = await import('./storage.mjs');
    const { bank, state } = await storage.readSavedData();
    const q = bank.questions[0], now = Date.now();
    state.attempts = Array.from({ length: 50000 }, (_, i) => ({ id: 'long-' + i,
      questionId: q.id, subjectId: q.subjectId, chapterId: q.chapterId, answer: q.answer,
      correct: true, at: now - (50000 - i) * 60000, durationMs: 15000, mode: 'practice', manual: false, examId: null, uncertain: false }));
    await storage.saveStorage(bank, state);
    const put = IDBObjectStore.prototype.put, clone = globalThis.structuredClone;
    let recordsWritten = 0, recordsCloned = 0;
    IDBObjectStore.prototype.put = function(value, key) {
      if (typeof key === 'string' && key.startsWith('attempt:')) recordsWritten++;
      return put.call(this, value, key);
    };
    globalThis.structuredClone = value => { if (Array.isArray(value) && value[0]?.questionId) recordsCloned += value.length; return clone(value); };
    const started = performance.now();
    try {
      state.attempts.push({ ...state.attempts.at(-1), id: 'long-final', at: now });
      await storage.saveStorage(bank, state);
      state.theme = 'dark'; await storage.saveStorage(bank, state);
    } finally { IDBObjectStore.prototype.put = put; globalThis.structuredClone = clone; }
    const saveMs = performance.now() - started;
    const saved = await storage.readSavedState();
    if (saved.attempts.length !== 50001 || saved.attempts.at(-1).id !== 'long-final') throw Error('Lost append');
    state.attempts.push({ ...state.attempts.at(-1), id: 'queued-a' });
    const firstQueued = storage.saveStorage(bank, state);
    state.attempts.push({ ...state.attempts.at(-1), id: 'queued-b' });
    const secondQueued = storage.saveStorage(bank, state);
    await Promise.all([firstQueued, secondQueued]);
    const queued = await storage.readSavedState();
    if (queued.attempts.length !== 50003 || queued.attempts.at(-2).id !== 'queued-a' || queued.attempts.at(-1).id !== 'queued-b') throw Error('Lost queued append');
    const { createBackup } = await import('./backup-codec.mjs');
    const full = createBackup(await (await import('./question-content.mjs')).materializeBank(bank), state), light = createBackup(bank, state, true);
    const { validateBackup } = await import('./core.mjs');
    if (validateBackup(light, bank).state.attempts.length !== 50003) throw Error('Lost progress backup');
    let synced = false;
    if (api && key) {
      const { createSyncClient, PROGRESS_FORMAT } = await import('./sync.mjs');
      const client = createSyncClient(); await client.connect(api, key);
      await client.upload({ format: PROGRESS_FORMAT, bankRevision: bank.revision, state });
      const remote = await client.read();
      if (remote.payload.state.attempts.length !== 50003) throw Error('Lost compressed progress');
      synced = true;
    }
    const fullBytes = new Blob([JSON.stringify(full)]).size;
    const lightBytes = new Blob([JSON.stringify(light)]).size;
    state.attempts = [];
    state.exams = [{ id: 'audit-report', status: 'submitted', questionIds: ids, index: 0, answers: {},
      results: Object.fromEntries(ids.map(id => [id, false])), score: 0, correct: 0,
      startedAt: now - 60000, endsAt: now, submittedAt: now, minutes: 1 }];
    await storage.saveStorage(bank, state);
    if ((await storage.readSavedState()).attempts.length !== 0) throw Error('Failed atomic reset');
    return { recordsWritten, recordsCloned, saveMs, fullBytes, lightBytes, synced };
  }, { ids, api: process.env.ZHIXING_TEST_API, key: process.env.ZHIXING_TEST_KEY });
  assert.equal(metrics.recordsWritten, 1);
  assert.equal(metrics.recordsCloned, 1);
  Object.assign(report, metrics);
  await page.close();
  page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const requested = new Set();
  page.on('request', request => { if (request.url().includes('/figure-packs/')) requested.add(request.url().split('/').pop()); });
  await page.goto(baseURL + '/#/exam/audit-report');
  await page.locator('.score').waitFor();
  assert.ok(await page.locator('img[loading="lazy"]').count() > 20);
  await page.waitForTimeout(300);
  report.initialPacks = requested.size;
  report.initialPackBytes = (await Promise.all([...requested].map(name => stat('_site/figure-packs/' + name)))).reduce((sum, file) => sum + file.size, 0);
  assert.ok(report.initialPackBytes < 1000000, JSON.stringify(report));
  const last = page.locator('.stack > .question-main').last();
  await last.scrollIntoViewIfNeeded();
  await last.locator('img').first().waitFor();
  await page.waitForFunction(() => [...document.querySelector('.stack > .question-main:last-child').querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0));
  assert.ok(requested.size > report.initialPacks);
  await context.close();
  assert.deepEqual(errors, []);
  await writeFile('artifacts/optimization-report.json', JSON.stringify(report, null, 2));
  console.log('Optimization checks passed:', JSON.stringify(report));
} finally { await browser.close(); }
