import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

const browser = await chromium.launch(browserOptions), report = {}, errors = [];
try {
  const migration = await browser.newContext();
  const old = await migration.newPage();
  await old.goto(baseURL + '/config.json');
  await old.evaluate(async () => {
    const { normalizeBank, emptyState, createExam } = await import('./core.mjs');
    const bank = normalizeBank(await (await fetch('./data/bank.json')).json()), state = emptyState(), q = bank.questions[0];
    const exam = createExam([q.id], 30, q.subjectId);
    Object.assign(exam, { status: 'submitted', submittedAt: Date.now(), results: { [q.id]: true }, score: 100 });
    state.exams = [exam]; state._attemptLog = 1;
    const attempt = { id: 'v2-kept', questionId: q.id, answer: q.answer, correct: true, at: Date.now() };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('zhixing-study:' + new URL('./', location.href).pathname, 2);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv');
      store.put(bank, 'bank'); store.put(state, 'state'); store.put(1, 'version');
      store.put(1, 'attemptCount'); store.put(attempt, 'attempt:0000000000000000');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.onversionchange = () => { db.close(); window.v2Closed = true; };
  });
  const upgraded = await migration.newPage();
  await upgraded.goto(baseURL + '/#/exams');
  await upgraded.locator('.exam-card').waitFor();
  const migrated = await upgraded.evaluate(async () => (await import('./storage.mjs')).readSavedData());
  assert.equal(await old.evaluate(() => window.v2Closed), true);
  assert.equal(migrated.state.attempts[0].id, 'v2-kept');
  assert.equal(migrated.state.exams[0].score, 100);
  assert.ok(migrated.bank.contentCatalog);
  report.v2Migration = true;
  await migration.close();

  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage(), requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(baseURL + '/#/practice');
  await page.locator('.practice-start').waitFor();
  assert.ok(requests.some(url => url.includes('/data/question-catalog-')));
  assert.ok(!requests.some(url => url.endsWith('/data/bank.json') || url.includes('/question-content/')));
  const data = await page.evaluate(async () => (await import('./storage.mjs')).readSavedData());
  assert.ok(data.bank.contentCatalog);
  assert.match(await page.locator('.practice-start .question-count-note').innerText(), /PDF 3,716 题、补充 4,709 题/);
  const recount = JSON.parse(await readFile('data/question-counts.json', 'utf8'));
  for (const subject of recount.subjects) for (const chapter of subject.chapters.filter(c => !c.parentId)) {
    const card = page.locator('.chapter-card').filter({ has: page.locator(`a.chapter-title[href="#/practice?subject=${subject.id}&chapter=${chapter.id}"]`) });
    assert.equal(await card.locator('.pill').innerText(), `${chapter.counts.total} 题`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="toggle-theme"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: 'artifacts/question-counts-mobile-dark.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  report.siteAndChapterCounts = true;
  await page.locator('[data-action="practice-one"]').first().click();
  await page.locator('.question-title .katex').first().waitFor();
  assert.equal(requests.filter(url => url.includes('/question-content/')).length, 1);
  report.initialFullBankRequests = requests.filter(url => url.endsWith('/data/bank.json')).length;
  const next = data.bank.questions.find(q => q.contentChunk !== data.bank.questions[0].contentChunk);
  let failures = 0;
  await page.route(`**/question-content/${next.contentChunk}.json`, async route => {
    if (!failures++) await route.fulfill({ status: 503, body: '{}' }); else await route.continue();
  });
  await page.goto(baseURL + '/#/practice?q=' + encodeURIComponent(next.sourceLabel));
  await page.locator(`[data-action="practice-one"][data-id="${next.id}"]`).click();
  await page.getByRole('heading', { name: '题目暂时无法加载' }).waitFor();
  await page.locator('[data-action="retry-content"]').click();
  await page.locator('.question-main').waitFor();
  assert.equal(await page.locator('[data-question-id]').getAttribute('data-question-id'), next.id);
  const delayed = data.bank.questions.find(q => ![next.contentChunk, data.bank.questions[0].contentChunk].includes(q.contentChunk));
  let release;
  const started = new Promise(resolve => { release = resolve; });
  await page.route(`**/question-content/${delayed.contentChunk}.json`, route => { release(route); });
  await page.goto(baseURL + '/#/practice?q=' + encodeURIComponent(delayed.sourceLabel));
  await page.locator(`[data-action="practice-one"][data-id="${delayed.id}"]`).click();
  const pending = await started;
  await page.locator('.local-nav a[href="#/practice"]').click();
  await page.locator('.practice-start').waitFor();
  await pending.continue();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.question-main').count(), 0);
  report.contentRetryAndNavigation = true;

  Object.assign(report, await page.evaluate(async () => {
    const storage = await import('./storage.mjs'), core = await import('./core.mjs');
    const { bank, state } = await storage.readSavedData(), ids = bank.questions.slice(0,100).map(q => q.id);
    state.exams = Array.from({ length: 1000 }, (_, i) => ({ ...core.createExam([...ids], 30), id: 'history-'+i,
      status: 'submitted', submittedAt: Date.now(), score: 100,
      answers: Object.fromEntries(ids.map(id => [id, 'A'])), results: Object.fromEntries(ids.map(id => [id, true])),
      questionTimes: Object.fromEntries(ids.map(id => [id, 30000])) }));
    const active = core.createExam([...ids], 30); state.exams.push(active);
    await storage.saveStorage(bank, state);
    const put = IDBObjectStore.prototype.put, clone = structuredClone;
    let examWrites = 0, historicalClones = 0;
    IDBObjectStore.prototype.put = function(value, key) {
      if (typeof key === 'string' && key.startsWith('exam:')) examWrites++;
      return put.call(this, value, key);
    };
    globalThis.structuredClone = value => { if (value?.status === 'submitted') historicalClones++; return clone(value); };
    const started = performance.now();
    try { active.answers[ids[0]] = 'B'; await storage.saveStorage(bank, state); }
    finally { IDBObjectStore.prototype.put = put; globalThis.structuredClone = clone; }
    const activeSaveMs = performance.now() - started;
    let saved = await storage.readSavedState();
    if (saved.exams.length !== 1001 || saved.exams.at(-1).answers[ids[0]] !== 'B') throw Error('Exam append was lost');
    core.finishExam(state, bank, active); await storage.saveStorage(bank, state);
    if ((await storage.readSavedState()).exams.at(-1).status !== 'submitted') throw Error('Exam submission was lost');
    state.exams = state.exams.slice(0,2); await storage.saveStorage(bank, state);
    if ((await storage.readSavedState()).exams.length !== 2) throw Error('Exam replacement was not atomic');
    state.exams = []; await storage.saveStorage(bank, state);
    if ((await storage.readSavedState()).exams.length !== 0) throw Error('Exam reset left old records');
    return { historicalExams: 1000, examWrites, historicalClones, activeSaveMs };
  }));
  assert.equal(report.examWrites, 1);
  assert.equal(report.historicalClones, 0);
  await context.close();

  const exports = await browser.newContext({ acceptDownloads: true });
  const exportPage = await exports.newPage();
  await exportPage.goto(baseURL + '/#/library');
  await exportPage.locator('[data-action="export-bank"]').waitFor();
  const fullDownload = exportPage.waitForEvent('download');
  await exportPage.locator('[data-action="export-bank"]').click();
  const full = JSON.parse(await readFile(await (await fullDownload).path(), 'utf8'));
  const raw = JSON.parse(await readFile('dist/data/bank.json', 'utf8'));
  assert.deepEqual(full.questions.map(q => q.original), raw.questions);
  assert.equal(full.contentCatalog, undefined);
  await exportPage.route('**/data/bank.json', route => route.fulfill({ status: 503, body: '{}' }));
  await exportPage.locator('[data-action="export-backup"]').click();
  await exportPage.locator('#toast.show').filter({ hasText: '资源加载失败（503）' }).waitFor();
  const newer = await exports.newPage();
  await newer.goto(baseURL + '/#/library');
  await newer.locator('.library-hero').waitFor();
  await newer.locator('[data-action="toggle-theme"]').click();
  await exportPage.locator('#storage-conflict:not([hidden])').waitFor();
  const lightDownload = exportPage.waitForEvent('download');
  await exportPage.locator('#export-stale-progress').click();
  const light = JSON.parse(await readFile(await (await lightDownload).path(), 'utf8'));
  assert.equal(light.bankRevision, raw.revision);
  assert.equal(light.bank, undefined);
  report.fullExportExact = true;
  report.staleProgressExportWithoutBody = true;
  await exports.close();
  assert.deepEqual(errors, []);
  await writeFile('artifacts/catalog-history-report.json', JSON.stringify(report, null, 2));
  console.log('Catalog/history checks passed:', JSON.stringify(report));
} finally { await browser.close(); }
