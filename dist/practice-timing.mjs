export function pausePracticeQuestion(practice, now = Date.now()) {
  if (!practice || !Number.isFinite(practice.questionStartedAt)) return;
  const id = practice.questionIds[practice.index];
  practice.questionTimes ??= {};
  practice.questionTimes[id] = (practice.questionTimes[id] ?? 0) + Math.max(0, now - practice.questionStartedAt);
  practice.questionStartedAt = null;
}

export function resumePracticeQuestion(practice, now = Date.now()) {
  if (!practice || practice.questionStartedAt != null) return;
  const response = practice.responses[practice.questionIds[practice.index]];
  if (response?.graded && typeof response.correct === "boolean") return;
  practice.questionStartedAt = now;
}
