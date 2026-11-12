"""Recover exact drawing groups when bounding rectangles overlap other math."""
from collections import defaultdict
import json
from extract import local_source_path
import fitz

from extract import page_events,within
from glyphs import ROOT,CACHE,GlyphMatcher


def bounds(drawings):
    box=fitz.Rect(drawings[0]['rect'])
    for drawing in drawings[1:]:box|=drawing['rect']
    return box


def main():
    path=CACHE/'source-glyphs.jsonl'
    rows=[json.loads(line) for line in path.open()]
    index=json.loads((ROOT/'data/render-index.json').read_text())
    extraction=json.loads((CACHE/'extraction.json').read_text())
    expected={r['id']:r['pathCount'] for r in extraction['formulas']}
    revisions_path=CACHE/'source-revisions.json'
    revisions=json.loads(revisions_path.read_text()) if revisions_path.exists() else {}
    affected=[r for r in rows if not r['pathCountMatches']]
    groups=defaultdict(list)
    for record in affected:groups[record['location']['documentId']].append(record)
    matcher=GlyphMatcher();fixed=unresolved=0;changed={}
    for did,records in groups.items():
        with fitz.open(local_source_path(ROOT,index['documents'][did]['path'])) as pdf:
            pages={};parts={}
            for record in records:
                loc=record['location'];qid=loc['questionId'];part=loc['part'];key=(qid,part)
                if key not in parts:
                    candidates=[]
                    for clip in index['questions'][qid]['parts'][part]:
                        pi=clip['page']
                        if pi not in pages:pages[pi]=page_events(pdf[pi])
                        region=fitz.Rect(clip['rect']);masks=[fitz.Rect(m) for m in clip['hideAnswerLabels']]
                        events=[e for e in pages[pi] if within(e['rect'],region) and not any(within(e['rect'],m) for m in masks)]
                        pending=[]
                        for event in events:
                            if event['kind']=='vector':pending.append(event['drawing'])
                            elif pending:candidates.append((pi,pending));pending=[]
                        if pending:candidates.append((pi,pending))
                    parts[key]=candidates
                matches=[ds for pi,ds in parts[key] if pi==loc['page']-1 and
                         max(abs(a-b) for a,b in zip(bounds(ds),loc['bbox']))<.002]
                if len(matches)!=1 or len(matches[0])!=expected[record['id']]:
                    unresolved+=1;continue
                selected=matches[0];fills=[d['rect'] for d in selected if d.get('fill') is not None]
                selected=[d for d in selected if not (d['type']=='s' and any(
                    max(abs(a-b) for a,b in zip(d['rect'],r))<.003 for r in fills))]
                glyphs=[{**matcher.identify(d),'bbox':[round(v,5) for v in d['rect']]} for d in selected]
                version=revisions.get(record['id'],0)+1
                record.update(glyphs=glyphs,pathCountMatches=True,
                              unknownGlyphs=sum(g['glyph'] is None for g in glyphs),
                              sourceVersion=version,groupEvidence='original-page-event-sequence')
                revisions[record['id']]=version;changed[record['id']]=record;fixed+=1
        print(json.dumps({'fixedSourceGroups':fixed,'unresolved':unresolved}),flush=True)
    temporary=path.with_suffix('.tmp');temporary.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows));temporary.replace(path)
    child_path=CACHE/'compound-glyphs.jsonl'
    if child_path.exists():
        children=[json.loads(l) for l in child_path.open()]
        for child in children:
            if child['parent'] not in changed:continue
            parent=changed[child['parent']];region=fitz.Rect(child['location']['bbox'])
            glyphs=[g for g in parent['glyphs'] if within(fitz.Rect(g['bbox']),region)]
            version=revisions.get(child['id'],0)+1
            child.update(glyphs=glyphs,pathCountMatches=True,sourceVersion=version,
                         unknownGlyphs=sum(g['glyph'] is None for g in glyphs))
            revisions[child['id']]=version
        temporary=child_path.with_suffix('.tmp');temporary.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in children));temporary.replace(child_path)
    revisions_path.write_text(json.dumps(revisions))
    (CACHE/'source-group-repair.json').write_text(json.dumps({'recovered':fixed,'unresolved':unresolved,
                                                             'changedIds':list(changed)}))
    print(json.dumps({'recovered':fixed,'unresolved':unresolved}),flush=True)


if __name__=='__main__':main()
