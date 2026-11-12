import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';
import { emptyState, BACKUP_FORMAT } from '../dist/core.mjs';
const browser = await chromium.launch(browserOptions), report = {}, errors = [];
try {
  const legacy = JSON.parse(await readFile('data/pdf-source-bank.json', 'utf8'));
  legacy.managedBundle = true;
  const state = emptyState(), q = legacy.questions[0];
  state.favorites = [q.id];
  state.attempts.push({ id: 'legacy-review', questionId: q.id, subjectId: q.subjectId,
    chapterId: q.chapterId, answer: q.answer, correct: true, at: Date.now(), durationMs: 1000 });
  const context = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const missing = [];
  page.on('response', response => { if (response.status() === 404 && response.url().includes('/question-images/')) missing.push(response.url()); });
  await page.goto(baseURL + '/#/library');
  await page.locator('[data-action="restore-backup"]').click();
  await page.locator('#file-input').setInputFiles({ name: 'legacy-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: BACKUP_FORMAT, bank: legacy, state })) });
  await page.locator('[data-action="confirm-dialog"]').click();
  await page.locator('.local-hero').waitFor();
  const before = await page.evaluate(async () => (await import('./storage.mjs')).readSavedData());
  await page.goto(baseURL + '/#/practice');
  await page.locator('[data-action="practice-one"]').first().click();
  await page.locator('.question-title .katex').first().waitFor();
  assert.equal(missing.length, 0);
  report.legacyBackup = { questionsBeforeReload: before.bank.questions.length,
    revisionBeforeReload: before.bank.revision, failedImageRequests: missing.length,
    renderedMath: await page.locator('.question-title .katex').count() };
  await page.reload();
  await page.locator('.question-title .katex').first().waitFor();
  const after = await page.evaluate(async () => (await import('./storage.mjs')).readSavedData());
  report.legacyBackup.questionsAfterReload = after.bank.questions.length;
  report.legacyBackup.retainedAttempts = after.state.attempts.length;
  await context.close();

  const syncContext = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce' });
  const syncPage = await syncContext.newPage(); syncPage.on('pageerror', e => errors.push(e.message));
  const current = JSON.parse(await readFile('dist/data/bank.json', 'utf8'));
  const remote = { version: 1, payload: { format: 'zhixing.progress.v1', bankRevision: current.revision, state: emptyState() } };
  let reads = 0, started;
  const restoring = new Promise(resolve => { started = resolve; });
  const headers = { 'Access-Control-Allow-Origin': new URL(baseURL).origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Content-Type': 'application/json' };
  await syncPage.route('http://127.0.0.1:9999/v1/progress', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 200, headers, body: '{}' }); return; }
    if (++reads === 2) { started(route); return; }
    await route.fulfill({ status: 200, headers, body: JSON.stringify(remote) });
  });
  await syncPage.goto(baseURL + '/#/library');
  await syncPage.locator('[data-action="cloud-connect"]').click();
  await syncPage.locator('#cloud-api').fill('http://127.0.0.1:9999');
  await syncPage.locator('#cloud-token').fill('a'.repeat(43));
  await syncPage.locator('[data-action="cloud-do-connect"]').click();
  await syncPage.locator('.cloud-card .pill').filter({ hasText: '已连接' }).waitFor();
  await syncPage.locator('[data-action="cloud-download"]').click();
  await syncPage.locator('[data-action="confirm-dialog"]').click();
  const pending = await restoring;
  await syncPage.keyboard.press('Escape');
  await syncPage.goto(baseURL + '/#/exams');
  await syncPage.locator('[data-action="create-exam"]').first().click();
  await syncPage.locator('#exam-count').fill('1');
  await syncPage.locator('[data-action="begin-exam"]').click();
  await syncPage.locator('[data-timer]').waitFor();
  const during = await syncPage.evaluate(async () => (await import('./storage.mjs')).readSavedState());
  let downloaded = false; syncPage.on('download', () => { downloaded = true; });
  await pending.fulfill({ status: 200, headers, body: JSON.stringify(remote) }).catch(() => {});
  await syncPage.waitForTimeout(100);
  await syncPage.locator('[data-timer]').waitFor();
  const finished = await syncPage.evaluate(async () => (await import('./storage.mjs')).readSavedState());
  report.restoreRace = { activeExamsWhileWaiting: during.exams.filter(e => e.status === 'active').length,
    examsAfterRemoteResponse: finished.exams.length, downloadedAfterCancel: downloaded };
  assert.equal(finished.exams.length, 1);
  assert.equal(finished.exams[0].id, during.exams[0].id);
  assert.equal(downloaded, false);
  await syncContext.close();
  assert.deepEqual(errors, []);
  assert.equal(report.legacyBackup.questionsBeforeReload, current.questions.length);
  assert.equal(report.legacyBackup.retainedAttempts, 1);
  assert.deepEqual(errors, []);
  await writeFile('artifacts/recovery-report.json', JSON.stringify(report, null, 2));
  console.log('Recovery checks passed:', JSON.stringify(report));
} finally { await browser.close(); }
