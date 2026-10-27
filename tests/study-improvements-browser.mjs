import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';
import assert from 'node:assert/strict';
import { emptyState, normalizeBank, BACKUP_FORMAT } from '../dist/core.mjs';
import { fixture } from './fixture.mjs';
const browser=await chromium.launch(browserOptions), errors=[];
async function stateOf(page) {
  return page.evaluate(async()=>{
    const {storageName}=await import('./assets.mjs');
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(storageName,1);r.onerror=()=>reject(r.error);
      r.onsuccess=()=>{const db=r.result,t=db.transaction('kv'),v=t.objectStore('kv').get('state');t.oncomplete=()=>{db.close();resolve(v.result)};t.onerror=()=>reject(t.error)};
    });
  });
}
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror', e=>errors.push(e.message));
  await page.emulateMedia({colorScheme:'dark', reducedMotion:'reduce'});
  await page.goto(`${baseURL}/#/practice`);
  await page.locator('[data-action="start-practice"][data-mode="sequential"]').click();
  const image=page.locator('.question-title img').first();await image.waitFor();
  await image.focus();await page.keyboard.press('Enter');
  await page.locator('#image-zoom').fill('150');
  assert.equal(await page.locator('#image-zoom-value').innerText(),'150%');
  await page.locator('[data-action="reset-image-zoom"]').click();
  assert.equal(await page.locator('#image-zoom-value').innerText(),'100%');
  await page.locator('#dialog [data-action="close-dialog"]').first().click();
  await page.goto(`${baseURL}/#/library`);
  const raw=structuredClone(fixture);raw.questions=raw.questions.slice(0,5);
  await page.locator('[data-action="choose-file"]').click();
  await page.locator('#file-input').setInputFiles({name:'qa-new-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
  await page.locator('[data-action="confirm-import"]').click();await page.locator('.local-hero').waitFor();
  await page.goto(`${baseURL}/#/prepare`);
  assert.equal(await page.locator('#prepare-round-policy').inputValue(),'adaptive');
  await page.locator('[data-action="begin-preparation"]').click();
  await page.locator('.question-main').waitFor();
  await page.locator('[data-action="toggle-focus"]').click();
  assert.equal(await page.locator('.page-head').isVisible(),false);
  await page.locator('.question-toolbar [data-action="display-settings"]').click();
  await page.locator('#display-font').selectOption('larger');
  await page.locator('#display-spacing').selectOption('relaxed');
  await page.locator('#display-theme').selectOption('system');
  await page.locator('#dialog [data-action="close-dialog"]').first().click();
  assert.equal(await page.locator('body').getAttribute('data-font-size'),'larger');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.evaluate(()=>{window.__live=document.querySelector('.preparation-live');window.__bar=document.querySelector('.preparation-live .progress-bar>span')});
  for(const q of raw.questions) {
    // Locate each question from current in-memory navigation via exported state.
    const index=(await stateOf(page)).practice.questionIds.indexOf(q.id);
    await page.locator(`.index-btn[data-index="${index}"]`).click();
    await page.locator(`.question-main[data-question-id="${q.id}"]`).waitFor();
    if(q.id==='qa-single') {
      await page.locator('[data-action="toggle-uncertain"]').click();
      await page.evaluate(()=>{window.__main=document.querySelector('.question-main');window.__live=document.querySelector('.preparation-live');window.__bar=document.querySelector('.preparation-live .progress-bar>span')});
    }
    if(q.type==='solution') {
      await page.locator('[data-action="submit-answer"]').click();
      await page.locator('[data-action="self-grade"][data-correct="true"]').click();
    } else {
      if(q.type==='fill') await page.locator('[data-answer-text]').fill(q.answer);
      else for(const value of Array.isArray(q.answer)?q.answer:[String(q.answer)]) await page.locator(`[data-action="answer-option"][data-value="${value}"]`).click();
      await page.locator('[data-action="submit-answer"]').click();
    }
    await page.locator('.result-box').waitFor();
    if(q.id==='qa-single') {
      assert.equal(await page.evaluate(()=>window.__main===document.querySelector('.question-main')&&window.__live===document.querySelector('.preparation-live')&&window.__bar===document.querySelector('.preparation-live .progress-bar>span')),true);
      assert.match(await page.locator('.result-label').innerText(),/不确定/);
      assert.equal(await page.locator('[data-action="toggle-uncertain"]').isDisabled(),true);
      assert.equal(await page.locator('[data-preparation-score]').innerText(),'—');
    }
  }
  const last=await page.locator('.question-index .index-btn').count();
  await page.locator(`.index-btn[data-index="${last-1}"]`).click();
  await page.locator('[data-action="next-question"]').click();
  await page.locator('.preparation-summary').waitFor();
  await page.locator('[data-action="next-training"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.question-index .index-btn').length===3);
  await page.screenshot({path:'artifacts/improved-study-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'artifacts/improved-study-mobile.png',fullPage:false,animations:'disabled'});
  // Return through the header: focus mode must remain escapable.
  await page.locator('[data-action="toggle-focus"]').click();
  await page.goto(`${baseURL}/#/practice?status=unseen`);
  await page.locator('[data-action="start-practice"]').first().waitFor();
  assert.equal(await page.locator('[data-action="start-practice"]').first().isDisabled(),true);
  await page.goto(`${baseURL}/#/knowledge`);
  await page.locator('.knowledge-title').first().click();
  await page.locator('[data-action="knowledge-recall"]').click();
  await page.locator('[data-recall-text]').fill('核心概念与关键词，先独立回忆。');
  assert.equal(await page.locator('.recall-reference').getAttribute('open'),null);
  await page.locator('.recall-reference>summary').click();
  await page.locator('[data-action="knowledge-recalled"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-action="knowledge-recalled"]').disabled);
  await page.reload();await page.locator('[data-recall-text]').waitFor();
  assert.equal(await page.locator('[data-recall-text]').inputValue(),'核心概念与关键词，先独立回忆。');
  assert.equal(await page.locator('[data-action="knowledge-recalled"]').isDisabled(),true);
  await page.goto(`${baseURL}/#/exams`);
  await page.locator('[data-action="create-exam"]').first().click();
  await page.locator('#exam-count').fill('2');
  await page.locator('[data-action="begin-exam"]').click();
  await page.locator('.question-main').waitFor();
  const exam=(await stateOf(page)).exams.find(e=>e.status==='active');
  const examQuestion=raw.questions.find(q=>q.id===exam.questionIds[0]);
  if(examQuestion.type==='fill') await page.locator('[data-answer-text]').fill(examQuestion.answer);
  else for(const value of Array.isArray(examQuestion.answer)?examQuestion.answer:[String(examQuestion.answer)]) await page.locator(`[data-action="answer-option"][data-value="${value}"]`).click();
  await page.locator('[data-action="toggle-uncertain"]').click();
  assert.equal(await page.locator('.index-btn.current .nav-state').innerText(),'?');
  await page.locator('.question-nav [data-action="submit-exam"]').click();
  await page.locator('[data-action="confirm-dialog"]').click();
  await page.locator('.exam-breakdown').waitFor();
  assert.match(await page.locator('.exam-breakdown tbody').innerText(),/1 题/);
  assert.match(await page.locator('.question-main').first().innerText(),/曾标记拿不准/);
  assert.match(await page.locator('.question-main').first().innerText(),/本题用时/);
  assert.match(await page.locator('.result-label').first().innerText(),/本题答对，但标记为拿不准/);
  assert.doesNotMatch(await page.locator('.result-label').allTextContents().then(values=>values.join(' ')),/再巩固一次|连续答对两次/);
  // Import a portable synthetic collection to exercise the real page controls.
  const large=structuredClone(fixture);
  large.questions=Array.from({length:65},(_,i)=>({...large.questions[0],id:`collection-${i}`}));
  const collectionBank=normalizeBank(large);collectionBank.managedBundle=false;
  const collectionState=emptyState();collectionState.favorites=collectionBank.questions.map(q=>q.id);
  await page.goto(`${baseURL}/#/library`);
  await page.locator('[data-action="restore-backup"]').click();
  await page.locator('#file-input').setInputFiles({name:'qa-collection.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:BACKUP_FORMAT,bank:collectionBank,state:collectionState}))});
  await page.locator('[data-action="confirm-dialog"]').click();await page.locator('.local-hero').waitFor();
  await page.goto(`${baseURL}/#/favorites`);
  await page.locator('#collection-sort').selectOption('bank');
  await page.locator('.collection-pagination').getByRole('link',{name:'下一页'}).click();
  await page.waitForFunction(()=>document.querySelector('.collection-item .muted')?.textContent.includes('第 2 / 3 页'));
  await page.locator('.collection-pagination').getByRole('link',{name:'下一页'}).click();
  await page.waitForFunction(()=>document.querySelector('.collection-item .muted')?.textContent.includes('第 3 / 3 页'));
  assert.equal(await page.locator('[data-action="practice-one"]').count(),5);
  await page.locator('[data-action="start-collection"]').click();
  await page.locator('.question-main[data-question-id="collection-60"]').waitFor();
  assert.equal(await page.locator('.question-index .index-btn').count(),5);
  assert.deepEqual(errors,[]);
  console.log('Study enhancements passed: adaptive rounds, confidence, stable DOM, display settings, image zoom, recall, exam report and collection pagination.');
} finally {await browser.close()}
