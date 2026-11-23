// Runs the actual packaged client against a small DOM and explicitly driven HTTP replies.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'phone.html'),'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const settle = () => new Promise(resolve=>setImmediate(resolve));
const copy = object => JSON.parse(JSON.stringify(object));
const config = JSON.parse(fs.readFileSync(path.join(__dirname,'../dev/config.json'),'utf8'));

function client(language='ar-SA') {
  const requests=[], downloads=[], revoked=[], confirmReplies=[], timers=new Map();
  let clock=0, serial=0, active=null;
  function matches(node,selector) {
    if(selector.includes(',')) return selector.split(',').some(s=>matches(node,s));
    if(selector.startsWith('.'))return node.className===selector.slice(1);
    const match=selector.match(/^([\w-]+)?\[([\w-]+)(?:=([^\]]+))?\]$/);
    if(match){const [,tag,key,value]=match,property=key.startsWith('data-')?node.dataset[key.slice(5)]:node[key];
      return (!tag || node.tag===tag) && (value===undefined?property!==undefined:property===value);}
    return node.tag===selector;
  }
  class Element {
    constructor(tag) {
      this.tag=tag; this.value=''; this.children=[]; this.dataset={}; this.listeners={}; this.disabled=false;
      this.classList={toggle(){}};
    }
    setAttribute(key,value) {
      if(key.startsWith('data-'))this.dataset[key.slice(5)]=value;
      else if(['hidden','disabled','checked','open'].includes(key))this[key]=true;
      else this[key]=value;
    }
    append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const child of [...this.children])child.remove();this.append(...nodes);}
    remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
    insertBefore(node,before){node.remove();node.parentNode=this;this.children.splice(this.children.indexOf(before),0,node);}
    get nextElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1];}
    get previousElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)-1];}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(matches(child,selector)?[child]:[]),...child.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
    closest(selector){return matches(this,selector)?this:this.parentNode?.closest(selector);}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
    focus(){active=this;}
    fire(type,fields={}){const event={target:this,type,preventDefault(){},...fields};
      for(let el=this;el;el=el.parentNode)for(const fn of el.listeners[type] || [])fn(event);}
    click(){if(!this.disabled && !this.closest('fieldset')?.disabled)this.fire('click');}
  }
  const root=new Element('document'), stack=[root];
  for(const [tag] of html.split('<script>')[0].replace(/<style>[\s\S]*?<\/style>/,'').matchAll(/<\/?[\w-]+[^>]*>/g)){
    if(tag.startsWith('</')){stack.pop();continue;}
    const name=tag.match(/^<([\w-]+)/)[1],node=new Element(name);
    for(const attr of tag.slice(name.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1],attr[2]??'');
    stack.at(-1).append(node);if(!['meta','input','br'].includes(name))stack.push(node);
  }
  const byId=id=>root.querySelector('[id='+id+']');
  const sandbox={
    document:{documentElement:root.querySelector('html'),body:root.querySelector('body'),createElement:name=>new Element(name),
      getElementById:byId,querySelector:s=>root.querySelector(s),querySelectorAll:s=>root.querySelectorAll(s)},
    location:{hash:'#'+'1'.repeat(48),pathname:'/'},history:{replaceState(){}},navigator:{language},
    performance:{now:()=>clock},crypto:require('node:crypto').webcrypto,AbortController,Blob,
    URL:{createObjectURL(blob){downloads.push(blob);return 'blob:phone-'+downloads.length;},revokeObjectURL(url){revoked.push(url);}},
    confirm:()=>confirmReplies.shift()??false,addEventListener:(event,action)=>root.addEventListener(event,action),
    setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,at:clock+delay});return id;},
    clearTimeout(id){timers.delete(id);},
    fetch(url,options){return new Promise((resolve,reject)=>{
      const reply=(status,data={})=>resolve({status,ok:status>=200&&status<300,json:async()=>copy(data)});
      options.signal.addEventListener('abort',()=>reject(Error('Deadline')),{once:true});
      requests.push({url,options,reply});});}
  };
  vm.runInNewContext(source,sandbox);
  async function advance(ms){clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock&&timers.delete(id))timer.fn();await settle();}
  function liveCounts(node=root) {
    return node.children.reduce((a,n)=>{const child=liveCounts(n);return {nodes:a.nodes+child.nodes,listeners:a.listeners+child.listeners};},
      {nodes:1,listeners:Object.values(node.listeners).reduce((n,handlers)=>n+handlers.length,0)});
  }
  return {$:byId,keys:root.querySelectorAll('[data-key]'),document:sandbox.document,requests,downloads,revoked,confirmReplies,advance,timers,liveCounts,hide:()=>root.fire('pagehide'),get focus(){return active;}};
}
const state = {
  ok:true, revision:1,
  settings:{mosqueName:'جامع الاختبار',neighborhood:'الشرق',announcements:[{label:'أ','text':'الإعلان الأول'},{label:'ب',text:'الإعلان الثاني'}],
    iqamaOffsets:{fajr:25,dhuhr:20,asr:20,maghrib:10,isha:20},jumuahTime:'',prayerModeMinutes:15,manualOverrides:[],
    silentPhoneReminder:true,postPrayerMinutes:5,hourFormat:24,dateStyle:'both',fridayProgram:{...config.fridayProgram}},
  backup:copy(config)
};
state.backup.mosque.fields.name.value=state.settings.mosqueName;

