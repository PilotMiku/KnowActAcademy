import test from "node:test";
import assert from "node:assert/strict";
import { createPractice } from "../dist/core.mjs";
import { pausePracticeQuestion, resumePracticeQuestion } from "../dist/practice-timing.mjs";

test("practice timing accumulates revisits and excludes time away, including pending self-assessment", () => {
  const practice = createPractice(["one", "two"]);
  resumePracticeQuestion(practice, 1000);
  pausePracticeQuestion(practice, 4000);
  pausePracticeQuestion(practice, 9000);
  resumePracticeQuestion(practice, 604000);
  pausePracticeQuestion(practice, 606000);
  assert.equal(practice.questionTimes.one, 5000);
  practice.index = 1;
  practice.responses.two = { graded: true, correct: null };
  resumePracticeQuestion(practice, 607000);
  pausePracticeQuestion(practice, 610000);
  assert.equal(practice.questionTimes.two, 3000);
  practice.responses.two.correct = true;
  resumePracticeQuestion(practice, 900000);
  assert.equal(practice.questionStartedAt, null);
});
