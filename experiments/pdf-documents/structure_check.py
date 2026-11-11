"""Check symbol identities and mathematical grouping across layout changes.

Only delimiter size variants may have different glyph outlines. Font levels,
baseline rows, left-to-right order within a row, and each fraction/root rule's
scope must agree. This permits harmless spacing changes while rejecting changed
scripts, fraction denominators, radical scope, and matrix dimensions.
"""
import json
import re
import numpy as np
from glyphs import CACHE

LABELS=json.loads((CACHE/'verified-glyph-labels.json').read_text())
EQUIVALENCE_FILE=CACHE/'glyph-equivalences.json'
EQUIVALENCES=json.loads(EQUIVALENCE_FILE.read_text()) if EQUIVALENCE_FILE.exists() else {'aliases':{},'equivalentContours':[]}
ALIASES=EQUIVALENCES['aliases'];AMBIGUOUS={gid for group in EQUIVALENCES['equivalentContours'] for gid in group}
DELIMITER=re.compile(r'^(?:\\(?:bigg|Bigg|big|Big))?([()\[\]]|\\[{}]|\\(?:langle|rangle|lfloor|rfloor|lceil|rceil|vert|Vert))$')


def delimiter(glyph):
    match=DELIMITER.fullmatch(LABELS.get(str(glyph['glyph']),''))
    return match[1] if match else None


def rows(glyphs,indices,em):
    groups=[];assignment={}
    for index in sorted(indices,key=lambda i:glyphs[i]['baseline']):
        value=glyphs[index]['baseline']/em
        if not groups or value-groups[-1][0]>.18:groups.append((value,[]))
        groups[-1][1].append(index);assignment[index]=len(groups)-1
    return assignment


