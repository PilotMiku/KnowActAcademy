"""Identify source MathJax glyphs by their exact original vector contours.

This is independent of OCR confidence. A successful contour match identifies
the printed symbol, including its font variant; it does not validate a formula.
"""
from collections import defaultdict
import hashlib
import html
import json
from pathlib import Path
import unicodedata

import fitz
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/pdf-transcription'


def features(drawing):
    rect = drawing['rect']
    if rect.height < .00001 or rect.width < .00001:
        return None
    values, kinds = [], []
    for item in drawing['items']:
        kinds.append(item[0]+str(item[2]) if item[0]=='re' and len(item)>2 else item[0])
        points=item[1:2] if item[0]=='re' else item[1:]
        for point in points:
            if isinstance(point, fitz.Point):
                values.extend(((point.x - rect.x0) / rect.height,
                               (point.y - rect.y0) / rect.height))
            elif isinstance(point, fitz.Rect):
                values.extend(((point.x0 - rect.x0) / rect.height,
                               (point.y0 - rect.y0) / rect.height,
                               (point.x1 - rect.x0) / rect.height,
                               (point.y1 - rect.y0) / rect.height))
            else:
                return None
    return ''.join(kinds), np.array(values, dtype=np.float32)


def latex_label(entry):
    cp, variant = entry['codepoint'], entry['variant']
    if variant.startswith('-'):
        return None
    char = chr(cp)
    # Prefer ordinary letters in an explicit variant over mathematical Unicode.
    if cp >= 0x1D400:
        return None
    if char in '\\^_$&#%{}':
        char = '\\' + char
    if variant == 'normal':
        if chr(cp).isascii() and chr(cp).isalpha():
            return r'\mathrm{' + char + '}'
        return char
    wrappers = {'italic': None, 'bold': 'mathbf', 'bold-italic': 'boldsymbol',
                'double-struck': 'mathbb', 'fraktur': 'mathfrak',
                'script': 'mathcal', 'sans-serif': 'mathsf', 'monospace': 'mathtt'}
    if variant not in wrappers:
        return None
    wrapper = wrappers[variant]
    return '\\' + wrapper + '{' + char + '}' if wrapper else char


def build():
    entries = json.loads((CACHE / 'glyphs.json').read_text())
    unique = {}
    for entry in entries:
        unique.setdefault(entry['path'], []).append(entry)
    templates = []
    for number, (outline, labels) in enumerate(unique.items()):
        raw = ('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" '
               'viewBox="-200 -1500 2000 3000"><g transform="scale(1,-1)"><path d="'
               + html.escape(outline + 'Z', quote=True) + '"/></g></svg>').encode()
        with fitz.open(stream=raw, filetype='svg') as svg:
            with fitz.open(stream=svg.convert_to_pdf(), filetype='pdf') as pdf:
                drawings = pdf[0].get_drawings()
        if len(drawings) != 1:
            continue
        feature = features(drawings[0])
        if feature is None:
            continue
        choices = [latex_label(label) for label in labels]
        choices = [choice for choice in choices if choice and not any(ord(c) < 32 for c in choice)]
        # Default mathematical italic letters are easier to maintain than a wrapper.
        choices.sort(key=lambda choice: (len(choice), choice))
        templates.append({'id': number, 'kinds': feature[0], 'values': feature[1].tolist(),
                          'labels': labels, 'latex': choices[0] if choices else None,
                          'templateHeight': drawings[0]['rect'].height,
                          'baselineOffset': 150 - drawings[0]['rect'].y0,
                          'ratio': drawings[0]['rect'].width / drawings[0]['rect'].height})
    (CACHE / 'glyph-templates.json').write_text(json.dumps(templates, ensure_ascii=False), encoding='utf-8')
    print('Unique contour templates:', len(templates), flush=True)


class GlyphMatcher:
    def __init__(self):
        self.groups = defaultdict(list)
        self.by_id = {}
        for record in json.loads((CACHE / 'glyph-templates.json').read_text()):
            record['values'] = np.array(record['values'], dtype=np.float32)
            self.groups[(record['kinds'], len(record['values']))].append(record)
            self.by_id[record['id']] = record
        self.cache = {}

    def locate(self, result, rect):
        output = dict(result)
        if isinstance(result.get('glyph'), int) and not result.get('stretched'):
            record = self.by_id[result['glyph']]
            scale = rect.height / record['templateHeight']
            output['em'] = 100 * scale
            output['baseline'] = rect.y0 + record['baselineOffset'] * scale
        return output

    def identify(self, drawing):
        rect = drawing['rect']
        kinds = ''.join(item[0] for item in drawing['items'])
        if rect.height > .00001 and rect.width / rect.height > 5 and kinds in {'re','qu','llll'}:
            return {'glyph': 'rule', 'latex': None}
        if rect.width > .00001 and rect.height / rect.width > 5 and kinds in {'re','qu','llll'}:
            return {'glyph': 'vertical-rule', 'latex': None}
        feature = features(drawing)
        if feature is None:
            return {'glyph': None, 'latex': None}
        kinds, values = feature
        ratio = drawing['rect'].width / drawing['rect'].height
        # A wide rectangle is a fraction/radical rule rather than a font glyph.
        if kinds == 're' and ratio > 5:
            return {'glyph': 'rule', 'latex': None}
        quick = (kinds, len(values), round(ratio, 3), tuple(np.round(values[::max(1,len(values)//16)], 3)))
        if quick in self.cache:
            return self.locate(self.cache[quick], drawing['rect'])
        best, error = None, float('inf')
        for record in self.groups[(kinds, len(values))]:
            if abs(record['ratio'] - ratio) > .003 * max(1, ratio):
                continue
            distance = float(np.max(np.abs(record['values'] - values)))
            if distance < error:
                best, error = record, distance
        tolerance=max(.002,min(.008,.0008/max(rect.height,.001)))
        if best is not None and error < tolerance:
            result = {'glyph': best['id'], 'latex': best['latex'], 'contourError': error}
        else:
            # MathJax stretches delimiter extenders independently in x and y.
            # Match those private/size glyphs after undoing that stretch.
            stretched_values=values.copy();stretched_values[::2]/=ratio
            stretched_best=None;stretched_error=float('inf')
            for record in self.groups[(kinds,len(values))]:
                if not any(label['variant'].startswith('-') or label['codepoint'] in
                           {0x7c,0x2016,0x2212,0x23d0,0x2223,0x2225} for label in record['labels']):continue
                candidate=record['values'].copy();candidate[::2]/=record['ratio']
                distance=float(np.max(np.abs(candidate-stretched_values)))
                if distance<stretched_error:stretched_best,stretched_error=record,distance
            if stretched_best is not None and stretched_error<tolerance:
                result={'glyph':stretched_best['id'],'latex':stretched_best['latex'],
                        'contourError':stretched_error,'stretched':True}
            else:
                result = {'glyph': None, 'latex': None, 'contourError': error if error != float('inf') else None}
        self.cache[quick] = result
        return self.locate(result, drawing['rect'])


if __name__ == '__main__':
    build()