async function load(c,settings=state.settings) {
  c.requests[0].reply(200,{connected:true,expiresInMs:900000});await settle();c.$('settings-tab').click();
  c.requests[1].reply(200,{ok:true,revision:state.revision,settings});await settle();
}
function change(c,id,value){const n=c.$(id);n.value=String(value);n.fire('input');}
async function assetTests(){
  assert(Buffer.byteLength(html)<=64*1024,'Single pairing page fits the original asset size bound.');
  assert.doesNotMatch(source,/\.innerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\s*\(/);
  assert.doesNotMatch(html,/<(?:link|img|script)\b[^>]*(?:src|href)=["'](?:https?:)?\/\//i);
}
async function remoteTests() {
  const c=client(),r=c.requests;
  assert.equal(r.length,1);assert.equal(r[0].url,'/api/status');assert(c.keys.every(node=>node.disabled));
  assert(c.$('settings-tab').disabled);assert.match(r[0].options.headers['X-Mosque-Client'],/^[0-9a-f]{32}$/);
  r[0].reply(202,{pending:true,code:'001234'});await settle();assert.equal(c.$('code').textContent,'001234');assert(!c.$('code').hidden);
  c.keys[0].click();c.$('settings-tab').click();assert.equal(r.length,1);
  await c.advance(2000);r[1].reply(200,{connected:true,expiresInMs:850000});await settle();
  assert(c.$('code').hidden);assert(c.keys.every(node=>!node.disabled));assert(!c.$('send').disabled);
  c.$('text').value='نص تجريبي';c.$('send').click();assert.equal(r[2].url,'/api/text');assert.equal(JSON.parse(r[2].options.body).text,'نص تجريبي');
  assert.equal(r[2].options.headers['X-Mosque-Client'],r[0].options.headers['X-Mosque-Client']);assert.equal(r[2].options.redirect,'error');assert.equal(r[2].options.credentials,'omit');
  await c.advance(5000);assert.match(c.$('state').textContent,/لم يتأكد/);
  c.keys[0].click();assert.equal(r[3].url,'/api/key');r[3].reply(429);await settle();assert.match(c.$('state').textContent,/انتظر/);
  c.keys[0].click();r[4].reply(403);await settle();assert(c.keys.every(node=>node.disabled));assert(c.$('settings-tab').disabled);
  assert.equal(c.timers.size,0);
  const expired=client(); expired.requests[0].reply(202,{pending:true,code:'123456'});await settle();await expired.advance(60000);
  assert(expired.$('code').hidden);assert.equal(expired.requests.length,1);assert(expired.keys.every(k=>k.disabled));assert.equal(expired.timers.size,0);
}
async function editorTests() {
  const c=client('en-GB'),r=c.requests;await load(c);
  assert.equal(r[1].url,'/api/pairing/state');assert.equal(r[1].options.method,'GET');assert.equal(c.document.documentElement.dir,'ltr');
  assert.equal(c.$('apply').textContent,'Save & Apply to TV');assert.equal(c.$('mosqueName').value,state.settings.mosqueName);
  assert(!c.$('editor-fields').disabled);assert(c.$('apply').disabled);assert.equal(c.timers.size,1);
  change(c,'mosqueName','New Mosque');change(c,'neighborhood','North');change(c,'offset-fajr','35');change(c,'jumuahTime','12:30');
  change(c,'prayerModeMinutes','11');change(c,'hourFormat','12');change(c,'dateStyle','hijri');change(c,'postPrayerMinutes','7');
  assert.equal(c.$('friday-group').hidden,false);assert.equal(c.$('fridayStart').value,'');assert.equal(c.$('fridayDuration').value,'');
  change(c,'fridayStart','07:10');change(c,'fridayNotice','10:50');change(c,'fridaySeconds','40');change(c,'fridayDuration','9');
  c.$('silentPhoneReminder').checked=false;c.$('silentPhoneReminder').fire('input');
  const anns=c.$('announcements');anns.children[1].querySelector('[data-action=up]').click();assert.equal(anns.children[0].querySelector('[name=label]').value,'ب');
  anns.children[1].querySelector('[data-action=remove]').click();c.$('add-ann').click();anns.children[1].querySelector('[name=text]').value='Lobby closed';
  c.$('add-override').click();const o=c.$('overrides').children[0];o.querySelector('[name=date]').value='2026-12-04';o.querySelector('[name=time]').value='17:30';o.querySelector('[name=prayer]').value='maghrib';
  c.$('language').click();assert.equal(c.document.documentElement.dir,'rtl');assert.equal(c.$('apply').textContent,'حفظ وتطبيق على الشاشة');
  c.$('remote-tab').click();c.$('settings-tab').click();assert.equal(r.length,2);assert.equal(c.$('mosqueName').value,'New Mosque');
  c.$('editor').fire('submit');assert(c.$('apply').disabled);c.$('editor').fire('submit');assert.equal(r.length,3);
  const submitted=JSON.parse(r[2].options.body);assert.deepEqual(Object.keys(submitted).sort(),['revision','settings']);
  assert.equal(r[2].url,'/api/pairing/apply-settings');assert.equal(r[2].options.headers['X-Mosque-Token'],'1'.repeat(48));
  assert.deepEqual(submitted.settings,{...state.settings,mosqueName:'New Mosque',neighborhood:'North',jumuahTime:'12:30',prayerModeMinutes:11,
    fridayProgram:{enabled:true,startTime:'07:10',noticeTime:'10:50',cardSeconds:40,prayerMinutes:9},
    iqamaOffsets:{...state.settings.iqamaOffsets,fajr:35},announcements:[state.settings.announcements[1],{label:'',text:'Lobby closed'}],
    manualOverrides:[{date:'2026-12-04',time:'17:30',prayer:'maghrib'}],silentPhoneReminder:false,postPrayerMinutes:7,hourFormat:12,dateStyle:'hijri'});
  const saved=copy(state);saved.revision=2;saved.settings=submitted.settings;saved.backup.mosque.fields.name.value='New Mosque';
  r[2].reply(200,{ok:true,revision:saved.revision,settings:saved.settings});await settle();assert.match(c.$('form-status').textContent,/حُفظت/);assert(c.$('apply').disabled);assert.equal(r.length,3);
  c.$('download').click();assert.equal(r[3].url,'/api/pairing/state?export=1');r[3].reply(200,saved);await settle();assert.deepEqual(JSON.parse(await c.downloads[0].text()),saved.backup);
  await c.advance(1000);assert.equal(c.revoked.length,1);assert.equal(c.timers.size,1);
}
async function validationTests() {
  const c=client('en'),r=c.requests;await load(c);
  change(c,'mosqueName','Invalid\u202ename');c.$('editor').fire('submit');assert.equal(r.length,2);assert.equal(c.focus.id,'mosqueName');assert.match(c.$('form-status').textContent,/invalid/);
  change(c,'mosqueName','Corrected');change(c,'fridayStart','12:00');c.$('editor').fire('submit');assert.equal(r.length,2);assert.equal(c.focus.id,'fridayStart');change(c,'fridayStart','');
  change(c,'mosqueName','Corrected');change(c,'offset-isha',181);c.$('editor').fire('submit');assert.equal(r.length,2);assert.equal(c.focus.id,'offset-isha');
  change(c,'offset-isha',10);c.$('editor').fire('submit');r[2].reply(409,{ok:false,error:'conflict'});await settle();
  assert.equal(c.$('mosqueName').value,'Corrected');assert(!c.$('reload').hidden);assert(c.$('apply').disabled);
  c.confirmReplies.push(false);c.$('reload').click();assert.equal(r.length,3);
  c.confirmReplies.push(true);c.$('reload').click();r[3].reply(200,{...state,revision:3});await settle();assert.equal(c.$('mosqueName').value,state.settings.mosqueName);
  c.$('add-override').click();c.$('add-override').click();
  for(const row of c.$('overrides').children){row.querySelector('[name=date]').value='2026-12-04';row.querySelector('[name=time]').value='12:00';}
  c.$('editor').fire('submit');assert.equal(r.length,4);assert.match(c.$('form-status').textContent,/already has/);
}
async function legacyFridayTests() {
  const c=client(),settings=copy(state.settings);delete settings.fridayProgram;
  await load(c,settings);
  assert.equal(c.$('friday-group').hidden,true);
  change(c,'mosqueName','اسم جديد');c.$('editor').fire('submit');
  assert.equal(JSON.parse(c.requests[2].options.body).settings.fridayProgram,undefined);
}
async function backupTests() {
  const c=client('en-US'),r=c.requests;await load(c);
  const legacy=copy(config);legacy.mosque.fields.name.value='Restored mosque';delete legacy.postPrayerMinutes;delete legacy.silentPhoneReminder;delete legacy.fridayProgram;
  legacy.iqama.overrides=[{id:'fri',kind:'weekday',match:'5',prayer:'dhuhr',time:'12:40',label:''}];
  async function choose(raw){c.$('backupFile').files=[new Blob([raw])];c.$('backupFile').fire('change');await settle();}
  await choose(JSON.stringify(legacy));assert.match(c.$('form-status').textContent,/Review it/);assert.equal(r.length,2);
  assert.equal(c.$('jumuahTime').value,'12:40');assert.equal(c.$('mosqueName').value,'Restored mosque');
  assert.equal(c.$('fridayNotice').value,state.settings.fridayProgram.noticeTime);
  c.$('download').click();r[2].reply(200,state);await settle();assert.deepEqual(JSON.parse(await c.downloads[0].text()),state.backup,'Export reflects saved TV settings until restore is applied');
  await choose('{"schemaVersion":2}');assert.match(c.$('form-status').textContent,/Invalid/);assert.equal(c.$('mosqueName').value,'Restored mosque');
  await choose('{"__proto__":{}}');assert.match(c.$('form-status').textContent,/Invalid/);
  await choose(JSON.stringify({...legacy,timetable:{records:[]}}));assert.match(c.$('form-status').textContent,/Invalid/);
  await choose(JSON.stringify({...legacy,fridayProgram:{...config.fridayProgram,cardSeconds:0}}));assert.match(c.$('form-status').textContent,/Invalid/);
  await choose('x'.repeat(129*1024));assert.equal(r.length,3);
  change(c,'mosqueName','Restored and reviewed');c.$('editor').fire('submit');const body=JSON.parse(r[3].options.body);
  assert.deepEqual(body.backup,legacy);assert.equal(body.settings.mosqueName,'Restored and reviewed');assert.equal(body.settings.neighborhood,state.settings.neighborhood);
  r[3].reply(403);await settle();assert(c.$('editor-fields').disabled);assert(c.$('apply').disabled);assert.match(c.$('form-status').textContent,/Pairing ended/);
  await c.advance(1000);assert.equal(c.timers.size,0);
}
async function largeBackupTests() {
  const c=client('en'),r=c.requests;await load(c);
  const backup=copy(state.backup),text=size=>'界'.repeat(size);
  backup.fridayProgram={...config.fridayProgram,startTime:'08:10',cardSeconds:45,prayerMinutes:9};
  for(const [key,field] of Object.entries(backup.mosque.fields))field.value=text(key==='name'?180:360);
  backup.mosque.custom=Array.from({length:8},(_,i)=>({id:String(i)+text(59),label:text(60),value:text(240),visible:true}));
  backup.iqama.overrides=Array.from({length:80},(_,i)=>({id:String(i)+text(57),kind:'date',match:new Date(Date.UTC(2027,0,i+1)).toISOString().slice(0,10),prayer:'fajr',time:'05:27',label:text(80)}));
  backup.announcements=Array.from({length:16},()=>({label:text(60),text:text(300)}));
  backup.manualOverrides=backup.iqama.overrides.map(o=>({date:o.match,prayer:o.prayer,time:'05:00'}));
  backup.displayPreferences={neighborhood:text(180),hourFormat:24,dateStyle:'both'};
  const file=new Blob([JSON.stringify(backup,null,2)]);
  c.$('backupFile').files=[file];c.$('backupFile').fire('change');await settle();
  c.$('editor').fire('submit');
  assert.equal(r[2].url,'/api/pairing/apply-settings');
  assert(Buffer.byteLength(r[2].options.body)>96*1024);
  assert.deepEqual(JSON.parse(r[2].options.body).backup,backup);
  assert.deepEqual(JSON.parse(r[2].options.body).settings.fridayProgram,backup.fridayProgram);
  r[2].reply(200,state);await settle();assert.equal(c.timers.size,1);
}
async function lifecycleTests() {
  const c=client(),r=c.requests;await load(c);
  const counts=c.liveCounts();
  for(let i=0;i<40;i++){
    c.$('remote-tab').click();c.$('settings-tab').click();
    c.$('language').click();
    c.$('add-ann').click();c.$('announcements').children.at(-1).querySelector('[data-action=remove]').click();
    c.$('add-override').click();c.$('overrides').children.at(-1).querySelector('[data-action=remove]').click();
  }
  assert.deepEqual(c.liveCounts(),counts);assert.equal(c.timers.size,1);assert.equal(r.length,2);
  change(c,'mosqueName','Draft');c.$('download').click();
  const changed=copy(state);changed.revision=2;changed.settings.mosqueName='TV edit';changed.backup.mosque.fields.name.value='TV edit';
  r[2].reply(200,changed);await settle();assert.equal(JSON.parse(await c.downloads[0].text()).mosque.fields.name.value,'TV edit');
  assert.equal(c.$('mosqueName').value,'Draft');assert(c.$('apply').disabled);
  await c.advance(1000);assert.equal(c.timers.size,1);assert.deepEqual(c.liveCounts(),counts);
  await c.advance(899000);assert.equal(c.timers.size,0);assert.equal(c.$('mosqueName').value,'');
  assert.equal(c.$('announcements').children.length,0);assert(c.$('settings-tab').disabled);assert.equal(r.length,3);
  const leaving=client();await load(leaving);leaving.$('text').value='private note';leaving.hide();
  assert.equal(leaving.$('text').value,'');assert.equal(leaving.$('mosqueName').value,'');assert.equal(leaving.timers.size,0);
}
(async()=>{for(const test of [assetTests,remoteTests,editorTests,validationTests,legacyFridayTests,backupTests,largeBackupTests,lifecycleTests]){await test();console.log('PASS '+test.name);}})().catch(e=>{console.error(e);process.exitCode=1;});
