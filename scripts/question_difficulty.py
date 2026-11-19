"""Reproducible practice estimates; source defaults never count as ratings."""
import collections
import html
import json
from pathlib import Path
import re
import argparse
ROOT = Path(__file__).resolve().parents[1]


def readable_text(value, formulas):
    def replace_image(match):
        image = FIGURE.search(match[0])
        return ' ' + (formulas.get(image.groups(), '') if image else '') + ' '

    value = re.sub(r'<img\b[^>]*>', replace_image, value, flags=re.I)
    return html.unescape(re.sub(r'<[^>]*>', ' ', value))


FIGURE = re.compile(r'/question-figure/([a-f0-9]{16})/([a-f0-9]{24})')
METHODS = [
    r'分部积分', r'换元|变量代换', r'洛必达|L.Hospital', r'泰勒|Taylor|麦克劳林',
    r'夹逼', r'中值定理', r'分类讨论|分情况', r'反证|矛盾', r'数学归纳',
    r'正交变换|配方法', r'特征值|特征向量', r'格林|高斯|斯托克斯',
    r'等价无穷小', r'链式法则|复合求导', r'初等变换|行变换', r'展开行列式|余子式',
    r'可分离变量|分离变量', r'比较判别|比值判别|根值判别|交错级数',
]
ADVANCED = r'重积分|曲线积分|曲面积分|幂级数|傅里叶|二次型|特征值|相似对角|微分方程'
INFERENCE = r'充要条件|必要条件|充分条件|任意.{0,35}恒|至少存在|是否存在|有无穷多|有唯一解|讨论|反例|证明|试证|必有|敛散性|收敛域|是否收敛'
PARAMETER = r'取值范围|参数|恒成立|等于多少时|为何值|满足什么|取何值|有解的条件'
RECOGNITION = r'属于|称为|定义为|表示的是|下列.{0,16}(?:正确|错误)|说法|命题|判断|概念'
DIRECT = r'代入|取负|求转置|是几阶|的阶数|求.{0,8}函数值'
PROCEDURE = r'单调|极值|最值|凹凸|拐点|间断|隐函数|积分|导数|中值|递推|近似|曲率|级数|矩阵的秩|逆矩阵|行列式|线性方程|向量组|曲线|曲面|方向导数|梯度'


