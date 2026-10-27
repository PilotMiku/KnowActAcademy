export function readinessForecast(pool, mastery, state, preparation, trainingScore) {
  const covered = mastery.size;
  const trials = [...mastery.values()].reduce((sum, q) => sum + q.trialCount, 0);
  const requiredCoverage = Math.min(20, pool.length);
  const requiredTrials = Math.min(40, pool.length * 2);
  const ids = new Set(pool.map((q) => q.id));
  const exam = state.exams.filter((e) => e.status === "submitted" && e.submittedAt >= preparation?.startedAt &&
    e.questionIds.length >= requiredCoverage && e.questionIds.every((id) => ids.has(id)))
    .sort((a, b) => b.submittedAt - a.submittedAt)[0];
  const sufficient = covered >= requiredCoverage && trials >= requiredTrials;
  const score = exam ? Math.round(((trainingScore ?? exam.score) + exam.score) / 2 * 10) / 10
    : sufficient ? trainingScore : null;
  return { estimatedScore: score, trainingScore, trials, requiredTrials, requiredCoverage,
    evidence: exam ? "模拟成绩参考" : sufficient ? "练习估算" : "样本不足",
    referenceExamId: exam?.id ?? null, referenceExamScore: exam?.score ?? null };
}
