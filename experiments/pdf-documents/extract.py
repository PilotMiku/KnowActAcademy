"""Extract original text and isolated vector formula regions without rewriting PDFs.

The output is a transcription workspace, never a replacement for the live bank.
Formula crops contain original vectors only, avoiding watermarks and nearby text.
"""
import argparse
from collections import defaultdict
import hashlib
import io
import json
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/pdf-transcription'


def within(rect, region):
    return region.contains(fitz.Point((rect.x0 + rect.x1) / 2,
                                      (rect.y0 + rect.y1) / 2))


def dark(drawing):
    return any(drawing.get(key) is not None
               and max(drawing[key]) < .5
               and drawing.get(opacity, 1) > .5
               for key, opacity in [('fill', 'fill_opacity'), ('color', 'stroke_opacity')])


def formula_image(drawings, page_bitmap=None):
    bounds = fitz.Rect(drawings[0]['rect'])
    for drawing in drawings[1:]:
        bounds |= drawing['rect']
    if page_bitmap is not None:
        # Formula geometry comes from original paths; a hard background cutoff
        # removes the pale export watermark without running Chinese OCR.
        rect = bounds + (-.25, -.25, .25, .25)
        bitmap = page_bitmap.crop(tuple(round(x * 4) for x in rect))
        bitmap = bitmap.point(lambda p: p if p < 180 else 255)
        return normalize_crop(bitmap, bounds)
    # Independent canvas contains only the selected original vector paths.
    offset = fitz.Point(3 - bounds.x0, 3 - bounds.y0)
    with fitz.open() as document:
        page = document.new_page(width=max(8, bounds.width + 6),
                                 height=max(8, bounds.height + 6))
        for drawing in drawings:
            shape = page.new_shape()
            for item in drawing['items']:
                kind = item[0]
                if kind == 'l':
                    shape.draw_line(item[1] + offset, item[2] + offset)
                elif kind == 'c':
                    shape.draw_bezier(*(p + offset for p in item[1:]))
                elif kind == 're':
                    rect = fitz.Rect(item[1])
                    shape.draw_rect(rect + (offset.x, offset.y, offset.x, offset.y))
                elif kind == 'qu':
                    shape.draw_quad(fitz.Quad(*(p + offset for p in item[1])))
                else:
                    raise ValueError('Unsupported PDF path primitive: ' + kind)
            shape.finish(width=drawing.get('width', 0), color=drawing.get('color'),
                         fill=drawing.get('fill'), even_odd=drawing.get('even_odd', False),
                         closePath=drawing.get('closePath', False))
            shape.commit()
        pix = page.get_pixmap(matrix=fitz.Matrix(4, 4), alpha=False)
        bitmap = Image.frombytes('RGB', (pix.width, pix.height), pix.samples).convert('L')
    return normalize_crop(bitmap, bounds)


def normalize_crop(bitmap, bounds):
    ink = bitmap.point(lambda p: 255 if p < 180 else 0).getbbox()
    if not ink:
        raise ValueError('Empty vector formula')
    bitmap = bitmap.crop(ink)
    # Preserve detail in multiline formulas and matrices instead of first
    # shrinking all of their letters into an 80-pixel-high thumbnail.
    target_height = max(80,min(384,bitmap.height))
    bitmap = bitmap.resize((max(1, round(bitmap.width * target_height / bitmap.height)),
                            target_height), Image.Resampling.LANCZOS)
    canvas = Image.new('L', (bitmap.width + 24, bitmap.height + 24), 255)
    canvas.paste(bitmap, (12, 12))
    buffer = io.BytesIO()
    canvas.save(buffer, 'PNG')
    digest = hashlib.sha256(canvas.tobytes() + str(canvas.size).encode()).hexdigest()[:24]
    return digest, bounds, buffer.getvalue()


