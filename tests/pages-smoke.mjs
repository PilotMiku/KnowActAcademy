import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/');
  await page.locator('.local-hero').waitFor();
  assert.match(await page.title(), /知行学习/);
  await page.goto(baseURL + '/#/practice?subject=calculus&chapter=s-6b82188494c1');
  await page.getByRole('button', { name: /顺序练习/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.original-pdf-image')].length === 5 &&
    [...document.querySelectorAll('.original-pdf-image')].every(image => image.complete && image.naturalWidth > 0));
  assert.deepEqual(errors, []);
  console.log('Root deployment smoke passed.');
} finally { await browser.close(); }
