import assert from 'node:assert/strict';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

const ids = ['u-linear-17c894477f3cf990', 'u-linear-ebaf25ab05feb525', 'u-calculus-801e7c98f1bfe7f3', 'u-calculus-6f3b5ba99624b436', 'u-calculus-9bc4cff8f2250ee8'];
const browser = await chromium.launch(browserOptions), errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/#/practice');
  await page.locator('.practice-start').waitFor();
  await page.evaluate(async ids => {
    const { readSavedData, saveStorage } = await import('./storage.mjs');
    const { createPractice } = await import('./core.mjs');
    const { bank, state } = await readSavedData();
    state.practice = createPractice(ids, 'sequential');
    await saveStorage(bank, state);
  }, ids);
  await page.goto(baseURL + '/#/practice?session=1'); await page.reload();
  for (const width of [1360, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme)
        await page.locator('[data-action="toggle-theme"]').click();
      for (const [index, id] of ids.entries()) {
        await page.locator(`.index-btn[data-index="${index}"]`).click();
        await page.locator(`.question-main[data-question-id="${id}"] .readable-formula .katex`).first().waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.question-main img')].every(img => !img.dataset.figureLoading && img.complete && img.naturalWidth > 0));
        assert.equal(await page.locator('.question-main .katex-error').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${id} ${theme} ${width}`);
        assert.equal(await page.locator('.option .readable-formula [data-action], .option .readable-formula[tabindex]').count(), 0);
      }
      await page.locator('.index-btn[data-index="0"]').click();
      await page.locator('.question-title .readable-formula .katex').first().waitFor();
      const before = await page.evaluate(async () => (await (await import('./storage.mjs')).readSavedState()).practice.responses);
      await page.locator('[data-action="view-question-images"]').click();
      await page.locator('.zoomed-formula .katex').waitFor();
      if (width <= 600) {
        assert.equal(await page.locator('.image-gallery').evaluate(el => getComputedStyle(el).flexWrap), 'nowrap');
        assert.equal(await page.locator('.image-gallery').evaluate(el => el.scrollWidth > el.clientWidth), true);
      }
      assert.equal(await page.locator('#dialog .katex-error').count(), 0);
      const height = await page.locator('.zoomed-formula').evaluate(el => el.getBoundingClientRect().height);
      await page.locator('#image-zoom').fill('300');
      assert.equal(await page.locator('#image-zoom-value').innerText(), '300%');
      assert.ok(await page.locator('.zoomed-formula').evaluate(el => el.getBoundingClientRect().height) > height * 2);
      assert.equal(await page.locator('.image-zoom-viewport').evaluate(el => el.scrollWidth > el.clientWidth), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#dialog .dialog-head [data-action="close-dialog"]').isVisible(), true);
      await page.screenshot({ path: `artifacts/neu-clarity-zoom-${theme}-${width}.png`, animations: 'disabled' });
      await page.locator('[data-action="toggle-formula-original"]').click();
      await page.waitForFunction(() => document.querySelector('#zoomed-image')?.complete && document.querySelector('#zoomed-image').naturalWidth > 0);
      assert.equal(await page.locator('.zoomed-formula').isVisible(), false);
      assert.equal(await page.locator('#zoomed-image').isVisible(), true);
      assert.equal(await page.evaluate(async () => {
        const view = document.querySelector('.formula-view');
        const { loadNativeFigure } = await import('./assets.mjs');
        return document.querySelector('#zoomed-image').src === await loadNativeFigure(view.dataset.figure, undefined, undefined, view.dataset.version);
      }), true, 'comparison loads the exact preserved source image');
      await page.locator('[data-action="toggle-formula-original"]').click();
      assert.equal(await page.locator('.zoomed-formula').isVisible(), true);
      assert.equal(await page.locator('#zoomed-image').isVisible(), false);
      const tabs = page.locator('[data-action="select-question-image"]');
      if (await tabs.count() > 1) {
        await tabs.last().click();
        assert.equal(await tabs.last().getAttribute('aria-pressed'), 'true');
        assert.equal(await tabs.first().getAttribute('aria-pressed'), 'false');
        assert.equal(await page.locator('#image-zoom').inputValue(), '100');
      }
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(async () => (await (await import('./storage.mjs')).readSavedState()).practice.responses), before);
      await page.screenshot({ path: `artifacts/neu-clarity-question-${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
  }
  assert.deepEqual(errors, []);
  console.log('NEU source-checked systems, determinants, piecewise functions, zoom and original comparison passed in both themes at 3 widths and 2x pixel density.');
} finally { await browser.close(); }
