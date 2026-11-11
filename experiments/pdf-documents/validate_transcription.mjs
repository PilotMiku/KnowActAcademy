// Run the same KaTeX shipped by the application against every native field.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const directory=path.join(root,'artifacts/pdf-transcription');
const context={module:{exports:{}}};context.exports=context.module.exports;
vm.runInNewContext(fs.readFileSync(path.join(root,'dist/vendor/katex/katex.min.js'),'utf8'),context);
const katex=context.module.exports;
const errors=[],missing=[],seen=new Map();let occurrences=0,questions=0;
for(const filename of ['original-native-draft.json','supplement-native-draft.json']){
 const bank=JSON.parse(fs.readFileSync(path.join(directory,filename),'utf8'));
 for(const q of bank.questions){questions++;
  for(const [part,record]of Object.entries(q.transcription.parts)){
   if(!record.text.trim()&&part!=='analysis')missing.push({questionId:q.id,part,status:record.status});
   for(const match of record.text.matchAll(/\\\(([\s\S]*?)\\\)/g)){
    occurrences++;const text=match[1];let error=seen.get(text);
    if(!seen.has(text)){
     try{katex.renderToString(text,{throwOnError:true,trust:false,strict:'ignore',maxExpand:500,maxSize:10,output:'mathml'});error=null;}
     catch(e){error=e.message;}seen.set(text,error);
    }
    if(error)errors.push({questionId:q.id,part,text,error});
   }
  }
 }
}
const result={questions,formulaOccurrences:occurrences,distinctFormulas:seen.size,
 latexErrorOccurrences:errors.length,emptyRequiredParts:missing.length,errors,missing};
fs.writeFileSync(path.join(directory,'latex-validation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({questions,formulaOccurrences:occurrences,distinctFormulas:seen.size,latexErrors:errors.length,emptyRequiredParts:missing.length}));
