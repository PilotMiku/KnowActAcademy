import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

const browser = await chromium.launch(browserOptions), errors = [], report = [];
const ids = ['s-6b82188494c1-q0027', 's-866d4371e8c0-q0005', 's-8df004948022-q0077'];
async function ready(page, id) {
  await page.waitForFunction(id => document.querySelector('.question-main')?.dataset.questionId === id &&
    [...document.querySelectorAll('.question-main img')].every(image => !image.dataset.figureLoading && image.complete && image.naturalWidth > 0), id);
}
async function saved(page) {
  return page.evaluate(async () => (await import('./storage.mjs')).readSavedState());
}
try {
  const page = await browser.newPage({ viewport:{width:1440,height:1000}, reducedMotion:'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/#/practice');
  await page.locator('.practice-start').waitFor();
  await page.evaluate(async ids => {
    const storage = await import('./storage.mjs'), {createPractice} = await import('./core.mjs');
    const {bank,state} = await storage.readSavedData();
    state.practice = createPractice(ids,'sequential');
    await storage.saveStorage(bank,state);
  }, ids);
  await page.goto(baseURL + '/#/practice?session=1');
  await page.reload();
  await ready(page,ids[0]);

  for (const theme of ['light','dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme)
      await page.locator('[data-action="toggle-theme"]').click();
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:900});
      for (const [index,id] of ids.entries()) {
        await page.locator(`.index-btn[data-index="${index}"]`).click();
        await ready(page,id);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
        assert.equal(await page.locator('.question-main .katex-error').count(),0);
        assert.equal(await page.locator('.question-main img.native-formula-image').first().evaluate(image => getComputedStyle(image).borderRadius),'0px');
        assert.equal(await page.locator('.navigation-legend').count(),1);
        if (width <= 600) {
          const actions = await page.locator('.question-actions').boundingBox();
          assert.ok(actions.y >= 0 && actions.y + actions.height <= 901);
          assert.equal(await page.locator('.question-actions').evaluate(element => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          }),true,'the fixed action bar stays above the question and navigation');
        }
        report.push({theme,width,id});
      }
      // Option images are inspected through a separate control, preserving the answer.
      await page.locator('.index-btn[data-index="0"]').click();
      await ready(page,ids[0]);
      const before = (await saved(page)).practice.responses;
      const optionImage = page.locator('.option img').first();
      const originalSource = await optionImage.getAttribute('src');
      await page.locator('[data-action="view-question-images"]').click();
      await page.locator('#zoomed-image').waitFor();
      await page.waitForFunction(() => document.querySelector('#zoomed-image').complete && document.querySelector('#zoomed-image').naturalWidth > 0);
      assert.equal(await page.locator('#zoomed-image').getAttribute('src'),originalSource);
      assert.ok(await page.locator('#zoomed-image').evaluate(image => image.width <= image.naturalWidth));
      await page.locator('#image-zoom').fill('300');
      assert.equal(await page.locator('#image-zoom-value').innerText(),'300%');
      assert.equal(await page.locator('.image-zoom-viewport').evaluate(element => element.scrollWidth > element.clientWidth),true);
      await page.locator('[data-action="reset-image-zoom"]').click();
      assert.equal(await page.locator('#image-zoom-value').innerText(),'100%');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      await page.screenshot({path:`artifacts/figure-viewer-${theme}-${width}.png`,animations:'disabled'});
      await page.keyboard.press('Escape');
      assert.deepEqual((await saved(page)).practice.responses,before);
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({top:0,behavior:'instant'}); });
      await page.screenshot({path:`artifacts/polished-question-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
    }
  }

  // A question with both a stem image and an option image exercises gallery switching.
  await page.locator('.index-btn[data-index="0"]').click();
  await ready(page,ids[0]);
  await page.locator('.question-title').evaluate(element => {
    const image = document.querySelector('.option img');
    if (image) element.append(image.cloneNode(true));
  });
  await page.locator('[data-action="view-question-images"]').click();
  const tabs = page.locator('[data-action="select-question-image"]');
  assert.ok(await tabs.count() >= 2);
  await tabs.last().click();
  assert.equal(await tabs.last().getAttribute('aria-pressed'),'true');
  assert.equal(await tabs.first().getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#zoomed-image').getAttribute('src'),await tabs.last().getAttribute('data-src'));
  await page.keyboard.press('Escape');

  await page.locator('.index-btn[data-index="1"]').click();
  await ready(page,ids[1]);
  await page.locator('.option').first().click();
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator('.result-box').waitFor();
  assert.equal(await page.locator('.analysis').evaluate(element => getComputedStyle(element).fontSize),'16px');
  assert.equal(await page.locator('.question-main').evaluate(element => element.getAnimations({subtree:true}).length),0);
  await page.screenshot({path:'artifacts/polished-analysis-mobile-dark.png',fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);
  await writeFile('artifacts/visual-polish-report.json',JSON.stringify({cases:report,optionImageDoesNotAnswer:true,gallerySwitching:true,reducedMotion:true,pageErrors:errors},null,2));
  console.log(`Visual polish and image inspection passed (${report.length} formula layouts).`);
} finally { await browser.close(); }
