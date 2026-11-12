import { getBankIndex, isScorable } from "./core.mjs";
import { rootChapter } from "./study-planning.mjs";

export function examResultSummary(bank, exam) {
  const questions = getBankIndex(bank).questions;
  const eligible = exam.questionIds.filter(id => isScorable(questions.get(id)) && questions.get(id).type !== 'solution');
  const correct = eligible.filter(id => exam.results?.[id] === true).length;
  return { total: eligible.length, correct, excluded: exam.questionIds.length - eligible.length,
    score: eligible.length ? Math.round(correct / eligible.length * 100) : null };
}

export function examChapterSummary(bank, exam, { esc }) {
  const index = getBankIndex(bank), groups = new Map();
  for (const id of exam.questionIds) {
    const q = index.questions.get(id);
    if (!q || !isScorable(q) || exam.results[id] === null) continue;
    const key = rootChapter(bank, q), [subjectId, chapterId] = JSON.parse(key);
    const row = groups.get(key) ?? { name: `${index.subjects.get(subjectId).name} · ${index.chapters.get(subjectId).get(chapterId)?.name ?? chapterId}`, total: 0, correct: 0, ms: 0, uncertain: 0 };
    row.total++; row.correct += Number(exam.results[id] === true); row.ms += exam.questionTimes?.[id] ?? 0;
    row.uncertain += Number(exam.uncertainIds?.includes(id) ?? false);
    groups.set(key, row);
  }
  return `<section class="card exam-breakdown"><h2>按章节复盘</h2><div class="trend-table-wrap"><table class="trend-table"><thead><tr><th>章节</th><th>正确率</th><th>拿不准</th><th>答题用时</th></tr></thead><tbody>${[...groups.values()].map((r) => `<tr><td>${esc(r.name)}</td><td>${r.correct}/${r.total} · ${Math.round(r.correct / r.total * 100)}%</td><td>${r.uncertain} 题</td><td>${exam.questionTimes ? `${Math.round(r.ms / 1000)} 秒` : "旧记录未统计"}</td></tr>`).join("")}</tbody></table></div></section>`;
}

export function examInsights(bank, exam, { esc, attr, button }) {
  const index=getBankIndex(bank);
  const questions=exam.questionIds.map(id=>index.questions.get(id)).filter(q=>q && isScorable(q));
  const wrong=questions.filter(q=>exam.results[q.id]===false);
  const slow=questions.filter(q=>Number.isFinite(exam.questionTimes?.[q.id]) && exam.questionTimes[q.id]>0)
    .sort((a,b)=>exam.questionTimes[b.id]-exam.questionTimes[a.id]).slice(0,5);
  const groups=new Map();
  for(const q of questions) {
    const key=rootChapter(bank,q), row=groups.get(key)||{key,total:0,wrong:0};row.total++;row.wrong+=Number(exam.results[q.id]===false);groups.set(key,row);
  }
  const weak=[...groups.values()].filter(row=>row.wrong).sort((a,b)=>b.wrong/b.total-a.wrong/a.total).slice(0,3);
  return `<section class="card exam-next-steps"><h2>下一步怎么练</h2>${wrong.length?`<p>本次 ${wrong.length} 道待巩固题，可直接组成一组练习。</p>${button('练习本次错题','practice-exam-weak',`data-id="${attr(exam.id)}"`,'btn primary')}`:'<p>本次有效评分题全部答对，可结合拿不准标记和耗时继续复盘。</p>'}${weak.map(row=>{const [subjectId,chapterId]=JSON.parse(row.key);return `<article><div><strong>${esc(index.chapters.get(subjectId)?.get(chapterId)?.name || chapterId)}</strong><p>本次 ${row.wrong}/${row.total} 题待巩固</p></div><a class="btn small" href="#/practice?subject=${encodeURIComponent(subjectId)}&chapter=${encodeURIComponent(chapterId)}&status=unmastered">练习薄弱章节</a></article>`;}).join('')}<h3>本次耗时较长的题</h3>${slow.length?slow.map(q=>`<article><span>${esc(q.sourceLabel || q.id)} · ${Math.round(exam.questionTimes[q.id]/1000)} 秒</span>${button('重练','practice-one',`data-id="${attr(q.id)}"`,'btn small')}</article>`).join(''):'<p>这份记录没有逐题有效用时。</p>'}<p class="format-note">耗时排行仅反映本次答题停留时间；章节建议基于本卷作答，不能代表整章掌握程度。</p></section>`;
}
