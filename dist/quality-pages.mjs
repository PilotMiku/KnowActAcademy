import { feedbackKinds, questionGuidance, difficultyLabels, editorialGuidance } from './question-guidance.mjs';
import { questionPreviewHTML, paginationHTML } from './question-discovery.mjs';
import { esc, attr, button, head } from './ui.mjs';

export function createQualityPages({ getBank, getState, route }) {
  function qualityPage() {
    const bank = getBank(), state = getState(), query = route().query;
    const issue = query.get('issue') || 'all';
    const feedback = state.questionFeedback || {};
    const flagged = q => q.answerVerified === false || q.sourceIncomplete || q.analysisMissing || feedback[q.id];
    const questions = bank.questions.filter(q => flagged(q) && (issue === 'all' ||
      issue === 'answer' && (q.answerVerified === false || q.sourceIncomplete) || issue === 'analysis' && q.analysisMissing ||
      issue === 'open' && feedback[q.id]?.status === 'open' || issue === 'reviewed' && feedback[q.id]?.status === 'reviewed'));
    const requested = Number(query.get('page'));
    const page = Math.max(1, Math.min(Math.max(1, Math.ceil(questions.length / 20)), Number.isSafeInteger(requested) ? requested : 1));
    const counts = [ ['答案待核实 / 原件缺损', bank.questions.filter(q => q.answerVerified === false || q.sourceIncomplete).length],
      ['缺少解析', bank.questions.filter(q => q.analysisMissing).length], ['个人待核对', Object.values(feedback).filter(f => f.status === 'open').length] ];
    return `${head('题目质量与纠错', '按题保留疑问、来源和核对记录。个人核对不会修改原题答案或评分资格。', button('导出纠错清单', 'export-feedback', '', 'btn'))}<div class="stat-cards">${counts.map(([label, count]) => `<section class="card big-stat"><p>${label}</p><b>${count}</b></section>`).join('')}</div><section class="card quality-help"><p>发现问题时，可从题目页或下面的列表记录公式、答案、解析和图片疑问。所有记录保存在你的学习数据中，可随备份导出。</p><p class="format-note">编辑学习标注已覆盖 ${bank.questions.filter(q => editorialGuidance[q.id]).length} 题；其余题目可添加个人难度、知识点和方法标注。难度仅为练习建议。</p></section><div class="field quality-filter"><label for="quality-issue">查看问题</label><select id="quality-issue" data-filter="issue">${[['all','全部问题记录'],['answer','答案待核实 / 原件缺损'],['analysis','缺少解析'],['open','个人待核对'],['reviewed','个人已核对']].map(([id,label]) => `<option value="${id}" ${issue===id?'selected':''}>${label}</option>`).join('')}</select></div><section class="card">${questions.length ? questions.slice((page-1)*20,page*20).map(q => `<article class="collection-item"><div class="grow"><strong>${esc(q.sourceLabel || q.id)}</strong>${questionPreviewHTML(q)}<p class="collection-meta">${q.analysisMissing?'缺少解析 · ':''}${q.answerVerified===false || q.sourceIncomplete?'仅供查阅 · ':''}${feedback[q.id]?`${esc(feedbackKinds[feedback[q.id].kind])} · ${feedback[q.id].status==='open'?'个人待核对':'个人已核对'}`:''}</p></div><div class="collection-actions">${button('预览', 'show-question-preview', `data-id="${attr(q.id)}"`, 'btn small')}${button('记录与核对', 'question-feedback', `data-id="${attr(q.id)}"`, 'btn small')}</div></article>`).join('') + paginationHTML(page,questions.length,query,'quality') : '<div class="study-empty">当前没有这类记录。</div>'}</section>`;
  }
  function feedbackForm(q) {
    const row = getState().questionFeedback[q.id];
    return `<p>${esc(q.sourceLabel || q.id)}</p><p class="format-note">记录个人疑问和核对证据，原题与原答案保留。标为“个人已核对”不会让待核实题进入评分。</p><input id="feedback-question" type="hidden" value="${attr(q.id)}"><div class="field"><label for="feedback-kind">问题类型</label><select id="feedback-kind">${Object.entries(feedbackKinds).map(([id,label]) => `<option value="${id}" ${row?.kind===id?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label for="feedback-text">问题描述与核对依据</label><textarea class="input" id="feedback-text" maxlength="5000" rows="6" placeholder="例如：哪一个公式有疑问、原件页码、你的计算或更正建议">${esc(row?.text || '')}</textarea></div><div class="field"><label for="feedback-status">个人核对状态</label><select id="feedback-status"><option value="open">待核对</option><option value="reviewed" ${row?.status==='reviewed'?'selected':''}>个人已核对</option></select></div><p id="feedback-error" role="alert"></p>`;
  }
  function annotationForm(q) {
    const guidance = questionGuidance(q, getState().questionAnnotations);
    return `<p>${esc(q.sourceLabel || q.id)} · ${esc(guidance.origin)}</p><p class="format-note">个人标注与原题分开保存，可用于筛选和知识点关联。留空知识点可取消个人知识点关联。</p><input id="annotation-question" type="hidden" value="${attr(q.id)}"><div class="field"><label for="annotation-difficulty">建议难度</label><select id="annotation-difficulty">${Object.entries(difficultyLabels).map(([id,label]) => `<option value="${id}" ${guidance.difficulty===id?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label for="annotation-concepts">知识点（逗号分隔，最多 12 个）</label><input class="input" id="annotation-concepts" maxlength="720" value="${attr(guidance.concepts.join('，'))}"></div><div class="field"><label for="annotation-method">解题方法与注意事项</label><textarea class="input" id="annotation-method" rows="4" maxlength="1000">${esc(guidance.method)}</textarea></div><p id="annotation-error" role="alert"></p>`;
  }
  return { qualityPage, feedbackForm, annotationForm };
}
