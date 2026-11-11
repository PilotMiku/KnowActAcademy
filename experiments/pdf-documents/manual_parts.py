"""Visual transcription of all 29 embedded raster parts in the PDF edition.

Diagrams are expressed as explicit geometric conditions where equivalent.
Source errors are recorded, never used to certify a wrong answer.
"""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

TEXTS=[
r'''以函数 \(f(x)=|x|\) 为例，它在 \(x=0\) 处连续，但在该点不可导。
因为 \(f'_+(0)=\lim_{h\to0^+}|h|/h=1\)，\(f'_-(0)=\lim_{h\to0^-}|h|/h=-1\)，左右导数不相等。其图像为顶点在原点的 V 形折线。''',
r'''在区间 \([e,\pi]\) 上对 \(f(x)=\sqrt[3]{x-1}\) 使用拉格朗日中值定理。记 \(m=(\sqrt[3]{\pi-1}-\sqrt[3]{e-1})/(\pi-e)>0\)，则存在 \(\xi\in(e,\pi)\)，使 \(m=f'(\xi)=1/(3\sqrt[3]{(\xi-1)^2})\)。
因此 \(\xi=1+1/\sqrt{27m^3}\)，从而 \(e-1<1/\sqrt{27m^3}<\pi-1\)。原图将解写成 \(1\pm\sqrt{m^3}\)，漏掉了倒数及系数，后文区间还误写为 \([2,1]\)。原选项也须核对，不能据该解析认定原答案正确。''',
r'''取水平薄片，\(0\le y\le4\)，左右边界为 \(x=\pm\sqrt{4-y}\)。绕直线 \(x=3\) 旋转所得圆环的外、内半径分别为 \(3+\sqrt{4-y}\)、\(3-\sqrt{4-y}\)。
\(dV=\pi[(3+\sqrt{4-y})^2-(3-\sqrt{4-y})^2]dy=12\pi\sqrt{4-y}\,dy\)。
所以 \(V=12\pi\int_0^4\sqrt{4-y}\,dy=64\pi\)。''',
r'''圆心为 \((0,5)\)、半径为 \(4\) 的圆，其上、下半圆分别为 \(y_1=5+\sqrt{16-x^2}\)、\(y_2=5-\sqrt{16-x^2}\)，\(-4\le x\le4\)。
绕 \(x\) 轴旋转，\(V=\pi\int_{-4}^4(y_1^2-y_2^2)dx=40\pi\int_0^4\sqrt{16-x^2}\,dx=160\pi^2\)。''',
r'''由 \(y=a\operatorname{ch}(x/a)\)，旋转体体积为 \(V=\pi\int_0^a y^2dx=\pi a^2\int_0^a\operatorname{ch}^2(x/a)dx\)。
令 \(u=x/a\)，则 \(V=\pi a^3\int_0^1[(e^u+e^{-u})/2]^2du=\frac14\pi a^3(2+\operatorname{sh}2)\)。原图换元后的上限仍写成 \(a\)，此处改为 \(1\)。''',
r'''曲线关于 \(y\) 轴对称，\(y=c\operatorname{ch}(x/c)\)，\(y'=\operatorname{sh}(x/c)\)。
弧长微元 \(ds=\sqrt{1+\operatorname{sh}^2(x/c)}dx=\operatorname{ch}(x/c)dx\)。
故 \(s=2\int_0^b\operatorname{ch}(x/c)dx=2c\operatorname{sh}(b/c)\)。''',
r'''以槽底为原点，竖直向上为 \(y\) 轴。横截面斜边满足 \(y=3x\)，高度 \(0\le y\le3\) 处水层宽 \(2y/3\)，槽长 \(20\)。
薄层水的质量为 \(dm=20(2y/3)\rho\,dy\)，提升高度为 \(3-y\)。
\(dW=\frac{40}{3}\rho g\,y(3-y)dy\)，因此 \(W=\frac{40}{3}\rho g\int_0^3y(3-y)dy=60\rho g=5.88\times10^5\,\mathrm J\)。''',
r'''以半球容器的顶面圆心为原点，竖直向下为 \(x\) 轴。深度 \(x\) 处截面积为 \(S(x)=\pi(r^2-x^2)\)，\(0\le x\le r\)。
薄层水重 \(dG=\rho g\pi(r^2-x^2)dx\)，提升高度为 \(x\)。
故 \(W=\rho g\pi\int_0^r(r^2-x^2)x\,dx=\frac14\rho g\pi r^4\)。''',
r'''设气缸内活塞一侧存有定量气体，气体作等温膨胀时推动活塞向右移动一段距离，若气体体积由 \(V_1\) 变至 \(V_2\)，求气体压力所做的功。''',
r'''以井口为原点，竖直向下为 \(x\) 轴，\(x\in[0,5]\)。取深度区间 \([x,x+dx]\) 内的一薄层水，其重力为 \(9.8\pi\cdot3^2dx\)（千牛），提升高度为 \(x\)。
功元素 \(dw=88.2\pi x\,dx\)，故 \(w=\int_0^5 88.2\pi x\,dx=88.2\pi[x^2/2]_0^5\approx3462\)（千焦）。''',
r'''在底面积为 \(S\) 的圆柱形容器中盛有一定量的气体。由于气体膨胀，面积为 \(S\) 的活塞沿轴向从位置 \(a\) 移动到位置 \(b\)。求移动过程中气体压力所作的功。''',
r'''恒温时，压强 \(P\) 与体积 \(V\) 成反比，即 \(P=k/V\)。活塞位于 \(x\) 时，\(V=xS\)，作用力为 \(F=PS=k/x\)。
功元素 \(dW=Fdx=(k/x)dx\)，所求功 \(W=\int_a^b(k/x)dx=k\ln(b/a)\)。原图“成正比”与自身公式矛盾，已更正为“成反比”。''',
r'''建立竖直坐标系，球心为原点，向上为正。球在 \(x\in[-R,R]\) 处的截面积为 \(\pi y^2=\pi(R^2-x^2)\)。
提升到水面前，\(dW_1=(\rho-\rho_0)g\pi(R^2-x^2)(H-R+x)dx\)；提出水面后，\(dW_2=\rho g\pi(R^2-x^2)(R-x)dx\)。
相加得 \(dW=g\pi[(\rho-\rho_0)H+\rho_0(R-x)](R^2-x^2)dx\)。利用奇函数在对称区间积分为零，
\(W=2g\pi[(\rho-\rho_0)H+\rho_0R]\int_0^R(R^2-x^2)dx=\frac43\pi R^3[(\rho-\rho_0)H+\rho_0R]g\)。''',
r'''取图示竖直坐标，\(x\in[0,a]\)，薄片宽为 \(2(a-x)\)，深度为 \(x+2a\)。
面积微元 \(dA=2(a-x)dx\)，压力微元 \(dP=(x+2a)2(a-x)\rho g\,dx\)。
故 \(P=\int_0^a2(x+2a)(a-x)\rho g\,dx=\frac73\rho ga^3\)。''',
r'''在端面建立坐标，取深度 \(x\in[0,R]\) 为积分变量。深度 \(x\) 处压强为 \(p=\rho gx\)，小矩形面积为 \(2\sqrt{R^2-x^2}dx\)。
\(dP=2\rho gx\sqrt{R^2-x^2}dx\)，所以 \(P=\int_0^R2\rho gx\sqrt{R^2-x^2}dx=\frac23\rho gR^3\)。''',
r'''设斜边长为 \(l\)，图示直线方程为 \(y=-x\cot\theta+l\cos\theta\)。
\(P=\rho g\int_0^{l\sin\theta}xy\,dx=\rho g\int_0^{l\sin\theta}(-x^2\cot\theta+lx\cos\theta)dx=\frac{\rho gl^3}{6}\sin^2\theta\cos\theta=\frac{\rho gl^3}{6}(\cos\theta-\cos^3\theta)\)。
令 \(dP/d\theta=0\)，得 \(-\sin\theta+3\cos^2\theta\sin\theta=0\)。因 \(\theta\in(0,\pi/2)\)，唯一驻点为 \(\theta_0=\arccos(\sqrt3/3)\)。由实际意义可知最大值存在，故该驻点即为所求。''',
r'''有一闸门，形状为宽 \(2\,\mathrm m\)、高 \(3\,\mathrm m\) 的竖直长方形；水面距门顶 \(1\,\mathrm m\)。求闸门上所受水的压力。''',
r'''取球心水平面为 \(y=0\)，水面为 \(y=H\)，\(y\in[-R,R]\)。压强 \(p=(H-y)\cdot1\cdot g\)。球面带面积微元
\(dA=2\pi x\sqrt{1+(dx/dy)^2}dy=2\pi x\sqrt{1+(-y/x)^2}dy=2\pi Rdy\)。
故 \(P=\int_{-R}^Rp\,dA=\int_{-R}^R(H-y)g\,2\pi Rdy=4\pi R^2Hg\,\mathrm N\)。
另解：令 \(y=R\sin\theta\)，\(\theta\in[-\pi/2,\pi/2]\)，\(dA=2\pi R^2\cos\theta\,d\theta\)。
\(P=\int_{-\pi/2}^{\pi/2}(H-R\sin\theta)g\,2\pi R^2\cos\theta\,d\theta=4\pi R^2Hg\,\mathrm N\)。这里按原图将液体密度取为 \(1\)。''',
r'''设水面为 \(y\) 轴，原点在圆心，\(x\) 轴竖直向下。半圆形闸门满足 \(x^2+y^2=9\)，\(0\le x\le3\)。
在 \([x,x+dx]\) 内的截面面积为 \(dS=2\sqrt{9-x^2}dx\)，压强为 \(p=\rho gx\)。
\(dF=2\rho gx\sqrt{9-x^2}dx\)，所以 \(F=\int_0^3 2\rho gx\sqrt{9-x^2}dx=-\frac23\rho g[(9-x^2)^{3/2}]_0^3=18\rho g\)。
取 \(\rho=10^3\,\mathrm{kg/m^3}\)，得到 \(F=1.8\times10^4g\,\mathrm N\)。''',
r'''取深度 \(x\in[0,h]\)。由相似三角形 \(b/a=(h-x)/h\)，得薄层宽 \(b=a(h-x)/h\)。
面积微元 \(dA=a(h-x)dx/h\)，压力微元 \(dP=\rho gx\,a(h-x)dx/h\)。
故 \(P=\rho g\int_0^h a(h-x)x\,dx/h=\frac{ah^2}{6}\rho g\)。''',
r'''自地面垂直向上发射火箭，问火箭应达到什么速度才可在无动力的情况下飞离地球？设地球半径为 \(R\)，用 \(r\) 表示火箭到地心的距离，\(x=r-R\) 表示离地高度。''',
r'''以细棒中点为原点，细棒沿 \(x\) 轴从 \(-l/2\) 延伸到 \(l/2\)，质点位于 \((0,a)\)。设质点质量为 \(m\)、细棒线密度为 \(\mu\)、万有引力常量为 \(k\)。
细棒微段对质点的引力大小为 \(dF=km\mu\,dx/(a^2+x^2)\)，其竖直分量为 \(dF_y=-km\mu a\,dx/(a^2+x^2)^{3/2}\)。
利用对称性，水平分量 \(F_x=0\)，\(F_y=-2km\mu a\int_0^{l/2}dx/(a^2+x^2)^{3/2}=-2km\mu l/(a\sqrt{4a^2+l^2})\)。
故引力大小为 \(F=2km\mu l/(a\sqrt{4a^2+l^2})\)，方向垂直于细棒并指向细棒。''',
r'''以细棒中点为原点，细棒沿 \(x\) 轴，质点位于 \((0,a)\)。细棒上微段 \([x,x+dx]\) 对质点的引力为 \(dF=km\mu\,dx/(a^2+x^2)\)。
由对称性 \(F_x=0\)，\(F_y=-2km\mu a\int_0^{l/2}dx/(a^2+x^2)^{3/2}=-2km\mu l/(a\sqrt{4a^2+l^2})\)。
当细棒很长，可视为无限长，即令 \(l\to\infty\)，引力大小为 \(2km\mu/a\)，方向与细棒垂直且指向细棒。''',
r'''令 \(a_n=1/\sqrt[n]{n!}\)。则
\(\frac{a_{n+1}}{a_n}=\frac{(n!)^{1/n}}{((n+1)!)^{1/(n+1)}}=\frac{(n!)^{1/[n(n+1)]}}{(n+1)^{1/(n+1)}}\)。
由 \(1\le n!\le n^n\)，有
\(\frac1{(n+1)^{1/(n+1)}}\le\frac{a_{n+1}}{a_n}\le(\frac n{n+1})^{1/(n+1)}\)。两端均趋于 \(1\)，故比值极限为 \(1\)。
因此幂级数 \(\sum_{n=1}^{\infty}(-1)^n x^n/\sqrt[n]{n!}\) 的收敛半径为 \(1\)。''',
r'''两条对角线 \(AC\)、\(DB\) 相交于中点 \(O\)。利用平行四边形法则，
\(\overrightarrow{AB}=\overrightarrow{AO}+\overrightarrow{OB}=\tfrac12\vec a-\tfrac12\vec b=\tfrac12(\vec a-\vec b)\)。''',
r'''在三角形 \(ABC\) 中，\(D,E,F\) 分别为 \(BC,CA,AB\) 的中点。由三角形法则，
\(\overrightarrow{AB}+\tfrac12\overrightarrow{BC}+\overrightarrow{DA}=\vec0\)，即 \(\overrightarrow{AD}=\vec c+\tfrac12\vec a\)。
同理 \(\overrightarrow{BE}=\vec a+\tfrac12\vec b\)，\(\overrightarrow{CF}=\vec b+\tfrac12\vec c\)。
故 \(\overrightarrow{AD}+\overrightarrow{BE}+\overrightarrow{CF}=\tfrac32(\vec a+\vec b+\vec c)=\vec0\)。''',
r'''设 \(M,N\) 分别为 \(AB,CD\) 的中点，任取原点 \(O\)。
\(\overrightarrow{MN}=\overrightarrow{ON}-\overrightarrow{OM}=\tfrac12(\overrightarrow{OC}+\overrightarrow{OD})-\tfrac12(\overrightarrow{OA}+\overrightarrow{OB})=\tfrac12\overrightarrow{AC}+\tfrac12\overrightarrow{BD}\)。
所以 \(2\overrightarrow{MN}=\overrightarrow{AC}+\overrightarrow{BD}\)。''',
r'''已知 \(\overrightarrow{OA}=\vec a\)、\(\overrightarrow{OB}=\vec b\)，\(D\) 在射线 \(OB\) 上且 \(AD\perp OB\)，记 \(\theta=\angle AOB\in(0,\pi/2)\)。当 \(\theta\) 为［　］时，\(\triangle ODA\) 的面积取得最大值。''',
r'''已知 \(\overrightarrow{OA}=\vec a\)、\(\overrightarrow{OB}=\vec b\)，\(D\) 为 \(A\) 到射线 \(OB\) 的垂足，\(\theta=\angle AOB\in(0,\pi/2)\)。则 \(\triangle ODA\) 的面积为［　］。''',
]


def main():
    source=json.loads((ROOT/'.cache/supplement-transcription/original-raster-parts.json').read_text())['parts']
    assert len(source)==len(TEXTS)==29
    rows={}
    for number,(part,text) in enumerate(zip(source,TEXTS),1):
        image=ROOT/'.cache/supplement-transcription/images'/(part['imageId']+'.png')
        rows[part['imageId']]={'text':text,'status':'manually-reviewed',
                              'sourceQuestionId':part['questionId'],'sourcePart':part['part'],
                              'sourceImageSha256':hashlib.sha256(image.read_bytes()).hexdigest(),
                              'reviewMethod':'visual-source-comparison-and-mathematical-check',
                              'diagramConditionsExpressedInText':True}
        if number in {2,5,12}:rows[part['imageId']]['sourceErratum']=True
        if number==2:rows[part['imageId']]['answerRequiresCorrection']=True
    output=Path(__file__).with_name('manual-parts.json')
    output.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'visuallyReviewedEmbeddedParts':len(rows),'sourceErrata':3}))


if __name__=='__main__':main()
