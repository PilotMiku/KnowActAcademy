import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch(browserOptions), errors = [];
let releaseBank;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const bankGate = new Promise(resolve => { releaseBank = resolve; });
  await context.route('**/data/bank.json', async route => { await bankGate; await route.continue(); });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const requestedBank = page.waitForRequest('**/data/bank.json');
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await requestedBank;
  await page.locator('.welcome-quote').waitFor();
  assert.equal(await page.locator('.welcome-quote h1').innerText(), '行是知之始\n知是行之成');
  assert.equal(await page.locator('.welcome-quote cite').innerText(), '陶行知');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/welcome-desktop-light.png', fullPage: true, animations: 'disabled' });
  await page.locator('.skip').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  assert.equal(await page.evaluate(() => location.hash), '');
  await page.getByRole('link', { name: '进入学习', exact: true }).focus();
  await page.evaluate(() => {
    window.addEventListener('click', () => {
      const shell = document.querySelector('.welcome-shell');
      window.entryMotion = { hash: location.hash, durations: shell.getAnimations().map(a => a.effect.getTiming().duration) };
    }, { once: true });
  });
  await page.keyboard.press('Enter');
  const entryMotion = await page.evaluate(() => window.entryMotion);
  assert.equal(entryMotion.hash, '');
  assert.ok(entryMotion.durations.some(duration => duration > 0 && duration <= 250));
  await page.getByRole('status').filter({ hasText: '正在准备学习空间' }).waitFor();
  releaseBank();
  await page.locator('.local-hero').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#/');
  await page.reload();
  await page.locator('.local-hero').waitFor();
  assert.equal(await page.locator('.welcome-shell').count(), 0);
  await page.goto(baseURL + '/#/practice?subject=calculus&chapter=s-6b82188494c1');
  await page.getByRole('button', { name: '顺序练习', exact: false }).click();
  await page.getByRole('button', { name: '收藏题目', exact: true }).click();
  await page.getByRole('button', { name: '取消收藏', exact: true }).waitFor();
  await page.getByRole('link', { name: '查看起始页', exact: true }).click();
  await page.locator('.welcome-shell').waitFor();
  const repeatedEntry = await page.evaluate(() => {
    const entry = document.querySelector('.welcome-enter'), shell = entry.closest('.welcome-shell');
    entry.click(); entry.click();
    return { hash: location.hash, animations: shell.getAnimations().length };
  });
  assert.equal(repeatedEntry.hash, '#/welcome');
  assert.equal(repeatedEntry.animations, 1);
  await page.locator('.local-hero').waitFor();
  await page.goto(baseURL + '/#/favorites');
  await page.locator('.collection-stem').waitFor();
  assert.equal(await page.locator('.collection-stem').count(), 1);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto(baseURL + '/#/welcome');
  await page.locator('.welcome-shell').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('.welcome-main').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.screenshot({ path: 'artifacts/welcome-desktop-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/welcome-mobile-dark.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 640 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/welcome-mobile-light.png', fullPage: true });
  await page.getByRole('link', { name: '加权备考', exact: true }).click();
  await page.locator('#prepare-subject').waitFor();
  assert.equal(await page.locator('.welcome-shell').count(), 0);
  await page.goto(baseURL + '/#/welcome');
  await page.locator('.welcome-shell').waitFor();
  const reducedEntry = await page.evaluate(() => {
    const shell = document.querySelector('.welcome-shell');
    document.querySelector('.welcome-enter').click();
    return { hash: location.hash, animations: shell.getAnimations().length };
  });
  assert.deepEqual(reducedEntry, { hash: '#/', animations: 0 });
  await page.locator('.local-hero').waitFor();
  assert.deepEqual(errors, []);
  console.log('Welcome page passed: slow loading, keyboard entry, deep links, saved favorites, light/dark, mobile and reduced motion.');
} finally {
  releaseBank?.();
  await browser.close();
}
