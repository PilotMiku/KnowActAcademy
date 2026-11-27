import { textOnly } from './core.mjs';
import { questionGuidance } from './question-guidance.mjs';

// Identify what the item asks for, using question text rather than source labels.
const tasks = [
  ['函数周期性', /最小正周期|周期为|周期是|求.{0,10}周期/],
  ['函数定义域', /(?:的|求|确定|判断)定义域/],
  ['函数奇偶性', /的奇偶性|是奇函数还是偶函数|奇函数.{0,45}偶函数|偶函数.{0,45}奇函数/],
  ['反函数', /(?:的|求|确定)反函数|互为反函数/],
  ['复合函数求值', /(?:则|求|计算)[^\p{Script=Han}]{0,8}f\s*\(\s*(?:f\s*\(|[-+]?\d*\s*x\s*[-+])/u],
  ['矩阵的秩', /的秩|求秩|秩为多少/],
  ['矩阵求逆', /的逆矩阵|求逆矩阵|可逆且.{0,20}逆矩阵/],
  ['特征值', /(?:求|的|对应的)特征值/],
  ['特征向量', /(?:求|的|对应的)特征向量/],
  ['向量组线性相关性', /线性相(?:关|依)|线性无关/],
  ['矩阵相似对角化', /相似对角|能否对角化/],
  ['二次型正定性', /正定的|正定时|是否正定|是正定/],
  ['幂级数收敛半径', /收敛半径/],
  ['幂级数收敛域', /收敛区间|收敛域/],
  ['级数敛散性', /敛散性|级数是否收敛/],
  ['函数极值', /求.{0,15}极值|的极值|极值点/],
  ['函数单调区间', /的单调区间|单调递增区间|单调递减区间/],
  ['函数凹凸性', /凹凸性|凹凸区间|凹区间|凸区间/],
  ['曲线拐点', /的拐点|求拐点/],
];
const broad = /^(?:极限(?:与连续)?|导数(?:与微分)?|微分|积分(?:与几何应用)?|微积分|函数|数列|级数(?:与收敛)?|高等数学|线性代数|行列式|矩阵|向量|线性方程|二次型|计算|证明)$/;

export function questionStemText(q) {
  const catalog = (q.searchText || '').trim();
  const body = catalog.startsWith(q.sourceLabel || '\0') ? catalog.slice(q.sourceLabel.length).trim() : catalog;
  return (q.previewText || body || (q.contentChunk ? '' : textOnly(q.stem))).normalize('NFKC').trim();
}

export function questionSkill(q, annotations) {
  const guide = questionGuidance(q, annotations);
  const label = guide.concepts?.[0] || q.tags?.find(tag => /^知识点[:：]/.test(tag))?.slice(4);
  const explicit = label?.normalize('NFKC').trim();
  if (explicit && !broad.test(explicit)) return explicit;
  const text = questionStemText(q).replace(/\\[()[\]]/g, '');
  const matches = tasks.filter(([, pattern]) => pattern.test(text));
  return matches.length === 1 ? matches[0][0] : '';
}
