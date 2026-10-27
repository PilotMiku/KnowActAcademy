export function pauseExamQuestion(exam, now = Date.now()) {
  if (!exam || exam.status !== "active" || !Number.isFinite(exam.questionStartedAt)) return;
  const id = exam.questionIds[exam.index];
  exam.questionTimes ??= {};
  exam.questionTimes[id] = (exam.questionTimes[id] ?? 0) + Math.max(0, Math.min(now, exam.endsAt) - exam.questionStartedAt);
  exam.questionStartedAt = null;
}
export function resumeExamQuestion(exam, now = Date.now()) {
  if (exam?.status === "active" && exam.questionStartedAt == null && now < exam.endsAt)
    exam.questionStartedAt = now;
}
