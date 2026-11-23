'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),generator=require('../dev/generate-device-profiles.cjs');
const datasetPath=path.join(root,'android/device-profiles.json'),bytes=fs.readFileSync(datasetPath),data=JSON.parse(bytes),checks=[];
const DATA_SHA='1e29dad1ae1a7d8e572c96caa0fc66c9006ef50dfb84da6f40c8825830251fd1';
function test(name,run){try{run();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}}
function find(dir,name){if(!fs.existsSync(dir))return null;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory()){const found=find(file,name);if(found)return found;}else if(item.name===name)return file;}return null;}
test('Pinned compact catalogue records the upstream data and the previous eligibility baseline',()=>{
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),DATA_SHA);assert.deepEqual(Object.keys(data),['schemaVersion','source','profiles','restoreOnly']);assert.equal(data.schemaVersion,2);assert.deepEqual(data.source,{repository:generator.REPOSITORY,commit:generator.PIN,baselineCommit:generator.BASELINE_PIN,license:'MIT'});assert.equal(data.profiles.length,508);
  const ids=new Set();for(const row of data.profiles){assert.deepEqual(Object.keys(row),['id','brand','osMajor','modelSlug','packages']);assert.match(row.id,/^[a-z0-9][a-z0-9-]{0,127}$/);assert(!ids.has(row.id));ids.add(row.id);assert.equal(typeof row.brand,'string');assert(row.brand.length>0&&row.brand.length<=128);assert(row.osMajor===null||(Number.isInteger(row.osMajor)&&row.osMajor>0&&row.osMajor<100));assert.equal(row.modelSlug,generator.modelSlug(row.id,row.brand));assert(Array.isArray(row.packages));assert.equal(new Set(row.packages).size,row.packages.length);for(const name of row.packages){assert(generator.PACKAGE.test(name));assert(name.length<=255);}}
  assert.equal(data.profiles.reduce((n,row)=>n+row.packages.length,0),8996);assert.equal(data.profiles.filter(row=>row.osMajor===null).length,10);
});
test('Withdrawn names are reserved for recorded recovery and cannot appear in built-in or model suggestions',()=>{
  const active=new Set(data.profiles.flatMap(row=>row.packages));
  const native=fs.readFileSync(path.join(root,'android/src/sa/mosque/display/DeviceSetup.java'),'utf8');
  assert.equal(data.restoreOnly.length,39);assert.equal(new Set(data.restoreOnly).size,39);
  for(const name of data.restoreOnly){assert(generator.PACKAGE.test(name));assert(!active.has(name));assert(!native.includes('{"'+name+'",'));}
  for(const name of ['com.tcl.exhibit','com.tcl.usercenter','com.nvidia.ota','com.coocaa.os.upgrade','com.amazon.providers.contentsupport'])assert(data.restoreOnly.includes(name));
  const newModel=data.profiles.find(row=>row.id==='artel-a55lu8500');assert.equal(newModel.osMajor,14);assert.deepEqual(newModel.packages,[]);
  const mixed=data.profiles.find(row=>row.id==='xiaomi-mitv-axso2');assert.equal(mixed.osMajor,null);assert.deepEqual(mixed.packages,[]);
});
test('Only active valid package lines are retained, with inline comments stripped and duplicates removed',()=>{
  assert.deepEqual(generator.packages('# com.hidden.app\ncom.example.app # explanation\n\ncom.example.app\r\ncom.other.Package_2\n'),['com.example.app','com.other.Package_2']);for(const bad of ['pm disable-user com.example.app','com.bad.app;reboot','not_a_package','../com.example.app'])assert.throws(()=>generator.packages(bad));
});
test('Model derivation removes only a complete brand prefix and invents no device aliases',()=>{
  assert.equal(generator.modelSlug('tcl-beyondtv-rt2851','TCL'),'beyondtv-rt2851');assert.equal(generator.modelSlug('sonybravia-x90','Sony'),'sonybravia-x90');assert.equal(generator.modelSlug('mi-box','Xiaomi'),'mi-box');assert.equal(generator.modelSlug('aiwa-smart-tv','AIWA'),'smart-tv');assert.equal(generator.modelSlug('aipro2k','AiPro2K'),'');assert.equal(generator.normalize('ＴＣＬ - TV'),'tcltv');
});
test('Only explicit numeric Android or Google TV versions are parsed',()=>{
  assert.equal(generator.osMajor('Android TV 11'),11);assert.equal(generator.osMajor('Google TV 14'),14);assert.equal(generator.osMajor('Android 12.0'),12);assert.equal(generator.osMajor('Google TV (unknown version)'),null);assert.equal(generator.osMajor('Fire OS 8'),null);assert.equal(generator.osMajor('Tizen 9'),null);
  for(const mixed of ['Android TV 9 / 11','Android TV 10 and 11','Android TV 11, 14','Android TV 11 / Google TV 14'])assert.equal(generator.osMajor(mixed),null);
  assert.equal(generator.osMajor('Fire OS 7.7.1.7 / Android 9'),9);assert.equal(generator.osMajor('Google TV 14 (SDK 34)'),14);
});
test('License and NOTICE preserve pinned attribution without importing scripts, notes, fonts, or device validation claims',()=>{
  const license=fs.readFileSync(path.join(root,'licenses/CleanYourTV-MIT.txt'),'utf8'),notice=fs.readFileSync(path.join(root,'licenses/CleanYourTV-NOTICE.txt'),'utf8');assert(license.startsWith('MIT License\n\nCopyright (c) 2026 Gathin\n'));assert(license.includes('Permission is hereby granted'));assert(license.includes('The Outfit typeface'));assert(notice.includes(generator.PIN));assert(notice.includes(generator.BASELINE_PIN));assert(notice.includes('508 upstream model records'));assert(!data.profiles.some(row=>'notes' in row||'tv' in row||'deviceAlias' in row));
});
const publicOnly=process.env.MOSQUE_DEVICE_PROFILES_PUBLIC_ONLY==='1';
let sourceVerification={performed:false,skipped:true,reason:publicOnly?'Raw-source audit explicitly skipped for public-source CI simulation; public asset hash and actual JVM tests still run.':'Pinned raw archive/tree are absent from this checkout (normal in public CI); public asset hash and actual JVM tests still run.'};
const hasSnapshots=Object.values(generator.sources).every(source=>[source.archive,source.tree].every(file=>fs.existsSync(path.join(root,'research',file))));
if(!publicOnly&&hasSnapshots)test('Both pinned raw snapshots regenerate the exact catalogue without extending package eligibility',()=>{
  const r=generator.generate({write:false});
  assert.equal(r.current.verified.length,1017);assert.equal(r.baseline.verified.length,833);
  assert.equal(Buffer.compare(Buffer.from(r.json),bytes),0);assert.equal(Buffer.compare(r.license,fs.readFileSync(path.join(root,'licenses/CleanYourTV-MIT.txt'))),0);
  assert.equal(r.notice,fs.readFileSync(path.join(root,'licenses/CleanYourTV-NOTICE.txt'),'utf8'));
  const oldById=new Map(r.baseline.profiles.map(row=>[row.id,row])),currentById=new Map(r.current.profiles.map(row=>[row.id,row]));
  const recovery=new Set([...data.restoreOnly,...data.profiles.flatMap(row=>row.packages)]);
  assert.deepEqual(recovery,new Set(r.baseline.profiles.flatMap(row=>row.packages)));
  assert.equal(r.withdrawn.length,18);for(const name of r.withdrawn)assert(data.restoreOnly.includes(name));
  for(const row of data.profiles){
    const prior=oldById.get(row.id),latest=currentById.get(row.id);
    if(!prior||!row.osMajor||prior.osMajor!==row.osMajor)assert.deepEqual(row.packages,[]);
    for(const name of row.packages){assert(prior.packages.includes(name));assert(latest.packages.includes(name));assert(!r.withdrawn.includes(name));}
  }
  assert.equal(data.profiles.filter(row=>!oldById.has(row.id)).length,92);
  sourceVerification={performed:true,commit:generator.PIN,verifiedRawBlobs:1017,baselineCommit:generator.BASELINE_PIN,baselineVerifiedRawBlobs:833,archiveFullyExtracted:false,upstreamCodeExecuted:false};
});
test('Actual Java matcher refuses guessing and accepts only an exact nonambiguous OEM/model/version',()=>{
  const windows=process.platform==='win32',binary=name=>name+(windows?'.exe':''),javaRoot=process.env.MOSQUE_JAVA_HOME||process.env.JAVA_HOME,javac=javaRoot?path.join(javaRoot,'bin',binary('javac')):find(path.join(root,'.android-tools/jdk'),binary('javac'));
  assert(javac&&fs.existsSync(javac),'Set MOSQUE_JAVA_HOME or JAVA_HOME to a JDK.');const java=path.join(path.dirname(javac),binary('java')),out=path.join(root,'android/build/device-profile-tests');fs.mkdirSync(out,{recursive:true});
  const fixture=path.join(root,'android/tests/DeviceProfilesTest.java'),tsv=path.join(out,'profiles.tsv');
  fs.writeFileSync(tsv,data.profiles.map(row=>[row.id,row.brand,row.modelSlug,String(row.osMajor),row.packages.join(',')].join('\t')).join('\n')+'\n');
  let result=cp.spawnSync(javac,['-encoding','UTF-8','-source','8','-target','8','-d',out,path.join(root,'android/src/sa/mosque/display/DeviceProfiles.java'),fixture],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr||String(result.error));result=cp.spawnSync(java,['-cp',out,'sa.mosque.display.DeviceProfilesTest',tsv],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr||String(result.error));const summary=JSON.parse(result.stdout.trim());assert.equal(summary.failed,0);assert(summary.passed>=27);checks.push({name:'Actual JVM exact-matcher fixture assertions',pass:true,assertions:summary.passed});
});
console.log(JSON.stringify({passed:checks.filter(row=>row.pass).length,total:checks.length,failed:checks.filter(row=>!row.pass).length,sourceVerification,method:'Static data validation, pinned source blob verification when the private research archive is available, and the actual pure Java matcher compiled/run on the local JVM. No Android, TV, ADB/socket, package disable, optimization, upstream execution, or device-compatibility validation.',checks},null,2));if(checks.some(row=>!row.pass))process.exitCode=1;
