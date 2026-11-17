import assert from 'node:assert/strict';
import { webkit } from 'playwright';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

for (const [engine, options] of [[chromium,browserOptions],[webkit,{headless:true}]]) {
  const browser = await engine.launch(options), errors = [];
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/scroll-fixture', route => route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;overflow-anchor:none}</style><main id="list" style="height:1200px">题目列表</main>'}));
    await page.goto(baseURL+'/scroll-fixture');
    await page.evaluate(async moduleURL => {
      const {restoreListPosition} = await import(moduleURL);
      window.beginRestore = y => {
        const root = document.querySelector('#list');
        window.layoutAnimation = root.animate([{opacity:.99},{opacity:1}],{duration:1000});
        window.layoutAnimation.pause();
        restoreListPosition(root,{hash:location.hash,y});
      };
      window.nextFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },baseURL+'/list-position.mjs');
    await page.evaluate(async () => { beginRestore(1800); await nextFrames(); });
    assert.ok(await page.evaluate(()=>scrollY<1800),'the short initial layout clamps the first restore');
    await page.evaluate(()=>{
      document.querySelector('#list').style.height='4000px';
      layoutAnimation.finish();
    });
    await page.waitForFunction(()=>Math.abs(scrollY-1800)<2 && document.querySelector('#list').style.overflowAnchor==='');
    await page.evaluate(async()=>{scrollTo(0,900);await nextFrames();});
    assert.equal(await page.evaluate(()=>scrollY),900,'settled restoration releases the scroll position');

    for(const input of ['wheel','pointerdown','touchstart','keydown']) {
      await page.evaluate(async input=>{
        beginRestore(1800);await nextFrames();
        window.dispatchEvent(new Event(input));
        scrollTo(0,600);
        layoutAnimation.finish();await nextFrames();
      },input);
      assert.equal(await page.evaluate(()=>scrollY),600,`${input} hands control back to the user`);
      assert.equal(await page.locator('#list').evaluate(el=>el.style.overflowAnchor),'');
    }
    await page.evaluate(async()=>{
      beginRestore(1800);await nextFrames();
      history.replaceState(null,'','#other-page');
      scrollTo(0,400);layoutAnimation.finish();await nextFrames();
    });
    assert.equal(await page.evaluate(()=>scrollY),400,'leaving the saved route cancels a pending restore');
    assert.deepEqual(errors,[]);
    console.log(`List return position passed: ${engine.name()}, delayed layout, settled release, user input and route cancellation.`);
  } finally { await browser.close(); }
}
