import { esc, attr, head } from './ui.mjs';

// Newly authored study aids, kept separate from the source questions and solutions.
export const mathReferences = [
  ['calculus','chapter-1','函数与极限',String.raw`当角度采用弧度制时，\(\lim_{x\to0}\frac{\sin x}{x}=1\)。`,String.raw`\(\lim_{x\to0}\frac{\sin 3x}{x}=3\)。先将分母配成 \(3x\)，再提出系数。`,'使用等价无穷小替换前，先确认趋近条件；和或差中的各项不能随意分别替换。'],
  ['calculus','chapter-2','导数与微分',String.raw`若内外层函数均在相应点可导，则 \((f(g(x)))'=f'(g(x))g'(x)\)。`,String.raw`\((\sin(x^2))'=2x\cos(x^2)\)。`,'复合函数求导要乘上内层导数；某点连续不保证该点可导。'],
  ['calculus','chapter-3','中值定理与导数应用',String.raw`若 \(f\) 在 \([a,b]\) 连续、在 \((a,b)\) 可导且 \(a<b\)，存在 \(\xi\in(a,b)\)，使 \(f(b)-f(a)=f'(\xi)(b-a)\)。`,String.raw`对 \(f(x)=x^2\) 在 \([0,2]\) 使用拉格朗日中值定理，得到 \(\xi=1\)。`,'先检查定理条件；驻点只是极值候选点，还需结合导数变号或其他判别。'],
  ['calculus','chapter-4','积分及其应用',String.raw`若 \(f\) 在 \([a,b]\) 连续且 \(F'=f\)，则 \(\int_a^b f(x)\,dx=F(b)-F(a)\)。`,String.raw`\(\int_0^1 2x\,dx=[x^2]_0^1=1\)。`,'不定积分要保留积分常数；定积分换元时须同时变换上下限，或换回原变量后再代入。'],
  ['calculus','chapter-5','无穷级数',String.raw`当 \(|r|<1\) 时，\(\sum_{n=0}^{\infty}r^n=\frac1{1-r}\)。`,String.raw`\(1+\frac12+\frac14+\cdots=2\)。`,'通项趋于零只是级数收敛的必要条件；幂级数收敛区间的端点要单独检验。'],
  ['calculus','chapter-6','空间解析几何与向量代数',String.raw`对非零向量，\(\cos\theta=\frac{\mathbf a\cdot\mathbf b}{\|\mathbf a\|\|\mathbf b\|}\)。`,String.raw`\((1,0,0)\cdot(0,1,0)=0\)，两非零向量垂直。`,'求夹角前确认向量非零；直线的方向向量与平面的法向量承担不同角色。'],
  ['calculus','chapter-7','多元函数微分学',String.raw`若 \(z=f(x,y)\) 在该点可微，则 \(dz=f_x\,dx+f_y\,dy\)。`,String.raw`若 \(z=x^2y\)，则 \(dz=2xy\,dx+x^2\,dy\)。`,'偏导数存在不保证可微；复合函数求偏导要梳理每一条变量依赖路径。'],
  ['calculus','chapter-8','多重积分',String.raw`极坐标变换 \(x=r\cos\theta,\ y=r\sin\theta\) 的面积元为 \(dx\,dy=r\,dr\,d\theta\)。`,String.raw`半径为 \(a>0\) 的圆盘面积为 \(\int_0^{2\pi}\int_0^a r\,dr\,d\theta=\pi a^2\)。`,'变量替换要同时变换积分区域和面积元；极坐标不能漏掉雅可比因子 r。'],
  ['calculus','chapter-9','曲线积分与曲面积分',String.raw`若 \(P,Q\) 在包含区域 \(D\) 的开集上有连续一阶偏导，边界分段光滑且取正向，则 \(\oint_{\partial D}P\,dx+Q\,dy=\iint_D(Q_x-P_y)\,dx\,dy\)。`,String.raw`圆周 \(x^2+y^2=R^2\) 取逆时针方向时，\(\oint(-y/2)\,dx+(x/2)\,dy=\pi R^2\)。`,'使用格林公式先检查区域内有无奇点及边界方向；有孔区域的内边界方向与外边界相反。'],
  ['calculus','chapter-10','微分方程',String.raw`对连续函数 \(p,q\)，方程 \(y'+p(x)y=q(x)\) 的积分因子可取 \(\mu(x)=e^{\int p(x)\,dx}\)，于是 \((\mu y)'=\mu q\)。`,String.raw`\(y'=2y\) 的通解为 \(y=Ce^{2x}\)。`,'分离变量时若除以含 y 的因子，须补查使该因子为零的常值解。'],
  ['linear','linear-chapter-1','行列式',String.raw`\(\begin{vmatrix}a&b\\c&d\end{vmatrix}=ad-bc\)。交换两行变号；一行乘 \(k\) 时行列式也乘 \(k\)。`,String.raw`\(\begin{vmatrix}1&2\\3&4\end{vmatrix}=-2\)。`,'行列式通常不能按矩阵加法拆开；按一行或一列的线性性展开时，其余行或列必须保持不变。'],
  ['linear','linear-chapter-2','矩阵及其运算',String.raw`若方阵 \(A,B\) 均可逆，则 \((AB)^{-1}=B^{-1}A^{-1}\)。`,String.raw`\(\operatorname{diag}(2,3)^{-1}=\operatorname{diag}(1/2,1/3)\)。`,'矩阵乘法通常不交换；约去矩阵因子前要确认相应逆矩阵存在。'],
  ['linear','linear-chapter-3','向量组与矩阵的秩',String.raw`矩阵的秩等于行阶梯形矩阵的非零行数，也等于主元数。`,String.raw`\(\begin{pmatrix}1&2\\2&4\end{pmatrix}\) 的秩为 1，因为第二行是第一行的两倍。`,'计算秩可用初等变换；寻找原列向量组的极大无关组时，应返回原矩阵中对应主元的列。'],
  ['linear','linear-chapter-4','特征值与相似对角化',String.raw`特征向量满足 \(Av=\lambda v,\ v\ne0\)。\(n\) 阶矩阵可对角化当且仅当它有 \(n\) 个线性无关的特征向量。`,String.raw`\(A=\operatorname{diag}(2,3)\) 的两个标准基向量分别对应特征值 2 和 3。`,'有重特征值时，须检查对应特征空间维数；仅求出全部特征值还不足以断定可对角化。'],
  ['linear','linear-chapter-5','二次型',String.raw`对实对称矩阵 \(A\)，二次型 \(x^TAx\) 正定当且仅当所有顺序主子式均为正。`,String.raw`\(x^2+2xy+2y^2=(x+y)^2+y^2\)，对非零向量严格为正。`,'写二次型矩阵时，交叉项系数要在两个对称位置各分一半；正定判别使用实对称矩阵。'],
  ['linear','linear-chapter-6','线性方程组',String.raw`\(Ax=b\) 有解当且仅当 \(r(A)=r([A\mid b])\)；有解时，若秩等于未知数个数则解唯一，否则有无穷多解。`,String.raw`\(x+y=1,\ 2x+2y=2\) 有无穷多解，可写为 \((x,y)=(1-t,t)\)。`,'齐次方程组总有零解；问非零解时，应比较系数矩阵的秩与未知数个数。'],
  ['linear','linear-chapter-7','线性空间与线性变换',String.raw`对有限维空间上的线性映射 \(T:V\to W\)，\(\dim\ker T+\dim\operatorname{im}T=\dim V\)。`,String.raw`\(T(x,y)=(x,0)\) 的核为 y 轴，像为 x 轴，两者维数均为 1。`,'先验证线性性，再讨论核、像和矩阵表示；表示矩阵依赖于所选的基。'],
].map(([subjectId,chapterId,title,formula,example,warning]) => ({subjectId,chapterId,title,formula,example,warning}));

