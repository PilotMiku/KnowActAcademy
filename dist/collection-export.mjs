import { esc, attr } from './ui.mjs';
import { renderRich } from './rich-content.mjs';
import { loadQuestionContent, loadedQuestion } from './question-content.mjs';

let fontCSS;
async function resource(url) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(url,{cache:'force-cache',signal:controller.signal});
    if(!response.ok) throw new Error('打印资源暂时无法加载，请重试');
    return await response.blob();
  } finally { clearTimeout(timer); }
}
function dataURL(blob) {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('打印资源编码失败'));reader.readAsDataURL(blob);});
}
async function embeddedMathCSS() {
  if(!fontCSS) fontCSS=(async()=>{
    const cssURL=new URL('./vendor/katex/katex.min.css',location.href);
    const css=await (await resource(cssURL)).text();
    const entries=await Promise.all([...css.matchAll(/src:url\(([^)]+\.woff2)\)[^}]*/g)].map(async match=>
      [match[0],`src:url(${await dataURL(await resource(new URL(match[1],cssURL)))}) format("woff2")`]));
    return entries.reduce((result,[before,after])=>result.replace(before,after),css);
  })();
  try{return await fontCSS;}catch(error){fontCSS=null;throw error;}
}

export async function printableCollection(bank, state, selected) {
  await loadQuestionContent(bank, selected.map(q => q.id));
  const root = document.createElement('main');
  root.innerHTML = selected.map((entry, i) => {
    const q = loadedQuestion(bank, entry.id), note = state.questionNotes?.[q.id];
    return `<section><h2>${i+1}. ${esc(q.sourceLabel || q.id)}</h2><div class="rich" data-rich="${attr(q.stem)}"></div>${q.options.map(o=>`<div class="print-option"><b>${esc(o.id)}</b><div class="rich" data-rich="${attr(o.text)}"></div></div>`).join('')}<details open><summary>参考答案与解析</summary><p>${esc(Array.isArray(q.answer)?q.answer.join('、'):q.answer)}</p><div class="rich" data-rich="${attr(q.analysis)}"></div></details>${note?.text?`<h3>我的笔记</h3><p class="personal-note">${esc(note.text)}</p>`:''}</section>`;
  }).join('');
  renderRich(root);
  const start = Date.now();
  while (root.querySelector('[data-figure-loading]') && Date.now()-start < 15000) await new Promise(resolve=>setTimeout(resolve,50));
  const pending = root.querySelectorAll('[data-figure-loading]');
  if (pending.length) throw new Error('部分题图尚未加载，请稍后重试打印导出');
  for(const image of root.querySelectorAll('img')) if(image.src && !image.src.startsWith('data:'))
    image.src=await dataURL(await resource(image.src));
  const mathCSS=await embeddedMathCSS();
  // Export generated, sanitized DOM. Imported scripts and event handlers never enter the file.
  for (const node of root.querySelectorAll('[data-action]')) {
    node.removeAttribute('data-action'); node.removeAttribute('tabindex'); node.removeAttribute('role');
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>知行学习 · 错题与收藏打印稿</title><style>${mathCSS}</style><style>body{font:16px/1.8 system-ui;margin:32px auto;padding:0 24px;max-width:900px;color:#18202b}section{border-bottom:1px solid #ddd;padding:20px 0}img{max-width:100%}.native-formula-image{display:inline-block}.print-option{display:flex;gap:15px}.personal-note{white-space:pre-wrap}.katex-display{overflow:auto}details{margin:20px 0}h2{font-size:20px}@media print{body{margin:0;padding:0}section{break-inside:avoid}a{color:inherit}}</style><h1>知行学习 · 复习打印稿</h1><p>共 ${selected.length} 题。可离线打开，使用浏览器的“打印”保存为 PDF。原题与个人笔记分别保留。</p>${root.outerHTML}</html>`;
}
