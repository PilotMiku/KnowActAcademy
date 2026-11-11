"""Compare mathematical structure, option permutations and answer content.

Chinese-only similarity is a review hint. Automatic matches require identical
MathML structure for the stem and all four options, with the correct option
mapped by content. Fractions, roots and script grouping remain structural.
"""
from collections import Counter,defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'.cache/pdf-transcription'
OUTPUT=ROOT/'artifacts/pdf-transcription'
MATH=re.compile(r'\\\((.*?)\\\)',re.S)


def canonical(node):
    tag=node.tag.rsplit('}',1)[-1]
    if tag=='merror':
        raise ValueError('Formula contains error or prose')
    if tag=='mtext':return text_items(node.text or '')
    if tag in {'mspace','annotation','annotation-xml'}:return []
    if tag in {'math','mrow','mstyle','semantics','TeXAtom'}:
        return coalesce([item for child in node for item in canonical(child)])
    if tag in {'mi','mn','mo'}:
        text=unicodedata.normalize('NFKC',node.text or '').replace('−','-').replace('\u2061','').replace('∣','|').replace('∥','‖')
        text=re.sub(r'\s+','',text)
        if not text.strip():return []
        variant=node.get('mathvariant')
        # Upright / italic typefaces do not change variable names; keep the
        # bold, double-struck, calligraphic etc. distinctions used for vectors.
        return [(tag,text,variant if variant not in {None,'normal','italic'} else '')]
    children=[canonical(child) for child in node]
    if tag in {'munder','mover','munderover'} and children and children[0] and children[0][0][0] in {'mi','mo'}:
        if children[0][0][1] in {'lim','max','min','sup','inf','∫','∬','∭','∮','∑','∏'}:
            tag={'munder':'msub','mover':'msup','munderover':'msubsup'}[tag]
    return [(tag,*children)]


def coalesce(items):
    result=[]
    for item in items:
        if item[0]=='mn' and result and result[-1][0]=='mn' and item[2]==result[-1][2]:
            result[-1]=('mn',result[-1][1]+item[1],item[2])
        else:result.append(item)
    decimal=[];i=0
    while i<len(result):
        if i+2<len(result) and result[i][0]=='mn' and result[i+1][:2] in [('mo','.'),['mo','.']] and result[i+2][0]=='mn':
            decimal.append(('mn',result[i][1]+'.'+result[i+2][1],result[i][2]));i+=3
        else:decimal.append(result[i]);i+=1
    result=[];i=0
    names=['arcsin','arccos','arctan','sinh','cosh','tanh','rank','sin','cos','tan','cot','sec','csc','log','lim','max','min','det','dim','ln','sh','ch','th']
    while i<len(decimal):
        matched=False
        for name in names:
            group=decimal[i:i+len(name)]
            if len(group)==len(name) and all(item[0]=='mi' and item[1]==char and item[2]=='' for item,char in zip(group,name)):
                result.append(('mi',name,''));i+=len(name);matched=True;break
        if not matched:result.append(decimal[i]);i+=1
    return result


def native_key(value,formulas):
    result=[];end=0
    for match in MATH.finditer(value):
        result.extend(text_items(value[end:match.start()]))
        math=formulas.get(match[1])
        if math is None:return None
        # Empty answer brackets may be text or math in the two exports.
        if math not in [[["mo","[",""],["mo","]",""]],
                        [["mo","(",""],["mo",")",""]]]:
            result.extend(math)
        end=match.end()
    result.extend(text_items(value[end:]))
    if '[公式待转写]' in value or not result:return None
    # Coalesce adjacent text and mathematical rows across harmless OCR boxes.
    merged=[]
    for item in result:
        if item[0]=='text' and merged and merged[-1][0]=='text':merged[-1]=('text',merged[-1][1]+item[1])
        else:merged.append(item)
    cleaned=[];i=0
    while i<len(merged):
        item=merged[i]
        if item[:2] in [('mo','.'),['mo','.'],('mo',','),['mo',','],('mo',';'),['mo',';'],('mo',':'),['mo',':']] and (i+1==len(merged) or merged[i+1][0]=='text'):
            i+=1;continue
        if i+1<len(merged) and item[:2] in [('mo','['),['mo','['],('mo','('),['mo','(']] and merged[i+1][:2] in [('mo',']'),['mo',']'],('mo',')'),['mo',')']]:
            i+=2;continue
        if item[:2] in [('mo','['),['mo','[']] and all(v[0]=='text' for v in merged[i+1:]):
            i+=1;continue
        cleaned.append(item);i+=1
    return json.dumps(cleaned,ensure_ascii=False,separators=(',',':'))


