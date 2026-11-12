import { button, icon } from './ui.mjs';

const key = () => 'zhixing-entry:' + new URL('./', location.href).pathname;
export function entryPreferences() {
  try { return JSON.parse(localStorage.getItem(key()) || '{}') || {}; } catch { return {}; }
}
export function rememberEntry(changes = {}) {
  try { localStorage.setItem(key(), JSON.stringify({ ...entryPreferences(), entered: true, ...changes })); } catch { /* Optional convenience. */ }
}
export function resumeRoute(state, now = Date.now()) {
  const exam = state.exams.find(e => e.status === 'active' && e.endsAt > now);
  if (exam) return '/exam/' + encodeURIComponent(exam.id);
  if (state.practice?.questionIds?.length)
    return state.practice.preparationId && state.practice.preparationId === state.preparation?.id ? '/prepare?session=1' : '/practice?session=1';
  return state.preparation ? '/prepare' : '/';
}
export function guideHTML({ dismissible = false } = {}) {
  return `<section class="card learning-guide" aria-label="学习方式引导"><div class="guide-heading"><div><span class="pill blue">从一个小目标开始</span><h2>今天想怎么学？</h2></div>${dismissible ? button('先跳过', 'dismiss-guide', '', 'btn small') : ''}</div><div class="guide-options">
    <a href="#/practice?view=chapters" data-guide-destination>${icon('book', 23)}<strong>按章节练习</strong><p>选择正在学的章节，顺序练习或随机抽题。</p><span>选择章节 →</span></a>
    <a href="#/prepare" data-guide-destination>${icon('target', 23)}<strong>测一测薄弱点</strong><p>先做最多 20 题测评，再针对错题和薄弱项训练。</p><span>选择测评范围 →</span></a>
    <a href="#/knowledge" data-guide-destination>${icon('folder', 23)}<strong>阅读学习资料</strong><p>按分类阅读、收藏资料，保存阅读位置。</p><span>打开学习资料 →</span></a>
    </div><p class="format-note">不需要登录。学习记录保存在当前浏览器，换设备前可在题库管理中导出备份。随时可从页脚重新打开本指南。</p></section>`;
}
