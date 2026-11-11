"""Recover original glyph identities, layout, and repeated-formula aliases."""
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import statistics
import re

import fitz
from extract import dark, within
from glyphs import GlyphMatcher, CACHE, ROOT

LABEL_FILE=CACHE/'verified-glyph-labels.json'
VERIFIED_LABELS=json.loads(LABEL_FILE.read_text()) if LABEL_FILE.exists() else {}
SPACING_FILE=CACHE/'delimiter-spacing.json'
DELIMITER_SPACING=json.loads(SPACING_FILE.read_text()) if SPACING_FILE.exists() else {}
ROOT_GLYPHS={row['id'] for row in json.loads((CACHE/'glyph-templates.json').read_text())
             if any(label['codepoint']==0x221A for label in row['labels'])}


def flat_tex(glyphs, depth=0):
    """Conservative candidate for one-line expressions and simple scripts.

    A candidate is not approved until independently re-rendered and matched.
    Fractions, matrices, radicals, diagrams, accents, and unknown glyphs abstain.
    """
    if depth > 12 or not glyphs:
        return None
    glyphs=[{**g,'latex':VERIFIED_LABELS.get(str(g.get('glyph')),g.get('latex'))} for g in glyphs]
    if any(g.get('glyph') in ROOT_GLYPHS for g in glyphs):
        working=list(glyphs)
        roots=sorted((g for g in working if g.get('glyph') in ROOT_GLYPHS),
                     key=lambda g:g['bbox'][0],reverse=True)
        for radical in roots:
            if radical not in working:continue
            rx0,ry0,rx1,ry1=radical['bbox'];em=radical.get('em',0)
            if not em:continue
            bars=[g for g in working if g.get('glyph')=='rule'
                  and abs(g['bbox'][0]-rx1)<em*.25 and abs(g['bbox'][1]-ry0)<em*.15]
            if not bars:continue
            bar=min(bars,key=lambda g:abs(g['bbox'][1]-ry0));bx0,by0,bx1,by1=bar['bbox']
            body=[g for g in working if g is not bar and g is not radical
                  and bx0-em*.08<=(g['bbox'][0]+g['bbox'][2])/2<=bx1+em*.08
                  and by0-em*.05<=(g['bbox'][1]+g['bbox'][3])/2<=ry1+em*.15]
            inner=flat_tex(body,depth+1)
            if inner is None:continue
            bases=[g for g in body if g.get('em',0)>em*.85]
            inner_bars=[g for g in body if g.get('glyph')=='rule']
            if bases:baseline=statistics.median(g['baseline'] for g in bases)
            elif inner_bars:
                axis=max(inner_bars,key=lambda g:g['bbox'][2]-g['bbox'][0])['bbox']
                baseline=(axis[1]+axis[3])/2+em*.25
            else:continue
            members=body+[bar,radical];first=min(working.index(g) for g in members)
            bbox=[min(g['bbox'][0] for g in members),min(g['bbox'][1] for g in members),
                  max(g['bbox'][2] for g in members),max(g['bbox'][3] for g in members)]
            working=[g for g in working if g not in members]
            working.insert(first,{'latex':r'\sqrt{'+inner+'}','em':em,'baseline':baseline,'bbox':bbox})
        glyphs=working
    # Collapse a fraction only when both numerator and denominator occupy the
    # original rule's horizontal extent. The later contour audit must still pass.
    if any(g.get('glyph') == 'rule' for g in glyphs):
        working = list(glyphs)
        rules = sorted((g for g in working if g.get('glyph') == 'rule'),
                       key=lambda g: g['bbox'][2] - g['bbox'][0])
        for rule in rules:
            if rule not in working:
                continue
            x0,y0,x1,y1 = rule['bbox']
            inferred_em = (y1-y0) / .06
            if inferred_em <= 0:
                return None
            top, bottom = [], []
            for glyph in working:
                if glyph is rule:
                    continue
                box = glyph['bbox']
                cx,cy = (box[0]+box[2])/2,(box[1]+box[3])/2
                if x0-inferred_em*.08 <= cx <= x1+inferred_em*.08:
                    if y0-inferred_em*3 < cy < y0:
                        top.append(glyph)
                    elif y1 < cy < y1+inferred_em*3:
                        bottom.append(glyph)
            if not top or not bottom:
                continue
            numerator, denominator = flat_tex(top, depth+1), flat_tex(bottom, depth+1)
            if numerator is None or denominator is None:
                continue
            display = max(g.get('em',0) for g in top+bottom) > inferred_em*.85
            latex = ('\\dfrac' if display else '\\frac') + '{' + numerator + '}{' + denominator + '}'
            members = top + bottom + [rule]
            first = min(working.index(g) for g in members)
            bounds = [min(g['bbox'][0] for g in members),min(g['bbox'][1] for g in members),
                      max(g['bbox'][2] for g in members),max(g['bbox'][3] for g in members)]
            replacement = {'latex':latex,'em':inferred_em,
                           'baseline':(y0+y1)/2+inferred_em*.25,'bbox':bounds}
            working = [g for g in working if g not in members]
            working.insert(first,replacement)
        if any(g.get('glyph') == 'rule' for g in working):
            return None
        glyphs = working
    if any(not g.get('latex') or not g.get('em') for g in glyphs):
        return None
    em = max(g['em'] for g in glyphs)
    bases = [g for g in glyphs if g['em'] > em * .9]
    baseline = statistics.median(g['baseline'] for g in bases)
    if max(abs(g['baseline'] - baseline) for g in bases) > em * .15:
        return None
    result = []
    i = 0
    while i < len(glyphs):
        glyph = glyphs[i]
        if glyph['em'] > em * .9:
            if i:
                key=str(glyphs[i-1].get('glyph'))+':'+str(glyph.get('glyph'))
                if key in DELIMITER_SPACING:
                    gap=(glyph['bbox'][0]-glyphs[i-1]['bbox'][2])/em
                    extra=gap-DELIMITER_SPACING[key]
                    if extra>.15:result.append(r'\hspace{'+str(round(extra,4))+'em}')
                elif (glyphs[i-1]['latex'],glyph['latex']) in {('[',']'),('(',')'),(r'\{',r'\}')}:
                    if glyph['bbox'][0]-glyphs[i-1]['bbox'][2] > em*.7:result.append(r'\quad')
            result.append(glyph['latex'])
            i += 1
            continue
        if not result:
            return None
        upper = glyph['baseline'] < baseline - em * .15
        lower = glyph['baseline'] > baseline + em * .1
        if not upper and not lower:
            return None
        group = []
        while i < len(glyphs) and glyphs[i]['em'] < em * .9:
            current_upper = glyphs[i]['baseline'] < baseline - em * .15
            if current_upper != upper:
                break
            group.append(glyphs[i])
            i += 1
        script = flat_tex(group, depth+1)
        if script is None:
            return None
        result.append(('^' if upper else '_') + '{' + script + '}')
    text=' '.join(result)
    for name in ['arcsin','arccos','arctan','sinh','cosh','tanh','sin','cos','tan','cot','sec','csc',
                 'log','ln','lim','max','min','det','ker','dim','rank','sh','ch','th']:
        pattern=r'\s*'.join(re.escape(r'\mathrm{'+letter+'}') for letter in name)
        command=('\\'+name) if name not in {'rank','sh','ch','th'} else r'\operatorname{'+name+'}'
        text=re.sub(pattern,lambda _:command,text)
    if r'\{' in text and r'\}' in text and text.count('|')==1:
        text=text.replace('|',r'\mid')
    return text


