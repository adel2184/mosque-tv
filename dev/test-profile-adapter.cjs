/* Actual adapter lifecycle tests with Worker/native/file-picker/core-boundary fakes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const engine=require('./location-engine.js'),store=require('./profile-store.js'),source=fs.readFileSync(path.join(__dirname,'profile-adapter.js'),'utf8');
const calendar=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/setup-calendar.json'),'utf8')),librarySource=fs.readFileSync(path.join(__dirname,'vendor/adhan/adhan.umd.cjs'),'utf8'),engineSource=fs.readFileSync(path.join(__dirname,'location-engine.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value)),assert=(value,message='Assertion failed')=>{if(!value)throw Error(message);};
const eq=(a,b)=>assert(a===b,`Expected ${JSON.stringify(b)}; got ${JSON.stringify(a)}`),same=(a,b)=>eq(JSON.stringify(a),JSON.stringify(b));
const profile=()=>({language:'ar',countryId:'SA',cityId:'110336',timezone:'Asia/Riyadh',hourFormat:12,dateStyle:'both',methodId:'UmmAlQura',neighborhood:'',mosqueName:'جامع الاختبار',latitude:26.43442,longitude:50.10326});
const catalog={countries:[{id:'SA',cities:[{id:'110336',nameAr:'الدمام',nameEn:'Dammam',timezone:'Asia/Riyadh',latitude:26.43442,longitude:50.10326}]}]},table=engine.calculate(profile(),2026,calendar),definitions=[],checks=[];
const test=(name,run)=>definitions.push({name,run});
function runtime(options={}){
  const nodes=new Map(),listeners=new Map(),workers=[],blobs=new Map(),revoked=[],timers=new Map(),readers=[],calls=[],status=[],opens=[],validations=[],commits=[],providerCalls=[];let serial=0,timerSerial=0;
  const body={children:[],appendChild(node){this.children.push(node);}};
  function node(tag,id,text=''){const value={tagName:tag.toUpperCase(),id,textContent:text,value:'',files:[],clicks:0,click(){this.clicks++;}};if(id)nodes.set(id,value);return value;}
  if(!options.missingLibrary)node('script','prayer-calculation-library',librarySource);if(!options.missingEngineCode)node('script','location-engine-code',engineSource);
  const document={body,getElementById:id=>nodes.get(id)||body.children.find(node=>node.id===id)||null,createElement:tag=>node(tag,'')};
  class TestBlob{constructor(parts,config){this.code=parts.map(String).join('');this.type=config.type;}}
  const URL={createObjectURL(blob){const id='blob:adapter-test/'+(++serial);blobs.set(id,blob);return id;},revokeObjectURL(id){revoked.push(id);blobs.delete(id);}};
  class Worker{
    constructor(url){if(options.workerConstructorError)throw Error('Simulated worker construction failure');this.url=url;this.code=blobs.get(url).code;this.terminated=false;this.messages=[];workers.push(this);}
    terminate(){this.terminated=true;}
    postMessage(value){if(options.workerPostError)throw Error('Simulated worker post failure');this.messages.push(value);}
    deliver(data){if(this.onmessage)this.onmessage({data});}
    runActual(){const worker={postMessage:data=>this.deliver(data)};worker.self=worker;vm.runInNewContext(this.code,worker,{timeout:10000});worker.onmessage({data:this.messages[0]});}
  }
  class FileReader{constructor(){readers.push(this);}readAsText(file,encoding){this.file=file;this.encoding=encoding;}complete(text){this.result=text;this.onload();}}
  const core={getContext:()=>({profile:options.installedProfile?clone(options.installedProfile):null,settings:{mosque:{fields:{name:{value:options.savedName??'اسم محفوظ'}}}},required:Boolean(options.required),calendar,catalog,year:2026}),validatePrepared(p,t){validations.push({profile:p,table:t});if(options.rejectValidation)throw Error('Core validation rejected the table');return true;},commit(p,t){commits.push({profile:p,table:t});if(options.failCommit)throw Error('Atomic write quota failure');return options.commitResult||{ok:true};}};
  const native={cancelSetupFetch(){calls.push(['cancelSetupFetch']);if(options.cancelThrows)throw Error('Simulated cancellation denial');},startSetupFetch(json){calls.push(['startSetupFetch',JSON.parse(json)]);if(options.fetchThrows)throw Error('Simulated native fetch start failure');},showKeyboard(){calls.push(['showKeyboard']);},openControl(id){calls.push(['openControl',id]);}};
  const provider={fromUmmah(payload,p,y,cal){providerCalls.push({payload,profile:p,year:y,calendar:cal});if(options.providerError)throw Error('Provider payload rejected');return clone(table);}};
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[options.now??Date.parse('2026-11-17T11:00:00Z')]));}static now(){return options.now??Date.parse('2026-11-17T11:00:00Z');}}
  const setup={getState:()=>({profile:profile()}),refreshStatus:value=>status.push(value),open:value=>opens.push(value)};
  const win={document,Date:ClockDate,Blob:TestBlob,URL,FileReader,Worker,console,MosqueInstall:core,MosqueLocation:engine,MosqueProfileStore:store,MosqueSetup:setup,MosqueSetupProvider:provider,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},setTimeout(fn,ms){const id=++timerSerial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};win.window=win;
  if(!options.noNative)win.MosqueAndroid=native;if(options.noWorker)delete win.Worker;if(options.noCore)delete win.MosqueInstall;if(options.noSetup)delete win.MosqueSetup;
  vm.runInNewContext(source,win,{filename:'dev/profile-adapter.js',timeout:3000});
  return{window:win,adapter:win.MosqueProfile,core,workers,blobs,revoked,timers,readers,calls,status,opens,validations,commits,providerCalls,document,
    emit(detail){for(const fn of listeners.get('mosque-native-setup-result')||[])fn({detail});},
    async settle(){await new Promise(resolve=>setImmediate(resolve));},
    async prepared(){const pending=win.MosqueProfile.prepare(profile());workers.at(-1).deliver({ok:true,table:clone(table)});return await pending;}
  };
}

test('Loading an operational adapter performs no calculation, download, import, or commit; required setup opens only its UI',()=>{
  const app=runtime();assert(app.adapter);eq(app.calls.length,0);eq(app.workers.length,0);eq(app.commits.length,0);eq(app.opens.length,0);same(app.adapter.catalog(),catalog);eq(app.adapter.load().mosqueName,'اسم محفوظ');const fresh=runtime({required:true});same(fresh.opens,[{required:true}]);eq(fresh.adapter.load().mosqueName,'');eq(fresh.calls.length,0);eq(fresh.commits.length,0);
});
test('Missing core/setup prerequisites leave the adapter uninstalled and a desktop runtime exposes no native download or keyboard action',()=>{
  for(const options of [{noCore:true},{noSetup:true}]){const app=runtime(options);eq(app.adapter,undefined);eq(app.workers.length,0);eq(app.calls.length,0);}const desktop=runtime({noNative:true});eq(desktop.adapter.downloadData,undefined);eq(desktop.adapter.openKeyboard,undefined);eq(desktop.adapter.openPhone,undefined);
});
test('An installed wizard seed uses the current settings name including blank, preserves the profile neighborhood, and never mutates the core profile',()=>{
  const original={...profile(),mosqueName:'Original setup name',neighborhood:'Original neighborhood'};for(const savedName of ['Name edited in settings','']){const app=runtime({installedProfile:original,savedName}),loaded=app.adapter.load();eq(loaded.mosqueName,savedName);eq(loaded.neighborhood,'Original neighborhood');eq(app.core.getContext().profile.mosqueName,'Original setup name');loaded.mosqueName='Modified returned seed';eq(app.core.getContext().profile.mosqueName,'Original setup name');eq(app.commits.length,0);eq(app.calls.length,0);}
});
test('Explicit offline preparation executes the actual generated Blob worker and validates its complete table before offering data',async()=>{
  const app=runtime(),pending=app.adapter.prepare(profile());eq(app.workers.length,1);eq(app.workers[0].messages[0].year,2026);same(app.workers[0].messages[0].profile,engine.validateProfile(profile(),catalog));eq(app.timers.size,1);eq([...app.timers.values()][0].ms,90000);eq(app.commits.length,0);app.workers[0].runActual();const result=await pending;eq(result.ok,true);eq(result.table.records.length,732);eq(result.profileKey,JSON.stringify(engine.validateProfile(profile(),catalog)));eq(app.validations.length,1);eq(app.commits.length,0);eq(app.workers[0].terminated,true);eq(app.timers.size,0);eq(app.blobs.size,0);eq(app.revoked.length,1);
});
test('Cancelling a worker resolves failure, releases resources, and ignores its stale onmessage after a replacement begins',async()=>{
  const app=runtime(),first=app.adapter.prepare(profile()),old=app.workers[0],oldCallback=old.onmessage;app.adapter.cancelPrepare();eq((await first).ok,false);eq(old.terminated,true);eq(app.timers.size,0);const second=app.adapter.prepare(profile());oldCallback({data:{ok:true,table:clone(table)}});eq(app.validations.length,0);app.workers[1].deliver({ok:true,table:clone(table)});eq((await second).ok,true);eq(app.validations.length,1);eq(app.commits.length,0);
});
test('Worker timeout, runtime failure, construction/post failure and absent assets/capabilities return an honest failure with no commit',async()=>{
  for(const mode of ['timeout','error','badResult','validation','constructor','post','library','source','capability']){const app=runtime({rejectValidation:mode==='validation',workerConstructorError:mode==='constructor',workerPostError:mode==='post',missingLibrary:mode==='library',missingEngineCode:mode==='source',noWorker:mode==='capability'}),pending=app.adapter.prepare(profile());if(mode==='timeout')[...app.timers.values()][0].fn();else if(mode==='error')app.workers[0].onerror();else if(mode==='badResult')app.workers[0].deliver({ok:'true',table});else if(mode==='validation')app.workers[0].deliver({ok:true,table});const result=await pending;eq(result.ok,false);eq(result.canCalculate,true);eq(app.commits.length,0);eq(app.blobs.size,0);eq(app.timers.size,0);if(app.workers.length)eq(app.workers[0].terminated,true);}
});
test('Preparation uses the newly selected zone for target-year rollover rather than the previous context year',async()=>{
  const app=runtime({now:Date.parse('2026-12-31T16:00:00Z')}),p={...profile(),timezone:'Pacific/Auckland'},pending=app.adapter.prepare(p);eq(app.workers[0].messages[0].year,2027);app.adapter.cancelPrepare();eq((await pending).ok,false);
});
test('Native download starts only explicitly, request IDs isolate progress/results, and success is validated without auto-save',async()=>{
  const app=runtime(),pending=app.adapter.downloadData(profile()),request=app.calls.find(call=>call[0]==='startSetupFetch')[1];eq(request.requestId,1);eq(request.targetYear,2026);let settled=false;pending.then(()=>settled=true);app.emit({requestId:99,state:'fetching',progress:40});app.emit({requestId:99,state:'ready',payload:{wrong:true}});await app.settle();eq(settled,false);eq(app.status.length,0);eq(app.providerCalls.length,0);app.emit({requestId:1,state:'fetching',progress:40,messageAr:'جارٍ التنزيل'});eq(app.status.length,1);const payload={fixture:'provider-body'};app.emit({requestId:1,state:'ready',payload});const result=await pending;eq(result.ok,true);eq(app.providerCalls.length,1);eq(app.providerCalls[0].payload,payload);eq(app.providerCalls[0].year,2026);eq(app.validations.length,1);eq(app.commits.length,0);eq(app.workers.length,0);
});
test('Cancelling then restarting a native download prevents old request results from completing the new request',async()=>{
  const app=runtime(),first=app.adapter.downloadData(profile());app.adapter.cancelPrepare();eq((await first).ok,false);const second=app.adapter.downloadData(profile());const ids=app.calls.filter(call=>call[0]==='startSetupFetch').map(call=>call[1].requestId);same(ids,[1,2]);app.emit({requestId:1,state:'ready',payload:{stale:true}});eq(app.providerCalls.length,0);app.emit({requestId:2,state:'ready',payload:{current:true}});eq((await second).ok,true);eq(app.providerCalls.length,1);eq(app.commits.length,0);
});
test('Native fetch failure, provider rejection, core rejection, and a thrown fetch start never fall back to an automatic calculation or save',async()=>{
  for(const mode of ['native','provider','core','start']){const app=runtime({providerError:mode==='provider',rejectValidation:mode==='core',fetchThrows:mode==='start'});let result;if(mode==='start'){let rejected=false;try{await app.adapter.downloadData(profile());}catch(_){rejected=true;}assert(rejected);result={ok:false};}else{const pending=app.adapter.downloadData(profile());app.emit({requestId:1,state:mode==='native'?'error':'ready',payload:{fixture:true},messageEn:'Unavailable'});result=await pending;}eq(result.ok,false);eq(app.workers.length,0);eq(app.commits.length,0);}
});
test('File imports accept a direct table or an installation table only after selection/read/validation and never save automatically',async()=>{
  for(const wrapped of [false,true]){const app=runtime(),pending=app.adapter.importData(profile()),input=app.document.getElementById('setupTimetableFile');eq(input.clicks,1);eq(app.readers.length,0);input.files=[{size:200,content:'unused'}];input.onchange();eq(app.readers[0].encoding,'UTF-8');app.readers[0].complete(JSON.stringify(wrapped?{timetable:table}:table));const result=await pending;eq(result.ok,true);eq(app.validations.length,1);eq(app.commits.length,0);eq(app.workers.length,0);}
});
test('Cancelled, oversized, invalid-JSON, unreadable and stale file reads cannot become prepared data',async()=>{
  for(const mode of ['cancel','oversized','json','read','stale']){const app=runtime(),pending=app.adapter.importData(profile()),input=app.document.getElementById('setupTimetableFile');if(mode==='cancel')input.oncancel();else{input.files=[{size:mode==='oversized'?3000001:200}];input.onchange();if(mode==='json')app.readers[0].complete('{');else if(mode==='read')app.readers[0].onerror();else if(mode==='stale'){const reader=app.readers[0];app.adapter.cancelPrepare();reader.complete(JSON.stringify(table));}}eq((await pending).ok,false);eq(app.validations.length,0);eq(app.commits.length,0);}
});
test('A prepared snapshot saves exactly once only through explicit save and changed choices are rejected before core commit',async()=>{
  const app=runtime(),prepared=await app.prepared();eq(app.commits.length,0);for(const invalid of [null,{ok:'true',table}, {...prepared,profileKey:'old choices'}])eq(app.adapter.save(profile(),invalid).ok,false);eq(app.adapter.save({...profile(),hourFormat:24},prepared).ok,false);eq(app.commits.length,0);eq(app.adapter.save(profile(),prepared).ok,true);eq(app.commits.length,1);eq(app.commits[0].table,prepared.table);
});
test('An atomic commit exception or explicit failed result remains failure without claiming setup completion',async()=>{
  for(const options of [{failCommit:true},{commitResult:{ok:false,messageAr:'فشل الحفظ'}}]){const app=runtime(options),prepared=await app.prepared();const result=app.adapter.save(profile(),prepared);eq(result.ok,false);eq(app.commits.length,1);eq(app.opens.length,0);}
});
test('Keyboard and phone actions call only their requested native APIs; cancellation remains safe if the native cancel throws',async()=>{
  const app=runtime({cancelThrows:true});eq(app.calls.length,0);app.adapter.openKeyboard();app.adapter.openPhone();same(app.calls,[['showKeyboard'],['openControl','phone']]);const pending=app.adapter.prepare(profile());app.adapter.cancelPrepare();eq((await pending).ok,false);eq(app.workers[0].terminated,true);eq(app.commits.length,0);
});

(async()=>{for(const item of definitions){try{await item.run();checks.push({name:item.name,pass:true});}catch(error){checks.push({name:item.name,pass:false,error:error.stack});}}const report={executedAt:new Date().toISOString(),sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),method:'Actual profile-adapter.js with a controlled Worker/native/file-picker/core API boundary. One test executes the actual generated Blob worker containing vendored Adhan and the actual engine in a DOM-free VM; lifecycle timers/messages and file/native service responses are fakes. Core semantic validation and real provider parsing are covered separately. No network, real worker thread, browser, Android/TV, physical picker/IME, or durable storage is exercised.',passed:checks.filter(item=>item.pass).length,total:checks.length,failed:checks.filter(item=>!item.pass).length,checks};console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;})();
