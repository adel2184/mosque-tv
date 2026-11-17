'use strict';
// Explicit publication allowlist. Never traverses signing/tools/research/distribution folders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'publish');fs.mkdirSync(out,{recursive:true});
const selected=new Set(['.gitignore','README.md','README_AR.md','DATA_SOURCES.md','TEST_REPORT.md','index.html','test.html']);
const add=(folder)=>{for(const item of fs.readdirSync(path.join(root,folder),{withFileTypes:true})){const file=folder+'/'+item.name;if(item.isDirectory()){if(!['build','dist','history'].includes(item.name))add(file);}else if(!/\.(apk|zip|p12|jks|keystore|pyc|tgz)$/i.test(file)&&!/(^|\/)password\.txt$|(?:bridge|tv-settings|control-center)-test-results\.json|\/tree\.json$/.test(file))selected.add(file);}};
for(const folder of ['android','assets','data','dev','licenses','docs','.github'])add(folder);
const paths=Array.from(selected).sort();
for(const generated of ['assets/data/location-catalog.js','data/location-catalog.json']){const index=paths.indexOf(generated);if(index>=0)paths.splice(index,1);}
const manifest=[],text=[],binary=[];
for(const file of paths){
  if(/(^|\/)(\.android-signing|\.android-tools|\.git|research|publish|third-party|qa)(\/|$)/.test(file))throw Error('Forbidden publication path '+file);
  const bytes=fs.readFileSync(path.join(root,file));const decoded=bytes.toString('utf8');
  const item={path:file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};manifest.push(item);
  if(!Buffer.from(decoded,'utf8').equals(bytes)||bytes.includes(0))binary.push({...item,base64:bytes.toString('base64')});
  else text.push({path:file,mode:'100644',type:'blob',content:decoded});
}
const payload={text,binary};fs.writeFileSync(path.join(out,'source-tree-payload.b64'),Buffer.from(JSON.stringify(payload)).toString('base64'));
fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({files:manifest.length,text:text.length,binary:binary.length,sourceBytes:manifest.reduce((n,f)=>n+f.bytes,0),transferChars:fs.statSync(path.join(out,'source-tree-payload.b64')).size}));