def check_ordered(source,rendered):
    if len(source)!=len(rendered) or not source:return {'passed':False}
    for a,b in zip(source,rendered):
        if a['glyph'] is None or b['glyph'] is None:return {'passed':False}
        equivalent=ALIASES.get(str(a['glyph']),a['glyph'])==ALIASES.get(str(b['glyph']),b['glyph'])
        if not equivalent and not (delimiter(a) and delimiter(a)==delimiter(b)):
            return {'passed':False}
    indices=[i for i,(a,b) in enumerate(zip(source,rendered)) if a.get('em') and b.get('em')
             and not delimiter(a) and a['glyph'] not in AMBIGUOUS and b['glyph'] not in AMBIGUOUS]
    if not indices:return {'passed':False}
    se=max(source[i]['em'] for i in indices);re=max(rendered[i]['em'] for i in indices)
    size_error=max(abs(source[i]['em']/se-rendered[i]['em']/re) for i in indices)
    if size_error>.035:return {'passed':False}
    sr,rr=rows(source,indices,se),rows(rendered,indices,re)
    if sr!=rr:return {'passed':False}
    # Dot/bullet font outlines can be identical after scaling. Their actual
    # size and position against a nonambiguous baseline must still agree.
    for index,(a,b) in enumerate(zip(source,rendered)):
        if a['glyph'] not in AMBIGUOUS and b['glyph'] not in AMBIGUOUS:continue
        if delimiter(a):continue
        metrics=[]
        for glyphs,glyph,em,assignment in [(source,a,se,sr),(rendered,b,re,rr)]:
            x0,y0,x1,y1=glyph['bbox'];cy=(y0+y1)/2
            anchor=min(indices,key=lambda i:abs(cy-glyphs[i]['baseline']))
            metrics.append(((x1-x0)/em,(y1-y0)/em,(cy-glyphs[anchor]['baseline'])/em,assignment[anchor]))
        if metrics[0][3]!=metrics[1][3] or max(abs(a-b) for a,b in zip(metrics[0][:3],metrics[1][:3]))>.06:
            return {'passed':False}
    # Baseline clusters preserve script and matrix row membership. Within each
    # row, glyph order must remain spatially consistent as well as draw order.
    for row in set(sr.values()):
        members=[i for i in indices if sr[i]==row]
        for left,right in zip(members,members[1:]):
            dxs=(source[right]['bbox'][0]-source[left]['bbox'][0])/se
            dxr=(rendered[right]['bbox'][0]-rendered[left]['bbox'][0])/re
            if (dxs>.15 and dxr<-.15) or (dxs<-.15 and dxr>.15):return {'passed':False}
    for index in indices:
        if source[index]['em']/se>.9:continue
        attachments=[]
        for glyphs,em in [(source,se),(rendered,re)]:
            glyph=glyphs[index];x=glyph['bbox'][0];baseline=glyph['baseline']
            bigger=[j for j in indices if glyphs[j]['em']>glyph['em']*1.1
                    and abs(glyphs[j]['baseline']-baseline)<em*1.5]
            left=[j for j in bigger if glyphs[j]['bbox'][0]<=x+em*.05]
            if left:anchor=min(left,key=lambda j:abs(x-glyphs[j]['bbox'][2]))
            elif bigger:anchor=min(bigger,key=lambda j:abs(x-glyphs[j]['bbox'][0]))
            else:anchor=None
            attachments.append(anchor)
        if attachments[0]!=attachments[1]:return {'passed':False}
    # A matching character sequence alone does not prove fraction/root scope.
    # Compare which nearby symbols lie above/below and inside each source rule.
    for index,a in enumerate(source):
        if a['glyph'] not in {'rule','vertical-rule'}:continue
        b=rendered[index]
        scopes=[]
        for glyphs,rule,em in [(source,a,se),(rendered,b,re)]:
            x0,y0,x1,y1=rule['bbox'];scope=[]
            for j in indices:
                x=(glyphs[j]['bbox'][0]+glyphs[j]['bbox'][2])/2
                y=(glyphs[j]['bbox'][1]+glyphs[j]['bbox'][3])/2
                if a['glyph']=='rule':
                    near=abs(y-(y0+y1)/2)<em*3
                    inside=x0-em*.06<=x<=x1+em*.06
                    side=-1 if y<(y0+y1)/2 else 1
                else:
                    near=abs(x-(x0+x1)/2)<em*3
                    inside=y0-em*.06<=y<=y1+em*.06
                    side=-1 if x<(x0+x1)/2 else 1
                if near and inside:scope.append((j,side))
            scopes.append(scope)
        if scopes[0]!=scopes[1]:return {'passed':False}
    return {'passed':True,'reason':None,'structureEquivalent':True,
            'sizeError':round(size_error,5),'baselineRows':len(set(sr.values()))}


def spatial_order(glyphs):
    anchors=[g for g in glyphs if g.get('em') and g['glyph'] not in AMBIGUOUS and not delimiter(g)]
    if not anchors:return glyphs
    em=max(g['em'] for g in anchors)
    positions=[]
    for i,glyph in enumerate(glyphs):
        cy=(glyph['bbox'][1]+glyph['bbox'][3])/2
        if glyph.get('em') and glyph['glyph'] not in AMBIGUOUS:baseline=glyph['baseline']
        elif glyph['glyph'] in AMBIGUOUS:baseline=min(anchors,key=lambda g:abs(cy-g['baseline']))['baseline']
        else:baseline=cy
        positions.append((i,baseline))
    clusters={};level=-1;start=None
    for i,y in sorted(positions,key=lambda pair:pair[1]):
        if start is None or y-start>em*.18:level+=1;start=y
        clusters[i]=level
    return [glyphs[i] for i in sorted(range(len(glyphs)),key=lambda i:(clusters[i],glyphs[i]['bbox'][0],glyphs[i]['bbox'][1]))]


def check(source,rendered):
    result=check_ordered(source,rendered)
    if result['passed']:return result
    # Browser/PDF and SVG emit scripts and rules in different paint orders.
    # Match spatial reading order, then rerun all grouping/attachment checks.
    result=check_ordered(spatial_order(source),spatial_order(rendered))
    if result['passed']:result['paintOrderIndependent']=True
    return result