export function referencePage(bank, query) {
  const subject = query.get('subject') || '', chapter = query.get('chapter') || '';
  const rows = mathReferences.filter(r => (!subject || r.subjectId===subject) && (!chapter || r.chapterId===chapter));
  return `${head('数学章节速查', '编辑整理的公式、例题与易错提醒，作为原资料之外的学习补充。', '<a class="btn" href="#/knowledge">学习资料</a>')}<nav class="reference-tabs"><a class="btn" href="#/reference">全部章节</a>${bank.subjects.map(s=>`<a class="btn" href="#/reference?subject=${encodeURIComponent(s.id)}">${esc(s.name)}</a>`).join('')}</nav><p class="format-note">覆盖高等数学与线性代数 17 个大章。每张卡片选取一个代表性主题，不能替代该章全部知识；使用公式前请核对适用条件。</p><div class="reference-grid">${rows.map(row=>`<section class="card reference-card"><h2>${esc(row.title)}</h2><h3>关键公式与条件</h3><div class="rich" data-rich="${attr('<p>'+esc(row.formula)+'</p>')}"></div><h3>小例题</h3><div class="rich" data-rich="${attr('<p>'+esc(row.example)+'</p>')}"></div><h3>易错提醒</h3><p>${esc(row.warning)}</p><a class="btn small" href="#/practice?subject=${row.subjectId}&chapter=${row.chapterId}">练习本章题目</a></section>`).join('')}</div>${rows.length?'':'<section class="card study-empty">没有找到对应的速查卡片。</section>'}`;
}
