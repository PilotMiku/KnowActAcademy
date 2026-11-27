import { changeScope, preparationTreeHTML, syncPreparationTree } from './preparation-scope.mjs';
import { attr, button, esc } from './ui.mjs';

const chapterParam = 'scopeChapter';
const chapterInput = 'data-practice-chapter';

function subjectsInScope(bank, subjectId) {
  return bank.subjects.filter(subject => !subjectId || subject.id === subjectId);
}

export function practiceChapters(bank, query) {
  if (!query.has(chapterParam)) return undefined;
  const chosen = new Set(query.getAll(chapterParam));
  return subjectsInScope(bank, query.get('subject')).flatMap(subject => subject.chapters
    .filter(chapter => chosen.has(JSON.stringify([subject.id, chapter.id])))
    .map(chapter => ({ subjectId: subject.id, chapterId: chapter.id })));
}

export function clearPracticeChapters(query) {
  query.delete(chapterParam);
}

export function createPracticeScope({ getBank, getFilters, getQuery, dialog, openDialog, go }) {
  function selectedInputs(container) {
    return [...container.querySelectorAll(`[${chapterInput}]:checked:not(:disabled)`)];
  }

  function updateSelectionCount() {
    const count = selectedInputs(dialog).length;
    dialog.querySelector('#practice-chapter-count').textContent = count ? `已选 ${count} 个章节` : '未选择章节';
    dialog.querySelector('[data-action="clear-practice-chapters"]').disabled = !count;
  }

  function open() {
    const bank = getBank(), filters = getFilters();
    const groups = subjectsInScope(bank, filters.subjectId).filter(subject => subject.chapters.length).map(subject => ({
      subject,
      selected: filters.chapters?.filter(row => row.subjectId === subject.id).map(row => row.chapterId)
        ?? (filters.chapterId ? [filters.chapterId] : []),
    }));
    openDialog('多选练习章节', `<fieldset class="exam-chapters" aria-describedby="practice-chapter-help">
      <legend class="sr-only">练习章节</legend>
      <p id="practice-chapter-help">勾选大章会包含下属全部小节，也可以展开后单独勾选小节。</p>
      <div class="practice-scope-controls"><p id="practice-chapter-count" role="status"></p>${button('清空选择', 'clear-practice-chapters', '', 'btn small')}</div>
      <div class="preparation-chapter-options">${groups.map(({ subject, selected }) => `<section data-practice-subject="${attr(subject.id)}">
        <h3>${esc(subject.name)}</h3>${preparationTreeHTML(bank, subject.id, selected, { attribute: chapterInput, includeQuestion: () => true })}
      </section>`).join('')}</div>
    </fieldset>`, button('取消', 'close-dialog') + button('应用章节', 'apply-practice-chapters', '', 'btn primary'));
    for (const [i, group] of [...dialog.querySelectorAll('[data-practice-subject]')].entries()) {
      const { subject, selected } = groups[i];
      syncPreparationTree(group, subject.chapters, selected, chapterInput);
    }
    updateSelectionCount();
  }

  function change(input) {
    const group = input.closest('[data-practice-subject]');
    const chapters = getBank().subjects.find(subject => subject.id === group.dataset.practiceSubject).chapters;
    const selected = changeScope(chapters, selectedInputs(group).map(input => input.value), input.value, input.checked);
    syncPreparationTree(group, chapters, selected, chapterInput);
    updateSelectionCount();
  }

  function clear() {
    const subjects = getBank().subjects;
    for (const group of dialog.querySelectorAll('[data-practice-subject]')) {
      const chapters = subjects.find(subject => subject.id === group.dataset.practiceSubject).chapters;
      syncPreparationTree(group, chapters, [], chapterInput);
    }
    updateSelectionCount();
  }

  function apply() {
    const query = getQuery();
    query.delete('chapter');
    query.delete('page');
    clearPracticeChapters(query);
    for (const input of selectedInputs(dialog)) {
      const subjectId = input.closest('[data-practice-subject]').dataset.practiceSubject;
      query.append(chapterParam, JSON.stringify([subjectId, input.value]));
    }
    go('/practice' + (query.size ? '?' + query : ''));
  }

  return { open, change, clear, apply };
}
