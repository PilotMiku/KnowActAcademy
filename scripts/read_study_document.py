"""Convert supplied text-only Word documents to reading HTML, preserving order and breaks.

This is a web reading representation; the original file remains the layout authority.
Unsupported embedded content fails explicitly instead of silently disappearing.
"""
import html
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def read_docx(path):
    with ZipFile(path) as archive:
        document = ET.fromstring(archive.read('word/document.xml'))
        relationships = ET.fromstring(archive.read('word/_rels/document.xml.rels')) if 'word/_rels/document.xml.rels' in archive.namelist() else []
        links = {r.get('Id'): r.get('Target') for r in relationships if r.get('TargetMode') == 'External'}
    if any(document.find('.//' + W + tag) is not None for tag in ('drawing', 'pict', 'object', 'altChunk', 'numPr')):
        raise ValueError('Word 文档包含尚未支持的图片、对象或自动编号，请先转换或补充转换支持：' + str(path))

    def inline(node):
        if node.tag == W + 't':
            return html.escape(node.text or '')
        if node.tag == W + 'tab':
            return '\t'
        if node.tag == W + 'br':
            return '' if node.get(W + 'type') == 'page' else '<br>'
        if node.tag == W + 'r':
            text = ''.join(inline(c) for c in node if c.tag != W + 'rPr')
            for prop, tag in [('b', 'strong'), ('i', 'em'), ('u', 'u')]:
                value = node.find(W + 'rPr/' + W + prop)
                if value is not None and value.get(W + 'val') not in {'0', 'false', 'none'}:
                    text = f'<{tag}>{text}</{tag}>'
            return text
        text = ''.join(inline(c) for c in node)
        if node.tag == W + 'hyperlink' and node.get(R + 'id') in links:
            return f'<a href="{html.escape(links[node.get(R + "id")], quote=True)}">{text}</a>'
        return text

    def blocks(parent):
        output = []
        for node in parent:
            if node.tag == W + 'p':
                style_node = node.find(W + 'pPr/' + W + 'pStyle')
                style = style_node.get(W + 'val', '') if style_node is not None else ''
                text = ''.join(inline(c) for c in node if c.tag != W + 'pPr')
                if not re.sub('<[^>]*>', '', text).strip():
                    continue
                heading = re.fullmatch(r'Heading([1-6])', style)
                if heading:
                    tag = 'h' + str(min(6, int(heading[1]) + 1))
                    output.append(f'<{tag}>{text}</{tag}>')
                elif style in {'CodeBlock', 'CodeSnippet'}:
                    output.append('<pre><code>' + text.replace('<br>', '\n') + '</code></pre>')
                elif style.startswith('List'):
                    tag = 'ol' if style == 'ListNumber' else 'ul'
                    # Adjacent Word list paragraphs form a single list.
                    if output and output[-1].endswith(f'</{tag}>'):
                        output[-1] = output[-1][:-len(f'</{tag}>')] + f'<li>{text}</li></{tag}>'
                    else:
                        output.append(f'<{tag}><li>{text}</li></{tag}>')
                elif style == 'PromptText':
                    output.append(f'<blockquote><p>{text}</p></blockquote>')
                else:
                    output.append(f'<p>{text}</p>')
            elif node.tag == W + 'tbl':
                rows = []
                for row in node.findall(W + 'tr'):
                    cells = []
                    for cell in row.findall(W + 'tc'):
                        span = cell.find(W + 'tcPr/' + W + 'gridSpan')
                        attr = f' colspan="{int(span.get(W + "val"))}"' if span is not None else ''
                        cells.append(f'<td{attr}>{blocks(cell)}</td>')
                    rows.append('<tr>' + ''.join(cells) + '</tr>')
                output.append('<table><tbody>' + ''.join(rows) + '</tbody></table>')
        return '\n'.join(output)

    return blocks(document.find(W + 'body'))


def read_text(path):
    text = path.read_text(encoding='utf-8-sig')
    # TXT remains literal: commands and angle brackets must never become HTML.
    return '<pre>' + html.escape(text) + '</pre>'
