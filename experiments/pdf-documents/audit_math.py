"""Independently recompute supported scalar limits and definite integrals.

This is a screening aid for the OCR review draft, not an all-question proof.
Unsupported syntax, missing source evidence, and timeouts always abstain.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import re
import signal
import time

ROOT=Path(__file__).resolve().parents[2]
MATH=re.compile(r'\\\(([\s\S]*?)\\\)')


def normalize(tex):
    tex=tex.replace('−','-').replace('→',r'\to ').replace('∞',r'\infty ')
    # Older exports spell operator names as separate upright letters.
    tex=re.sub(r'\\mathrm\s*\{\s*([A-Za-z])\s*\}',r'\1',tex)
    for word in ['arctan','arcsin','arccos','sin','cos','tan','cot','ln','lim','log']:
        tex=re.sub(r'(?<![A-Za-z\\])'+r'\s*'.join(word)+r'(?![A-Za-z])',lambda m:'\\'+word+' ',tex)
    tex=re.sub(r'\\operatorname\*?\s*\{\s*([A-Za-z]+)\s*\}',lambda m:'\\'+m[1]+' ',tex)
    tex=re.sub(r'\\(?:displaystyle|textstyle|bigl|bigr|Bigl|Bigr|big|Big|left|right|quad|qquad)\b','',tex)
    tex=re.sub(r'\\[,;! ]',' ',tex)
    tex=re.sub(r'\\(?:dfrac|tfrac)\b',r'\\frac',tex)
    tex=re.sub(r'(?<=\d)\s+(?=\d)','',tex)
    return tex.strip().rstrip(';,，；。').strip()


def timeout(*_):raise TimeoutError('symbolic screening time limit')


def check(job):
    import sympy as s
    from sympy.parsing.latex import parse_latex
    qid,stem,options,answer=job
    row={'questionId':qid,'status':'unsupported'}
    expressions=MATH.findall(stem)
    if len(expressions)!=1:return row
    tex=normalize(expressions[0])
    if not re.match(r'^\s*\\(?:lim|int)(?=[\s_{])',tex):return row
    # Conditions outside the expression require separate mathematical review.
    outside=MATH.sub('',stem)
    if re.search('[\u3400-\u9fff]',re.sub(r'求极限|计算极限|求积分|计算积分|求定积分|计算定积分|求|计算|极限|定积分|的值|等于|则|为|是','',outside)):return row
    tex=tex.split('=')[0].strip() if '=' in tex else tex
    # Remove terminal empty brackets; never strip numeric intervals.
    tex=re.sub(r'[\[(]\s*[\])]\s*[.,。]?\s*$','',tex).strip().rstrip('.。')
    signal.signal(signal.SIGALRM,timeout);signal.setitimer(signal.ITIMER_REAL,2)
    try:
        expr=parse_latex(tex,strict=True)
        if not isinstance(expr,(s.Limit,s.Integral)):return row
        if expr.has(s.Integral) and any(len(limit)!=3 for integral in expr.atoms(s.Integral) for limit in integral.limits):return row
        if expr.has(s.Limit):
            _,var,point,direction=expr.args
            result=expr.doit()
            explicit_side = bool(re.search(r'\\to[^}]*\^\s*(?:\{\s*)?[+-]', tex))
            if point not in (s.oo,-s.oo) and not explicit_side:
                other=s.Limit(expr.args[0],var,point,dir='-').doit()
                difference=s.simplify(result-other)
                if difference != 0 and difference.is_number and difference.is_zero is False:
                    row.update(status='two-sided-limit-does-not-exist',expression=tex)
                    return row
                if difference != 0:
                    row.update(status='abstained',reason='left/right equality not proved')
                    return row
        else:result=expr.doit()
        if result.has(s.Integral,s.Limit,s.AccumBounds) or result.free_symbols or result in (s.nan,s.zoo):return row
        parsed={}
        for letter,option in options.items():
            matches=MATH.findall(option)
            if len(matches)!=1 or re.search('[\u3400-\u9fff]',MATH.sub('',option)):continue
            value=parse_latex(normalize(matches[0]).strip().rstrip('.'),strict=True)
            if value.free_symbols or isinstance(value,(s.Equality,s.Rel)):continue
            parsed[letter]=value
        correct=[letter for letter,value in parsed.items() if value==result or (value.is_finite and result.is_finite and s.simplify(s.expand_log((value-result).rewrite(s.log),force=True))==0)]
        if len(parsed)!=len(options):
            row.update(status='incomplete-option-parse',expression=tex,result=str(result),parsedOptions=list(parsed));return row
        row.update(status='matches-draft-answer' if correct==[answer] else 'candidate-mismatch',expression=tex,result=str(result),matchingOptions=correct,referenceAnswer=answer,
                   method='sympy-exact-limit-or-integral-with-strict-full-input-parse')
        return row
    except (Exception,KeyboardInterrupt) as error:
        row.update(status='abstained',reason=type(error).__name__)
        return row
    finally:signal.setitimer(signal.ITIMER_REAL,0)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--workers',type=int,default=4);args=parser.parse_args()
    bank=json.loads((ROOT/'dist/data/bank.json').read_text())
    review=json.loads((ROOT/'artifacts/pdf-transcription/unified-review.json').read_text())['questions']
    jobs=[(q['id'],review[q['id']]['parts']['stem']['text'],{o['id']:review[q['id']]['parts']['option-'+o['id']]['text'] for o in q['options']},q['answer']) for q in bank['questions']]
    results=[];started=time.monotonic()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for i,row in enumerate(pool.map(check,jobs,chunksize=8),1):
            results.append(row)
            if i%500==0:print(json.dumps({'processed':i,'total':len(jobs),'seconds':round(time.monotonic()-started,1)}),flush=True)
    from collections import Counter
    output={'bankRevision':bank['revision'],'summary':dict(Counter(r['status'] for r in results)),'questions':results}
    (ROOT/'artifacts/question-math-screening.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(output['summary']),flush=True)


if __name__=='__main__':main()
