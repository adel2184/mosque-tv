/* Actual atomic-envelope module tests; storage failures are simulated, not browser/device tests. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const file=path.join(__dirname,'profile-store.js'),source=fs.readFileSync(file,'utf8'),store=require('./profile-store.js'),checks=[];
const assert=(value,message='Assertion failed')=>{if(!value)throw Error(message);};
const eq=(a,b)=>assert(a===b,`Expected ${JSON.stringify(b)}; received ${JSON.stringify(a)}`);
const same=(a,b)=>eq(JSON.stringify(a),JSON.stringify(b));
const rejects=fn=>{let error;try{fn();}catch(value){error=value;}assert(error,'Expected rejection');return error;};
function test(name,fn){try{fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}}
const envelope=(name='جامع الاختبار')=>({schemaVersion:1,profile:{countryId:'SA',cityId:'110336',mosqueName:name},settings:{schemaVersion:1,iqama:{offsets:{fajr:26}}},timetable:{metadata:{schemaVersion:1,timezone:'Asia/Riyadh'},records:[{date:'2026-11-17'}]},completedAt:'2026-11-17T11:00:00.000Z'});
function storage(initial={}){const values=new Map(Object.entries(initial)),writes=[];return{values,writes,quota:Infinity,failWrite:false,failRead:false,getItem(key){if(this.failRead)throw Error('Simulated read denial');return values.has(key)?values.get(key):null;},setItem(key,value){value=String(value);if(this.failWrite||Buffer.byteLength(value,'utf8')>this.quota)throw Error('Simulated atomic quota failure');values.set(key,value);writes.push({key,value});}};}
test('CommonJS and DOM-free browser/worker exports use the independent installation key without touching storage on load',()=>{
  eq(store.key,'mosque-display.installation.v1');let reads=0;const sandbox={};Object.defineProperty(sandbox,'localStorage',{get(){reads++;throw Error('Unexpected storage read');}});vm.runInNewContext(source,sandbox,{timeout:2000});eq(reads,0);eq(sandbox.MosqueProfileStore.key,store.key);eq(typeof sandbox.MosqueProfileStore.commit,'function');
});
test('A successful commit performs one atomic-key write and preserves the old mosque and timetable keys',()=>{
  const s=storage({'mosque-display.settings.v1':'legacy-settings','mosque-display.timetable.v1':'legacy-table'}),value=envelope();eq(store.commit(s,value),value);same(store.read(s),value);eq(s.writes.length,1);eq(s.writes[0].key,store.key);eq(s.values.get('mosque-display.settings.v1'),'legacy-settings');eq(s.values.get('mosque-display.timetable.v1'),'legacy-table');
});
test('A missing installation returns null and malformed stored JSON or envelopes throw rather than declaring setup complete',()=>{
  eq(store.read(storage()),null);for(const raw of ['{','null','[]','{}',JSON.stringify({...envelope(),schemaVersion:2})])rejects(()=>store.read(storage({[store.key]:raw})));
});
test('All required envelope members must be non-array objects and invalid candidates never replace the previous snapshot',()=>{
  const old=JSON.stringify(envelope('القديم')),invalid=[null,[],{},...['profile','settings','timetable'].flatMap(key=>[null,[],true,'truthy text',1].map(value=>({...envelope(),[key]:value})))];for(const value of invalid){const s=storage({[store.key]:old});rejects(()=>store.commit(s,value));eq(s.values.get(store.key),old);eq(s.writes.length,0);}
});
test('Completion timestamps require a canonical real UTC ISO instant',()=>{
  for(const completedAt of ['2026','invalid','2026-11-17T11:00:00Z','2026-11-17T11:00:00.000+00:00','2026-02-30T11:00:00.000Z','',null,123]){const s=storage(),value={...envelope(),completedAt};rejects(()=>store.commit(s,value));eq(s.writes.length,0);}store.commit(storage(),envelope());
});
test('Atomic quota/write failures retain the entire old profile/settings/timetable together and do not report success',()=>{
  const old=envelope('القديم'),raw=JSON.stringify(old);for(const failure of ['quota','denial']){const s=storage({[store.key]:raw});if(failure==='quota')s.quota=20;else s.failWrite=true;let succeeded=false;try{store.commit(s,envelope('الجديد'));succeeded=true;}catch(_){}eq(succeeded,false);eq(s.values.get(store.key),raw);same(store.read(s),old);eq(s.writes.length,0);}
});
test('JSON serialization failures also occur before storage mutation',()=>{
  const old=JSON.stringify(envelope('القديم'));for(const value of [Object.assign(envelope(),{extra:1n}),(()=>{const v=envelope();v.profile.circular=v;return v;})()]){const s=storage({[store.key]:old});rejects(()=>store.commit(s,value));eq(s.values.get(store.key),old);eq(s.writes.length,0);}
});
test('The 3MB cap counts UTF-8 Arabic and supplementary characters on both read and commit',()=>{
  for(const text of ['م'.repeat(1500001),'🕌'.repeat(750001)]){const value=envelope(text),raw=JSON.stringify(value);assert(raw.length<3000000,'Fixture must distinguish UTF-16 length from byte size');assert(Buffer.byteLength(raw,'utf8')>3000000);const s=storage({[store.key]:'old'});rejects(()=>store.commit(s,value));eq(s.values.get(store.key),'old');eq(s.writes.length,0);rejects(()=>store.read(storage({[store.key]:raw})));}
});
test('The exact 3,000,000-byte boundary is accepted and one extra byte is rejected without replacement',()=>{
  const value=envelope(''),overhead=Buffer.byteLength(JSON.stringify(value),'utf8');value.profile.mosqueName='x'.repeat(3000000-overhead);eq(Buffer.byteLength(JSON.stringify(value),'utf8'),3000000);const s=storage();store.commit(s,value);const old=s.values.get(store.key);value.profile.mosqueName+='x';rejects(()=>store.commit(s,value));eq(s.values.get(store.key),old);eq(s.writes.length,1);same(store.read(s),JSON.parse(old));
});
test('A denied read propagates failure without modifying any stored value',()=>{
  const old=JSON.stringify(envelope()),s=storage({[store.key]:old});s.failRead=true;rejects(()=>store.read(s));eq(s.values.get(store.key),old);eq(s.writes.length,0);
});
const report={executedAt:new Date().toISOString(),sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),method:'Actual profile-store.js executed in CommonJS and a DOM-free VM. Storage is an atomic Map-backed fake with quota/read/write failures. This tests the envelope boundary; full profile/timetable semantic validation belongs to the app core. No real localStorage, browser, Android, TV, or disk-quota failure was exercised.',passed:checks.filter(item=>item.pass).length,total:checks.length,failed:checks.filter(item=>!item.pass).length,checks};console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
