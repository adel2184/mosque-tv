/* Actual release generator, virtual files only: no real APK, feed or key is changed. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'release.cjs'),'utf8');
let count=0;
function run(mutate){
  const files=new Map(),bytes=Buffer.from('fixture APK bytes');
  const report={apk:'mosque-display-tv.apk',package:'sa.mosque.display',minSdk:24,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),signatureVerification:'Verified using v2 scheme (APK Signature Scheme v2): true\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: 4cb9564d63fd3f037d12e2ed98af1bf7255a7fb7ef53d6a57aba020b5e9b061e\n',badging:"package: name='sa.mosque.display' versionCode='3' versionName='2.0.0'\nminSdkVersion:'24'"};
  const manifest='<manifest android:versionCode="3" android:versionName="2.0.0"><uses-sdk android:minSdkVersion="24" /></manifest>';
  if(mutate)mutate(report);
  const virtual={readFileSync(file,encoding){const name=path.basename(file);const value=name==='AndroidManifest.xml'?manifest:name==='build-report.json'?JSON.stringify(report):name==='mosque-display-tv.apk'?bytes:files.get(name);if(value===undefined)throw Error('Unexpected virtual file '+name);return encoding?Buffer.isBuffer(value)?value.toString(encoding):value:Buffer.isBuffer(value)?value:Buffer.from(value);},writeFileSync(file,value){files.set(path.basename(file),value);}};
  const module={exports:{}};
  vm.runInNewContext(source,{require(name){return name==='node:fs'?virtual:require(name);},module,__dirname,process:{env:{}},console:{log(){}},Buffer},{filename:'release.cjs'});
  return {feed:module.exports.generate(__dirname),files};
}
const good=run();if(good.feed.versionCode!==3||good.feed.apk.size!==17||!good.files.has('SHA256SUMS.txt'))throw Error('Valid feed mismatch');count++;
for(const mutate of [r=>r.sha256='0'.repeat(64),r=>r.bytes++,r=>r.signatureVerification=r.signatureVerification.replace('4cb956','000000'),r=>r.badging=r.badging.replace("versionCode='3'","versionCode='2'"),r=>r.signatureVerification=r.signatureVerification.replace('Number of signers: 1','Number of signers: 10')]){let rejected=false;try{run(mutate);}catch(_){rejected=true;}if(!rejected)throw Error('Invalid release accepted');count++;}
console.log('PASS '+count+' release metadata checks');
