import { getBankIndex } from './core.mjs';
import { questionGuidance } from './question-guidance.mjs';
import { mathReferences } from './math-reference.mjs';
import { esc, attr } from './ui.mjs';

// Authored aids are overlays: original statements, answers and solutions stay intact.
export const conceptCards = [
  { id:'limit-sine', title:'三角函数重要极限', concepts:['重要极限','根式与绝对值'], formula:String.raw`弧度制下，\(\lim_{x\to0}\sin x/x=1\)，且 \(1-\cos x=2\sin^2(x/2)\)。`, condition:'使用时先核对趋近点；根式开平方会引入绝对值。', example:String.raw`\(\sqrt{\sin^2 t}=|\sin t|\)，不能直接省略绝对值。`, warning:'左右极限的符号条件可能不同。' },
  { id:'limit-exponential', title:'指数型重要极限', concepts:['指数型重要极限'], formula:String.raw`\(\lim_{u\to0}(1+u)^{1/u}=e\)。`, condition:'在实数范围内，底数须在所考虑邻域内为正。', example:String.raw`\(\lim_{x\to0}(1+2x)^{3/x}=e^6\)。`, warning:'必须同时匹配底数中的增量与指数中的倒数。' },
  { id:'derivative-definition', title:'导数与连续性', concepts:['导数定义','连续性'], formula:String.raw`\(f'(a)=\lim_{h\to0}[f(a+h)-f(a)]/h\)。可导必连续，连续未必可导。`, condition:'分子、分母必须使用相同增量和同一基点。', example:String.raw`\(\lim_{h\to0}[f(a+2h)-f(a)]/h=2f'(a)\)。`, warning:'未知 f(a) 时，应先根据条件确定它。' },
  { id:'product-chain', title:'乘积与复合函数求导', concepts:['乘积求导','复合函数求导','对数求导'], formula:String.raw`\((uv)'=u'v+uv'\)，\((f(g(x)))'=f'(g(x))g'(x)\)，\((\ln x)'=1/x\)。`, condition:'乘积和复合结构可能同时出现；实对数要求真数为正。', example:String.raw`\((x\sin x)'=\sin x+x\cos x\)。`, warning:'区分变量与常数，不要漏掉乘积项或内层导数。' },
  { id:'extrema', title:'极值判别', concepts:['极值判别'], formula:String.raw`若 \(f'(a)=0\) 且 \(f''(a)>0\)，则 \(a\) 为局部极小值点；若 \(f''(a)<0\)，则为局部极大值点。`, condition:'采用二阶判别时函数须在该点邻域内具备相应可导条件。', example:String.raw`\(x^2\) 在 \(x=0\) 处取得极小值 0。`, warning:'f″(a)=0 时该判别无结论；极值点和极值是不同量。' },
  { id:'partial', title:'偏导数', concepts:['偏导数定义'], formula:String.raw`\(f_x(a,b)=\lim_{h\to0}[f(a+h,b)-f(a,b)]/h\)。`, condition:'对某个变量求偏导时，其余独立变量保持不变。', example:String.raw`\(f(x,y)=x^2y\) 时，\(f_x=2xy\)，\(f_y=x^2\)。`, warning:'偏导存在不能直接推出多元函数可微。' },
  { id:'matrix-inverse', title:'逆矩阵与矩阵多项式', concepts:['逆矩阵','矩阵多项式'], formula:String.raw`\(AB=BA=E\) 时，\(B=A^{-1}\)。`, condition:'逆矩阵讨论要求 A 为方阵；变形中保留矩阵的乘法顺序。', example:String.raw`若 \(A^2=E\)，则 \(A^{-1}=A\)。`, warning:'不能在尚未证明可逆时直接约去矩阵因子。' },
  { id: 'composition', title: '复合函数求值', concepts: ['复合函数求值'],
    formula: String.raw`\(f(g(x))\) 表示把 \(g(x)\) 整体代入 \(f\) 的自变量位置。`,
    condition: '同时检查内层有定义，以及内层的值落在外层定义域内。',
    example: String.raw`若 \(f(t)=t^2+1\)，则 \(f(2x+1)=(2x+1)^2+1\)。`,
    warning: '代入对象是整个表达式，平方时先加括号。' },
  { id: 'inverse-parity', title: '反函数与奇偶性', concepts: ['反函数', '函数奇偶性'],
    formula: String.raw`反函数满足 \(f^{-1}(f(x))=x\)。若 \(f\) 在关于原点对称的定义域上是可逆奇函数，其反函数也是奇函数。`,
    condition: '先确认反函数存在；讨论奇偶性时先检查定义域对称。',
    example: String.raw`由 \(f(-x)=-f(x)\)，令 \(y=f(x)\)，可得 \(f^{-1}(-y)=-f^{-1}(y)\)。`,
    warning: String.raw`\(f^{-1}(x)\) 是反函数，通常不等于 \(1/f(x)\)。` },
  { id: 'period', title: '函数周期性', concepts: ['函数周期性'],
    formula: String.raw`若 \(T>0\)，且定义域平移 \(T\) 后保持不变、处处满足 \(f(x+T)=f(x)\)，则 \(T\) 是周期。`,
    condition: '最小正周期必须在所有正周期中最小，并非每个周期函数都有最小正周期。',
    example: String.raw`\(|\sin x|\) 的最小正周期为 \(\pi\)，可用 \(\sin(x+\pi)=-\sin x\) 验证周期。`,
    warning: '验证出一个周期后，仍要排除更小的正周期。' },
  { id: 'domain', title: '函数定义域', concepts: ['函数定义域'],
    formula: String.raw`实函数中：分母不为零；偶次根式的被开方量非负；\(\log u\) 要求 \(u>0\)。`,
    condition: '多个限制条件取交集；复合函数还要满足外层的定义域要求。',
    example: String.raw`\(f(x)=1/(x-1)\) 时，\(f(1/x)\) 要求 \(x\ne0\) 且 \(1/x\ne1\)。`,
    warning: '化简可能消去原表达式的限制，原定义域条件仍需保留。' },
  { id: 'vandermonde', title: '范德蒙德行列式', concepts: ['范德蒙德行列式'],
    formula: String.raw`第 \(i\) 行为 \((1,x_i,\ldots,x_i^{n-1})\) 时，行列式为 \(\prod_{1\le i<j\le n}(x_j-x_i)\)。`,
    condition: '先核对各行幂次顺序；若调换行或列，要跟踪符号。',
    example: String.raw`\(\begin{vmatrix}1&a\\1&b\end{vmatrix}=b-a\)。`,
    warning: '不能只看差值的绝对值；每对因子的方向要与行顺序一致。' },
  { id: 'cofactor', title: '代数余子式与展开', concepts: ['代数余子式', '行列式展开'],
    formula: String.raw`\(A_{ij}=(-1)^{i+j}M_{ij}\)，沿第 \(i\) 行展开：\(\det A=\sum_j a_{ij}A_{ij}\)。`,
    condition: '余子式删去对应行列；代数余子式还包含符号。',
    example: String.raw`\(\begin{vmatrix}a&b\\c&d\end{vmatrix}=a\cdot d+b\cdot(-c)\)。`,
    warning: '异行元素与另一行对应代数余子式的乘积和为零，须核对下标。' },
  { id: 'column-operation', title: '列变换与线性相关', concepts: ['行列式列变换', '线性相关'],
    formula: String.raw`把一列的 \(k\) 倍加到另一列，行列式不变；列向量线性相关时，行列式为零。`,
    condition: '该行列式性质针对方阵；每次列替换须明确被替换的目标列。',
    example: String.raw`\(\begin{vmatrix}1&2\\3&6\end{vmatrix}=0\)，因为第二列是第一列的两倍。`,
    warning: '将一列单独乘常数会改变行列式，不能与“加到另一列”混淆。' },
];