def plain(text):
    text=unicodedata.normalize('NFKC',text)
    text=re.sub(r'(?<=\d)\.(?=\d)','\u2024',text)
    text=re.sub(r'(?<=\d),(?=\d)','\u201a',text)
    return re.sub(r'[\s，,。.;；:：、()（）\[\]【】［］『』「」]','',text)


def text_items(value):
    result=[]
    value=re.sub(r'[\[［【『]\s*(?:[1Il一]\s*)?[.。]?\s*$','',value)
    for match in re.finditer(r'[0-9]+(?:[\u2024\u201a][0-9]+)*|[A-Za-z]|[^A-Za-z0-9]+',plain(value)):
        word=match[0]
        if word[0].isdigit():result.append(('mn',word.replace('\u2024','.').replace('\u201a',','),''))
        elif word.isascii() and word.isalpha():result.append(('mi',word,''))
        else:result.append(('text',word))
    return result


def normalize_cached(value):
    if isinstance(value,list):
        if value and value[0] in ('mi','mn','mo'):
            return [value[0],re.sub(r'\s+','',value[1]),value[2]]
        result=[normalize_cached(v) for v in value]
        if result and result[0] in ('munder','mover','munderover') and result[1] and result[1][0][0] in {'mi','mo'}:
            if result[1][0][1] in {'lim','max','min','sup','inf','∫','∬','∭','∮','∑','∏'}:
                result[0]={'munder':'msub','mover':'msup','munderover':'msubsup'}[result[0]]
        return coalesce(result) if not result or isinstance(result[0],(list,tuple)) else result
    return value


def typography_key(key):
    if key is None:return None
    def walk(value):
        if isinstance(value,list):
            if len(value)==3 and value[0] in ('mi','mn','mo') and value[2] in {'bold','bold-italic'}:
                return [value[0],value[1],'']
            return [walk(v) for v in value]
        return value
    return json.dumps(walk(json.loads(key)),ensure_ascii=False,separators=(',',':'))


def section_key(q):
    name=q.get('chapterLabel') or Path(q['source']['file']).stem
    number=re.match(r'\d+(?:\.\d+)+',name)
    return (q['subjectId'],number[0] if number else re.sub(r'[\s、，,]','',name))


