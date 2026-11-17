import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium,browserOptions,baseURL} from './browser-helpers.mjs';
import {isScorable} from '../dist/core.mjs';
const raw = JSON.parse(await readFile('dist/data/bank.json','utf8'));
const questions = raw.questions.filter(q => q.analysisMissing);
const browser = await chromium.launch(browserOptions), errors = [];
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(baseURL + '/#/practice'); await page.locator('.practice-start').waitFor();
  await page.evaluate(async ids => {
    const storage = await import('./storage.mjs'),{createPractice} = await import('./core.mjs');
    const {bank,state} = await storage.readSavedData();
    state.practice = createPractice(ids,'sequential');
    await storage.saveStorage(bank,state);
  },questions.map(q=>q.id));
  await page.goto(baseURL + '/#/practice?session=1'); await page.reload();
  for (const [index,q] of questions.entries()) {
    const input = page.locator('[name="questionNumber"]');
    await input.fill(String(index+1)); await input.press('Enter');
    await page.waitForFunction(id => document.querySelector('.question-main')?.dataset.questionId === id,q.id);
    if (isScorable(q)) await page.locator(`.option[data-value="${q.answer}"]`).click();
    else assert.equal(await page.locator('.question-main .notice').count(),1,q.id);
    await page.locator('[data-action="submit-answer"]').click();
    await page.locator('.analysis').waitFor();
    assert.match(await page.locator('.analysis > b').innerText(),/本站整理/,q.id);
    assert.equal(await page.locator('.analysis .katex-error').count(),0,q.id);
    assert.doesNotMatch(await page.locator('.question-main').innerText(),/\$\{analysisNote\}/);
    if ([0,23,49,58].includes(index)) {
      await page.screenshot({path:`artifacts/supplemental-analysis-${index+1}.png`,fullPage:true,animations:'disabled'});
    }
  }
  const attempts = await page.evaluate(async () => (await (await import('./storage.mjs')).readSavedState()).attempts);
  assert.equal(attempts.length,55);
  for (const q of questions.filter(q => !isScorable(q))) assert.ok(!attempts.some(a=>a.questionId===q.id));
  await page.goto(baseURL + '/#/quality?issue=analysis');
  await page.locator('#quality-issue').waitFor();
  assert.equal(await page.locator('.collection-item').count(),3);
  assert.deepEqual(await page.locator('.big-stat b').allTextContents(),['45','3','0']);
  await page.locator('#quality-issue').selectOption('supplemented');
  await page.locator('.collection-item').first().waitFor();
  assert.match(await page.locator('.quality-help').innerText(),/57 题已有完整/);
  await page.screenshot({path:'artifacts/supplemental-quality-desktop.png',fullPage:true,animations:'disabled'});
  const printable = await page.evaluate(async id => {
    const {bank,state} = await (await import('./storage.mjs')).readSavedData();
    const {printableCollection} = await import('./collection-export.mjs');
    const html = await printableCollection(bank,state,[bank.questions.find(q=>q.id===id)]);
    return {includesSupplement:html.includes('本站补充解析'),includesDerivation:html.includes('正切函数要求分母不为零')};
  },questions[0].id);
  assert.deepEqual(printable,{includesSupplement:true,includesDerivation:true});
  await page.setViewportSize({width:320,height:844});
  await page.locator('[data-action="toggle-theme"]').click();
  await page.goto(baseURL + '/#/practice?session=1');
  await page.locator('.analysis').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'artifacts/supplemental-analysis-mobile-dark.png',fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);
  await writeFile('artifacts/supplemental-analysis-report.json',JSON.stringify({rendered:60,scored:55,reviewOnly:5,completeExplanations:57,partialExplanations:1,unrecoverable:2,printIncludesSupplement:true,pageErrors:errors},null,2));
  console.log('All 60 supplemental explanations/review notes render; 55 eligible answers, quality filters and printable export passed.');
} finally {await browser.close();}
