/* Actual app IIFE plus the real location engine/store; no browser or TV is run. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),engine=require('./location-engine.js'),profileStore=require('./profile-store.js');
const appSource=fs.readFileSync(path.join(__dirname,'app.js'),'utf8'),calendar=JSON.parse(fs.readFileSync(path.join(root,'data/setup-calendar.json'),'utf8')),catalog=JSON.parse(fs.readFileSync(path.join(root,'data/location-catalog.json'),'utf8'));
const provider=require('./setup-provider.js');
const adapterSource=fs.readFileSync(path.join(__dirname,'profile-adapter.js'),'utf8');
const OLD_SETTINGS='mosque-display.settings.v1',OLD_TABLE='mosque-display.timetable.v1',INSTALL=profileStore.key,checks=[];
const clone=value=>JSON.parse(JSON.stringify(value));
const assert=(value,message='Assertion failed')=>{if(!value)throw Error(message);};
const eq=(a,b)=>assert(a===b,`Expected ${JSON.stringify(b)}; received ${JSON.stringify(a)}`);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>eq(JSON.stringify(canonical(a)),JSON.stringify(canonical(b)));
const rejects=fn=>{let error;try{fn();}catch(value){error=value;}assert(error,'Invalid candidate was accepted');return error;};
function test(name,fn){try{fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}}
const embeddedFiles={'config-data':'dev/config.json','calendar-data':'data/calendar.json','setup-calendar-data':'data/setup-calendar.json','calendar-fixtures':'data/calendar-fixtures.json','prayer-data':'data/timetable.json','slides-data':'dev/slides.json','display-content-data':'dev/display-content.json'};
const embedded=Object.entries(embeddedFiles).map(([id,file])=>'<script id="'+id+'" type="application/json">'+fs.readFileSync(path.join(root,file),'utf8')+'</script>').join('\n');
const contextSource=fs.readFileSync(path.join(__dirname,'prayer-context.js'),'utf8');
const actualHTML=fs.readFileSync(path.join(__dirname,'shell.html'),'utf8').replace('<!--EMBEDDED_DATA-->',()=>embedded).replace('<!--APPLICATION_SCRIPT-->',()=>'<script>'+contextSource+'\n'+appSource+'</script>');
const originalHarness=fs.readFileSync(path.join(__dirname,'test-content.cjs'),'utf8'),boundary=originalHarness.indexOf('\nconst base=createRuntime();');assert(boundary>0,'Existing full-app runtime factory was not found');
let prefix=originalHarness.slice(0,boundary).replace("const html=fs.readFileSync(filename,'utf8');",'const html=CORE_HTML;')
  .replace("function createRuntime(boot=stamp('2026-11-16T09:15:00')){","function createRuntime(boot=stamp('2026-11-16T09:15:00')){const options=RUNTIME_OPTIONS;")
  .replace('const storage=new Map();let now=boot;','const storage=options.storage||new Map(),writes=[],attempts=[];let now=boot;')
  .replace('getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)',"getItem:key=>storage.get(key)??null,setItem:(key,value)=>{attempts.push(key);if(options.failKeys?.has(key))throw Error('Simulated atomic quota denial');storage.set(key,String(value));writes.push(key);},removeItem:key=>storage.delete(key)")
  .replace('vm.runInNewContext(application.text,sandbox,',"if(options.preload!==false){sandbox.MosqueLocation=ENGINE;sandbox.MosqueProfileStore=PROFILE_STORE;sandbox.MosquePlaces=options.catalog===undefined?CATALOG:options.catalog;}if(options.native)sandbox.MosqueAndroid=options.native;vm.runInNewContext(application.text,sandbox,")
  .replace('return {api,document,intervals,downloads,setNow','return {api,document,intervals,downloads,window:sandbox,storage,writes,attempts,setNow');
const factoryContext={require,__dirname,console,URL,URLSearchParams,Intl,CORE_HTML:actualHTML,ENGINE:engine,PROFILE_STORE:profileStore,CATALOG:catalog,RUNTIME_OPTIONS:{}};vm.runInNewContext(prefix+'\nthis.makeRuntime=createRuntime;',factoryContext,{timeout:5000});
function runtime(options={}){factoryContext.RUNTIME_OPTIONS=options;const app=factoryContext.makeRuntime(Date.parse('2026-11-17T06:15:00Z'));assert(app.window.MosqueInstall||options.preload===false,'Operational installation API missing');return app;}
function cityProfile(countryId,name,changes={}){const country=catalog.countries.find(item=>item.id===countryId),city=country?.cities.find(item=>item.nameEn===name);assert(city,'Missing catalog city '+countryId+'/'+name);return{language:'en',countryId,cityId:city.id,timezone:city.timezone,latitude:city.latitude,longitude:city.longitude,hourFormat:24,dateStyle:'gregorian',methodId:'Egyptian',neighborhood:'Test neighborhood',mosqueName:'Test Mosque <literal>',...changes};}
const cairo=cityProfile('EG','Cairo'),newYork=cityProfile('US','New York City',{methodId:'MuslimWorldLeague'});
const tableCache=new Map();function table(profile){const key=JSON.stringify(profile);if(!tableCache.has(key))tableCache.set(key,engine.calculate(profile,2026,calendar));return clone(tableCache.get(key));}
const providerHarness=fs.readFileSync(path.join(__dirname,'test-setup-provider.cjs'),'utf8'),providerBoundary=providerHarness.indexOf('\nconst p=profile()');assert(providerBoundary>0,'Existing provider fixture generator was not found');
const providerContext={require,__dirname,console};vm.runInNewContext(providerHarness.slice(0,providerBoundary)+'\nthis.makePayload=payloadFor;',providerContext,{timeout:5000});
const defaults=JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')),legacyTable=fs.readFileSync(path.join(root,'data/timetable.json'),'utf8');
test('An existing legacy installation keeps both original keys and all saved values without forcing setup or rewriting on boot',()=>{
  const settings=clone(defaults);settings.iqama.offsets.fajr=26;settings.mosque.fields.name.value='Existing Mosque';
  delete settings.adhanAdjustments;delete settings.silentPhoneReminder;delete settings.postPrayerMinutes;
  const raw=JSON.stringify(settings),storage=new Map([[OLD_SETTINGS,raw],[OLD_TABLE,legacyTable]]),app=runtime({storage});const context=app.window.MosqueInstall.getContext();eq(context.required,false);eq(context.hasInstallation,false);eq(context.settings.iqama.offsets.fajr,26);eq(context.settings.mosque.fields.name.value,'Existing Mosque');eq(app.api.database.metadata.city,'الدمام');eq(storage.get(OLD_SETTINGS),raw);eq(storage.get(OLD_TABLE),legacyTable);eq(app.writes.length,0);eq(storage.has(INSTALL),false);
  eq(context.settings.silentPhoneReminder,true);eq(context.settings.postPrayerMinutes,5);
});
test('A native legacy-upgrade signal preserves the old dashboard while a genuinely fresh install requires setup and no Dammam timetable',()=>{
  const upgraded=runtime({native:{setupStatus:()=>JSON.stringify({legacyUpgrade:true})}});eq(upgraded.window.MosqueInstall.getContext().required,false);assert(upgraded.api.database);const fresh=runtime(),context=fresh.window.MosqueInstall.getContext();eq(context.required,true);eq(context.hasInstallation,false);eq(context.profile,null);eq(fresh.api.database,null);eq(fresh.api.getState().phase,'UNAVAILABLE');eq(context.settings.donation.visible,false);eq(context.settings.mosque.enabled,false);eq(fresh.storage.size,0);
});
test('A v2.3.3 profile and JSON backup acquire both display defaults without a wizard or writes, then round-trip explicit Off values',()=>{
  const older=clone(defaults);delete older.silentPhoneReminder;delete older.postPrayerMinutes;
  older.mosque.fields.name.value=newYork.mosqueName;older.iqama.offsets.fajr=27;
  const savedTable=table(newYork),snapshot={schemaVersion:1,completedAt:'2026-11-16T08:00:00.000Z',profile:newYork,settings:older,timetable:savedTable};
  const before=JSON.stringify(snapshot),storage=new Map([[INSTALL,before],[OLD_SETTINGS,JSON.stringify(older)]]);
  const app=runtime({storage});const context=app.window.MosqueInstall.getContext();
  eq(context.required,false);eq(context.hasInstallation,true);same(context.profile,newYork);eq(context.settings.silentPhoneReminder,true);eq(context.settings.postPrayerMinutes,5);
  eq(context.settings.iqama.offsets.fajr,27);eq(storage.get(INSTALL),before);eq(app.writes.length,0);
  app.api.openSettings();
  function importBackup(settings){
    const file=app.document.getElementById('settingsFile'),content=JSON.stringify(settings);
    file.files=[{name:'settings.json',size:Buffer.byteLength(content),content}];app.fire(file,'change');
  }
  function exportBackup(){app.document.getElementById('exportSettingsButton').click();return JSON.parse(app.downloads.at(-1).textContent);}
  importBackup(older);const migrated=exportBackup();eq(migrated.silentPhoneReminder,true);eq(migrated.postPrayerMinutes,5);
  importBackup({...migrated,silentPhoneReminder:false,postPrayerMinutes:0});const chosen=exportBackup();
  eq(chosen.silentPhoneReminder,false);eq(chosen.postPrayerMinutes,0);
  for(const bad of [{postPrayerMinutes:'5'},{postPrayerMinutes:4},{postPrayerMinutes:null},{silentPhoneReminder:1},{silentPhoneReminder:null}]){
    importBackup({...chosen,...bad});same(exportBackup(),chosen);
  }
  for(const minutes of [0,3,5,7])eq(app.api.validateSettings({...chosen,postPrayerMinutes:minutes}).postPrayerMinutes,minutes);
  eq(storage.get(INSTALL),before);app.document.getElementById('saveButton').click();
  const reloaded=runtime({storage}).window.MosqueInstall.getContext();
  eq(reloaded.required,false);same(reloaded.profile,newYork);eq(reloaded.settings.silentPhoneReminder,false);eq(reloaded.settings.postPrayerMinutes,0);
  same(JSON.parse(storage.get(INSTALL)).timetable,savedTable);
});
test('A genuinely fresh install with a missing or empty location catalog stays in required repair setup without silently showing Dammam data',()=>{
  for(const catalog of [null,{countries:[],methods:[]}]){const app=runtime({catalog}),context=app.window.MosqueInstall.getContext();eq(context.required,true);eq(context.hasInstallation,false);eq(context.profile,null);eq(app.api.database,null);eq(app.api.getState().phase,'UNAVAILABLE');eq(context.settings.mosque.enabled,false);eq(app.storage.size,0);eq(app.writes.length,0);}
});
test('Bad atomic installation data requires repair and never silently adopts legacy mirrors',()=>{
  for(const value of ['{','{}',JSON.stringify({schemaVersion:1,profile:[],settings:{},timetable:{},completedAt:'2026-11-17T00:00:00.000Z'})]){const storage=new Map([[INSTALL,value],[OLD_SETTINGS,JSON.stringify(defaults)],[OLD_TABLE,legacyTable]]),app=runtime({storage}),context=app.window.MosqueInstall.getContext();eq(context.required,true);eq(context.hasInstallation,false);assert(context.error);eq(app.api.database,null);eq(storage.get(INSTALL),value);eq(app.writes.length,0);}
});
test('All five presets validate, atomically commit a Cairo profile, and reload the full profile/settings/timetable snapshot',()=>{
  for(const methodId of Object.keys(engine.methodPresets)){const profile={...cairo,methodId},raw=table(profile),app=runtime();eq(app.window.MosqueInstall.validatePrepared(profile,raw),true);eq(app.writes.length,0);eq(app.window.MosqueInstall.getContext().required,true);same(app.window.MosqueInstall.commit(profile,raw),{ok:true});same(app.writes,[INSTALL,OLD_SETTINGS,OLD_TABLE]);const snapshot=profileStore.read({getItem:key=>app.storage.get(key)??null});same(snapshot.profile,profile);eq(snapshot.settings.mosque.fields.name.value,profile.mosqueName);eq(snapshot.settings.mosque.fields.address.value,'Test neighborhood، Cairo');eq(snapshot.settings.donation.visible,false);eq(snapshot.settings.iqama.offsets.fajr,10);eq(snapshot.settings.iqama.offsets.maghrib,5);eq(snapshot.settings.prayerModeMinutes,10);eq(snapshot.timetable.metadata.calculation.method,methodId);const loaded=runtime({storage:app.storage}),context=loaded.window.MosqueInstall.getContext();eq(context.required,false);eq(context.hasInstallation,true);same(context.profile,profile);eq(context.settings.mosque.fields.name.value,profile.mosqueName);eq(loaded.api.database.metadata.timezone,profile.timezone);eq(loaded.document.getElementById('mosqueInfo').querySelector('h1').textContent,profile.mosqueName);eq(loaded.document.getElementById('mosqueInfo').querySelectorAll('literal').length,0);eq(loaded.document.getElementById('gregorianDate').dir,'ltr');}
});
test('New York reconfiguration uses its selected clock/date style/absolute events and preserves the existing saved iqama and donation choices',()=>{
  const old=clone(defaults);old.iqama.offsets.fajr=26;old.donation.visible=true;const app=runtime({storage:new Map([[OLD_SETTINGS,JSON.stringify(old)]])}),profile={...newYork,hourFormat:12,dateStyle:'hijri'},raw=table(profile);app.window.MosqueInstall.commit(profile,raw);const context=app.window.MosqueInstall.getContext();eq(context.settings.iqama.offsets.fajr,26);eq(context.settings.donation.visible,true);eq(context.profile.timezone,'America/New_York');eq(app.document.getElementById('clockTime').textContent,'01:15:00');eq(app.document.getElementById('clockPeriod').textContent,'AM');eq(app.document.getElementById('gregorianDate').hidden,true);eq(app.document.getElementById('hijriDate').hidden,false);const validated=app.api.validateTimetable(raw),events=app.api.buildEvents(validated,context.settings),reference=raw.records.find(row=>row.date==='2026-11-17');eq(events.find(row=>row.id==='2026-11-17/fajr').adhan,reference.instants.fajr);const loaded=runtime({storage:app.storage});same(loaded.window.MosqueInstall.getContext().profile,profile);eq(loaded.api.getSettings().iqama.offsets.fajr,26);
});
test('An independently selected timezone override survives validation, commit, and reload',()=>{
  const profile={...cairo,timezone:'Asia/Kolkata',hourFormat:24,dateStyle:'both'},app=runtime();app.window.MosqueInstall.commit(profile,table(profile));const loaded=runtime({storage:app.storage});eq(loaded.window.MosqueInstall.getContext().profile.timezone,'Asia/Kolkata');eq(loaded.document.getElementById('clockTime').textContent,'11:45:00');eq(loaded.document.getElementById('clockPeriod').textContent,'');eq(loaded.document.getElementById('hijriDate').hidden,false);eq(loaded.document.getElementById('gregorianDate').hidden,false);
});
test('A legacy authority timetable can be imported by catalog city name and its installed free-form label survives an upgrade',()=>{
  const app=runtime(),raw=table(cairo);
  raw.metadata.verificationStatus='authority-supplied-unverified';
  delete raw.metadata.countryId;
  delete raw.metadata.cityId;
  raw.metadata.city=' cairo ';
  app.window.MosqueInstall.commit(cairo,raw);
  const installed=JSON.parse(app.storage.get(INSTALL));
  installed.timetable.metadata.city='Local district prayer authority';
  app.storage.set(INSTALL,JSON.stringify(installed));
  const loaded=runtime({storage:app.storage});
  eq(loaded.window.MosqueInstall.getContext().hasInstallation,true);
  eq(loaded.api.database.metadata.city,installed.timetable.metadata.city);
  eq(loaded.writes.length,0);
  rejects(()=>loaded.api.validateTimetable(installed.timetable));
  for(const mismatched of [{countryId:'US'},{cityId:newYork.cityId}]){
    const candidate=clone(raw);
    Object.assign(candidate.metadata,mismatched);
    rejects(()=>loaded.api.validateTimetable(candidate));
  }
});
for(const [name,mutate]of [
  ['wrong timezone',value=>value.metadata.timezone='UTC'],
  ['wrong coordinates',value=>value.metadata.coordinates.latitude+=1],
  ['wrong preset ID',value=>value.metadata.calculation.method='Karachi'],
  ['wrong Fajr angle',value=>value.metadata.calculation.fajrAngle=0],
  ['wrong Asr shadow factor',value=>value.metadata.calculation.asrShadowFactor=2],
  ['out-of-order absolute prayer',value=>value.records[20].instants.fajr=value.records[20].instants.dhuhr],
  ['non-minute calculated instant',value=>value.records[20].instants.fajr+=1],
  ['absolute/wall time mismatch',value=>value.records[20].instants.fajr+=60000],
  ['duplicate civil date',value=>value.records[20].date=value.records[19].date],
  ['missing calculated instants',value=>delete value.records[20].instants]
])test('Prepared validation rejects '+name+' before writes and restores temporary profile context',()=>{
  const app=runtime(),bad=table(cairo);mutate(bad);rejects(()=>app.window.MosqueInstall.validatePrepared(cairo,bad));eq(app.writes.length,0);eq(app.window.MosqueInstall.getContext().profile,null);eq(app.window.MosqueInstall.getContext().hasInstallation,false);eq(app.window.MosqueInstall.getContext().required,true);
});
test('A denied primary commit preserves the old full snapshot, mirrors, and active profile without a false setup success',()=>{
  const app=runtime(),oldProfile={...newYork},oldTable=table(oldProfile);app.window.MosqueInstall.commit(oldProfile,oldTable);const before=[INSTALL,OLD_SETTINGS,OLD_TABLE].map(key=>app.storage.get(key)),failKeys=new Set([INSTALL]),failed=runtime({storage:app.storage,failKeys});const previous=failed.window.MosqueInstall.getContext();rejects(()=>failed.window.MosqueInstall.commit(cairo,table(cairo)));same([INSTALL,OLD_SETTINGS,OLD_TABLE].map(key=>failed.storage.get(key)),before);same(failed.window.MosqueInstall.getContext().profile,previous.profile);same(failed.window.MosqueInstall.getContext().settings,previous.settings);same(failed.attempts,[INSTALL]);eq(failed.writes.length,0);eq(failed.window.MosqueInstall.getContext().hasInstallation,true);
  const fresh=runtime({failKeys});rejects(()=>fresh.window.MosqueInstall.commit(cairo,table(cairo)));eq(fresh.window.MosqueInstall.getContext().required,true);eq(fresh.window.MosqueInstall.getContext().hasInstallation,false);eq(fresh.window.MosqueInstall.getContext().profile,null);
});
test('Legacy mirror failures after a successful primary write do not erase the durable installation',()=>{
  const app=runtime({failKeys:new Set([OLD_SETTINGS,OLD_TABLE])});same(app.window.MosqueInstall.commit(cairo,table(cairo)),{ok:true});same(app.writes,[INSTALL]);const loaded=runtime({storage:app.storage});eq(loaded.window.MosqueInstall.getContext().hasInstallation,true);same(loaded.window.MosqueInstall.getContext().profile,cairo);
});
test('The original settings Save persists inside the primary bundle, while quota failure retains the draft and old durable settings',()=>{
  const app=runtime();app.window.MosqueInstall.commit(newYork,table(newYork));const loaded=runtime({storage:app.storage,failKeys:new Set([INSTALL])});loaded.api.openSettings();loaded.edit('الفجر (دقيقة)',11);const old=loaded.storage.get(INSTALL);loaded.document.getElementById('saveButton').click();eq(loaded.storage.get(INSTALL),old);eq(loaded.window.MosqueInstall.getContext().settings.iqama.offsets.fajr,10);eq(loaded.api.getSettings().iqama.offsets.fajr,10);eq(loaded.document.getElementById('settingsDialog').open,true);const success=runtime({storage:app.storage});success.api.openSettings();success.edit('الفجر (دقيقة)',11);success.document.getElementById('saveButton').click();eq(profileStore.read({getItem:key=>success.storage.get(key)??null}).settings.iqama.offsets.fajr,11);const reloaded=runtime({storage:success.storage});eq(reloaded.api.getSettings().iqama.offsets.fajr,11);same(reloaded.window.MosqueInstall.getContext().profile,newYork);
});
test('A settings rename updates the durable profile, the actual wizard adapter seed, and reload; a failed rename changes none of them',()=>{
  const app=runtime();app.window.MosqueInstall.commit(cairo,table(cairo));app.api.openSettings();app.edit('اسم الجامع','Renamed Mosque from settings');app.document.getElementById('saveButton').click();const raw=app.storage.get(INSTALL),snapshot=JSON.parse(raw);eq(snapshot.settings.mosque.fields.name.value,'Renamed Mosque from settings');eq(snapshot.profile.mosqueName,'Renamed Mosque from settings');eq(app.window.MosqueInstall.getContext().profile.mosqueName,'Renamed Mosque from settings');
  app.window.MosqueSetup={getState:()=>({profile:app.window.MosqueInstall.getContext().profile}),open(){}};vm.runInNewContext(adapterSource,app.window,{filename:'dev/profile-adapter.js',timeout:3000});const seed=app.window.MosqueProfile.load();eq(seed.mosqueName,'Renamed Mosque from settings');seed.mosqueName='External seed mutation';eq(app.window.MosqueInstall.getContext().profile.mosqueName,'Renamed Mosque from settings');
  const loaded=runtime({storage:app.storage});eq(loaded.window.MosqueInstall.getContext().profile.mosqueName,'Renamed Mosque from settings');eq(loaded.document.getElementById('mosqueInfo').querySelector('h1').textContent,'Renamed Mosque from settings');const failed=runtime({storage:app.storage,failKeys:new Set([INSTALL])});failed.api.openSettings();failed.edit('اسم الجامع','Denied rename');failed.document.getElementById('saveButton').click();eq(failed.storage.get(INSTALL),raw);eq(failed.window.MosqueInstall.getContext().profile.mosqueName,'Renamed Mosque from settings');eq(failed.window.MosqueInstall.getContext().settings.mosque.fields.name.value,'Renamed Mosque from settings');eq(failed.api.getSettings().mosque.fields.name.value,'Renamed Mosque from settings');eq(failed.document.getElementById('settingsDialog').open,true);
});
test('Committing a profile is blocked during a real core prayer phase without changing stored installation data',()=>{
  const app=runtime();app.window.MosqueInstall.commit(cairo,table(cairo));const context=app.window.MosqueInstall.getContext(),db=app.api.validateTimetable(table(cairo)),event=app.api.buildEvents(db,context.settings).find(event=>event.date==='2026-11-17'&&event.prayer==='dhuhr');app.setNow(event.iqama+1000);eq(app.api.getState().phase,'PRAYER_MODE');const old=app.storage.get(INSTALL);rejects(()=>app.window.MosqueInstall.commit(newYork,table(newYork)));eq(app.storage.get(INSTALL),old);same(app.window.MosqueInstall.getContext().profile,cairo);
});
test('Actual Ummah parser output with honestly unreported angles validates, commits, and reloads through the core unchanged',()=>{
  const raw=provider.fromUmmah(providerContext.makePayload(cairo,2026),cairo,2026,calendar),app=runtime();eq(raw.metadata.calculation.fajrAngle,null);eq(raw.metadata.calculation.ishaAngle,null);eq(raw.metadata.calculation.library,'UmmahAPI (remote astronomical calculation)');eq(app.window.MosqueInstall.validatePrepared(cairo,raw),true);same(app.window.MosqueInstall.commit(cairo,raw),{ok:true});const loaded=runtime({storage:app.storage});eq(loaded.window.MosqueInstall.getContext().hasInstallation,true);eq(loaded.api.database.metadata.calculation.fajrAngle,null);eq(loaded.api.database.metadata.calculation.ishaAngle,null);eq(loaded.api.database.metadata.sourceResponsesValidated,26);eq(loaded.api.database.metadata.verificationStatus,'calculated-needs-review');
});
test('The remote metadata exception never accepts a different URL, invented exact angles, shadow policy, or incompatible intervals',()=>{
  const valid=provider.fromUmmah(providerContext.makePayload(cairo,2026),cairo,2026,calendar);for(const mutate of [raw=>raw.metadata.sourceUrl='https://example.invalid',raw=>raw.metadata.calculation.fajrAngle=19.5,raw=>raw.metadata.calculation.asrShadowFactor=2,raw=>raw.metadata.calculation.ishaMinutesOutsideRamadan=90]){const app=runtime(),bad=clone(valid);mutate(bad);rejects(()=>app.window.MosqueInstall.validatePrepared(cairo,bad));eq(app.writes.length,0);eq(app.window.MosqueInstall.getContext().profile,null);}
});
test('Umm al-Qura actual Isha intervals must match the local Ramadan date even when all clocks and absolute ordering are otherwise valid',()=>{
  const country=catalog.countries.find(item=>item.id==='SA'),city=country.cities.find(item=>item.id==='110336'),p={...cairo,countryId:'SA',cityId:city.id,latitude:city.latitude,longitude:city.longitude,timezone:city.timezone,methodId:'UmmAlQura'},raw=table(p),row=raw.records.find(item=>item.date==='2026-02-18');row.instants.isha+=30*60000;const parts=engine.wallParts(row.instants.isha,p.timezone);row.isha=String(parts.hour).padStart(2,'0')+':'+String(parts.minute).padStart(2,'0');const app=runtime();rejects(()=>app.window.MosqueInstall.validatePrepared(p,raw));eq(app.writes.length,0);eq(app.window.MosqueInstall.getContext().profile,null);
});
const report={executedAt:new Date().toISOString(),appSHA256:crypto.createHash('sha256').update(appSource).digest('hex'),method:'Actual dev/app.js and shell/data are evaluated in the existing full-application minimal DOM factory, preloaded with the actual engine, atomic store, full local calendar and GeoNames catalog. Provider compatibility uses its actual parser and the existing generated full-coverage fixture builder, not live downloaded coverage. Storage failures are atomic fakes. The core production MosqueInstall API is exercised; clock injection is test-mode only. No browser, Android/TV, visual layout, network source fetch, physical update, or real storage-quota test executed.',passed:checks.filter(item=>item.pass).length,total:checks.length,failed:checks.filter(item=>!item.pass).length,checks};console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
