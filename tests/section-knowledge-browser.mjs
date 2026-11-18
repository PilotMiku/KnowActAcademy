import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {chromium,browserOptions,baseURL} from './browser-helpers.mjs';
import {sectionKnowledge} from '../dist/section-knowledge.mjs';
const raw=JSON.parse(await readFile('dist/data/bank.json','utf8'));
const browser=await chromium.launch(browserOptions),errors=[],report={};
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseURL+'/#/reference');
  await page.getByRole('heading',{name:'数学小节知识卡',exact:true}).waitFor();
  assert.match(await page.locator('[data-section-result-count]').innerText(),/找到 182 个小节/);
  assert.equal(await page.locator('.section-knowledge-card').count(),12);
  const allMath=await page.evaluate(async()=>{
    const {sectionKnowledge}=await import('./section-knowledge.mjs');
    const {sectionCardContent}=await import('./section-reference.mjs');
    const {renderRich}=await import('./rich-content.mjs');
    const host=document.createElement('div');
    host.style.cssText='position:fixed;left:-10000px;top:0;width:680px;visibility:hidden';
    host.innerHTML=sectionKnowledge.map(row=>sectionCardContent(row)).join('');
    document.body.append(host);renderRich(host);
    const result={cards:sectionKnowledge.length,formulas:host.querySelectorAll('.katex').length,errors:host.querySelectorAll('.katex-error').length};host.remove();return result;
  });
  assert.equal(allMath.cards,182);assert.ok(allMath.formulas>500);assert.equal(allMath.errors,0);report.allCardMath=allMath;
  await page.locator('.section-knowledge-card').first().locator('summary').click();
  const first=page.locator('.section-knowledge-card').first();
  for(const label of ['知识要点','关键公式','适用条件','小例题','易错提醒']) await first.getByRole('heading',{name:label,exact:true}).waitFor();
  await page.screenshot({path:'artifacts/section-cards-desktop.png',fullPage:true,animations:'disabled'});
  await first.getByRole('link',{name:'单独查看卡片'}).click();
  assert.equal(await page.locator('.section-card-detail').getAttribute('data-section-id'),'s-6b82188494c1');
  await page.getByRole('link',{name:'下一小节 →',exact:true}).click();
  await page.locator('.section-card-detail[data-section-id="s-0cda94732a27"]').waitFor();
  assert.equal(await page.locator('.section-card-detail').getAttribute('data-section-id'),'s-0cda94732a27');
  await page.getByRole('link',{name:/返回本章小节/}).click();
  assert.match(await page.locator('[data-section-result-count]').innerText(),/找到 18 个小节/);

  await page.locator('#reference-subject').selectOption('linear');
  await page.locator('[data-section-result-count]').filter({hasText:'找到 17 个小节'}).waitFor();
  await page.locator('#reference-chapter').selectOption('linear-chapter-1');
  await page.locator('[data-section-result-count]').filter({hasText:'找到 2 个小节'}).waitFor();
  await page.locator('#reference-search').fill('克拉默');
  await page.getByRole('button',{name:'查找卡片'}).click();
  await page.locator('[data-section-result-count]').filter({hasText:'找到 1 个小节'}).waitFor();
  assert.match(await page.locator('.section-knowledge-card h2').innerText(),/Cramer/);
  await page.reload();await page.locator('#reference-search').waitFor();
  assert.equal(await page.locator('#reference-search').inputValue(),'克拉默');
  await page.locator('#reference-search').fill('qzx-no-matching-section');
  await page.getByRole('button',{name:'查找卡片'}).click();
  await page.getByText('没有找到匹配的小节卡片，请调整科目、章节或关键词。',{exact:false}).waitFor();
  report.searchFiltersAndReload=true;

  const roots=[...new Set(sectionKnowledge.map(row=>row.subjectId+':'+row.chapterId))];
  for(const root of roots){
    const [subject,chapter]=root.split(':');
    await page.goto(baseURL+'/#/reference?subject='+subject+'&chapter='+chapter);
    await page.waitForFunction(({subject,chapter})=>document.querySelector('#reference-subject')?.value===subject && document.querySelector('#reference-chapter')?.value===chapter,{subject,chapter});
    const expected=sectionKnowledge.filter(row=>row.subjectId===subject&&row.chapterId===chapter).length;
    assert.match(await page.locator('[data-section-result-count]').innerText(),new RegExp('找到 '+expected+' 个小节'));
    assert.equal(await page.locator('.section-knowledge-card').count(),Math.min(12,expected));
  }
  report.chapterScopes=roots.length;
  await page.goto(baseURL+'/#/reference?subject=calculus&chapter=chapter-9');
  await page.waitForFunction(()=>document.querySelector('#reference-chapter')?.value==='chapter-9');
  await page.getByRole('link',{name:'下一页',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.section-knowledge-card').length===5);
  assert.equal(await page.locator('.section-knowledge-card').count(),5);
  await page.goto(baseURL+'/#/reference?view=chapters');
  await page.locator('.reference-card').first().waitFor();
  assert.equal(await page.locator('.reference-card').count(),17);

  // A subsection without bank questions offers self-checks on its knowledge card.
  const selfCheckSection = 'u-section-4f0e014a22fe';
  assert.equal(raw.questions.some(q=>q.subjectId==='calculus'&&q.chapterId===selfCheckSection),false);
  await page.goto(baseURL+'/#/reference?subject=calculus&section='+selfCheckSection);
  const selfCheckCard = page.locator(`.section-card-detail[data-section-id="${selfCheckSection}"]`);
  const exercises = selfCheckCard.getByRole('region',{name:'本站自编自测'});
  await exercises.getByRole('heading',{name:'本站自编自测 · 4 题',exact:true}).waitFor();
  assert.equal(await exercises.getByRole('listitem').count(),4);
  assert.equal(await selfCheckCard.getByRole('link',{name:/练习本小节/}).count(),0);
  const solution = exercises.locator('details').first();
  assert.equal(await solution.locator('.rich').isVisible(),false);
  await solution.getByText('核对答案与推导',{exact:true}).click();
  await solution.locator('.rich .katex').first().waitFor();
  report.selfChecksWithoutBankQuestions=true;
  await page.goto(baseURL+'/#/practice?subject=calculus&chapter=s-6b82188494c1');
  await page.getByRole('link',{name:'本小节知识卡',exact:true}).click();
  await page.locator('.section-card-detail[data-section-id="s-6b82188494c1"]').waitFor();

  await page.evaluate(async ids=>{
    const storage=await import('./storage.mjs'),{createPractice}=await import('./core.mjs');
    const {bank,state}=await storage.readSavedData();state.practice=createPractice(ids,'sequential');await storage.saveStorage(bank,state);
  },['s-6b82188494c1','s-0cda94732a27'].map(id=>raw.questions.find(q=>q.chapterId===id).id));
  await page.goto(baseURL+'/#/practice?session=1');await page.reload();
  await page.locator('.question-main').waitFor();
  await page.locator('[data-action="question-learning"]').click();
  await page.locator('#learning-panel [data-section-id="s-6b82188494c1"]').waitFor();
  await page.locator('[data-action="next-question"]').click();
  await page.locator('#learning-panel [data-section-id="s-0cda94732a27"]').waitFor();
  assert.match(await page.locator('#learning-panel .learning-card').first().innerText(),/数列极限的定义/);
  await page.screenshot({path:'artifacts/section-card-question-sidebar.png',fullPage:true,animations:'disabled'});
  await page.getByRole('link',{name:'查看本小节完整知识卡 →',exact:true}).click();
  await page.locator('.section-card-detail[data-section-id="s-0cda94732a27"]').waitFor();
  assert.equal(await page.locator('#learning-panel').isVisible(),false);
  report.practiceEntryAndFollowingQuestion=true;

  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    for(const section of ['u-section-b67f4c343177','s-8df004948022','u-section-3888c5ca350b']){
      await page.goto(baseURL+'/#/reference?section='+section);
      await page.locator(`.section-card-detail[data-section-id="${section}"]`).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,section+' '+width);
      assert.equal(await page.locator('.section-card-detail .katex-error').count(),0);
    }
    await page.goto(baseURL+'/#/reference');
    await page.locator('[data-section-result-count]').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.locator('[data-action="toggle-theme"]').click();
  await page.goto(baseURL+'/#/reference?section=u-section-b67f4c343177');
  await page.locator('.section-card-detail').waitFor();
  await page.screenshot({path:'artifacts/section-card-mobile-dark.png',fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);report.mobileAndDark=true;
  await writeFile('artifacts/section-knowledge-report.json',JSON.stringify({...report,pageErrors:errors},null,2));
  console.log('Subsection knowledge cards passed:',JSON.stringify(report));
}finally{await browser.close();}
