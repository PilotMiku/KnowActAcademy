import { dayKey, getBankIndex, isEffectiveAttempt, isScorable } from './core.mjs';
import { spacedReview } from './study.mjs';

// Calendar arithmetic uses civil dates, independently of DST and device offsets.
const DAY = 86400000;
export function dateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / DAY : NaN;
}
export const dateFromNumber = number => new Date(number * DAY).toISOString().slice(0, 10);

export function normalizeRevisionPlan(value, bank) {
  if (value == null) return null;
  const subject = bank.subjects.find(s => s.id === value.subjectId);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 80 ||
      !Number.isFinite(dateNumber(value.examDate)) || value.examDate < '2000-01-01' || value.examDate > '2100-12-31' ||
      !subject || !Array.isArray(value.chapterIds) || !value.chapterIds.length ||
      new Set(value.chapterIds).size !== value.chapterIds.length ||
      value.chapterIds.some(id => !subject.chapters.some(c => c.id === id)) ||
      !Number.isInteger(value.minutesPerDay) || value.minutesPerDay < 10 || value.minutesPerDay > 240 ||
      !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt))
    throw new Error('复习日历的日期、章节或每日时间无效');
  return { title: value.title.trim(), examDate: value.examDate, subjectId: subject.id,
    chapterIds: [...value.chapterIds], minutesPerDay: value.minutesPerDay,
    createdAt: value.createdAt, updatedAt: value.updatedAt };
}

export function revisionSchedule(bank, state, now = Date.now()) {
  const plan = normalizeRevisionPlan(state.revisionPlan, bank);
  if (!plan) return null;
  const today = dayKey(now), first = dateNumber(today), end = dateNumber(plan.examDate);
  const daysLeft = Math.max(0, end - first), index = getBankIndex(bank);
  const ids = new Set(plan.chapterIds.flatMap(id => (index.chapterQuestions.get(plan.subjectId)?.get(id) ?? []).filter(isScorable).map(q => q.id)));
  const latest = new Map(), doneToday = new Set(), durations = [];
  for (const attempt of state.attempts) {
    if (!ids.has(attempt.questionId) || !isEffectiveAttempt(attempt, index.questions.get(attempt.questionId))) continue;
    if (!latest.has(attempt.questionId) || latest.get(attempt.questionId).at <= attempt.at) latest.set(attempt.questionId, attempt);
    if (dayKey(attempt.at) === today) doneToday.add(attempt.questionId);
    if (Number.isFinite(attempt.durationMs) && attempt.durationMs >= 10000) durations.push(attempt.durationMs);
  }
  const recent = durations.slice(-100).sort((a, b) => a - b);
  const secondsPerQuestion = Math.max(30, Math.min(480, (recent[Math.floor(recent.length / 2)] ?? 120000) / 1000));
  const dailyCapacity = Math.max(1, Math.floor(plan.minutesPerDay * 60 / secondsPerQuestion));
  const schedule = spacedReview(bank, state, now).schedule;
  const unseen = [], review = [];
  for (const id of ids) {
    const attempt = latest.get(id);
    if (!attempt) unseen.push(id);
    else {
      const due = schedule.get(id);
      const weak = !attempt.correct || attempt.uncertain;
      const dueDay = weak ? first : dateNumber(dayKey(due?.dueAt ?? now));
      if (dueDay < end && !doneToday.has(id)) review.push({ id, dueDay, weak });
    }
  }
  review.sort((a, b) => a.dueDay - b.dueDay || Number(b.weak) - Number(a.weak));
  let newIndex = 0, reviewIndex = 0;
  const days = [];
  // Large imported dates cannot create an unbounded page or allocation loop.
  for (let day = first; day < Math.min(end, first + 730); day++) {
    const completed = day === first ? doneToday.size : 0;
    let slots = Math.max(0, dailyCapacity - completed);
    const reviewIds = [], newIds = [];
    while (slots && reviewIndex < review.length && review[reviewIndex].dueDay <= day) {
      reviewIds.push(review[reviewIndex++].id); slots--;
    }
    while (slots && newIndex < unseen.length) { newIds.push(unseen[newIndex++]); slots--; }
    days.push({ date: dateFromNumber(day), newIds, reviewIds, completed,
      questionIds: [...reviewIds, ...newIds], minutes: Math.ceil((reviewIds.length + newIds.length) * secondsPerQuestion / 60) });
  }
  let nextReviewAt = null;
  for (const row of schedule.values()) if (ids.has(row.questionId) && row.dueAt > now && (nextReviewAt === null || row.dueAt < nextReviewAt)) nextReviewAt = row.dueAt;
  return { plan, today, daysLeft, days, total: ids.size, covered: latest.size, dailyCapacity, nextReviewAt,
    secondsPerQuestion: Math.round(secondsPerQuestion), completedToday: doneToday.size,
    remaining: unseen.length + review.length, unscheduled: unseen.length - newIndex + review.length - reviewIndex,
    expired: daysLeft === 0, truncated: daysLeft > 730 };
}
