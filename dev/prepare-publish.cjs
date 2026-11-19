'use strict';
// Explicit publication allowlist. Never traverses signing/tools/research/distribution folders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'publish');fs.mkdirSync(out,{recursive:true});
const selected=new Set(['.gitattributes','.gitignore','README.md','README_AR.md','README_EN.md','CONTRIBUTING.md','DATA_SOURCES.md','TEST_REPORT.md','index.html','test.html']);
const folders=['android','assets','data','dev','licenses','docs','.github','services','optimize'];
const tracked=execFileSync('git',['ls-files','--cached','-z','--',...folders],{cwd:root,encoding:'utf8'});
const excluded=/(?:^|\/)(?:build|dist|history|node_modules|\.netlify|\.android-signing|\.android-tools)(?:\/|$)|(?:^|\/)(?:\.env(?:\.|$)|\.npmrc$|password\.txt$|tree\.json$)|\.(?:apk|zip|p12|pfx|jks|keystore|key|pem|pyc|tgz)$|(?:bridge|tv-settings|control-center)-test-results\.json$/i;
for(const file of tracked.split('\0'))if(file&&!excluded.test(file)&&fs.existsSync(path.join(root,file)))selected.add(file);
// These named public additions are also needed when preparing a working-tree export before a commit.
const publicAdditions=['docs/DEVELOPMENT.md','docs/SETUP_EN.md','docs/PROJECT_NOTES_AR.md',
  'dev/capture-readme.cjs','dev/preview-file.cjs',
  'dev/prayer-context.js','dev/prayer-display.css','dev/test-prayer-context.cjs',
  'dev/phone-settings.js','dev/test-phone-settings.cjs',
  'android/src/sa/mosque/display/PhoneApproval.java','android/tests/PhoneApprovalTest.java',
  'android/src/sa/mosque/display/AndroidPhonePlatform.java','android/tests/PhoneServerTest.java',
  'android/test-phone-pairing.cjs','android/test-phone-client.cjs',
  ...['display-ar','display-en','prayer-mode','setup-ar','control-center-ar'].map(name=>'docs/images/'+name+'.webp')];
for(const file of publicAdditions)if(fs.existsSync(path.join(root,file)))selected.add(file);
const paths=Array.from(selected).sort();
for(const generated of ['assets/data/location-catalog.js','data/location-catalog.json']){const index=paths.indexOf(generated);if(index>=0)paths.splice(index,1);}
const manifest=[],text=[],binary=[];
for(const file of paths){
  if(/(^|\/)(\.android-signing|\.android-tools|\.git|research|publish|third-party|qa)(\/|$)/.test(file))throw Error('Forbidden publication path '+file);
  const input=path.join(fs.realpathSync(root),file);
  if(fs.realpathSync(input)!==input||!fs.lstatSync(input).isFile())throw Error('Expected a regular public source file: '+file);
  const bytes=fs.readFileSync(input);const decoded=bytes.toString('utf8');
  const item={path:file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};manifest.push(item);
  if(!Buffer.from(decoded,'utf8').equals(bytes)||bytes.includes(0))binary.push({...item,base64:bytes.toString('base64')});
  else text.push({path:file,mode:'100644',type:'blob',content:decoded});
}
const payload={text,binary};fs.writeFileSync(path.join(out,'source-tree-payload.b64'),Buffer.from(JSON.stringify(payload)).toString('base64'));
fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({files:manifest.length,text:text.length,binary:binary.length,sourceBytes:manifest.reduce((n,f)=>n+f.bytes,0),transferChars:fs.statSync(path.join(out,'source-tree-payload.b64')).size}));
