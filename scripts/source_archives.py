"""Immutable provenance for math originals removed after transcription.

The archive manifest only applies to registered mathematical PDF/HTML sources.
It never permits missing reading materials. A local ignored copy is optional
for OCR work; ordinary site builds use checked text and shared figure chunks.
"""
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import quote


def load_archives(root):
    root=Path(root).resolve();manifest=root/'data/archived-math-sources.json'
    if not manifest.exists():return {}
    data=json.loads(manifest.read_text())
    if data.get('format')!='zhixing.archived-math-sources.v1' or not isinstance(data.get('sources'),list):
        raise ValueError('数学原件归档清单格式错误')
    known={}
    catalog=json.loads((root/'data/catalog.json').read_text())
    math_paths={d['path'] for s in catalog['subjects'] for c in s['chapters'] for d in c['documents']}
    inventory=root/'data/pdf-inventory.json'
    if inventory.exists():known.update({r['path']:r['sha256'] for r in json.loads(inventory.read_text()) if r['path'] in math_paths})
    supplements=root/'data/supplement-sources.json'
    if supplements.exists():known.update({r['path']:r['sha256'] for r in json.loads(supplements.read_text())['sources']})
    result={}
    for entry in data['sources']:
        relative=Path(entry.get('path',''));commit=entry.get('commit','');digest=entry.get('sha256','')
        if (relative.is_absolute() or '..' in relative.parts or not relative.parts
                or relative.parts[0]!='question-bank' or relative.suffix.lower() not in {'.pdf','.html'}
                or relative.as_posix()!=entry.get('path') or entry['path'] in result
                or not re.fullmatch(r'[a-f0-9]{40}',commit) or not re.fullmatch(r'[a-f0-9]{64}',digest)
                or type(entry.get('bytes')) is not int or entry['bytes']<=0
                or known.get(entry['path'])!=digest):
            raise ValueError('数学原件归档登记无效：'+str(entry.get('path')))
        result[entry['path']]=entry
    return result


def verify_source(root,relative,expected):
    path=Path(root)/relative
    if path.is_file():
        if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
            raise ValueError('原始资料校验失败：'+relative)
        return
    archived=load_archives(root).get(relative)
    if not archived or archived['sha256']!=expected:
        raise ValueError('原始资料未保留且缺少匹配的归档登记：'+relative)


def source_url(root,relative,page=None,archives=None):
    archived=(load_archives(root) if archives is None else archives).get(relative)
    ref=archived['commit'] if archived else 'main'
    url='https://github.com/PilotMiku/KnowActAcademy/blob/'+ref+'/'+quote(relative,safe='/')
    return url+('#page='+str(page) if page is not None else '')


def local_source_path(root,relative):
    root=Path(root);path=root/relative
    if path.is_file():return path
    archived=load_archives(root).get(relative)
    if archived:
        cached=root/'.cache/source-archives'/archived['commit']/relative
        if cached.is_file() and hashlib.sha256(cached.read_bytes()).hexdigest()==archived['sha256']:return cached
    raise FileNotFoundError('原件已从当前分支移除；请从归档提交恢复到本地缓存后执行 OCR：'+relative)


if __name__=='__main__':
    import argparse
    import subprocess
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--restore-local',action='store_true',required=True,help='从本地 Git 历史恢复到被忽略的 OCR 缓存，不加入当前分支')
    parser.parse_args();root=Path(__file__).resolve().parents[1];entries=load_archives(root)
    for relative,entry in entries.items():
        target=root/'.cache/source-archives'/entry['commit']/relative
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==entry['sha256']:continue
        result=subprocess.run(['git','show',entry['commit']+':'+relative],cwd=root,capture_output=True)
        if result.returncode:
            raise SystemExit('本地没有归档提交，请先运行 git fetch origin '+entry['commit'])
        if hashlib.sha256(result.stdout).hexdigest()!=entry['sha256']:raise SystemExit('历史原件摘要不符：'+relative)
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(result.stdout)
    print(f'{len(entries)} 份原件已准备在 .cache/source-archives/，未重新加入当前分支。')
