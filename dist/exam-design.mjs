import { examQuestions, getBankIndex, shuffle } from './core.mjs';
import { rootChapter } from './study-planning.mjs';

export function validateExamDesign(input, bank) {
  const subjectId = input.subjectId || '';
  const index = getBankIndex(bank);
  if (subjectId && !index.subjects.has(subjectId)) throw new Error('考试科目不存在');
  const chapters = input.chapters == null ? null : input.chapters;
  if (chapters && (!Array.isArray(chapters) || !chapters.length || chapters.some(c => !c ||
    !index.chapters.get(c.subjectId)?.has(c.chapterId) || index.chapters.get(c.subjectId).get(c.chapterId).parentId || subjectId && c.subjectId !== subjectId) ||
    new Set(chapters.map(c=>JSON.stringify([c.subjectId,c.chapterId]))).size !== chapters.length)) throw new Error('请选择有效且不重复的大章节');
  const pool = examQuestions(bank, { subjectId, chapters });
  const count = Number(input.count), minutes = Number(input.minutes);
  if (!Number.isInteger(count) || count < 1 || count > 100 || count > pool.length || !Number.isInteger(minutes) || minutes < 1 || minutes > 240)
    throw new Error(`当前范围有 ${pool.length} 道自动判分题；题量须为 1–${Math.min(100,pool.length)}，时长须为 1–240 分钟。`);
  const allocation = input.allocation || [];
  if (!Array.isArray(allocation)) throw new Error('章节题量配比格式错误');
  if (allocation.length) {
    const available = new Map();
    for (const q of pool) { const key = rootChapter(bank,q); available.set(key,(available.get(key)||0)+1); }
    if (allocation.some(row => !row || !Number.isInteger(row.count) || row.count < 1 || !available.has(JSON.stringify([row.subjectId,row.chapterId])) ||
      row.count > available.get(JSON.stringify([row.subjectId,row.chapterId]))) ||
      new Set(allocation.map(row=>JSON.stringify([row.subjectId,row.chapterId]))).size !== allocation.length ||
      allocation.reduce((sum,row)=>sum+row.count,0) !== count) throw new Error('各章题量之和须等于总题量，且不能超过该章可用题量');
  }
  return { subjectId, chapters:chapters?.map(c=>({subjectId:c.subjectId,chapterId:c.chapterId})) || null, count, minutes,
    allocation:allocation.map(row=>({subjectId:row.subjectId,chapterId:row.chapterId,count:row.count})) };
}

export function drawExam(bank, settings, random = Math.random) {
  const design = validateExamDesign(settings,bank), pool = examQuestions(bank,design);
  if (!design.allocation.length) return shuffle(pool,random).slice(0,design.count);
  const selected = design.allocation.flatMap(row => shuffle(pool.filter(q=>rootChapter(bank,q)===JSON.stringify([row.subjectId,row.chapterId])),random).slice(0,row.count));
  return shuffle(selected,random);
}

export function normalizeExamTemplates(value = [], bank) {
  if (!Array.isArray(value) || value.length > 30 || new Set(value.map(row=>row?.id)).size !== value.length)
    throw new Error('备份中的组卷模板格式错误');
  return value.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 150 || ['__proto__','constructor','prototype'].includes(row.id) ||
      typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80 || !Number.isFinite(row.updatedAt)) throw new Error('备份中的组卷模板格式错误');
    return { id:row.id, name:row.name.trim(), updatedAt:row.updatedAt, ...validateExamDesign(row,bank) };
  });
}
