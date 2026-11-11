// Local MathJax helpers for comparing OCR with the original mathematical glyphs.
const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const lib = (name) => require(path.join(root, '.cache/mathjax/node_modules/mathjax-full/js', name));

if (process.argv[2] === 'glyphs') {
  const {TeXFont} = lib('output/svg/fonts/tex.js');
  const font = new TeXFont(), result = [];
  for (const variant of Object.keys(font.variant)) {
    for (const key of Object.keys(font.variant[variant].chars)) {
      const codepoint = Number(key);
      let data = font.getChar(variant, codepoint);
      let resolved = codepoint;
      if (data?.[3]?.smp) { resolved = data[3].smp; data = font.getChar('normal', resolved); }
      if (data?.[3]?.p) result.push({variant, codepoint, resolved, path: 'M' + data[3].p});
    }
  }
  fs.writeFileSync(path.join(root, '.cache/pdf-transcription/glyphs.json'), JSON.stringify(result));
  console.log(result.length);
} else if (process.argv[2] === 'labels') {
  const {TeX} = lib('input/tex.js');
  const {AllPackages} = lib('input/tex/AllPackages.js');
  const {MapHandler} = lib('input/tex/MapHandler.js');
  new TeX({packages:AllPackages});
  const labels = new Set();
  for (const name of ['mathchar0mi','mathchar0mo','mathchar7','delimiter',
                      'AMSsymbols-mathchar0mi','AMSsymbols-mathchar0mo','AMSsymbols-delimiter']) {
    const map=MapHandler.getMap(name);
    if (!map?.map) continue;
    for (const [macro] of map.map) {
      const tex='\\'+macro; labels.add(tex);labels.add('{\\displaystyle '+tex+'}');
    }
  }
  for (const char of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-=()[]|.,;!/:') {
    labels.add(char);
    for (const command of ['mathrm','mathbf','mathit','boldsymbol','mathbb','mathcal','mathfrak','mathsf','mathtt'])
      labels.add('\\'+command+'{'+char+'}');
  }
  for (const char of '{}%&#_$') labels.add('\\'+char);
  for (const template of JSON.parse(fs.readFileSync(path.join(root,'.cache/pdf-transcription/glyph-templates.json'))))
    if (template.latex) labels.add(template.latex);
  fs.writeFileSync(path.join(root,'.cache/pdf-transcription/glyph-label-candidates.json'),JSON.stringify([...labels]));
  console.log(labels.size);
} else {
  const {mathjax} = lib('mathjax.js');
  const {TeX} = lib('input/tex.js');
  const {SVG} = lib('output/svg.js');
  const {liteAdaptor} = lib('adaptors/liteAdaptor.js');
  const {RegisterHTMLHandler} = lib('handlers/html.js');
  const {AllPackages} = lib('input/tex/AllPackages.js');
  const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
  const {STATE} = lib('core/MathItem.js');
  const {SerializedMmlVisitor} = lib('core/MmlTree/SerializedMmlVisitor.js');
  const visitor = new SerializedMmlVisitor();
  const doc = mathjax.document('', {InputJax: new TeX({packages: AllPackages}),
                                  OutputJax: new SVG({fontCache: 'none'})});
  const lines = readline.createInterface({input: process.stdin});
  lines.on('line', line => {
    const record = JSON.parse(line);
    try {
      if (record.mathml) {
        const tree = doc.convert(record.text, {display: false, end: STATE.COMPILED});
        process.stdout.write(JSON.stringify({id: record.id, mathml: visitor.visitTree(tree)}) + '\n');
        return;
      }
      const node = doc.convert(record.text, {display: false});
      const raw = adaptor.outerHTML(node), svg = raw.match(/<svg[\s\S]*<\/svg>/)?.[0];
      const error = raw.includes('data-mml-node="merror"');
      const mathml = record.includeMathML ? visitor.visitTree(doc.convert(record.text, {display:false,end:STATE.COMPILED})) : undefined;
      process.stdout.write(JSON.stringify({id: record.id, svg, error, mathml}) + '\n');
    } catch (error) { process.stdout.write(JSON.stringify({id: record.id, error: error.message}) + '\n'); }
  });
}
