"""Inventory NEU supplementary HTML exports and decode their embedded originals.

Files contain images rather than mathematical text. Counts and answer evidence
are recorded independently; no OCR output is treated as a verified answer.
"""
import base64
from collections import Counter
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re

from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'.cache/supplement-transcription'


class ExportParser(HTMLParser):
    def __init__(self):
        super().__init__();self.tables=[];self.current=None;self.row=None;self.text=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='table':self.current={'rows':[]}
        elif tag=='tr' and self.current is not None:
            self.row={'correct': 'g' in attrs.get('class','').split(),'images':[]}
        elif tag=='img' and self.row is not None:
            self.row['images'].append(attrs.get('src',''))
    def handle_endtag(self,tag):
        if tag=='tr' and self.current is not None and self.row is not None:
            self.current['rows'].append(self.row);self.row=None
        elif tag=='table' and self.current is not None:
            self.tables.append(self.current);self.current=None
    def handle_data(self,data):
        if re.fullmatch(r'\s*#\d+[^\n]*',data):self.text.append(data.strip())


def inventory():
    CACHE.mkdir(parents=True,exist_ok=True)
    images=CACHE/'images';images.mkdir(exist_ok=True)
    files=[];questions=[];issues=[];image_metadata={}
    for directory in sorted((ROOT/'question-bank').iterdir()):
        if not directory.is_dir() or '补充' not in directory.name:continue
        subject='calculus' if '高数' in directory.name else 'linear'
        for source in sorted(directory.glob('*.html')):
            data=source.read_bytes();parser=ExportParser();parser.feed(data.decode('utf-8-sig'))
            match=re.search(r'\((\d+)题\)',source.stem)
            expected=int(match[1]) if match else None
            relative=source.relative_to(ROOT).as_posix()
            fid='sup-'+hashlib.sha256(relative.encode()).hexdigest()[:12]
            section=re.sub(r'\(\d+题\)$','',source.stem).strip()
            metadata={'id':fid,'path':relative,'sha256':hashlib.sha256(data).hexdigest(),
                      'subjectId':subject,'sectionName':section,'declaredQuestions':expected,
                      'actualQuestions':len(parser.tables),'bytes':len(data)}
            files.append(metadata)
            if expected!=len(parser.tables):
                issues.append({'file':relative,'issue':'title-count-mismatch',
                               'declared':expected,'actual':len(parser.tables)})
            for number,table in enumerate(parser.tables,1):
                rows=[]
                for row in table['rows']:
                    decoded=[]
                    for uri in row['images']:
                        prefix='data:image/'
                        if not uri.startswith(prefix) or ';base64,' not in uri:
                            raise ValueError('Unsupported external image in supplied export: '+relative)
                        payload=base64.b64decode(uri.split(';base64,',1)[1],validate=True)
                        digest=hashlib.sha256(payload).hexdigest()[:24]
                        path=images/(digest+'.png')
                        try:
                            with Image.open(io.BytesIO(payload)) as image:
                                image.load()
                                rgba=image.convert('RGBA');background=Image.new('RGBA',rgba.size,'white')
                                background.alpha_composite(rgba)
                                if not path.exists():background.convert('RGB').save(path)
                                image_metadata[digest]={'id':digest,'width':image.width,'height':image.height,
                                                        'sourceBytes':len(payload)}
                        except Exception as error:
                            issues.append({'file':relative,'question':number,'row':len(rows),
                                           'issue':'undecodable-source-image','imageId':digest,
                                           'sourceBytes':len(payload),'error':str(error)})
                            image_metadata[digest]={'id':digest,'decodeError':True,'sourceBytes':len(payload)}
                        decoded.append(digest)
                    rows.append({'correct':row['correct'],'images':decoded})
                qid=f'{fid}-q{number:04d}'
                correct=[i-1 for i,row in enumerate(rows) if row['correct']]
                sane=len(rows)==6 and len(correct)==1 and 0<=correct[0]<4 and all(len(r['images'])==1 for r in rows)
                if not sane:issues.append({'id':qid,'issue':'nonstandard-question-table',
                                           'rowCount':len(rows),'correctRows':correct})
                questions.append({'id':qid,'documentId':fid,'subjectId':subject,'chapterLabel':section,
                                  'sourceNumber':number,'sourceHeader':parser.text[number-1] if number<=len(parser.text) else None,
                                  'rows':rows,'answerEvidence':correct,'structureVerified':sane})
            print(json.dumps({'file':relative,'questions':len(parser.tables)},ensure_ascii=False),flush=True)
    output={'format':'zhixing.supplement-images.v1','files':files,'questions':questions,
            'images':list(image_metadata.values()),'issues':issues}
    (CACHE/'inventory.json').write_text(json.dumps(output,ensure_ascii=False),encoding='utf-8')
    summary={'files':len(files),'declaredQuestions':sum(f['declaredQuestions'] or 0 for f in files),
             'actualQuestions':len(questions),'uniqueImages':len(image_metadata),
             'bySubject':dict(Counter(q['subjectId'] for q in questions)),
             'issueCounts':dict(Counter(i['issue'] for i in issues)),
             'tableRowCounts':dict(Counter(len(q['rows']) for q in questions))}
    (CACHE/'inventory-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':inventory()
