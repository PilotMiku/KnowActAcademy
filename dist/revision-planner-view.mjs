import { dayKey } from './core.mjs';
import { dateNumber, dateFromNumber, revisionSchedule } from './revision-planner.mjs';
import { esc, attr, button, head } from './ui.mjs';
import { preparationTreeHTML } from './preparation-scope.mjs';
import { completionHTML } from './dashboard-tasks.mjs';

export function revisionScopeHTML(bank, subjectId, selected) {
  return preparationTreeHTML(bank, subjectId, selected).replaceAll('data-prepare-chapter', 'data-revision-chapter name="revision-chapter"');
}

export function revisionSummaryHTML(bank, state) {
  const summary = revisionSchedule(bank, state);
  if (!summary) return `<section class="card revision-summary"><div><h2>把复习安排到每天</h2><p>设置考试日期与每日时间，安排新题、薄弱题和到期复习。</p></div><a class="btn" href="#/calendar">制定复习日历</a></section>`;
  const today = summary.days[0];
  return `<section class="card revision-summary"><div><span class="pill blue">${summary.expired ? '考试日期已到' : `距考试 ${summary.daysLeft} 天`}</span><h2>${esc(summary.plan.title)}</h2><p>${summary.expired ? '可以调整日期，继续安排复习。' : `今日已练 ${summary.completedToday} 道不同题 · 待安排新题 ${today.newIds.length} 道、巩固 ${today.reviewIds.length} 道`}</p></div><a class="btn" href="#/calendar">查看复习日历</a></section>`;
}

export function revisionCalendarPage(bank, state, query) {
  const summary = revisionSchedule(bank, state), plan = summary?.plan;
  const subjectId = plan?.subjectId ?? bank.subjects[0]?.id;
  const selected = plan?.chapterIds ?? bank.subjects[0]?.chapters.filter(c => !c.parentId).map(c => c.id) ?? [];
  const today = dayKey(), tomorrow = dateFromNumber(dateNumber(today) + 1);
  const defaultDate = dateFromNumber(dateNumber(today) + 30);
  const rawOffset = Number(query.get('offset'));
  const offset = Math.max(0, Math.min(Math.floor((Math.max(1, summary?.days.length ?? 1) - 1) / 14) * 14,
    Number.isSafeInteger(rawOffset) ? Math.floor(rawOffset / 14) * 14 : 0));
  const percent = summary?.total ? Math.round(summary.covered / summary.total * 100) : 0;
  return `${head('考试复习日历', '按每天可用时间安排练习；完成后更新，未完成的题会重新分配。', '<a class="btn" href="#/prepare">备考模式</a>')}
    ${summary ? `<section class="card revision-overview"><span class="pill blue">${summary.expired ? '考试日期已到' : `距考试 ${summary.daysLeft} 天`}</span><h2>${esc(plan.title)}</h2><p>${esc(plan.examDate)} 考试 · 每天 ${plan.minutesPerDay} 分钟 · 约 ${summary.dailyCapacity} 题</p><div class="progress-bar" data-progress-key="revision-coverage" role="progressbar" aria-label="计划范围题库覆盖率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div><p>已覆盖 ${summary.covered} / ${summary.total} 道可评分题 · 今天已练 ${summary.completedToday} 道不同题</p>${!summary.expired && summary.days[0]?.questionIds.length ? button('开始今日安排 · 最多 20 题', 'revision-practice', '', 'btn primary') : `<p>${summary.expired ? '请在下方调整考试日期，学习记录会继续保留。' : '今天暂无待完成安排。'}</p>`}${summary.unscheduled ? `<p class="notice" role="status">按当前时间预算，还有 ${summary.unscheduled} 道题未能安排到考前。可增加每日时间、缩小范围或延后日期。</p>` : ''}${summary.truncated ? '<p class="format-note">当前最多展示未来 730 天的安排。</p>' : ''}${!summary.expired && !summary.days[0]?.questionIds.length ? completionHTML(summary) : ''}<p class="format-note">题量按本范围最近有效用时的中位数估计，无记录时按每题 2 分钟。优先处理已知薄弱题与到期题，再安排新题；每题只安排一次。后续复习日期会随实际作答重新计算，不代表学完后无需再复习。</p></section>
    ${!summary.expired ? `<section class="revision-calendar" aria-label="未来复习安排"><div class="section-head"><h2>${offset ? '后续安排' : '从今天开始'} <small>每天 ${plan.minutesPerDay} 分钟</small></h2></div><div class="revision-days">${summary.days.slice(offset, offset + 14).map((day, i) => `<article class="card revision-day ${day.date === today ? 'is-today' : ''}"><time datetime="${day.date}">${day.date === today ? '今天' : day.date.slice(5)} <small>${['日','一','二','三','四','五','六'][new Date(day.date + 'T12:00:00').getDay()]}</small></time><p>新题 <b>${day.newIds.length}</b> · 巩固 <b>${day.reviewIds.length}</b></p><p class="muted">${day.completed ? `已练 ${day.completed} 道 · ` : ''}预计还需 ${day.minutes} 分钟</p>${button('查看安排', 'revision-day', `data-date="${day.date}"`, 'text-btn')}</article>`).join('')}</div><nav class="revision-pagination" aria-label="日历翻页">${offset ? `<a class="btn" href="#/calendar?offset=${offset - 14}">前 14 天</a>` : ''}${offset + 14 < summary.days.length ? `<a class="btn" href="#/calendar?offset=${offset + 14}">后 14 天</a>` : ''}</nav></section>` : ''}` : ''}
    <details class="card revision-editor" ${!plan || summary.expired ? 'open' : ''}><summary>${plan ? '调整考试日期与复习范围' : '创建复习计划'}</summary><form id="revision-plan-form"><div class="revision-fields"><label class="field">计划名称<input class="input" name="title" maxlength="80" required value="${attr(plan?.title ?? '我的考试复习')}" autocomplete="off"></label><label class="field">考试日期<input class="input" type="date" name="examDate" min="${tomorrow}" max="${dateFromNumber(dateNumber(today) + 730)}" required value="${attr(plan && !summary.expired ? plan.examDate : defaultDate)}"></label><label class="field">每天可用时间（分钟）<input class="input" type="number" name="minutesPerDay" min="10" max="240" step="1" required value="${plan?.minutesPerDay ?? 30}"></label><label class="field">考试科目<select name="subjectId" id="revision-subject">${bank.subjects.map(s => `<option value="${attr(s.id)}" ${s.id === subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label></div><fieldset class="revision-scope"><legend>复习范围（大章包含全部小节）</legend><div id="revision-scope">${revisionScopeHTML(bank, subjectId, selected)}</div><p id="revision-scope-summary" aria-live="polite"></p></fieldset><p id="revision-form-error" role="alert"></p><div class="flex"><button class="btn primary" type="submit">${plan ? '保存并重新安排' : '生成复习日历'}</button>${plan ? button('移除复习计划', 'revision-remove', '', 'btn') : ''}</div><p class="format-note">计划自动保存到当前浏览器，并包含在完整备份、进度备份和服务器同步中。</p></form></details>`;
}
