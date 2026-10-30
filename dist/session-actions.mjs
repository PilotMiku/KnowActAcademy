import { shuffle, filterQuestions } from "./core.mjs";
import { preparationQuestions, createPreparation, diagnosticProgress, restoreDiagnostic,
  createTraining, practiceProgress, currentPreparationPractice } from "./preparation.mjs";
import { practicePool, balancedSample, collectionQueue, collectionPageSlice, reviewBatchSize } from "./study-planning.mjs";
import { spacedReview, archivePreparation } from "./study.mjs";
import { pauseExamQuestion, resumeExamQuestion } from "./exam-timing.mjs";
import { pausePracticeQuestion } from "./practice-timing.mjs";
import { button } from "./ui.mjs";

const actions = new Set(["start-practice", "prepare-select-all", "prepare-select-none", "begin-preparation", "concept-details", "start-spaced", "spaced-one", "resume-preparation", "complete-preparation", "next-training", "start-collection", "practice-one", "resume-practice", "exit-practice", "answer-option", "submit-answer", "self-grade", "navigate-question", "next-question", "finish-practice"]);

// Own practice/preparation transitions; persistence and navigation stay explicit.
export function createSessionActions({ getBank, getState, getFilters, route, subject,
  startPractice, persist, go, toast, render, isPreparationPractice, preparationSelection,
  updatePreparationSelection, showConceptDetails, currentQuestion, currentExam,
  updateSelectedOptions, updateExamProgress, tickExam, submitPractice, openDialog, defaultCount }) {
  return async (action, el) => {
    if (!actions.has(action)) return false;
    const bank = getBank(), state = getState();
    switch (action) {
      case "start-practice": {
        const list = practicePool(bank, getFilters(), state);
        const randomCount = route().query.get("count") === "all" ? list.length : defaultCount;
        const ids = (
          el.dataset.mode === "random"
            ? (route().query.get("distribution") === "balanced" ? balancedSample(bank, list, randomCount) : shuffle(list).slice(0, randomCount))
            : list
        ).map((q) => q.id);
        await startPractice(ids, el.dataset.mode);
        break;
      }
      case "prepare-select-all":
      case "prepare-select-none": {
        const roots = new Set(subject(document.querySelector("#prepare-subject").value).chapters.filter((c) => !c.parentId).map((c) => c.id));
        for (const input of document.querySelectorAll("[data-prepare-chapter]"))
          input.checked = action === "prepare-select-all" && roots.has(input.value);
        updatePreparationSelection();
        break;
      }
      case "begin-preparation": {
        const created = createPreparation(bank, preparationSelection());
        archivePreparation(state);
        state.preparation = created.preparation;
        state.practice = created.practice;
        await persist();
        go("/prepare?session=1");
        break;
      }
      case "concept-details":
        showConceptDetails(el.dataset.name);
        break;
      case "start-spaced": {
        const scope = route().page === "dashboard" ? bank.questions
          : el.dataset.scope === "preparation" && state.preparation
            ? preparationQuestions(bank, state.preparation) : filterQuestions(bank, getFilters(), state);
        const allowed = new Set(scope.map((q) => q.id));
        const ids = spacedReview(bank, state).due.filter((item) => allowed.has(item.questionId)).slice(0, reviewBatchSize(state, Number(route().query.get("reviewMinutes")))).map((item) => item.questionId);
        if (!ids.length) { toast("当前范围没有到期题目"); return true; }
        await startPractice(ids, "spaced");
        break;
      }
      case "spaced-one":
        await startPractice([el.dataset.id], "spaced");
        break;
      case "resume-preparation": {
        if (!state.preparation) return true;
        if (state.practice?.preparationId !== state.preparation.id) {
          const saved = currentPreparationPractice(state);
          if (!saved && diagnosticProgress(state).ready) {
            go("/prepare");
            return true;
          }
          state.practice = saved ? structuredClone(saved) : restoreDiagnostic(state);
          state.practice.questionStartedAt = null;
          await persist();
        }
        go("/prepare?session=1" + (practiceProgress(state.practice).ready ? "&summary=1" : ""));
        break;
      }
      case "complete-preparation": {
        const p = state.practice;
        pausePracticeQuestion(p);
        const i = p.questionIds.findIndex((id) => typeof p.responses[id]?.correct !== "boolean");
        p.index = Math.max(0, i);
        p.questionStartedAt = null;
        await persist();
        go("/prepare?session=1");
        break;
      }
      case "next-training": {
        const active = currentPreparationPractice(state);
        if (active && !practiceProgress(active).ready) {
          toast("请先完成本组题目，解答题需完成自评");
          return true;
        }
        state.practice = createTraining(bank, state);
        state.preparation.round = state.practice.round;
        await persist();
        go("/prepare?session=1");
        break;
      }
      case "start-collection": {
        const mode = el.dataset.mode;
        const list = collectionQueue(bank, getFilters(), state, mode, route().query.get("sort") ?? "priority");
        const current = collectionPageSlice(list, route().query.get("page") ?? 1);
        await startPractice(
          current.items.map((q) => q.id),
          mode,
        );
        break;
      }
      case "practice-one":
        await startPractice([el.dataset.id], "sequential");
        break;
      case "resume-practice":
        go(isPreparationPractice() ? "/prepare?session=1" : "/practice?session=1");
        break;
      case "exit-practice":
        go(isPreparationPractice() ? "/prepare" : state.practice?.mode === "spaced" ? "/spaced" : "/practice");
        break;
      case "answer-option": {
        const q = currentQuestion(),
          exam = currentExam();
        if (!q) return true;
        if (exam && (exam.status !== "active" || Date.now() >= exam.endsAt)) {
          await tickExam();
          return true;
        }
        const target = exam
          ? exam.answers
          : (state.practice.responses[q.id] ??= {
              answer: q.type === "multiple" ? [] : "",
              graded: false,
            });
        if (!exam && target.graded) return true;
        const value = el.dataset.value;
        const old = exam ? target[q.id] : target.answer;
        const answer =
          q.type === "multiple"
            ? Array.isArray(old) && old.includes(value)
              ? old.filter((v) => v !== value)
              : [...(Array.isArray(old) ? old : []), value]
            : value;
        if (exam) target[q.id] = answer;
        else target.answer = answer;
        updateSelectedOptions(answer);
        if (exam) updateExamProgress(exam);
        await persist();
        break;
      }
      case "submit-answer":
        await submitPractice();
        break;
      case "self-grade":
        await submitPractice(el.dataset.correct === "true");
        break;
      case "navigate-question": {
        const target = currentExam() ?? state.practice;
        if (!target) return true;
        const i = Number(el.dataset.index);
        if (i < 0 || i >= target.questionIds.length) return true;
        if (i === target.index) return true;
        if (currentExam()) pauseExamQuestion(target);
        else pausePracticeQuestion(target);
        target.index = i;
        if (currentExam()) resumeExamQuestion(target);
        else target.questionStartedAt = null;
        await persist();
        render();
        break;
      }
      case "next-question": {
        const p = state.practice;
        if (!p) return true;
        if (p.index < p.questionIds.length - 1) {
          pausePracticeQuestion(p);
          p.index++;
          p.questionStartedAt = null;
          await persist();
          render();
        } else {
          if (isPreparationPractice(p)) {
            go("/prepare?session=1&summary=1");
            break;
          }
          const done = Object.values(p.responses).filter(
            (r) => r.graded && r.correct !== null,
          ).length;
          openDialog(
            "又向前，走了一小步。",
            `<p>本组 ${p.questionIds.length} 道题，已完成 ${done} 道。${done < p.questionIds.length ? "你可以返回补完，也可以稍作休息。" : "给自己一点肯定，再开始下一段。"}</p>`,
            `${button("继续查看", "close-dialog")}${button("回到学习台", "finish-practice", "", "btn primary")}`,
          );
        }
        break;
      }
      case "finish-practice":
        go("/");
        break;
    }
    return true;
  };
}
