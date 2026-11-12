// Editorial annotations are an overlay. They never replace source records or answers.
// Difficulty is an editor's practice suggestion, not a calibrated exam rating.
export const editorialGuidance = Object.freeze({
  's-6b82188494c1-q0001': { difficulty: 'easy', concepts: ['复合函数求值'], method: '将 2x+1 整体代入，再展开合并同类项。', evidence: '已对照本题题干与原解析核对。' },
  's-6b82188494c1-q0002': { difficulty: 'medium', concepts: ['反函数', '函数奇偶性'], method: '利用反函数的定义，将 f(-x)=-f(x) 转换为反函数的对应关系。', evidence: '已对照本题题干与原解析核对。' },
  's-6b82188494c1-q0003': { difficulty: 'medium', concepts: ['反函数', '函数奇偶性'], method: '把互为反函数的条件写成复合恒等式，再比较 f(x) 和 f(-x)。', evidence: '已对照本题题干与原解析核对。' },
  's-6b82188494c1-q0004': { difficulty: 'easy', concepts: ['函数奇偶性'], method: '先检查定义域对称，再直接比较 f(-x) 与 f(x)。', evidence: '已对照本题题干与原解析核对。' },
  's-6b82188494c1-q0005': { difficulty: 'medium', concepts: ['函数周期性'], method: '利用正弦与余弦平移后的关系；验证周期后，还需检查是否存在更小的正周期。', evidence: '已核对题干和选项；补充提醒区分“一个周期”和“最小正周期”。' },
  's-6b82188494c1-q0006': { difficulty: 'easy', concepts: ['复合函数求值', '函数定义域'], method: '将 f(x) 整体代入 f 的表达式，并保留 x≠0、x≠1 的定义域限制。', evidence: '已核对复合表达式及分母非零条件。' },
  's-95526ab77b54-q0001': { difficulty: 'medium', concepts: ['范德蒙德行列式'], method: '各行提出公因子，再识别范德蒙德行列式。', evidence: '已对照本题四阶行列式与原解析核对。' },
  's-95526ab77b54-q0002': { difficulty: 'medium', concepts: ['代数余子式', '行列式展开'], method: '把代数余子式之和还原为按列展开，利用相同列判断行列式。', evidence: '已对照本题原解析中的第二列与第四列核对。' },
  's-95526ab77b54-q0003': { difficulty: 'medium', concepts: ['行列式列变换', '线性相关'], method: '将各列相加得到常数列，观察该列与原常数列的线性相关关系。', evidence: '已对照行和条件和原解析核对。' },
});
export const difficultyLabels = { easy: '基础', medium: '进阶', hard: '挑战', unrated: '待标注' };
export function questionGuidance(question, annotations = {}) {
  const personal = annotations[question.id];
  const editorial = editorialGuidance[question.id];
  if (personal) return { ...personal, origin: '个人标注' };
  if (editorial) return { ...editorial, origin: '编辑标注' };
  if (!question.source && !question.contentChunk) return { difficulty: question.difficulty || 'unrated', concepts: question.concepts || [], method: '', origin: '导入标注' };
  return { difficulty: 'unrated', concepts: question.concepts || [], method: '', origin: '待标注' };
}

export const feedbackKinds = { formula: '公式或文字', answer: '答案疑问', analysis: '解析问题', image: '图片问题', other: '其他问题' };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const safeId = id => typeof id === 'string' && !['__proto__', 'constructor', 'prototype'].includes(id);
export function normalizeQuestionFeedback(value = {}, ids) {
  if (!object(value) || Object.entries(value).some(([id, row]) => !safeId(id) || !ids.has(id) || !object(row) ||
    !Object.hasOwn(feedbackKinds, row.kind) || !['open', 'reviewed'].includes(row.status) ||
    typeof row.text !== 'string' || row.text.length > 5000 || !Number.isFinite(row.updatedAt)))
    throw new Error('备份中的题目纠错记录格式错误');
  return Object.fromEntries(Object.entries(value).map(([id, row]) => [id, { kind: row.kind, text: row.text, status: row.status, updatedAt: row.updatedAt }]));
}
export function normalizeQuestionAnnotations(value = {}, ids) {
  if (!object(value) || Object.entries(value).some(([id, row]) => !safeId(id) || !ids.has(id) || !object(row) ||
    !Object.hasOwn(difficultyLabels, row.difficulty) || !Array.isArray(row.concepts) || row.concepts.length > 12 ||
    row.concepts.some(c => typeof c !== 'string' || !c.trim() || c.length > 60) ||
    typeof row.method !== 'string' || row.method.length > 1000 || !Number.isFinite(row.updatedAt)))
    throw new Error('备份中的题目学习标注格式错误');
  return Object.fromEntries(Object.entries(value).map(([id, row]) => [id, { difficulty: row.difficulty, concepts: [...new Set(row.concepts)], method: row.method, updatedAt: row.updatedAt }]));
}