def extract_shapes():
    extraction = json.loads((CACHE / 'extraction.json').read_text())
    groups = defaultdict(lambda: defaultdict(list))
    for formula in extraction['formulas']:
        location = formula['locations'][0]
        groups[location['documentId']][location['page'] - 1].append((formula, location))
    matcher = GlyphMatcher()
    records, aliases, direct = {}, {}, {}
    signature_to_id = {}
    output = CACHE / 'source-glyphs.jsonl'
    with output.open('w', encoding='utf-8') as stream:
        for docno, document in enumerate(extraction['documents'], 1):
            did = document['documentId']
            with fitz.open(ROOT / document['source']['path']) as pdf:
                for pi, formulas in groups[did].items():
                    drawings = [d for d in pdf[pi].get_drawings() if dark(d)]
                    for formula, location in formulas:
                        region = fitz.Rect(location['bbox']) + (-.001, -.001, .001, .001)
                        selected = [d for d in drawings if within(d['rect'], region)]
                        count_matches = len(selected) == formula['pathCount']
                        # Chrome may emit the fill and stroke of one glyph as two
                        # paths; the stroke is not an additional mathematical symbol.
                        fills = [d['rect'] for d in selected if d.get('fill') is not None]
                        selected = [d for d in selected if not (
                            d['type'] == 's' and any(
                                max(abs(a-b) for a,b in zip(d['rect'], rect)) < .003
                                for rect in fills))]
                        glyphs = []
                        for drawing in selected:
                            match = matcher.identify(drawing)
                            glyphs.append({**match, 'bbox': [round(v, 5) for v in drawing['rect']]})
                        unknown = sum(g['glyph'] is None for g in glyphs)
                        record = {'id': formula['id'], 'glyphs': glyphs,
                                  'pathCountMatches': count_matches, 'unknownGlyphs': unknown,
                                  'location': location}
                        stream.write(json.dumps(record, ensure_ascii=False) + '\n')
                        if count_matches and not unknown and glyphs:
                            signature = [(g['glyph'], *[round((v - (region.x0 if n % 2 == 0 else region.y0)) / region.height, 3)
                                                       for n, v in enumerate(g['bbox'])]) for g in glyphs]
                            digest = hashlib.sha256(json.dumps(signature).encode()).hexdigest()
                            canonical = signature_to_id.setdefault(digest, formula['id'])
                            aliases[formula['id']] = canonical
                            candidate = flat_tex(glyphs)
                            if candidate:
                                direct[formula['id']] = candidate
                        records[formula['id']] = {'unknownGlyphs': unknown,
                                                  'pathCountMatches': count_matches}
            stream.flush()
            print(json.dumps({'documents': docno, 'formulas': len(records),
                              'directCandidates': len(direct),
                              'distinctShapes': len(set(aliases.values()))}), flush=True)
    (CACHE / 'formula-aliases.json').write_text(json.dumps(aliases), encoding='utf-8')
    (CACHE / 'direct-candidates.json').write_text(json.dumps(direct, ensure_ascii=False), encoding='utf-8')
    (CACHE / 'source-glyph-summary.json').write_text(json.dumps(records), encoding='utf-8')


if __name__ == '__main__':
    extract_shapes()