def load_formulas(questions):
    target=CACHE/'semantic-formulas-v5.jsonl';formulas={}
    previous=CACHE/'semantic-formulas-v4.jsonl'
    if not target.exists() and previous.exists():
        with target.open('w') as output:
            for line in previous.open():
                row=json.loads(line)
                if row.get('structure') is None:continue
                row['structure']=normalize_cached(row['structure']);output.write(json.dumps(row,ensure_ascii=False)+'\n')
    if target.exists():
        for line in target.open():
            row=json.loads(line);formulas[row['text']]=row.get('structure')
    requested={m[1] for q in questions for value in [q['stem']]+[o['text'] for o in q['options']] for m in MATH.finditer(value)}
    pending=sorted(requested-set(formulas));print(json.dumps({'semanticFormulasCached':len(formulas),'pending':len(pending)}),flush=True)
    process=subprocess.Popen(['node',str(ROOT/'experiments/pdf-documents/mathjax.cjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
    try:
        with target.open('a') as stream:
            for i,text in enumerate(pending,1):
                process.stdin.write(json.dumps({'id':i,'text':text,'mathml':True})+'\n');process.stdin.flush()
                row=json.loads(process.stdout.readline());structure=None
                try:
                    if 'mathml' in row:structure=canonical(ET.fromstring(row['mathml']))
                except (ValueError,ET.ParseError):pass
                # A JSON round trip fixes tuple/list consistency with the cache.
                structure=json.loads(json.dumps(structure))
                formulas[text]=structure;stream.write(json.dumps({'text':text,'structure':structure},ensure_ascii=False)+'\n')
                if i%1000==0:stream.flush();print(json.dumps({'semanticFormulasProcessed':i,'total':len(pending)}),flush=True)
    finally:process.stdin.close();process.wait()
    return formulas


def compare():
    original=json.loads((OUTPUT/'original-native-draft.json').read_text())['questions']
    supplementary=json.loads((OUTPUT/'supplement-native-draft.json').read_text())['questions']
    formulas=load_formulas(original+supplementary)
    originals=defaultdict(list);supplements=defaultdict(list);keys={};typographic=defaultdict(list)
    for q in original+supplementary:
        key=native_key(q['stem'],formulas)
        option_keys=[native_key(o['text'],formulas) for o in q['options']]
        keys[q['id']]={'stem':key,'options':option_keys}
        if key:(originals if not q['id'].startswith('sup-') else supplements)[(q['subjectId'],key)].append(q)
        if key and not q['id'].startswith('sup-'):typographic[(section_key(q),typography_key(key))].append(q)
    matches=[];conflicts=[];ambiguous=[]
    for q in supplementary:
        own=keys[q['id']];candidates=[]
        if not own['stem'] or None in own['options'] or len(set(own['options']))!=4:continue
        for old in originals.get((q['subjectId'],own['stem']),[]):
            other=keys[old['id']]
            if None in other['options'] or set(own['options'])!=set(other['options']):continue
            mapping={old['options'][i]['id']:q['options'][own['options'].index(key)]['id'] for i,key in enumerate(other['options'])}
            record={'originalId':old['id'],'supplementId':q['id'],'optionMapping':mapping,
                    'evidence':'identical-mathematical-structure-stem-and-four-options'}
            if mapping[old['answer']]!=q['answer']:conflicts.append({**record,'issue':'correct-answer-conflict'})
            else:candidates.append(record)
        if not candidates:
            right=[typography_key(key) for key in own['options']]
            if len(set(right))==4:
                for old in typographic.get((section_key(q),typography_key(own['stem'])),[]):
                    other=keys[old['id']];left=[typography_key(key) for key in other['options']]
                    if None in left or len(set(left))!=4 or set(left)!=set(right):continue
                    mapping={old['options'][i]['id']:q['options'][right.index(key)]['id'] for i,key in enumerate(left)}
                    record={'originalId':old['id'],'supplementId':q['id'],'optionMapping':mapping,
                            'evidence':'same-section-identical-content-and-four-distinct-options-font-weight-normalized'}
                    if mapping[old['answer']]==q['answer']:candidates.append(record)
                    elif not any(r['originalId']==old['id'] and r['supplementId']==q['id'] for r in conflicts):
                        conflicts.append({**record,'issue':'correct-answer-conflict'})
        if candidates:
            # Preserve all original IDs; attach a new duplicate source to one.
            match=candidates[0]
            if len(candidates)>1:match['otherOriginalIds']=[r['originalId'] for r in candidates[1:]]
            matches.append(match)
    report={'summary':{'originalQuestions':len(original),'supplementQuestions':len(supplementary),
                       'matchedSupplementQuestions':len(matches),'answerConflicts':len(conflicts),
                       'projectedUnifiedQuestions':len(original)+len(supplementary)-len(matches)},
            'matches':matches,'conflicts':conflicts}
    (OUTPUT/'semantic-comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (CACHE/'question-semantic-keys.json').write_text(json.dumps(keys,ensure_ascii=False))
    print(json.dumps(report['summary'],ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':compare()
