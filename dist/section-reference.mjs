import {sectionCardsForBank} from './section-knowledge.mjs';
import {esc,attr,head,icon} from './ui.mjs';

const pageSize = 12;
export function referenceViewTabs(bank,active) {
  return `<nav class="reference-view-tabs" aria-label="知识卡片分类"><a href="#/reference" ${active === 'sections' ? 'aria-current="page"' : ''}>小节知识卡 <span>${sectionCardsForBank(bank).length}</span></a><a href="#/reference?view=chapters" ${active === 'chapters' ? 'aria-current="page"' : ''}>大章概览 <span>17</span></a></nav>`;
}
function sectionExercises(exercises) {
  if (!exercises?.length) return '';
  return `<section class="section-exercises" aria-label="本站自编自测">
    <h3>本站自编自测 · ${exercises.length} 题</h3>
    <p class="format-note">先在纸上作答，再展开核对。自测不计入练习成绩。</p>
    <ol>${exercises.map(({type, prompt, solution}) => `<li><span class="pill">${esc(type)}</span>
      <div class="rich" data-rich="${attr(prompt)}"></div>
      <details><summary>核对答案与推导</summary><div class="rich" data-rich="${attr(solution)}"></div></details>
    </li>`).join('')}</ol>
  </section>`;
}
export function sectionCardContent(row,{questionCount = null, standalone = false} = {}) {
  let practice = '';
  if (questionCount !== 0)
    practice = `<a class="btn small primary" href="#/practice?subject=${encodeURIComponent(row.subjectId)}&chapter=${encodeURIComponent(row.sectionId)}">练习本小节 ${icon('arrow',13)}</a>`;
  else if (!row.exercises?.length)
    practice = '<p class="format-note">本小节暂无题目，可先通过知识卡复习。</p>';
  const detail = standalone ? '' : `<a class="btn small" href="#/reference?subject=${encodeURIComponent(row.subjectId)}&section=${encodeURIComponent(row.sectionId)}">单独查看卡片</a>`;
  return `<div class="section-card-body"><h3>知识要点</h3><p>${esc(row.overview)}</p><h3>关键公式</h3><div class="rich" data-rich="${attr(row.formula)}"></div><h3>适用条件</h3><div class="rich" data-rich="${attr(row.condition)}"></div><h3>小例题</h3><div class="rich" data-rich="${attr(row.example)}"></div><h3>易错提醒</h3><div class="rich section-card-warning" data-rich="${attr(row.warning)}"></div>${sectionExercises(row.exercises)}<div class="section-card-actions">${practice}${detail}</div></div>`;
}
export function filteredSectionCards(bank,query) {
  const subject = query.get('subject') || '', chapter = query.get('chapter') || '';
  const text = (query.get('q') || '').trim().toLocaleLowerCase();
  return sectionCardsForBank(bank).filter(row => (!subject || row.subjectId === subject) &&
    (!chapter || row.chapterId === chapter) && (!text || [row.title,row.sourceTitle,row.overview,row.formula,row.condition,row.example,row.warning].join(' ').toLocaleLowerCase().includes(text)));
}
export function sectionReferencePage(bank,query) {
  const available = sectionCardsForBank(bank);
  const selected = query.get('section');
  const title = head('数学小节知识卡','按小节整理知识要点、公式条件、例题与易错提醒。','<a class="btn" href="#/knowledge">学习资料</a>');
  const tabs = referenceViewTabs(bank,'sections');
  const counts = new Map();
  for (const question of bank.questions) {
    const key = question.subjectId + ':' + question.chapterId;
    counts.set(key,(counts.get(key) || 0) + 1);
  }
  const content = (row,standalone = false) => sectionCardContent(row,{questionCount:counts.get(row.subjectId + ':' + row.sectionId) || 0,standalone});
  const subjectName = id => bank.subjects.find(s => s.id === id)?.name || id;
  const chapterName = row => bank.subjects.find(s => s.id === row.subjectId)?.chapters.find(c => c.id === row.chapterId)?.name || '';
  const meta = row => `<span class="section-card-meta"><span class="pill blue">${esc(subjectName(row.subjectId))}</span><span>${esc(chapterName(row))}</span></span>`;
  if (selected) {
    const index = available.findIndex(row => row.sectionId === selected && (!query.get('subject') || row.subjectId === query.get('subject')));
    if (index < 0) return `${title}${tabs}<section class="card study-empty">没有找到这个小节的知识卡。<a class="text-btn" href="#/reference">返回全部卡片</a></section>`;
    const row = available[index];
    const peers = available.filter(card => card.subjectId === row.subjectId && card.chapterId === row.chapterId);
    const order = peers.findIndex(card => card.sectionId === row.sectionId);
    const link = (card,label) => card ? `<a class="btn" href="#/reference?subject=${encodeURIComponent(card.subjectId)}&section=${encodeURIComponent(card.sectionId)}">${label}</a>` : '';
    return `${title}${tabs}<div class="section-card-location"><a href="#/reference?subject=${encodeURIComponent(row.subjectId)}&chapter=${encodeURIComponent(row.chapterId)}">${icon('back',14)} 返回本章小节</a><span>${order+1} / ${peers.length}</span></div><article class="card section-knowledge-card section-card-detail" data-section-id="${attr(row.sectionId)}">${meta(row)}<h2>${esc(row.title)}</h2><span class="format-note">小节知识卡 · 本站整理</span>${content(row,true)}</article><nav class="section-card-pagination" aria-label="相邻小节卡片">${link(peers[order-1],'← 上一小节')}${link(peers[order+1],'下一小节 →')}</nav>`;
  }
  const subject = query.get('subject') || '', chapter = query.get('chapter') || '', search = query.get('q') || '';
  const rows = filteredSectionCards(bank,query);
  const pages = Math.max(1,Math.ceil(rows.length/pageSize));
  const requested = Number(query.get('page'));
  const page = Number.isSafeInteger(requested) ? Math.max(1,Math.min(pages,requested)) : 1;
  const scopeSubjects = bank.subjects.filter(s => !subject || s.id === subject);
  const pagination = target => { const next = new URLSearchParams(query); next.set('page',target); return '#/reference?' + next; };
  return `${title}${tabs}<form class="card section-reference-filters" data-reference-filter><div class="field"><label for="reference-subject">科目</label><select id="reference-subject" name="subject" data-reference-subject><option value="">全部科目</option>${bank.subjects.map(s => `<option value="${attr(s.id)}" ${s.id===subject?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label for="reference-chapter">大章</label><select id="reference-chapter" name="chapter" data-reference-chapter><option value="">全部大章</option>${scopeSubjects.map(s => `<optgroup label="${attr(s.name)}">${s.chapters.filter(c=>!c.parentId).map(c=>`<option value="${attr(c.id)}" ${c.id===chapter?'selected':''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select></div><div class="field section-reference-search"><label for="reference-search">查找小节或知识点</label><input class="input" id="reference-search" name="q" type="search" value="${attr(search)}" placeholder="例如：夹逼、换元、特征值"></div><button class="btn primary" type="submit">查找卡片</button></form><div class="section-reference-count"><p role="status" data-section-result-count>找到 ${rows.length} 个小节 · 共 ${available.length} 张知识卡</p>${subject||chapter||search?'<a class="text-btn" href="#/reference">清除筛选</a>':''}<span class="muted">点击小节展开查看</span></div><div class="section-reference-grid">${rows.slice((page-1)*pageSize,page*pageSize).map(row=>`<details class="card section-knowledge-card" data-section-id="${attr(row.sectionId)}"><summary>${meta(row)}<h2>${esc(row.title)}</h2><p>${esc(row.overview)}</p><span class="section-card-expand">查看知识卡 ${icon('chevron',14)}</span></summary>${content(row)}</details>`).join('')}</div>${!rows.length?'<section class="card study-empty">没有找到匹配的小节卡片，请调整科目、章节或关键词。<a class="text-btn" href="#/reference">查看全部卡片</a></section>':''}${pages>1?`<nav class="section-card-pagination" aria-label="知识卡片分页">${page>1?`<a class="btn" href="${attr(pagination(page-1))}">上一页</a>`:''}<span>第 ${page} / ${pages} 页</span>${page<pages?`<a class="btn" href="${attr(pagination(page+1))}">下一页</a>`:''}</nav>`:''}<p class="format-note">卡片为本站整理的学习提要，适用条件随公式列出，可结合原题与课程资料复习。</p>`;
}
