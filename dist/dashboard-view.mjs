import { getBankIndex } from './core.mjs';
import { questionCounts, questionCountDescription } from './question-counts.mjs';
import { dailyTasksHTML } from './dashboard-tasks.mjs';
import { knowledgeGroups } from './knowledge.mjs';
import { icon, esc, attr, button } from './ui.mjs';

export function compactDashboard({ bank, state, knowledge, activeSubject, stats, guide, chapters }) {
  const recentId = state.readingHistory?.[0]?.id || Object.keys(state.knowledgePositions || {}).at(-1);
  const reading = knowledge.articles.find(a => a.id === recentId);
  return `${guide}<section class="local-hero dashboard-heading"><div><h1>学习概览</h1><p class="subtitle">接续上次的进度，安排今天的练习。</p></div>${button('学习指南', 'open-guide', '', 'btn')}</section>${dailyTasksHTML(bank, state, { esc, attr, button })}${reading ? `<section class="card reading-resume"><div><span class="pill blue">最近阅读</span><h2>${esc(reading.title)}</h2><p>接着上次保存的位置阅读。</p></div><a class="btn" href="#/knowledge/${encodeURIComponent(reading.id)}">继续阅读</a></section>` : ''}
    <div class="course-tabs" role="navigation" aria-label="选择学习科目">${bank.subjects.map(s => `<a href="#/?subject=${encodeURIComponent(s.id)}" class="course-tab ${s.id === activeSubject?.id ? 'active' : ''}" ${s.id === activeSubject?.id ? 'aria-current="true"' : ''}><span class="course-symbol">${s.id === 'linear' ? 'A' : '∫'}</span><span><b>${esc(s.name)}</b><small>${questionCounts(getBankIndex(bank).subjectQuestions.get(s.id)).total.toLocaleString()} 题 · ${s.chapters.filter(c => !c.parentId).length} 章</small></span>${icon('arrow',16)}</a>`).join('')}<a href="#/knowledge" class="course-tab knowledge-entry"><span class="course-symbol">${icon('book',23)}</span><span><b>学习资料</b><small>${knowledgeGroups(knowledge).length} 个分类 · ${knowledge.articles.length} 份资料</small></span>${icon('arrow',16)}</a></div>
    <div class="section-head"><h2>${esc(activeSubject?.name || '章节')} <small>最近学习与推荐章节</small></h2><a href="#/practice?subject=${encodeURIComponent(activeSubject?.id || '')}&view=chapters" class="text-btn">全部章节 ${icon('arrow',15)}</a></div>${chapters}
    <div class="dashboard-links"><a class="btn" href="#/review">错题回顾</a><a class="btn" href="#/favorites">我的收藏</a><a class="btn" href="#/reference">数学章节速查</a><a class="btn" href="#/stats">学习统计</a><a class="btn" href="#/data">数据与备份</a></div>
    <details class="card overview-details"><summary>题库与累计学习数据</summary><section class="local-stat-strip">${[['book',questionCounts(bank.questions).total.toLocaleString(),'题目记录（含补充）'],['folder',bank.subjects.reduce((n,s)=>n+s.chapters.filter(c=>!c.parentId).length,0),'已接入章节'],['target',stats.today,'今日完成'],['chart',stats.total?stats.accuracy+'%':'—','累计正确率']].map(([i,v,l])=>`<div>${icon(i,22)}<span><b>${v}</b><small>${l}</small></span></div>`).join('')}</section><p class="format-note question-count-note">${esc(questionCountDescription(bank.questions))}</p></details>`;
}

export function weakSectionsHTML(summary) {
  return `<p class="format-note">覆盖量按不同题目去重；最近正确率每题只取最近一次有效作答；隔日巩固要求最近两次确定答对分属不同日期，不等同于长期掌握。</p><section class="card weak-sections"><h2>优先巩固的小节</h2>${summary.weak.length ? summary.weak.map(row => `<article><div><strong>${esc(row.name)}</strong><p>最近正确率 ${row.accuracy}% · 已覆盖 ${row.covered} / ${row.total} 题</p></div><a class="btn small" href="#/practice?subject=${encodeURIComponent(row.subjectId)}&chapter=${encodeURIComponent(row.chapterId)}&status=unmastered">针对练习</a></article>`).join('') : '<p>完成练习后，按已练小节的最近正确率列出建议。未练小节不会被误判为薄弱。</p>'}</section>`;
}
