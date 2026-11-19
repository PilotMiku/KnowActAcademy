import assert from 'node:assert/strict';
import {chromium,browserOptions,baseURL,revealPracticeOptions} from './browser-helpers.mjs';
const browser=await chromium.launch(browserOptions),errors=[];
const ids=['s-6b82188494c1-q0001','u-linear-c8eeb147cdfd7f6f'];
try {
  const page=await browser.newPage({viewport:{width:1360,height:1000},reducedMotion:'no-preference'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseURL+'/#/practice');await page.locator('.practice-start').waitFor();
  await page.evaluate(async ids=>{
    const {readSavedData,saveStorage}=await import('./storage.mjs'),{createPractice}=await import('./core.mjs');
    const {bank,state}=await readSavedData();state.practice=createPractice(ids,'sequential');await saveStorage(bank,state);
  },ids);
  await page.goto(baseURL+'/#/practice?session=1');await page.reload();
  await page.locator(`.question-main[data-question-id="${ids[0]}"]`).waitFor();
  const favorite=page.locator('.question-top [data-action="toggle-favorite"]');
  assert.equal(await favorite.getAttribute('aria-pressed'),'false');
  await page.locator('[data-action="answer-option"][data-value="A"]').click();
  await favorite.click();
  await page.waitForFunction(()=>document.querySelector('.favorite-button')?.classList.contains('favorite-added'));
  assert.equal(await favorite.getAttribute('aria-pressed'),'true');
  assert.equal(await favorite.locator('svg').evaluate(el=>getComputedStyle(el).fill),await favorite.evaluate(el=>getComputedStyle(el).color));
  assert.equal(await page.locator('.option.selected').getAttribute('data-value'),'A');
  await page.reload();await page.locator('.favorite-button.is-favorite').waitFor();
  assert.equal(await favorite.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.favorite-added').count(),0,'reload does not replay the celebration');
  await favorite.click();await page.waitForFunction(()=>document.querySelector('.favorite-button')?.getAttribute('aria-pressed')==='false');
  assert.equal(await favorite.locator('svg').evaluate(el=>getComputedStyle(el).fill),'none');
  await page.locator('.index-btn[data-index="1"]').click();
  await page.locator(`.question-main[data-question-id="${ids[1]}"] .readable-formula .katex`).first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.question-main img')].every(img=>!img.dataset.figureLoading && img.complete && img.naturalWidth>0));
  assert.match(await page.locator('.difficulty-badge').getAttribute('aria-label'),/自动初评/);
  assert.equal(await page.locator('.question-main .katex-error').count(),0);
  for(const width of [1360,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const theme of ['light','dark']){
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('[data-action="toggle-theme"]').click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await page.locator('.question-title').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=18),true);
      await page.waitForFunction(()=>!document.querySelector('[data-action="answer-option"]')?.disabled);
      await page.screenshot({path:`artifacts/difficulty-favorite-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
    }
  }
  await page.setViewportSize({width:1360,height:1000});
  await page.locator('[data-action="question-annotation"]').click();
  await page.locator('#annotation-difficulty').selectOption('5');
  await page.locator('[data-action="save-annotation"]').click();
  await page.locator('.difficulty-badge[data-difficulty-stars="5"]').waitFor();
  assert.match(await page.locator('.difficulty-badge').getAttribute('aria-label'),/个人标注/);
  await favorite.click();await page.locator('.favorite-button.is-favorite').waitFor();
  await page.setViewportSize({width:390,height:1000});
  await page.screenshot({path:'artifacts/favorite-selected-mobile.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:1360,height:1000});
  await page.goto(baseURL+'/#/favorites');await page.locator('.collection-item .favorite-button').waitFor();
  assert.equal(await page.locator('.collection-item .favorite-button').getAttribute('aria-pressed'),'true');
  await page.locator('.collection-item .favorite-button').click();await page.locator('.collection-item .favorite-button').waitFor({state:'detached'});
  const sourceLabel = await page.evaluate(async id => {
    const { bank } = await (await import('./storage.mjs')).readSavedData();
    return bank.questions.find(q => q.id === id).sourceLabel;
  }, ids[1]);
  const filters = new URLSearchParams({ difficulty: '5', q: sourceLabel });
  await page.goto(baseURL+'/#/practice?'+filters);await page.locator('.practice-start').waitFor();await revealPracticeOptions(page);
  assert.equal(await page.locator('#practice-difficulty').inputValue(),'5');
  const personallyRated = page.locator(`[data-action="practice-one"][data-id="${ids[1]}"]`);
  await personallyRated.waitFor();
  // Reduced-motion users still get the filled state, without a celebration.
  await page.emulateMedia({reducedMotion:'reduce'});
  await personallyRated.click();await page.locator('.question-main').waitFor();
  await favorite.click();await page.locator('.favorite-button.is-favorite').waitFor();
  assert.equal(await page.locator('.favorite-added').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Five-star annotations, source-checked formulas, favorite persistence and motion passed at desktop/mobile in both themes.');
} finally {await browser.close();}
