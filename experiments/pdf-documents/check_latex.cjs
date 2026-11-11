const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const context={module:{exports:{}}};context.exports=context.module.exports;
vm.runInNewContext(fs.readFileSync(path.join(root,'dist/vendor/katex/katex.min.js'),'utf8'),context);
const texts=JSON.parse(fs.readFileSync(0,'utf8')),result={};
for(const text of texts){
  try{context.module.exports.renderToString(text,{throwOnError:true,trust:false,strict:'ignore',maxExpand:500,maxSize:10,output:'mathml'});result[text]=null;}
  catch(error){result[text]=error.message;}
}
process.stdout.write(JSON.stringify(result));
