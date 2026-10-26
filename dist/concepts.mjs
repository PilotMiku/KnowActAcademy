import { getBankIndex } from "./core.mjs";

// Associations describe the chapter headings in the supplied bank. They do not
// infer a precise concept from the rasterized text of individual questions.
const rules = [
  { name: "极限与连续", subjects: ["calculus"], match: /极限|无穷小|连续|夹逼|单调有界|间断/ },
  { name: "导数与微分", subjects: ["calculus"], match: /导数|求导|微分|Roll|Lagrange|Cauchy|Taylor|泰勒|麦克劳林|单调性|极值|最值|凹凸|拐点|曲率|切线|切平面|梯度|方向导数/i },
  { name: "泰勒展开与幂级数", subjects: ["calculus"], match: /Taylor|泰勒|麦克劳林|幂级数/i },
  { name: "复合函数与变量替换", subjects: ["calculus"], match: /复合函数|换元|凑微分/ },
  { name: "积分与几何应用", subjects: ["calculus"], match: /积分|原函数|面积|体积|弧长|变力|水压力|引力/ },
  { name: "级数与收敛", subjects: ["calculus"], match: /级数|收敛|审敛|Fourier/i },
  { name: "向量与空间几何", subjects: ["calculus", "linear"], match: /向量|数量积|混合积|平面|直线|梯度/ },
  { name: "线性方程与矩阵运算", subjects: ["linear"], match: /Cramer|初等变换|逆矩阵|矩阵方程|极大无关|矩阵的秩|矩阵及其运算/i },
  { name: "行列式与可逆性", subjects: ["linear"], match: /行列式|Cramer|逆矩阵|矩阵特征值|正定/i },
  { name: "特征值与二次型", subjects: ["linear"], match: /特征值|特征向量|相似|二次型|矩阵合同/ },
];
const indexes = new WeakMap();
export function getConceptIndex(bank) {
  if (indexes.has(bank)) return indexes.get(bank);
  const bankIndex = getBankIndex(bank), questions = new Map(), concepts = new Map();
  for (const q of bank.questions) {
    const chapterName = bankIndex.chapters.get(q.subjectId)?.get(q.chapterId)?.name ?? "";
    const explicit = [...(q.concepts ?? []), ...(q.tags ?? []).filter((t) => /^知识点[:：]/.test(t)).map((t) => t.slice(4))];
    const names = [...new Set([...explicit, ...rules.filter((r) => r.subjects.includes(q.subjectId) && r.match.test(chapterName)).map((r) => r.name)]
      .map((name) => String(name).trim()).filter(Boolean))];
    questions.set(q.id, names);
    for (const name of names) {
      const entry = concepts.get(name) ?? { name, questionIds: [], chapters: new Map() };
      entry.questionIds.push(q.id);
      const key = JSON.stringify([q.subjectId, q.chapterId]);
      const chapter = entry.chapters.get(key) ?? { subjectId: q.subjectId, chapterId: q.chapterId, name: chapterName, count: 0 };
      chapter.count++;
      entry.chapters.set(key, chapter);
      concepts.set(name, entry);
    }
  }
  const index = { questions, concepts };
  indexes.set(bank, index);
  return index;
}
