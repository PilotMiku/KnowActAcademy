import {chromium,browserOptions,baseURL,revealPreparationOptions} from './browser-helpers.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
const raw=structuredClone(fixture);raw.questions=[raw.questions[0],raw.questions[4],raw.questions[3]];
const browser=await chromium.launch(browserOptions),errors=[],base=Date.UTC(2026,10,17,4);
async function stateOf(page){return page.evaluate(async()=>(await import('./storage.mjs')).readSavedState());}
async function metrics(page){return page.evaluate(async()=>{
 const {bank,state}=await(await import('./storage.mjs')).readSavedData();
 const m=(await import('./preparation.mjs')).preparationMetrics(bank,state);
 return {passed:m.passed,mastered:m.mastered,stable:m.stableMastered,pending:m.pendingMistakes,progress:m.progress};
});}
async function visit(page,id){const s=await stateOf(page);const i=s.practice.questionIds.indexOf(id);assert.ok(i>=0,id);await page.locator(`.index-btn[data-index="${i}"]`).click();}
async function grade(page,id,correct){
 await visit(page,id);const q=raw.questions.find(q=>q.id===id);
 if(q.type==='solution'){
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator(`[data-action="self-grade"][data-correct="${correct}"]`).click();
 }else{
  const answer=q.type==='boolean'?String(correct?q.answer:!q.answer):correct?q.answer:'A';
  await page.locator(`.option[data-value="${answer}"]`).click();
  await page.locator('[data-action="submit-answer"]').evaluate(button=>{button.click();button.click();});
 }
 await page.locator('.result-box').waitFor();
 await page.locator('.result-box .self-grade-actions').waitFor({state:'detached'});
}
async function summary(page){const s=await stateOf(page);await visit(page,s.practice.questionIds.at(-1));await page.locator('[data-action="next-question"]').click();await page.locator('.preparation-summary').waitFor();}
try{
 const page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true,reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(base));
 await page.goto(baseURL+'/#/library');await page.getByRole('button',{name:'选择题库文件'}).click();
 await page.locator('#file-input').setInputFiles({name:'qa-mastery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
 await page.getByRole('button',{name:'确认导入',exact:true}).click();await page.locator('.local-hero').waitFor();
 await page.goto(baseURL+'/#/prepare');await revealPreparationOptions(page);await page.locator('#prepare-round-policy').selectOption('fixed');
 await page.locator('[data-action="begin-preparation"]').click();
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('.session-preparation').evaluate(el=>el.open),false);
 await page.locator('.session-preparation summary').first().click();
 await page.locator('.preparation-live').waitFor();
 await page.locator('.session-preparation summary').first().click();
 await grade(page,'qa-single',true);
 assert.equal(await page.locator('[data-live-field="session-count"]').innerText(),'1 / 3');
 assert.match(await page.locator('[data-preparation-question-status]').innerText(),/已掌握/);
 await page.locator('[data-action="mark-preparation-incorrect"]').evaluate(button=>{button.click();button.click();});
 await page.locator('.result-box.wrong').waitFor();
 assert.equal(await page.locator('[data-action="mark-preparation-incorrect"]').count(),0);
 assert.equal((await stateOf(page)).mistakes['qa-single'].wrongCount,1);
 assert.equal((await stateOf(page)).practice.responses['qa-single'].correct,false);
 assert.match(await page.locator('.result-label').innerText(),/已按不会做加入错题本/);
 await page.reload();
 await page.getByRole('button',{name:'撤销自评'}).click();
 await page.locator('.result-box.wrong').waitFor({state:'detached'});
 assert.equal((await stateOf(page)).mistakes['qa-single'],undefined);
 assert.equal((await stateOf(page)).attempts.filter(a=>a.questionId==='qa-single').length,1);
 assert.equal((await metrics(page)).mastered,1);
 await page.locator('[data-action="mark-preparation-incorrect"]').click();
 await page.locator('.result-box.wrong').waitFor();
 await page.setViewportSize({width:1440,height:1080});
 await page.goto(baseURL+'/#/review');await page.locator('[data-action="resolve-mistake"][data-id="qa-single"]').click();
 await page.getByRole('status').filter({hasText:'请先独立答对'}).waitFor();
 assert.equal((await stateOf(page)).mistakes['qa-single'].resolved,false);
 await page.goto(baseURL+'/#/prepare?session=1');
 await visit(page,'qa-solution');await page.locator('[data-action="submit-answer"]').click();
 assert.equal((await metrics(page)).passed,0); // Opening a reference is not a successful trial.
 await page.locator('[data-action="self-grade"][data-correct="true"]').click();
 assert.equal((await metrics(page)).mastered,1);
 await page.locator('[data-action="mark-preparation-incorrect"]').click();
 await page.locator('.result-box.wrong').waitFor();
 assert.equal((await metrics(page)).mastered,0);
 await grade(page,'qa-boolean',true);assert.equal((await metrics(page)).mastered,1);
 await summary(page);await page.locator('[data-action="next-training"]').click();
 assert.deepEqual(new Set((await stateOf(page)).practice.questionIds),new Set(['qa-single','qa-solution']));
 await grade(page,'qa-solution',true);
 await grade(page,'qa-single',true);
 assert.match(await page.locator('[data-preparation-question-status]').innerText(),/已掌握/);
 assert.match(await page.locator('.result-label').innerText(),/本次答对.*已掌握/);
 assert.deepEqual(await metrics(page),{passed:3,mastered:3,stable:0,pending:0,progress:100});
 assert.equal((await stateOf(page)).mistakes['qa-single'].resolved,true);
 await page.reload();assert.equal((await metrics(page)).mastered,3);
 assert.equal((await stateOf(page)).attempts.filter(a=>a.questionId==='qa-single').length,2);
 await page.screenshot({path:'artifacts/preparation-mastered-desktop.png',fullPage:true});
 // The portable backup must retain mastery and the corrected wrong results.
 await page.goto(baseURL+'/#/library');const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'导出完整备份'}).click();await(await download).saveAs('artifacts/preparation-mastery-backup.json');
 await page.getByRole('button',{name:'清空学习记录'}).click();await page.locator('[data-action="confirm-dialog"]').click();await page.locator('.local-hero').waitFor();
 await page.goto(baseURL+'/#/library');
 await page.getByRole('button',{name:'恢复学习数据'}).click();await page.locator('#file-input').setInputFiles('artifacts/preparation-mastery-backup.json');
 await page.locator('[data-action="confirm-dialog"]').click();await page.locator('.local-hero').waitFor();
 await page.goto(baseURL+'/#/prepare?session=1');assert.equal((await metrics(page)).mastered,3);
 await summary(page);await page.locator('[data-action="next-training"]').click();
 let p=(await stateOf(page)).practice;assert.equal(p.round,2);assert.equal(p.auditQuestionIds.length,1);
 assert.ok(!p.questionIds.includes('qa-single')); // It was just corrected in round 1.
 await grade(page,p.questionIds[0],true);assert.match(await page.locator('[data-preparation-question-status]').innerText(),/随机抽查.*已掌握/);
 assert.equal((await metrics(page)).mastered,3);
 // A later eligible sample still includes the corrected mistake.
 for(let i=0;i<3;i++){
  await summary(page);await page.locator('[data-action="next-training"]').click();
  p=(await stateOf(page)).practice;
  await grade(page,p.questionIds[0],true);
  if(p.questionIds.includes('qa-single'))break;
 }
 assert.ok(p.questionIds.includes('qa-single'));
 assert.match(await page.locator('[data-preparation-question-status]').innerText(),/已掌握/);
 assert.equal((await metrics(page)).stable,0);
 await summary(page);await page.clock.setFixedTime(new Date(base+86400000+10000));
 await page.reload();await page.locator('.preparation-summary').waitFor();
 await page.evaluate(()=>{Math.random=()=>0.5;});await page.locator('[data-action="next-training"]').click();
 p=(await stateOf(page)).practice;assert.ok(p.questionIds.includes('qa-single'));
 await grade(page,'qa-single',false);
 assert.match(await page.locator('[data-preparation-question-status]').innerText(),/待巩固/);
 assert.equal((await metrics(page)).progress,66.67);assert.equal((await metrics(page)).pending,1);
 assert.equal((await stateOf(page)).mistakes['qa-single'].resolved,false);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'切换明暗主题'}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'artifacts/preparation-sampling-mobile-dark.png',fullPage:true});
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/preparation-mastery-browser-report.json',JSON.stringify({passed:true,immediateMastery:true,markIncorrect:true,noImmediateRepeat:true,delayedSamples:true,backupRestore:true,relapse:true,pageErrors:errors},null,2));
 console.log('Preparation immediate mastery and self-assessment, delayed sampling, no forced repeats, backups and relapse passed.');
}finally{await browser.close();}
