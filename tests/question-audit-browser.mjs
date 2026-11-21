import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium,browserOptions,baseURL} from './browser-helpers.mjs';
const reviews=JSON.parse(await readFile('data/question-reviews.json','utf8')).entries;
const bank=JSON.parse(await readFile('dist/data/bank.json','utf8'));
const byId=new Map(bank.questions.map(q=>[q.id,q]));
const ids=Object.keys(reviews),browser=await chromium.launch(browserOptions);
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(baseURL+'/#/practice');await page.locator('.practice-start').waitFor();
 await page.evaluate(async ids=>{
  const storage=await import('./storage.mjs'),{createPractice}=await import('./core.mjs');
  const {bank,state}=await storage.readSavedData();state.practice=createPractice(ids,'sequential');
  await storage.saveStorage(bank,state);
 },ids);
 await page.goto(baseURL+'/#/practice?session=1');await page.reload();
 for(const [index,id] of ids.entries()){
  const input=page.locator('[name="questionNumber"]');await input.fill(String(index+1));await input.press('Enter');
  await page.waitForFunction(id=>document.querySelector('.question-main')?.dataset.questionId===id,id);
  const row=reviews[id];
  if(row.assessment==='review-only') assert.equal(await page.locator('.question-main .notice').count(),1,id);
  else await page.locator(`.option[data-value="${row.correctedAnswer ?? row.referenceAnswer}"]`).click();
  await page.locator('[data-action="submit-answer"]').click();await page.locator('.analysis').waitFor();
  assert.equal(await page.locator('.question-main .katex-error').count(),0,id);
  if(row.parts.stem) {
   const prose=byId.get(id).stem.match(/[\u3400-\u9fff]{2,}/gu) ?? [];
   const rendered=await page.locator('.question-title').innerText();
   assert.ok(rendered.trim(),id);
   for(const phrase of prose) assert.ok(rendered.includes(phrase),id+' '+phrase);
  }
 }
 const attempts=await page.evaluate(async()=> (await(await import('./storage.mjs')).readSavedState()).attempts);
 const eligible=ids.filter(id=>reviews[id].assessment!=='review-only');
 assert.equal(attempts.length,eligible.length);
 assert.ok(attempts.every(a=>eligible.includes(a.questionId)&&a.correct));
 await page.screenshot({path:'artifacts/question-audit-desktop.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'artifacts/question-audit-mobile.png',fullPage:true,animations:'disabled'});
 await page.goto(baseURL+'/#/quality?issue=answer');await page.locator('#quality-issue').waitFor();
 assert.equal((await page.locator('.big-stat b').allTextContents())[0],'45');
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/question-audit-browser-report.json',JSON.stringify({rendered:ids.length,eligible:eligible.length,excluded:ids.length-eligible.length,pageErrors:errors},null,2));
 console.log(`All ${ids.length} editorial reviews render; ${eligible.length} eligible and ${ids.length-eligible.length} excluded answers verified.`);
}finally{await browser.close();}