export function questionHintsHTML(question, state) {
  const guide = questionGuidance(question, state.questionAnnotations);
  const hints = guide.hints ?? (guide.method ? [`本题可先关注：${guide.concepts.join('、') || '题干条件与所求量'}。`, guide.method] : []);
  if (!hints.length) return '';
  return `<details class="method-hint"><summary>分层解题提示 · ${hints.length} 层</summary><p class="format-note">每次只展开下一层，完整答案仍在作答后查看。</p>${hints.map((text,index) => `<div class="hint-step" data-hint-step="${index}" hidden><b>提示 ${index + 1}</b><div class="rich" data-rich="${attr(text)}"></div></div>`).join('')}<button type="button" class="btn small" data-action="reveal-hint" data-id="${attr(question.id)}" data-level="0">查看第 1 层提示</button><p class="format-note">${esc(guide.evidence || '个人学习标注，供练习参考。')}</p></details>`;
}

export function questionLearningCards(question, bank, state) {
  const guidance = questionGuidance(question, state.questionAnnotations);
  const exact = conceptCards.filter(card => card.concepts.some(name => guidance.concepts.includes(name)));
  if (exact.length) return exact.map(card => ({ ...card, association: `知识点关联 · ${guidance.origin}` }));
  const chapters = getBankIndex(bank).chapters.get(question.subjectId);
  let id = question.chapterId;
  const seen = new Set();
  while (chapters?.get(id)?.parentId && !seen.has(id)) { seen.add(id); id = chapters.get(id).parentId; }
  const chapter = mathReferences.find(row => row.subjectId === question.subjectId && row.chapterId === id);
  return chapter ? [{ ...chapter, id: `${chapter.subjectId}-${chapter.chapterId}`, condition: '', association: '章节关联 · 本章代表性主题' }] : [];
}

export function learningCardsHTML(question, bank, state, { expanded = false } = {}) {
  const cards = questionLearningCards(question, bank, state);
  if (!cards.length) return '';
  const content = cards.map(card => `<article class="learning-card"><span class="pill">${esc(card.association)}</span><h3>${esc(card.title)}</h3><div class="rich" data-rich="${attr(card.formula)}"></div>${card.condition ? `<p>${esc(card.condition)}</p>` : ''}<h4>小例子</h4><div class="rich" data-rich="${attr(card.example)}"></div><h4>易错提醒</h4><div class="rich" data-rich="${attr(card.warning)}"></div>${card.concepts ? `<a class="text-btn" href="#/practice?subject=${encodeURIComponent(question.subjectId)}&concept=${encodeURIComponent(card.concepts[0])}">练习同一知识点 →</a>` : `<a class="text-btn" href="#/reference?subject=${encodeURIComponent(question.subjectId)}&chapter=${encodeURIComponent(card.chapterId)}">查看本章速查 →</a>`}</article>`).join('');
  return expanded ? `<div class="learning-cards">${content}</div>` : `<details class="related-learning"><summary>相关知识卡片 · ${cards.length} 张</summary><div class="learning-cards">${content}</div></details>`;
}