def page_events(page):
    # get_texttrace() ignores ActualText associated with simulated-bold paths.
    # The regular text extractor recovers those Chinese labels correctly.
    spans = []
    for block in page.get_text('rawdict')['blocks']:
        for line in block.get('lines', []):
            if abs(line['dir'][0] - 1) > .001 or abs(line['dir'][1]) > .001:
                continue
            for span in line['spans']:
                if span.get('color', 0) >= 0xCCCCCC:
                    continue
                # MuPDF merges same-font spans on either side of a vector formula.
                # Split at actual character gaps so the intervening formula survives.
                run = []
                def flush_text():
                    if run and ''.join(c['c'] for c in run).strip():
                        bounds = fitz.Rect(run[0]['bbox'])
                        for char in run[1:]:
                            bounds |= fitz.Rect(char['bbox'])
                        spans.append({'rect': bounds, 'text': ''.join(c['c'] for c in run)})
                    run.clear()
                for char in span['chars']:
                    if run and char['bbox'][0] - run[-1]['bbox'][2] > .5:
                        flush_text()
                    run.append(char)
                flush_text()
    trace_events = []
    for span in page.get_texttrace():
        if abs(span['dir'][0] - 1) > .001 or abs(span['dir'][1]) > .001:
            continue
        if span.get('opacity', 1) <= .5 or span.get('type') == 3:
            continue
        text = ''.join(chr(c[0]) for c in span['chars'])
        if text.strip():
            trace_events.extend({'seqno': span['seqno'], 'rect': fitz.Rect(char[3])}
                                for char in span['chars'])
    drawings = [d for d in page.get_drawings() if dark(d)]
    ink = trace_events + [{'seqno': d['seqno'], 'rect': d['rect']} for d in drawings]
    ink_rows = defaultdict(list)
    for item in ink:
        ink_rows[int((item['rect'].y0 + item['rect'].y1) / 24)].append(item)
    span_rows = defaultdict(list)
    for span in spans:
        for row in range(int(span['rect'].y0 // 12), int(span['rect'].y1 // 12) + 1):
            span_rows[row].append(span)
    events = []
    for span in spans:
        candidates = [item for row in range(int(span['rect'].y0 // 12) - 1,
                                            int(span['rect'].y1 // 12) + 2)
                      for item in ink_rows[row]]
        matching = [item['seqno'] for item in candidates if within(item['rect'], span['rect'])]
        approximate = not matching
        if approximate:
            expanded = span['rect'] + (-1, -1, 1, 1)
            matching = [item['seqno'] for item in candidates if item['rect'].intersects(expanded)]
        if not matching:
            sx, sy = (span['rect'].x0 + span['rect'].x1) / 2, (span['rect'].y0 + span['rect'].y1) / 2
            nearest = min(ink, key=lambda e: abs((e['rect'].y0 + e['rect'].y1) / 2 - sy) * 100
                          + abs((e['rect'].x0 + e['rect'].x1) / 2 - sx))
            matching = [nearest['seqno']]
        events.append({'kind': 'text', 'seqno': min(matching),
                       'orderingApproximate': approximate, **span})
    for drawing in drawings:
        row = int((drawing['rect'].y0 + drawing['rect'].y1) / 24)
        if not any(within(drawing['rect'], span['rect']) for span in span_rows[row]):
            events.append({'kind': 'vector', 'seqno': drawing['seqno'],
                           'rect': drawing['rect'], 'drawing': drawing})
    return sorted(events, key=lambda e: e['seqno'])


def extract(limit=None):
    index = json.loads((ROOT / 'data/render-index.json').read_text())
    baseline=ROOT/'data/pdf-source-bank.json'
    bank = json.loads((baseline if baseline.exists() else ROOT/'dist/data/bank.json').read_text())
    CACHE.mkdir(parents=True, exist_ok=True)
    crops = CACHE / 'crops'
    crops.mkdir(exist_ok=True)
    by_doc = defaultdict(list)
    for question in bank['questions']:
        by_doc[question['source']['documentId']].append(question)
    output, formulas, figures, issues = [], {}, [], []
    for docno, (did, source) in enumerate(index['documents'].items(), 1):
        if limit and docno > limit:
            break
        data = (ROOT / source['path']).read_bytes()
        if hashlib.sha256(data).hexdigest() != source['sha256']:
            raise ValueError('PDF checksum mismatch: ' + source['path'])
        with fitz.open(stream=data, filetype='pdf') as document:
            pages = {}
            records = []
            for question in by_doc[did]:
                parts = {}
                for part, clips in index['questions'][question['id']]['parts'].items():
                    nodes = []
                    for clip in clips:
                        pi = clip['page']
                        if pi not in pages:
                            page = document[pi]
                            pix = page.get_pixmap(matrix=fitz.Matrix(4, 4), colorspace=fitz.csGRAY)
                            pages[pi] = (page_events(page), Image.frombytes('L', (pix.width, pix.height), pix.samples),
                                         page.get_image_info())
                        region = fitz.Rect(clip['rect'])
                        masks = [fitz.Rect(r) for r in clip['hideAnswerLabels']]
                        selected = [e for e in pages[pi][0] if within(e['rect'], region)
                                    and not any(within(e['rect'], m) for m in masks)]
                        pending = []

                        def flush():
                            if not pending:
                                return
                            digest, bounds, png = formula_image(pending, pages[pi][1])
                            crop_path = crops / (digest + '.png')
                            if not crop_path.exists():
                                crop_path.write_bytes(png)
                            location = {'questionId': question['id'], 'part': part,
                                        'documentId': did, 'page': pi + 1,
                                        'bbox': [round(x, 4) for x in bounds]}
                            formulas.setdefault(digest, {'id': digest, 'crop': crop_path.name,
                                                        'locations': [], 'pathCount': len(pending)})['locations'].append(location)
                            nodes.append({'kind': 'formula', 'id': digest, 'page': pi + 1,
                                          'bbox': location['bbox']})
                            pending.clear()

                        for event in selected:
                            if event['kind'] == 'vector':
                                pending.append(event['drawing'])
                            else:
                                flush()
                                nodes.append({'kind': 'text', 'text': event['text'],
                                              'page': pi + 1,
                                              'bbox': [round(x, 4) for x in event['rect']],
                                              'orderingApproximate': event.get('orderingApproximate', False)})
                        flush()
                        for image in pages[pi][2]:
                            if fitz.Rect(image['bbox']).intersects(region):
                                figures.append({'questionId': question['id'], 'part': part,
                                                'page': pi + 1, 'bbox': list(image['bbox'])})
                        if not selected and part != 'analysis':
                            issues.append({'questionId': question['id'], 'part': part,
                                           'issue': 'No text/vector events in source clip'})
                    parts[part] = nodes
                records.append({'id': question['id'], 'parts': parts})
            output.append({'documentId': did, 'source': source, 'questions': records})
        print(json.dumps({'documents': docno, 'questions': sum(len(d['questions']) for d in output),
                          'uniqueFormulas': len(formulas), 'file': source['path']}, ensure_ascii=False), flush=True)
        # Per-document checkpoint supports restart and inspectable partial results.
        (CACHE / 'documents').mkdir(exist_ok=True)
        (CACHE / 'documents' / (did + '.json')).write_text(json.dumps(output[-1], ensure_ascii=False), encoding='utf-8')
    payload = {'sourceRevision': bank['revision'], 'documents': output,
               'formulas': list(formulas.values()), 'figures': figures, 'issues': issues}
    (CACHE / 'extraction.json').write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'documents': len(output), 'questions': sum(len(d['questions']) for d in output),
                      'formulaOccurrences': sum(len(f['locations']) for f in formulas.values()),
                      'uniqueFormulas': len(formulas), 'figures': len(figures), 'issues': len(issues)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--documents', type=int)
    extract(parser.parse_args().documents)
