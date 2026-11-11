"""Normalize equivalent legacy TeX commands without completing missing math."""
import re


def atom_end(text, start):
    if start >= len(text):raise ValueError('missing TeX argument')
    if text[start] == '{':
        depth=1;index=start+1
        while index<len(text):
            if text[index]=='\\':
                match=re.match(r'\\(?:[A-Za-z]+|.)',text[index:]);index+=len(match[0]);continue
            if text[index]=='{':depth+=1
            elif text[index]=='}':
                depth-=1
                if depth==0:return index+1
            index+=1
        raise ValueError('unclosed TeX argument')
    if text[start]=='\\':
        match=re.match(r'\\(?:[A-Za-z]+|.)',text[start:])
        return start+len(match[0])
    return start+1


def normalize(text):
    # Plain TeX's \root degree \of atom is equivalent to LaTeX's \sqrt[degree]{atom}.
    # Do not add closing groups, change signs or guess missing operands.
    text=re.sub(r'\\hfill\b',r'\\quad',text)
    index=0
    while True:
        match=re.search(r'\\root\b',text[index:])
        if not match:break
        start=index+match.start();degree_start=index+match.end()
        end=re.search(r'\\of\b',text[degree_start:])
        if not end:break
        degree=text[degree_start:degree_start+end.start()].strip()
        body_start=degree_start+end.end()
        while body_start<len(text) and text[body_start].isspace():body_start+=1
        try:body_end=atom_end(text,body_start)
        except ValueError:index=body_start;continue
        if not degree or '\\root' in degree or '}' in degree.strip('{}'):
            index=body_start;continue
        body=text[body_start:body_end]
        if not body.startswith('{'):body='{'+body+'}'
        replacement=r'\sqrt['+degree+']'+body
        text=text[:start]+replacement+text[body_end:];index=start+len(r'\sqrt[')+len(degree)+1
    def operator(match):
        name=re.sub(r'\s','',match[2])
        if name in {'sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','ln','log','lim','det','rank','dim','ker','sh','ch','th'}:
            return r'\operatorname'+match[1]+'{'+name+'}'
        return match[0]
    return re.sub(r'\\operatorname(\*?)\s*\{([^{}]*)\}',operator,text)
