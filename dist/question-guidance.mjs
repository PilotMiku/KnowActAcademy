// Editorial annotations are an overlay. They never replace source records or answers.
// Difficulty is an editor's practice suggestion, not a calibrated exam rating.
export const editorialGuidance = Object.freeze({
  's-f3c2285366b2-q0001': { difficulty:'easy', concepts:['重要极限'], method:'分子分母同时除以 x，使用 sin x / x 的极限。', evidence:'已独立计算并对照原解析，结果为 0。', hints:['先观察 sin x 与 x 的比值。','分子分母同时除以 x，变成 (1−sin x/x)/(1+sin x/x)。','sin x/x 趋于 1，分子趋于 0、分母趋于 2。'] },
  's-f3c2285366b2-q0004': { difficulty:'medium', concepts:['重要极限','根式与绝对值'], method:'先将 1−cos x 写成 2sin²(x/2)，利用右极限处理绝对值。', evidence:'已核对右极限条件并独立计算，结果为根号 2。', hints:['使用半角公式化简被开方量。','根号下的 sin²(x/2) 应先写为 |sin(x/2)|。','x 从右侧趋于 0 时 sin(x/2)>0，再使用重要极限。'] },
  's-73cc3a94d49a-q0001': { difficulty:'medium', concepts:['指数型重要极限'], method:'将指数写成 (a/x)·(b/a)，配成标准重要极限。', evidence:'在 a≠0、底数在零点邻域内为正时，结果为 exp(b/a)，与原解析一致。', hints:['这是 1 的无穷次幂型极限。','令 u=x/a，则指数 b/x=(b/a)/u。','先求 (1+u)^(1/u) 的极限，再取 b/a 次幂。'] },
  's-73cc3a94d49a-q0002': { difficulty:'easy', concepts:['导数定义','对数求导'], method:'把给定式认作 ln x 在 a 处的差商。', evidence:'已对照 a>0 的条件，独立得到 1/a，与原解析一致。', hints:['ln(x+a)−ln a 是同一函数的增量。','令 g(t)=ln t，将式子写成 [g(a+x)−g(a)]/x。','由差商定义得到 g′(a)，再使用对数导数。'] },
  's-b08a6d73f6a6-q0001': { difficulty:'medium', concepts:['导数定义'], method:'每个差商都先核对函数值的基点与分母中的实际增量。', evidence:'已对照原选项及解析；增量 2h、−h 分别带来系数 2、−1。', hints:['f 在 x₀ 可导，只能直接使用以 x₀ 为基点的导数定义。','分子增量为 2h 时，分母也要配成 2h；增量为 −h 同理。','额外系数从分母补配得到，不能把不同基点处的函数值相减当作标准差商。'] },
  's-b08a6d73f6a6-q0002': { difficulty:'medium', concepts:['导数定义','连续性'], method:'先由连续性及给定极限求 f(2)，再代入导数定义。', evidence:'已独立核对 f(2)=0、f′(2)=2，与原解析一致。', hints:['先求 f(2)，还不能直接把 f(x)/(x−2) 当作导数。','把 f(x) 写成 (x−2)·[f(x)/(x−2)]，由连续性得到 f(2)=0。','再把导数定义中的 f(x)−f(2) 代入给定极限。'] },
  's-565d562db0f9-q0001': { difficulty:'easy', concepts:['乘积求导','对数求导'], method:'x cos x 用乘积法则；ln(a^x)=x ln a，sin e 是常数。', evidence:'按实函数题意 a>0；独立求导与原解析一致。', hints:['先区分自变量 x 与常数 a、e。','对 x cos x 使用 (uv)′=u′v+uv′。','将 ln(a^x) 改写为 x ln a；sin e 的导数为零。'] },
  's-565d562db0f9-q0002': { difficulty:'medium', concepts:['乘积求导'], method:'两个含 x 的乘积分别求导，常数 tan e 的导数为零。', evidence:'已独立使用乘积法则核对原解析。', hints:['sin x ln x 与 x³ sec x 都是乘积。','分别应用乘积法则，保留两个展开项。','使用 (sec x)′=sec x tan x，最后保留原式中的减号。'] },
  's-842ce28a4f0d-q0001': { difficulty:'easy', concepts:['极值判别','对数求导'], method:'在 x>0 内求驻点，再用二阶导数或导数变号判别。', evidence:'已独立求出 x=1 为极小值点、极小值为 1，与原解析一致。', hints:['定义域为 x>0。','求出 y′=1−1/x，令其为零寻找驻点。','检查 y″=1/x² 在驻点的符号，最后代回原函数计算极值。'] },
  's-842ce28a4f0d-q0002': { difficulty:'medium', concepts:['极值判别','乘积求导'], method:'先求 x²ln x 的导数，再检查正半轴上的驻点。', evidence:'已独立得到极小值点 1/√e、极小值 −1/(2e)，与原解析一致。', hints:['在 x>0 上求导：y′=x(2ln x+1)。','x=0 不在定义域，驻点应由 2ln x+1=0 求出。','检查 y″=2ln x+3 在驻点为正，再代回原函数。'] },
  's-f3cd1df4fea4-q0002': { difficulty:'medium', concepts:['偏导数定义'], method:'补上并减去 f(a,b)，拆成两个以 a 为基点的偏导差商。', evidence:'保持第二个变量 b 不变，独立得到 2fₓ(a,b)，与原解析一致。', hints:['第二个变量固定为 b，把它当作一元函数差商。','分子补上 f(a,b)，拆为 [f(a+x,b)−f(a,b)] 和 [f(a,b)−f(a−x,b)]。','后一项配成增量 −x 的差商，两个极限均为 fₓ(a,b)。'] },
  's-f3cd1df4fea4-q0003': { difficulty:'easy', concepts:['偏导数定义','复合函数求导'], method:'对 y 求偏导时将 x 视为常数，使用指数函数链式法则。', evidence:'独立得到 2y·2^(x+y²)·ln 2，与原解析 y·2^(x+y²)·ln 4 等价。', hints:['求关于 y 的偏导，x 保持不变。','使用 (a^u)′=a^u ln a·u′。','指数 u=x+y² 对 y 的导数为 2y。'] },
  's-c24640ce8c58-q0002': { difficulty:'medium', concepts:['逆矩阵','矩阵多项式'], method:'将 A²+A=6E 写成 A(A+E)=6E，构造逆矩阵。', evidence:'已独立验证左右乘均为单位矩阵，A⁻¹=(A+E)/6，与原解析一致。', hints:['把常数单位矩阵移到等式右侧。','从 A²+A 中提出 A，得到 A(A+E)=6E。','两边除以 6，按逆矩阵定义检查乘积是否为 E。'] },
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
