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
