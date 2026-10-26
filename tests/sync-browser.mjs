import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const api = process.env.ZHIXING_TEST_API;
const key = process.env.ZHIXING_TEST_KEY;
assert.ok(api && key, 'Run with npm run test:browser');
const knowledge = JSON.parse(await readFile('dist/data/knowledge.json', 'utf8'));
const note = knowledge.articles.find(article => article.kind === 'note');
const browser = await chromium.launch(browserOptions);
const errors = [];
async function stateOf(page) {
  return page.evaluate(async () => {
    const { storageName } = await import('./assets.mjs');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(storageName, 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('kv');
        const value = tx.objectStore('kv').get('state');
        tx.oncomplete = () => { db.close(); resolve(value.result); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
}
async function connect(page) {
  await page.goto(baseURL + '/#/library');
  await page.getByRole('button', { name: '连接同步服务器', exact: true }).click();
  await page.locator('#cloud-api').fill(api);
  await page.locator('#cloud-token').fill(key);
  await page.locator('[data-action="cloud-do-connect"]').click();
  await page.locator('.cloud-card .pill').filter({ hasText: '已连接' }).waitFor();
}
async function confirm(page, action) {
  await page.locator(`[data-action="${action}"]`).click();
  await page.locator('[data-action="confirm-dialog"]').click();
}
try {
  const one = await browser.newContext({ acceptDownloads: true });
  const two = await browser.newContext({ acceptDownloads: true });
  const a = await one.newPage(), b = await two.newPage();
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
  await a.goto(baseURL + '/#/practice?subject=calculus&chapter=s-6b82188494c1');
  await a.getByRole('button', { name: /顺序练习/ }).click();
  await a.locator('[data-action="answer-option"][data-value="A"]').click();
  await a.getByRole('button', { name: '确认答案', exact: true }).click();
  await a.getByRole('button', { name: '收藏题目', exact: true }).click();
  await a.goto(baseURL + '/#/prepare?subject=calculus&scope=custom&chapter=s-6b82188494c1');
  await a.locator('[data-action="begin-preparation"]').click();
  await a.locator('.question-main').waitFor();
  await a.locator('[data-action="answer-option"][data-value="A"]').click();
  await a.getByRole('button', { name: '确认答案', exact: true }).click();
  await a.locator('.result-box').waitFor();
  await a.goto(baseURL + '/#/prepare');
  await a.locator('[data-action="begin-preparation"]').click();
  await a.locator('.question-main').waitFor();
  await a.goto(baseURL + '/#/knowledge/' + note.id);
  await a.getByRole('button', { name: /标为已读/ }).click();
  await a.getByRole('button', { name: '收藏知识点', exact: true }).click();
  const original = await stateOf(a);
  await connect(a);
  assert.deepEqual(await stateOf(a), original); // Connecting never changes local progress.
  await connect(b); // Both devices now hold revision 0.
  await confirm(a, 'cloud-upload');
  await a.getByRole('status').filter({ hasText: '学习进度已上传' }).waitFor();
  assert.deepEqual(await stateOf(a), original);
  // Stale device cannot overwrite the new remote snapshot.
  await confirm(b, 'cloud-upload');
  await b.getByRole('status').filter({ hasText: /服务器已有更新/ }).waitFor();
  await b.getByRole('button', { name: '关闭', exact: true }).click();
  const downloadEvent = b.waitForEvent('download');
  await confirm(b, 'cloud-download');
  const backup = await downloadEvent;
  await backup.saveAs('artifacts/pre-sync-backup.json');
  await b.getByRole('status').filter({ hasText: '服务器进度已恢复' }).waitFor();
  const restored = await stateOf(b);
  assert.deepEqual(restored.attempts, original.attempts);
  assert.deepEqual(restored.favorites, original.favorites);
  assert.deepEqual(restored.mistakes, original.mistakes);
  assert.deepEqual(restored.knowledgeRead, original.knowledgeRead);
  assert.deepEqual(restored.knowledgeFavorites, original.knowledgeFavorites);
  assert.deepEqual(restored.preparation, original.preparation);
  assert.deepEqual(restored.preparationHistory, original.preparationHistory);
  assert.deepEqual(restored.practice, original.practice);
  const beforeBackup = JSON.parse(await readFile('artifacts/pre-sync-backup.json', 'utf8'));
  assert.equal(beforeBackup.state.attempts.length, 0);
  await b.reload();
  await b.getByRole('button', { name: '连接同步服务器', exact: true }).waitFor();
  assert.deepEqual((await stateOf(b)).favorites, original.favorites);
  // A same-origin neighboring repository and the original app have separate databases.
  const databases = await b.evaluate(() => indexedDB.databases());
  assert.deepEqual(databases.map(db => db.name), ['zhixing-study:/test-repo/']);
  const storageText = await b.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  assert.ok(!storageText.includes(key));
  await b.setViewportSize({ width: 390, height: 844 });
  await b.screenshot({ path: 'artifacts/sync-mobile.png', fullPage: true });
  assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  await writeFile('artifacts/sync-browser-report.json', JSON.stringify({ passed: true, scenarios: [
    'real cross-origin CORS API, read-only connect, manual upload, stale-device conflict rejection',
    'second device restores attempts, mistakes, favorites and knowledge records',
    'automatic local backup before restore; no key in browser persistent storage',
    'independent repository storage, refresh persistence and mobile sync layout',
  ] }, null, 2));
  console.log('Real backend two-device sync passed.');
} finally { await browser.close(); }
