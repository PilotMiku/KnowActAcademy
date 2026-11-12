import test from 'node:test';
import assert from 'node:assert/strict';
import { questionImageURL, nativeFigureID, nativeFigureChunk, loadNativeFigure } from '../dist/assets.mjs';

test('original bank paths work at both Pages root and repository subpaths', () => {
  const original = '/api/question-image/s-abc-q0001/option-B/0.webp?v=pdf-123';
  for (const prefix of ['/', '/study/', '/%E7%9F%A5%E8%A1%8C/']) {
    assert.equal(questionImageURL(original, new URL('https://example.github.io' + prefix)),
      'https://example.github.io' + prefix + 'question-images/s-abc-q0001/option-B/0.webp?v=pdf-123');
  }
});

test('custom imported image URLs keep their original meaning', () => {
  assert.equal(questionImageURL('https://images.example.com/x.png', new URL('https://host/repo/')),
    'https://images.example.com/x.png');
  assert.equal(questionImageURL('./assets/example.png', new URL('https://host/repo/')),
    'https://host/repo/assets/example.png');
});

test('native figures use versioned shared chunks under repository subpaths', async () => {
  const a='ab0123456789012345678901',b='ab0123456789012345678902',version='1234567890abcdef';
  assert.equal(nativeFigureID(`/api/question-figure/${version}/${a}`),a);
  assert.equal(nativeFigureChunk(`/api/question-figure/${version}/${a}`),version);
  assert.equal(nativeFigureID('/api/question-figure/../../private'),null);
  let requests=0;
  const fetcher=async url=>{if(url.includes('/figure-index/'))return {ok:false,status:404};requests++;assert.equal(url,`https://host/repo/question-figures/ab-${version}.json`);
    return {ok:true,json:async()=>({format:'zhixing.figure-chunk.v1',figures:{[a]:'data:image/webp;base64,AAAA',[b]:'data:image/webp;base64,BBBB'}})};};
  const result=await Promise.all([loadNativeFigure(a,new URL('https://host/repo/'),fetcher,version),loadNativeFigure(b,new URL('https://host/repo/'),fetcher,version)]);
  assert.equal(requests,1);assert.equal(result[1],'data:image/webp;base64,BBBB');
});

test('native figure loader rejects executable payloads and retries failed chunks', async () => {
  const id='cd0123456789012345678901',base=new URL('https://host/retry/');let requests=0;
  const request=async()=>{requests++;if(requests===1)throw Error('offline');return {ok:true,json:async()=>({format:'zhixing.figure-chunk.v1',figures:{[id]:'data:image/svg+xml;base64,AAAA'}})};};
  await assert.rejects(loadNativeFigure(id,base,request),/offline/);
  await assert.rejects(loadNativeFigure(id,base,request),/内容无效/);
  assert.equal(requests,2);
});

test('legacy figure references resolve through small indexes and reuse a topical pack', async () => {
  const a='aa0123456789012345678901', b='bb0123456789012345678902', version='abcdef0123456789', pack='0123456789abcdef';
  let packs=0;
  const request=async url => {
    if(url.includes('/figure-index/')) return {ok:true,json:async()=>({format:'zhixing.figure-index.v1',packs:{[a]:pack,[b]:pack}})};
    assert.equal(url,`https://host/packed/figure-packs/${pack}.json`); packs++;
    return {ok:true,json:async()=>({format:'zhixing.figure-chunk.v1',figures:{[a]:'data:image/webp;base64,AAAA',[b]:'data:image/webp;base64,BBBB'}})};
  };
  const sources=await Promise.all([a,b].map(id=>loadNativeFigure(id,new URL('https://host/packed/'),request,version)));
  assert.equal(packs,1); assert.equal(sources[1],'data:image/webp;base64,BBBB');
  await assert.rejects(loadNativeFigure(a,new URL('https://host/invalid-index/'),async()=>({ok:true,json:async()=>({format:'zhixing.figure-index.v1',packs:{[a]:'../../private'}})}),version),/索引无效/);
});
