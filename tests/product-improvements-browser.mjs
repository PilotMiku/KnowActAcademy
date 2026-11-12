import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, browserOptions, baseURL, revealPracticeOptions } from './browser-helpers.mjs';

const browser=await chromium.launch(browserOptions), errors=[], report={};
const stateOf=page=>page.evaluate(async()=> (await import('./storage.mjs')).readSavedState());
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseURL+'/#/practice?subject=calculus&chapter=s-6b82188494c1');
  await page.locator('.question-excerpt .katex').first().waitFor();
  const firstId=await page.locator('[data-action="practice-one"]').first().getAttribute('data-id');
  await page.locator('.question-pagination a').filter({hasText:'下一页'}).click();
  assert.match(await page.locator('.section-head').last().innerText(),/第 21/);
  const id=await page.locator('[data-action="practice-one"]').first().getAttribute('data-id');assert.notEqual(firstId,id);
  await page.reload();await page.locator('[aria-current="page"]').filter({hasText:'2'}).waitFor();
  await page.locator('[data-action="show-question-preview"]').first().click();
  await page.locator('#dialog .preview-option').first().waitFor();
  assert.equal(await page.locator('#dialog .result-box').count(),0);
  await page.locator('#dialog [data-action="close-dialog"]').first().click();
  await page.locator('.local-header-actions [data-action="search"]').click();
  await page.locator('#global-search').fill('极限');
  await page.locator('#search-results mark').first().waitFor();
  assert.ok(await page.locator('#search-results .question-excerpt').count());
  await page.locator('#search-results a').filter({hasText:'查看全部'}).click();
  await page.locator('.practice-start').waitFor();assert.match(await page.evaluate(()=>location.hash),/q=/);
  report.discovery=true;

  await page.goto(baseURL+'/#/practice?subject=calculus&chapter=s-6b82188494c1');
  await page.locator('[data-action="practice-one"]').first().click();
  await page.locator('.question-main[data-practice-id]').waitFor();
  assert.match(await page.locator('.question-editorial').innerText(),/编辑标注/);
  await page.locator('[data-action="question-feedback"]').click();
  await page.locator('#feedback-kind').selectOption('formula');
  await page.locator('#feedback-text').fill('个人核对依据 <script>window.feedbackRan=true</script>');
  await page.locator('#feedback-status').selectOption('reviewed');
  await page.locator('[data-action="save-feedback"]').click();
  await page.locator('[data-action="question-annotation"]').click();
  await page.locator('#annotation-difficulty').selectOption('hard');
  await page.locator('#annotation-concepts').fill('测试知识点，代入法');
  await page.locator('#annotation-method').fill('检查整体代入条件');
  await page.locator('[data-action="save-annotation"]').click();
  await page.locator('.question-editorial').filter({hasText:'个人标注'}).waitFor();
  await page.locator('[data-action="answer-option"][data-value="A"]').click();
  await page.locator('[data-action="submit-answer"]').click();await page.locator('.result-box').waitFor();
  await page.locator('.question-notes summary').click();
  await page.locator('[data-question-note]').fill('打印笔记 <img src=x onerror="window.printRan=true">');
  await page.locator('[data-note-reason][value="calculation"]').check();
  await page.locator('[data-note-status]').filter({hasText:'已保存'}).waitFor();
  await page.goto(baseURL+'/#/practice?difficulty=hard&concept='+encodeURIComponent('测试知识点'));
  await page.locator('[data-action="practice-one"]').first().waitFor();
  assert.equal(await page.locator('[data-action="practice-one"]').count(),1);
  assert.equal(await page.locator('[data-action="practice-one"]').getAttribute('data-id'),firstId);
  await page.goto(baseURL+'/#/quality?issue=reviewed');
  await page.locator('.collection-item').first().waitFor();
  assert.match(await page.locator('.collection-item').innerText(),/个人已核对/);
  assert.equal(await page.evaluate(()=>window.feedbackRan),undefined);
  report.feedbackAndAnnotations=true;

  await page.goto(baseURL+'/#/review?reason=calculation&notes=1');
  await page.locator('[data-collection-selected]').check();
  await page.locator('[data-action="practice-selected"]').click();
  await page.locator('.question-main[data-practice-id]').waitFor();
  assert.equal((await stateOf(page)).practice.questionIds.length,1);
  await page.goto(baseURL+'/#/review?reason=calculation&notes=1');
  const printed=page.waitForEvent('download');await page.locator('[data-action="print-collection"]').click();
  const printFile=await printed;await printFile.saveAs('artifacts/product-print.html');
  const html=await readFile('artifacts/product-print.html','utf8');
  assert.ok(html.includes('打印笔记'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src="x" onerror='));
  assert.ok(html.includes('data:font/woff2'));assert.ok(!html.includes('<link'));
  const offline=await browser.newContext({offline:true});const printPage=await offline.newPage();
  await printPage.setContent(html);await printPage.evaluate(()=>document.fonts.ready);
  assert.ok(await printPage.locator('.katex').count());
  const illustrated=await page.evaluate(async()=>{
    const {bank,state}=await(await import('./storage.mjs')).readSavedData();
    const q=bank.questions.find(q=>q.previewHasImages && q.answerVerified !== false);
    return (await import('./collection-export.mjs')).printableCollection(bank,state,[q]);
  });
  await printPage.setContent(illustrated);
  assert.ok(await printPage.locator('img').count());
  await printPage.waitForFunction(()=>[...document.images].every(img=>img.src.startsWith('data:') && img.complete && img.naturalWidth>0));
  await offline.close();
  report.collectionPracticeAndPrint=true;

  await page.goto(baseURL+'/#/stats');
  await page.locator('.subject-learning-row').first().waitFor();
  assert.match(await page.locator('.subject-learning-row').first().innerText(),/题库覆盖/);
  assert.match(await page.locator('.subject-learning-row').first().innerText(),/最近作答正确率/);
  await page.goto(baseURL+'/#/');await page.locator('.chapter-grid').waitFor();
  assert.equal(await page.locator('.chapter-card').count(),3);assert.equal(await page.locator('.spaced-overview').count(),0);
  report.homeAndStatistics=true;

  await page.goto(baseURL+'/#/knowledge?group=xigai');await page.locator('.knowledge-title').first().click();
  await page.locator('.reading-paper').waitFor();
  await page.goto(baseURL+'/#/');await page.locator('.reading-resume').waitFor();
  await page.locator('.reading-resume a').click();await page.locator('.reading-paper').waitFor();
  await page.setViewportSize({width:390,height:844});await page.reload();
  await page.locator('.reading-toc').waitFor();assert.equal(await page.locator('.reading-toc details').evaluate(el=>el.open),false);
  await page.goto(baseURL+'/#/reference');await page.locator('.reference-card').first().waitFor();
  assert.equal(await page.locator('.reference-card').count(),17);
  assert.equal(await page.locator('.katex-error').count(),0);
  report.readingAndReferences=true;

  await page.setViewportSize({width:1440,height:1000});
  await page.goto(baseURL+'/#/exams');await page.locator('[data-action="create-exam"]').first().click();
  await page.locator('#exam-subject').selectOption('calculus');await page.locator('#exam-count').fill('3');
  await page.locator('.exam-design-options summary').click();
  await page.locator('#exam-distribution').selectOption('custom');
  const quotas=page.locator('[data-exam-quota]');await quotas.nth(0).fill('2');await quotas.nth(1).fill('1');
  await page.locator('#exam-template-name').fill('三题章节配比');await page.locator('[data-action="save-exam-template"]').click();
  await page.waitForFunction(async()=> (await import('./storage.mjs')).readSavedState().then(s=>s.examTemplates.length===1));
  await page.locator('#exam-count').fill('4');await page.locator('[data-action="load-exam-template"]').click();
  assert.equal(await page.locator('#exam-count').inputValue(),'3');
  await page.locator('[data-action="begin-exam"]').click();await page.locator('[data-timer]').waitFor();
  assert.equal(await page.locator('.method-hint').count(),0);
  const exam=(await stateOf(page)).exams.at(-1);assert.equal(exam.questionIds.length,3);
  const chapters=await page.evaluate(async ids=>{const {bank}=await(await import('./storage.mjs')).readSavedData();const index=(await import('./core.mjs')).getBankIndex(bank);return ids.map(id=>index.chapters.get(index.questions.get(id).subjectId).get(index.questions.get(id).chapterId).parentId);},exam.questionIds);
  assert.equal(chapters.filter(c=>c==='chapter-1').length,2);
  await page.locator('[data-action="submit-exam"]').first().click();await page.locator('[data-action="confirm-dialog"]').click();
  await page.locator('.exam-next-steps').waitFor();
  await page.locator('[data-action="practice-exam-weak"]').click();await page.locator('.question-main[data-practice-id]').waitFor();
  assert.equal((await stateOf(page)).practice.questionIds.length,3);
  report.examTemplatesAndFollowup=true;

  await page.goto(baseURL+'/#/data');await page.locator('.backup-overview').first().waitFor();
  const downloading=page.waitForEvent('download');await page.locator('[data-action="export-progress"]').click();
  const file=await downloading;await file.saveAs('artifacts/product-progress.json');
  const exported=JSON.parse(await readFile('artifacts/product-progress.json','utf8'));
  assert.equal(exported.state.questionAnnotations[firstId].difficulty,'hard');assert.equal(exported.state.examTemplates.length,1);
  await page.locator('.backup-overview').first().filter({hasText:'上次发起导出'}).waitFor();
  await page.locator('[data-action="restore-backup"]').click();await page.locator('#file-input').setInputFiles('artifacts/product-progress.json');
  await page.locator('[data-action="confirm-dialog"]').click();await page.locator('.daily-tasks').waitFor();
  const restored=await stateOf(page);assert.deepEqual(restored.questionFeedback,exported.state.questionFeedback);assert.deepEqual(restored.questionAnnotations,exported.state.questionAnnotations);assert.deepEqual(restored.examTemplates,exported.state.examTemplates);
  report.backupRestore=true;

  if(process.env.ZHIXING_TEST_API) {
    const api=process.env.ZHIXING_TEST_API,key=process.env.ZHIXING_TEST_KEY;
    async function connect(target) {
      await target.goto(baseURL+'/#/data');await target.locator('[data-action="cloud-connect"]').click();
      await target.locator('#cloud-api').fill(api);await target.locator('#cloud-token').fill(key);await target.locator('[data-action="cloud-do-connect"]').click();
      await target.locator('.cloud-card .pill').filter({hasText:'已连接'}).waitFor();
    }
    await connect(page);await page.locator('[data-action="cloud-upload"]').click();await page.locator('[data-action="confirm-dialog"]').click();await page.locator('#toast').filter({hasText:'学习进度已上传'}).waitFor();
    const second=await browser.newContext({acceptDownloads:true});const other=await second.newPage();other.on('pageerror',e=>errors.push(e.message));
    await connect(other);await other.locator('[data-action="cloud-download"]').click();await other.locator('[data-action="confirm-dialog"]').click();await other.locator('#toast').filter({hasText:'服务器进度已恢复'}).waitFor();
    const synced=await stateOf(other);assert.deepEqual(synced.questionFeedback,restored.questionFeedback);assert.deepEqual(synced.questionAnnotations,restored.questionAnnotations);assert.deepEqual(synced.examTemplates,restored.examTemplates);assert.deepEqual(synced.readingHistory,restored.readingHistory);
    await second.close();report.realBackendNewRecords=true;
  }
  for(const width of [320,390,1024,1440]) {
    await page.setViewportSize({width,height:width<600?844:1000});
    for(const route of ['','practice','quality','stats','reference','review','data']) {
      await page.goto(baseURL+'/#/'+route);await page.locator('.local-shell').waitFor();
      const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
      if(!fits) {
        await page.screenshot({path:'artifacts/product-overflow.png',fullPage:true});
        console.log('Overflow elements:',await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>({tag:el.tagName,class:el.className,right:el.getBoundingClientRect().right}))));
      }
      assert.ok(fits,`${width} ${route} overflow`);
    }
  }
  await page.setViewportSize({width:390,height:844});await page.goto(baseURL+'/#/');await page.locator('.chapter-card').first().waitFor();
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'artifacts/product-dashboard-mobile.png',fullPage:true,animations:'disabled'});
  await page.goto(baseURL+'/#/quality');await page.locator('.quality-help').waitFor();await page.locator('[data-action="toggle-theme"]').click();
  await page.screenshot({path:'artifacts/product-quality-mobile-dark.png',fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);report.responsiveWidths=[320,390,1024,1440];report.errors=errors;
  await writeFile('artifacts/product-improvements-report.json',JSON.stringify(report,null,2));console.log('Product improvements passed:',JSON.stringify(report));
  await context.close();
} finally { await browser.close(); }