def estimate(question, formulas):
    topic = ' '.join(question.get('tags', [])[:2])
    stem = readable_text(question['stem'], formulas)
    options = [readable_text(option['text'], formulas) for option in question['options']]
    analysis = readable_text(question.get('analysis', ''), formulas)
    score, reasons = 1.0, []
    if re.search(ADVANCED, topic):
        score += .55
        reasons.append('涉及进阶章节方法')

    inference = bool(re.search(INFERENCE, stem))
    parameter = bool(re.search(PARAMETER, stem))
    cases = bool(re.search(r'分段|分情况|分类讨论', stem + analysis) or
                 (re.search(r'\\begin\s*\{cases\}', stem) and '方程组' not in stem))
    if inference:
        score += 1.25
        reasons.append('需要判断条件或进行论证')
    if parameter:
        score += 1.15
        reasons.append('需要确定参数或成立范围')
    if cases:
        score += .9
        reasons.append('涉及分段或分类处理')

    compact_math = re.sub(r'\\(?:mathrm|operatorname)\*?\s*\{\s*([a-z]+)\s*\}', r' \1 ', stem)
    compact_math = re.sub(r'\b(l)\s+(i)\s+(m)\b', 'lim', compact_math)
    compact_math = re.sub(r'\b(l)\s+(n)\b', 'ln', compact_math)
    operators = {'∫': 'int', '∑': 'sum', '∬': 'iint', '∭': 'iiint'}
    operations = {name for symbol, name in operators.items() if symbol in stem}
    operations.update(re.findall(r'(?<![a-zA-Z])(?:lim|ln|log|sin|cos|tan|det)\b', compact_math))
    operations.update(re.findall(r'\\(?:int|iint|iiint|sum|lim|frac|sqrt|ln|log|sin|cos|tan|det|partial|prod|arctan)\b', stem))
    matrix = bool(re.search(r'\\begin\s*\{[bpvBV]?matrix\}', stem))
    steps = len(re.findall(r'[=⇒⇔]|\\(?:Rightarrow|Longrightarrow|therefore|implies)\b', analysis))
    methods = sum(bool(re.search(pattern, analysis)) for pattern in METHODS)
    if len(operations) >= 2 or matrix:
        score += .85
        reasons.append('题干含复合运算或矩阵运算')
    if steps >= 8 or methods >= 2:
        score += 1.75
        reasons.append('解析有较长推导或涉及多种方法')
    elif steps >= 4 or methods or len(operations) >= 3:
        score += .8
        reasons.append('需要选用方法或进行多步运算')

    statements = sum(bool(re.search(INFERENCE, option)) for option in options)
    if statements >= 2:
        score += .65
        reasons.append('多个选项需要分别检验')
    recognition = bool(re.search(RECOGNITION, stem))
    routine = not (inference or parameter or cases or statements or methods or steps >= 4 or len(operations) >= 2)
    if routine and (recognition or re.search(r'定义|初等函数|基本公式|简单性质', topic)):
        score -= .7
        reasons.append('主要考查基础概念、基本公式或直接应用')

    # A missing transcription reduces confidence, never adds difficulty.
    original = question['stem'] + ''.join(option['text'] for option in question['options'])
    formula_ids = FIGURE.findall(original)
    limited = any(key not in formulas for key in formula_ids) and routine and not operations and not matrix
    if limited:
        if recognition:
            score = .75 if re.search(r'概念|定义|性质', topic) else 1.5
        elif re.search(DIRECT, stem):
            score = 1.45 + (.75 if re.search(ADVANCED, topic) else 0)
        else:
            score = 2.05 if re.search(PROCEDURE + '|' + ADVANCED, topic) else 1.65
        reasons.append('部分数学条件仅见于原图，难度暂估')

    stars = 1 + sum(score >= threshold for threshold in (.85, 1.85, 2.65, 3.75))
    return stars, '；'.join(reasons or ['主要是代入、单步计算或常规应用'])


def publish(check=False):
    bank = json.loads((ROOT/'dist/data/bank.json').read_text())
    formula_records = json.loads((ROOT/'data/readable-formulas.json').read_text())['records']
    formulas = {(row['version'], key): row['latex'] for key, row in formula_records.items()
                if row['review'] == 'visually-checked-original'}
    sources, reasons, records = [], [], {}
    for q in bank['questions']:
        stars, reason = estimate(q, formulas)
        source = [q['source']['sha256'], q['source']['format']]
        if source not in sources: sources.append(source)
        if reason not in reasons: reasons.append(reason)
        records[q['id']] = [stars, reasons.index(reason), sources.index(source)]
    content = '// Generated by scripts/question_difficulty.py; estimates, not calibrated exam ratings.\n'
    for name, value in [('sources', sources), ('reasons', reasons), ('ratings', records)]:
        content += 'const '+name+' = '+json.dumps(value, ensure_ascii=False, separators=(',', ':'))+';\n'
    content += """export function estimatedDifficulty(q) {
  const row = Object.hasOwn(ratings, q.id) ? ratings[q.id] : null;
  if (!row) return null;
  const source = sources[row[2]];
  if (q.source?.format !== source[1] || (q.source?.sha256 ? q.source.sha256 !== source[0] : !q.contentChunk)) return null;
  return { stars:row[0], reason:reasons[row[1]], origin:reasons[row[1]].includes('难度暂估') ? '自动初评 · 低置信度' : '自动初评' };
}
"""
    target = ROOT/'dist/question-difficulty.mjs'
    if check:
        if not target.exists() or target.read_text() != content:
            raise ValueError('难度初评与题库不一致，请运行 scripts/question_difficulty.py')
    else:
        target.write_text(content)
    return dict(collections.Counter(row[0] for row in records.values()))

if __name__ == '__main__':
    parser = argparse.ArgumentParser();parser.add_argument('--check', action='store_true')
    print(publish(parser.parse_args().check))
