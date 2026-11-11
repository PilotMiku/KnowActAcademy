"""Find font glyphs with exactly the same normalized printed contour."""
from collections import defaultdict
import json
import numpy as np
from glyphs import CACHE


def main():
    groups=defaultdict(list);aliases={};members=defaultdict(list)
    for glyph in json.loads((CACHE/'glyph-templates.json').read_text()):
        values=np.array(glyph['values']);key=(glyph['kinds'],len(values));canonical=glyph['id']
        for other,vector in groups[key]:
            if abs(other['ratio']-glyph['ratio'])<.0001 and np.max(np.abs(vector-values))<.0001:
                canonical=aliases[str(other['id'])];break
        groups[key].append((glyph,values));aliases[str(glyph['id'])]=canonical;members[canonical].append(glyph['id'])
    ambiguous=[ids for ids in members.values() if len(ids)>1]
    (CACHE/'glyph-equivalences.json').write_text(json.dumps({'aliases':aliases,'equivalentContours':ambiguous}))
    print(json.dumps({'equivalentContourGroups':len(ambiguous),'glyphsInEquivalentGroups':sum(map(len,ambiguous))}))


if __name__=='__main__':main()
