import { isScorable } from "./core.mjs";

export function readinessForecast(pool, mastery, state, preparation, trainingScore) {
  const eligible = pool.filter(isScorable), ids = new Set(eligible.map(q => q.id));
  const sections = new Map();
  for (const q of eligible) {
    const key = JSON.stringify([q.subjectId, q.chapterId]);
    const section = sections.get(key) ?? { total: 0, covered: 0 };
    section.total++; section.covered += Number(mastery.has(q.id)); sections.set(key, section);
  }
  const covered = eligible.filter(q => mastery.has(q.id)).length;
  const trials = eligible.reduce((sum, q) => sum + (mastery.get(q.id)?.trialCount ?? 0), 0);
  const minimumBySection = [...sections.values()].reduce((sum, section) => sum + Math.min(2, section.total), 0);
  const requiredCoverage = Math.min(eligible.length, Math.max(20, Math.ceil(eligible.length * 0.1), minimumBySection));
  const requiredTrials = Math.min(eligible.length * 2, Math.max(40, requiredCoverage * 2));
  const qualifiedSections = [...sections.values()].filter(section => section.covered >= Math.min(2, section.total)).length;
  const exam = state.exams.filter((e) => e.status === "submitted" && e.submittedAt >= preparation?.startedAt &&
    e.questionIds.length >= Math.min(20, eligible.length) && e.questionIds.every((id) => ids.has(id)))
    .sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const sufficient = eligible.length > 0 && covered >= requiredCoverage && trials >= requiredTrials && qualifiedSections === sections.size;
  const score = !sufficient ? null : exam ? Math.round(((trainingScore ?? exam.score) + exam.score) / 2 * 10) / 10 : trainingScore;
  return { estimatedScore: score, trainingScore, trials, requiredTrials, requiredCoverage,
    sampleCoverage: eligible.length ? Math.round(covered / eligible.length * 10000) / 100 : 0,
    qualifiedSections, totalSections: sections.size,
    evidence: !sufficient ? "样本不足" : exam ? "模拟成绩参考" : "练习估算",
    referenceExamId: exam?.id ?? null, referenceExamScore: exam?.score ?? null };
}
