'use strict';
// Exercise the actual TV projection, prayer engine, DOM and installation storage together.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {runtime,cityProfile,table,defaults,legacyTable,INSTALL,OLD_SETTINGS,OLD_TABLE}=require('./test-profile-integration.cjs');
const schema=require('./phone-settings.js');
const same=(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
const live=()=>true;
function legacy(changes={}) {
  const s={...defaults,...changes};
  return runtime({storage:new Map([[OLD_SETTINGS,JSON.stringify(s)],[OLD_TABLE,legacyTable]])});
}
function api(app){
  // The old synchronous DOM fixture leaves timeouts inert. Run the phone's
  // finite commit/render slices on the real event loop in this suite.
  app.window.setTimeout=setTimeout;
  return app.window.MosquePhoneSettings;
}
function next(app){const {ok,revision,settings}=api(app).state();assert.equal(ok,true);return {revision,settings};}
function installed(){
  const app=runtime(),p=cityProfile('SA','Dammam',{language:'ar',methodId:'UmmAlQura'});
  assert.equal(app.window.MosqueInstall.commit(p,table(p)).ok,true);
  app.writes.length=0;
  return app;
}
test('A fresh installation requires setup; existing defaults project exact compact settings and no timetable',()=>{
  same(api(runtime()).state(),{ok:false,error:'unavailable'});
  const app=legacy(),view=api(app).state();
  assert.equal(view.ok,true);schema.validateEditor(view.settings);
  assert.equal(view.settings.announcements.length,2);assert.equal(view.settings.jumuahTime,'');
  assert.equal(view.backup,undefined);
  const exported=api(app).state(true);assert.equal(exported.backup.mosque.fields.name.value,defaults.mosque.fields.name.value);
  assert.doesNotMatch(JSON.stringify(view),/"(location|contact|imam|custom|donation|adhanAdjustments)"/);
  assert.doesNotMatch(JSON.stringify(exported),/"(records|timetable|profile|timezone)"/);
  assert.doesNotMatch(JSON.stringify(view),/"(records|timetable|profile|timezone)"/);
  assert.equal(app.writes.length,0);
});
test('A single atomic settings apply updates identity, reordered plain-text announcements, display, and persisted profile',async()=>{
  const app=installed(),req=next(app),old=JSON.parse(app.storage.get(INSTALL));
  Object.assign(req.settings,{mosqueName:'اسم <b>الجامع</b>',neighborhood:'الحي الجديد',hourFormat:12,dateStyle:'hijri',
    announcements:[{label:'ثانٍ',text:'إعلان ثانٍ'},{label:'أول',text:'<b>نص عادي</b>'}],silentPhoneReminder:false,postPrayerMinutes:3});
  const result=await api(app).apply(req,live);
  assert.equal(result.ok,true,JSON.stringify(result));assert(result.revision>req.revision);
  assert.equal(result.backup,undefined);
  const saved=JSON.parse(app.storage.get(INSTALL));
  assert.equal(saved.profile.mosqueName,req.settings.mosqueName);
  assert.equal(saved.profile.neighborhood,req.settings.neighborhood);
  assert.equal(saved.profile.hourFormat,12);assert.equal(saved.profile.dateStyle,'hijri');
  same(saved.timetable,old.timetable);same(saved.settings.donation,old.settings.donation);
  same(app.writes,[INSTALL]);assert.equal(app.document.getElementById('gregorianDate').hidden,true);
  const info=app.document.getElementById('mosqueInfo');
  assert(info.textContent.includes(req.settings.mosqueName));assert.equal(info.querySelector('b'),null);
  const ticker=app.document.getElementById('tickerTrack');
  assert(ticker.textContent.indexOf('إعلان ثانٍ')<ticker.textContent.indexOf('<b>نص عادي</b>'));
  assert.equal(ticker.querySelector('b'),null);
  const reopened=runtime({storage:app.storage});
  assert.equal(reopened.window.MosqueInstall.getContext().required,false);
  same(next(reopened).settings,result.settings);assert.equal(reopened.intervals.length,1);
});
test('An old TV backup restores hidden/non-editor fields while retaining installed calendar and timetable',async()=>{
  const app=installed(),req=next(app),backup=JSON.parse(JSON.stringify(defaults)),before=JSON.parse(app.storage.get(INSTALL));
  backup.mosque.fields.subtitle={value:'وصف محفوظ',visible:true};
  backup.mosque.fields.address.value='عنوان مخصص طويل';
  backup.mosque.custom=[{id:'item',label:'المكتب',value:'الطابق الأول',visible:true}];
  backup.donation={visible:false,title:'مخصص',description:'نص'};
  backup.iqama.overrides=[{id:'fixed',kind:'weekday',match:'2',prayer:'isha',time:'20:40',label:'اجتماع'}];
  backup.adhanAdjustments={asr:2};
  delete backup.postPrayerMinutes;delete backup.silentPhoneReminder;
  req.backup=backup;req.settings.mosqueName=backup.mosque.fields.name.value;
  req.settings.prayerModeMinutes=backup.prayerModeMinutes;req.settings.iqamaOffsets=backup.iqama.offsets;
  req.settings.postPrayerMinutes=5;req.settings.silentPhoneReminder=true;
  const result=await api(app).apply(req,live);
  assert.equal(result.ok,true,JSON.stringify(result));const saved=JSON.parse(app.storage.get(INSTALL));
  same(saved.settings.mosque.custom,backup.mosque.custom);same(saved.settings.donation,backup.donation);
  assert.equal(saved.settings.mosque.fields.address.value,backup.mosque.fields.address.value);
  assert.equal(saved.settings.iqama.overrides[0].id,'fixed');assert.equal(saved.settings.adhanAdjustments.asr,2);
  same(saved.timetable,before.timetable);assert.equal(saved.profile.neighborhood,before.profile.neighborhood);
});
test('Legacy settings remain usable without a wizard; Friday iqama and a dated manual adhan drive the real TV schedule',async()=>{
  const app=legacy(),req=next(app),oldTable=app.storage.get(OLD_TABLE);
  req.settings.jumuahTime='13:00';req.settings.iqamaOffsets.asr=21;
  req.settings.manualOverrides=[{date:'2026-11-20',prayer:'asr',time:'15:00'}];
  req.settings.hourFormat=24;req.settings.dateStyle='gregorian';req.settings.announcements=[];
  const result=await api(app).apply(req,live);assert.equal(result.ok,true,JSON.stringify(result));
  same(app.writes,[OLD_SETTINGS]);assert.equal(app.storage.get(OLD_TABLE),oldTable);
  const reopened=runtime({storage:app.storage});
  assert.equal(reopened.window.MosqueInstall.getContext().required,false);
  same(next(reopened).settings,result.settings);
  reopened.setNow(Date.parse('2026-11-20T12:59:00+03:00'));
  assert.equal(reopened.api.getState().active.iqama,Date.parse('2026-11-20T13:00:00+03:00'));
  reopened.setNow(Date.parse('2026-11-20T15:01:00+03:00'));
  const phase=reopened.api.getState();
  assert.equal(phase.active.adhan,Date.parse('2026-11-20T15:00:00+03:00'));
  assert.equal(phase.active.iqama,Date.parse('2026-11-20T15:21:00+03:00'));
  assert.equal(reopened.document.getElementById('hijriDate').hidden,true);
  assert.equal(reopened.document.getElementById('clockPeriod').textContent,'');
  assert(reopened.document.getElementById('prayerRows').textContent.includes('15:00'));
});
test('Invalid schema/unsafe control characters, unsupported backup keys, schedule conflicts and stale sessions never write',async()=>{
  const app=legacy();
  const invalid=[s=>s.extra=true,s=>s.silentPhoneReminder='true',s=>s.hourFormat='24',s=>s.mosqueName='bad\x00name',
    s=>s.announcements=[{label:'a',text:'ok',href:'arbitrary'}],s=>s.manualOverrides=[{date:'2026-02-31',prayer:'dhuhr',time:'12:45'}],
    s=>s.neighborhood='a'.repeat(181),s=>s.iqamaOffsets.fajr=0];
  for(const change of invalid){const req=next(app);change(req.settings);same(await api(app).apply(req,live),{ok:false,error:'invalid'});}
  const req=next(app);
  same(await api(app).apply({...req,backup:{...defaults,timetable:{records:[]}}},live),{ok:false,error:'invalid'});
  same(await api(app).apply(req,()=>false),{ok:false,error:'unavailable'});
  same(await api(app).apply(req),{ok:false,error:'unavailable'});
  req.settings.jumuahTime='01:00';
  same(await api(app).apply(req,live),{ok:false,error:'schedule'});
  assert.equal(app.writes.length,0);
});
test('Reduced motion pages every announcement in order without animation, polling, or dropping long text',async()=>{
  const app=legacy(),req=next(app);
  req.settings.announcements=Array.from({length:16},(_,i)=>({label:String(i+1),text:'界'.repeat(300)}));
  req.settings.dateStyle='none';
  assert.equal((await api(app).apply(req,live)).ok,true);
  const track=app.document.getElementById('tickerTrack');
  assert(track.classList.contains('static-announcements'));assert.equal(track.children.length,1);
  const nodes=track.children[0].children,seen=new Map();
  const originalNodes=[...nodes],start=Date.parse('2026-11-17T06:15:00Z');
  for(let i=0;i<nodes.length;i++){
    app.setNow(start+i*15000);
    const visible=nodes.filter(n=>!n.hidden);assert.equal(visible.length,1);assert.equal(visible[0],originalNodes[i]);
    const label=visible[0].children[0].textContent.split(' ')[0],body=visible[0].children[1].textContent;
    seen.set(label,(seen.get(label)||'')+body);
    app.api.tick();assert.equal(nodes.find(n=>!n.hidden),visible[0]);
  }
  assert.equal(seen.size,16);
  for(const item of req.settings.announcements)assert.equal(seen.get(item.label),item.text);
  assert.equal(app.intervals.length,1);assert.equal(app.document.getElementById('hijriDate').hidden,true);
  assert.equal(app.document.getElementById('gregorianDate').hidden,true);
  assert.equal(runtime({storage:app.storage}).window.MosquePhoneSettings.state().settings.dateStyle,'none');
});
test('Existing TV draft, quota failure, local revision changes and a cancelled preparation cannot overwrite saved settings',async()=>{
  const initial=installed(),storage=initial.storage,previous=storage.get(INSTALL);
  const failing=runtime({storage,failKeys:new Set([INSTALL])}),req=next(failing);
  req.settings.mosqueName='محاولة';same(await api(failing).apply(req,live),{ok:false,error:'storage'});
  assert.equal(storage.get(INSTALL),previous);
  const app=runtime({storage});const old=next(app);
  app.api.openSettings();app.document.getElementById('previewButton').click();
  same(await api(app).apply(old,live),{ok:false,error:'busy'});
  app.document.getElementById('cancelButton').click();app.api.openSettings();app.document.getElementById('saveButton').click();
  same(await api(app).apply(old,live),{ok:false,error:'conflict'});
  const current=next(app);current.settings.iqamaOffsets.fajr+=1;
  let count=0;const writeCount=app.writes.length;
  same(await api(app).apply(current,()=>++count<2),{ok:false,error:'unavailable'});
  assert.equal(app.writes.length,writeCount);
});
test('A TV draft or preview opened immediately after a phone commit survives the deferred repaint',async()=>{
  const app=legacy(),phone=api(app),req=next(app);
  req.settings.mosqueName='حفظ من الهاتف';
  let resume;
  app.window.setTimeout=fn=>{resume=fn;return 1;};
  const operation=phone.apply(req,live);
  assert.equal(typeof resume,'function');
  const latest=phone.state(true);assert.equal(latest.settings.mosqueName,req.settings.mosqueName);
  app.api.openSettings();
  const local={...latest.backup,postPrayerMinutes:7};
  const file=app.document.getElementById('settingsFile'),content=JSON.stringify(local);
  file.files=[{name:'restore.json',size:Buffer.byteLength(content),content}];app.fire(file,'change');
  app.document.getElementById('previewButton').click();
  app.window.setTimeout=setTimeout;resume();
  assert.equal((await operation).ok,true);assert.equal(app.api.getSettings().postPrayerMinutes,7);
  assert.equal(phone.state().settings.postPrayerMinutes,5);
  app.document.getElementById('exportSettingsButton').click();
  assert.equal(JSON.parse(app.downloads.at(-1).textContent).postPrayerMinutes,7);
});
