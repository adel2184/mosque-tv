/* Development-only regression simulation of the actual control center and original settings UI.
 * This file is not an application module. No browser, Android, remote, or TV is executed. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),centerFile=path.join(root,'dev/control-center.js');
const centerSource=fs.readFileSync(centerFile,'utf8'),bridgeSource=fs.readFileSync(path.join(__dirname,'tv-bridge.js'),'utf8');
const appSource=fs.readFileSync(path.join(root,'dev/app.js'),'utf8');
const SETTINGS='mosque-display.settings.v1',TABLE='mosque-display.timetable.v1',CENTER='mosque-display.control-center.v1';
const DEFAULTS=['network','sound','speed','tv','app','update'];
const CATALOG=[...DEFAULTS,'phone','display','screensaver','home','power','deviceSetup'];
const checks=[];
const assert=(value,message='Assertion failed')=>{if(!value)throw Error(message);};
const eq=(actual,expected)=>assert(actual===expected,`Expected ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`);
const same=(actual,expected)=>eq(JSON.stringify(actual),JSON.stringify(expected));
function test(name,fn){try{fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}}

// Reuse the existing DOM/settings harness, including the real validator and save/cancel handlers.
// Only its test storage-key fixture is set to the production key; no application source is rewritten.
const legacyHarness=fs.readFileSync(path.join(__dirname,'test-tv-settings.cjs'),'utf8');
const firstLegacyTest=legacyHarness.indexOf("\ntest('Actual TV hub");
assert(firstLegacyTest>0,'Existing settings runtime factory was not found');
const actualShortcut=appSource.slice(appSource.indexOf("document.addEventListener('keydown',e=>{"),appSource.indexOf("document.addEventListener('mousemove',interaction"));
assert(actualShortcut.includes('launchControls()'),'Actual Menu/keyboard launcher was not found');
const factoryContext={require,__dirname,console,actualShortcut};
let factorySource=legacyHarness.slice(0,firstLegacyTest).replace("STORE='test'","STORE='"+SETTINGS+"'");
assert(factorySource.includes('${handlers}\\nwindow.TEST='),'Settings harness insertion point was not found');
factorySource=factorySource.replace('${handlers}\\nwindow.TEST=','${handlers}\\n${actualShortcut}\\nwindow.TEST=')
  .replace("key:key=>{const event=emit(listeners,'keydown',{key,ctrlKey:false,altKey:false});","key:(key,extra={})=>{const event=emit(listeners,'keydown',{key,ctrlKey:false,altKey:false,...extra});");
vm.runInNewContext(factorySource+"\nthis.createLegacyRuntime=runtime;",factoryContext,{timeout:4000});

function runtime(options={}){
  const app=factoryContext.createLegacyRuntime(),doc=app.document,win=app.window;
  const values=options.storage||new Map(),writes=[],pending=[],observers=[];
  const Element=doc.createElement('div').constructor;
  function matches(node,selector){
    selector=selector.trim();if(selector.includes(','))return selector.split(',').some(item=>matches(node,item));
    const negatives=[...selector.matchAll(/:not\(([^)]+)\)/g)].map(match=>match[1]);
    selector=selector.replace(/:not\([^)]+\)/g,'');if(negatives.some(item=>matches(node,item)))return false;
    const space=selector.lastIndexOf(' ');if(space>=0){if(!matches(node,selector.slice(space+1)))return false;for(let parent=node.parentNode;parent;parent=parent.parentNode)if(matches(parent,selector.slice(0,space)))return true;return false;}
    const attributes=[...selector.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/g)];
    selector=selector.replace(/\[[^\]]+\]/g,'');
    for(const match of attributes){const value=node.getAttribute(match[1]);if(value===null||(match[2]!==undefined&&String(value)!==match[2]))return false;}
    const id=selector.match(/#([\w-]+)/);if(id&&node.id!==id[1])return false;
    const classes=[...selector.matchAll(/\.([\w-]+)/g)].map(match=>match[1]);if(classes.some(value=>!node.classList.contains(value)))return false;
    const tag=selector.match(/^[\w-]+/);return !tag||node.tagName===tag[0].toUpperCase();
  }
  Element.prototype.getAttribute=function(name){
    if(name==='id')return this.id||null;if(name==='class')return this.className||null;
    if(name.startsWith('data-'))return this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??null;
    if(name==='disabled')return this.disabled?'':null;
    return this._attrs?.has(name)?this._attrs.get(name):null;
  };
  Element.prototype.setAttribute=function(name,value){
    if(name==='id')this.id=String(value);else if(name==='class')this.className=String(value);
    else if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);
    else{if(!this._attrs)this._attrs=new Map();this._attrs.set(name,String(value));if(name==='disabled')this.disabled=true;}
  };
  Element.prototype.hasAttribute=function(name){return this.getAttribute(name)!==null;};
  Element.prototype.removeAttribute=function(name){this._attrs?.delete(name);if(name==='disabled')this.disabled=false;};
  Element.prototype.contains=function(other){return this===other||this.children.some(child=>child.contains(other));};
  Element.prototype.querySelectorAll=function(selector){const found=[];const walk=node=>{for(const child of node.children){if(matches(child,selector))found.push(child);walk(child);}};walk(this);return found;};
  Element.prototype.querySelector=function(selector){return this.querySelectorAll(selector)[0]||null;};
  Element.prototype.closest=function(selector){for(let node=this;node;node=node.parentNode)if(matches(node,selector))return node;return null;};
  Element.prototype.getBoundingClientRect=function(){const hidden=node=>node&&(node.hidden||(node.tagName==='DIALOG'&&!node.open)||hidden(node.parentNode));return{left:0,top:0,right:200,bottom:60,width:hidden(this)?0:200,height:hidden(this)?0:60};};
  for(const [name,get]of Object.entries({firstChild(){return this.children[0]||null;},childElementCount(){return this.children.length;},parentElement(){return this.parentNode;},isConnected(){return doc.body.contains(this)||doc.head.contains(this);}}))Object.defineProperty(Element.prototype,name,{get,configurable:true});
  Element.prototype.removeChild=function(child){child.remove();return child;};
  doc.head=doc.createElement('head');doc.documentElement=doc.createElement('html');
  doc.documentElement.append(doc.head,doc.body);
  doc.querySelectorAll=selector=>doc.documentElement.querySelectorAll(selector);
  doc.querySelector=selector=>doc.querySelectorAll(selector)[0]||null;
  doc.contains=node=>doc.documentElement.contains(node);
  doc.createElementNS=(_,tag)=>doc.createElement(tag);
  const baseListen=doc.addEventListener.bind(doc);
  doc.addEventListener=(name,fn,capture)=>baseListen(name,event=>{event.target=event.target||doc.activeElement;event.stopPropagation=event.stopPropagation||(()=>event.propagationStopped=true);fn(event);},capture);
  win.document=doc;win.Element=Element;win.Blob=Blob;win.URL={createObjectURL:()=> 'blob:control-center-test',revokeObjectURL(){}};
  win.innerWidth=1920;win.innerHeight=1080;win.HTMLElement=Element;
  win.FileReader=class{};
  win.getComputedStyle=node=>({display:node.hidden?'none':'block',visibility:'visible'});
  win.requestAnimationFrame=fn=>{pending.push(fn);return pending.length;};win.cancelAnimationFrame=()=>{};
  win.setTimeout=fn=>{pending.push(fn);return pending.length;};win.clearTimeout=()=>{};win.setInterval=()=>1;win.clearInterval=()=>{};
  win.MutationObserver=class{constructor(fn){this.fn=fn;}observe(target,config){observers.push({target,config,fn:this.fn});}disconnect(){}};
  const bodyClasses=doc.body.classList;
  for(const method of ['add','remove','toggle']){const original=bodyClasses[method];bodyClasses[method]=(...args)=>{const result=original(...args);for(const observer of observers)if(observer.target===doc.body&&observer.config.attributes)pending.push(()=>observer.fn([{target:doc.body,type:'attributes',attributeName:'class'}]));return result;};}
  const store={getItem:key=>{if(options.readFailure)throw Error('Simulated unavailable storage');return values.has(key)?values.get(key):null;},setItem:(key,value)=>{if(options.writeFailure)throw Error('Simulated full storage');values.set(key,String(value));writes.push({key,value:String(value)});},removeItem:key=>values.delete(key)};
  win.localStorage=store;
  win.recordWrite=(key,value)=>{app.stored.set(key,value);store.setItem(key,value);};
  win.MosqueAndroid.exportJson=()=>{};win.MosqueAndroid.prayerState=()=>{};
  win.MosqueAndroid.deviceStatus=()=>JSON.stringify(options.device||{manufacturer:'TCL',model:'simulated fixture',network:{validated:true,connected:true,label:'Wi-Fi'},available:{bluetooth:true,mirror:true,wifi:true,sound:true,tv:true,display:true,screensaver:true}});
  let speedRunning=false;
  win.MosqueAndroid.speedStatus=()=>JSON.stringify({running:speedRunning,message:speedRunning?'اختبار تجريبي جارٍ':'لم يبدأ اختبار السرعة'});
  win.MosqueAndroid.controlStatus=()=>JSON.stringify(options.status||{device:'TCL simulated fixture',rows:{network:'Wi-Fi',sound:'مستوى الصوت'},available:Object.fromEntries([...CATALOG,'bluetooth','mirror','sleep'].map(id=>[id,true])),screensaverAvailable:true});
  win.MosqueAndroid.controlAction=id=>app.calls.push(['controlAction',id]);
  // These are native service fakes; the actual bridge still owns route selection and guards.
  for(const method of ['sleepMenu','displayOff','startSpeedTest','cancelSpeedTest'])win.MosqueAndroid[method]=value=>app.calls.push([method,value]);
  win.MosqueAndroid.startSpeedTest=()=>{speedRunning=true;app.calls.push(['startSpeedTest']);};
  win.MosqueAndroid.cancelSpeedTest=()=>{speedRunning=false;app.calls.push(['cancelSpeedTest']);};
  function flush(){let passes=0;while(pending.length){assert(++passes<100,'Scheduled DOM callbacks did not settle');for(const fn of pending.splice(0))fn();}}
  vm.runInNewContext(bridgeSource,win,{filename:'android/tv-bridge.js',timeout:4000});
  if(options.status)win.MosqueTVNative.controlStatus=()=>options.status;
  vm.runInNewContext(centerSource,win,{filename:'dev/control-center.js',timeout:4000});
  flush();
  const center=win.MosqueControl;assert(center,'Missing real MosqueControl API');
  return{...app,values,writes,center,flush,
    open(){center.open();flush();},
    click(id){const node=doc.getElementById(id);assert(node,'Missing '+id);node.click();flush();},
    key(key,extra){const event=app.key(key,extra);flush();return event;},
    menu(){const event=app.key(',',{ctrlKey:true,code:'Comma'});flush();return event;},
    back(){const result=center.handleBack();flush();return result;},
    prayer(value){win.TEST.setPrayer(value);doc.body.classList.toggle('praying',value);flush();},
    config(){const text=values.get(CENTER);return text?JSON.parse(text):null;},
    rows(){return doc.getElementById('ccRows').querySelectorAll('button').filter(node=>node.id.startsWith('cc-row-')).map(node=>node.id.slice(7));}
  };
}

const pref=(rows=DEFAULTS,lastId='cc-row-network')=>JSON.stringify({schemaVersion:1,rows,lastId});
const operatorCalls=app=>app.calls.filter(call=>call[0]!=='cancelSpeedTest');
const checked=(app,id)=>app.get('cc-option-'+id).getAttribute('aria-checked')==='true';
const activeInside=app=>{const panel=app.get('mosqueControlCenter');assert(panel.contains(app.document.activeElement),'Focus escaped the open control center');assert(app.document.activeElement.isConnected,'Focus remained on a detached node');assert(!app.document.activeElement.disabled,'Focus reached a disabled control');};
test('The real module opens six default rows without native actions or changing mosque/timetable storage',()=>{
  const values=new Map([[SETTINGS,'existing mosque settings'],[TABLE,'existing timetable']]),app=runtime({storage:values});
  eq(app.center.isOpen(),false);eq(app.calls.length,0);app.get('settingsButton').focus();app.open();
  same(app.rows(),DEFAULTS);eq(app.center.getState().storageKey,CENTER);eq(app.document.activeElement.id,'cc-row-network');eq(app.calls.length,0);
  app.back();eq(app.document.activeElement.id,'settingsButton');eq(values.get(SETTINGS),'existing mosque settings');eq(values.get(TABLE),'existing timetable');assert(app.writes.every(item=>item.key===CENTER));
  assert(/\bSTORE\s*=\s*['"]mosque-display\.settings\.v1['"]/.test(appSource)&&/\bTABLE_STORE\s*=\s*['"]mosque-display\.timetable\.v1['"]/.test(appSource),'Original mosque storage keys changed');
});
test('Malformed, unknown, duplicate, empty, oversized, and unsupported-version saved catalogs all fall back safely',()=>{
  const invalid=['{','null',JSON.stringify({schemaVersion:2,rows:['network'],lastId:'cc-row-network'}),pref([]),pref([...DEFAULTS,'phone']),pref(['network','network']),pref(['unlisted-package']),pref(['network'],'<script>alert(1)</script>')];
  for(const value of invalid){const app=runtime({storage:new Map([[CENTER,value]])});app.open();same(app.rows(),DEFAULTS);activeInside(app);eq(app.calls.length,0);}
});
test('Unavailable localStorage never prevents opening, customization, or a safe close',()=>{
  for(const failure of [{readFailure:true},{writeFailure:true}]){const app=runtime(failure);app.open();same(app.rows(),DEFAULTS);app.click('cc-customize');app.click('cc-option-network');app.click('cc-done');eq(app.center.getState().config.rows.length,5);app.back();eq(app.center.isOpen(),false);eq(operatorCalls(app).length,0);}
});
test('Checkbox choices enforce six maximum and one minimum, and Done persists only the separate center key',()=>{
  const app=runtime();app.open();app.click('cc-customize');eq(checked(app,'phone'),false);app.click('cc-option-phone');eq(checked(app,'phone'),false);assert(app.get('ccMessage').textContent.includes('ستة'));
  app.click('cc-option-network');app.click('cc-option-phone');eq(checked(app,'phone'),true);same(app.center.getState().draftRows,['sound','speed','tv','app','update','phone']);
  eq(app.values.has(CENTER),false,'Customization must remain staged until Done or Back');
  for(const id of ['sound','speed','tv','app','update'])app.click('cc-option-'+id);app.click('cc-option-phone');eq(checked(app,'phone'),true);assert(app.get('ccMessage').textContent.includes('واحد'));
  app.click('cc-done');same(app.rows(),['phone']);same(app.config().rows,['phone']);assert(app.writes.every(item=>item.key===CENTER));eq(app.document.activeElement.id,'cc-customize');
});
test('Remote reorder uses the staged chosen order, retains its row focus, and Back commits the new order',()=>{
  const app=runtime();app.open();app.click('cc-customize');app.get('cc-option-speed').focus();app.key('ArrowRight');same(app.center.getState().draftRows,['network','speed','sound','tv','app','update']);eq(app.document.activeElement.id,'cc-option-speed');
  app.key('ArrowLeft');same(app.center.getState().draftRows,DEFAULTS);app.key('ArrowLeft');same(app.center.getState().draftRows,['network','sound','tv','speed','app','update']);
  eq(app.values.has(CENTER),false);app.back();same(app.rows(),['network','sound','tv','speed','app','update']);same(app.config().rows,app.rows());eq(app.center.isOpen(),true);
  const restored=runtime({storage:app.values});restored.open();same(restored.rows(),app.rows());
});
test('Reset stages the default order and Done restores it without modifying legacy saved data',()=>{
  const original='{"saved":"mosque"}',app=runtime({storage:new Map([[CENTER,pref(['phone','power'],'cc-row-phone')],[SETTINGS,original]])});app.open();app.click('cc-customize');app.click('cc-reset');same(app.center.getState().draftRows,DEFAULTS);same(app.config().rows,['phone','power']);app.click('cc-done');same(app.config().rows,DEFAULTS);same(app.rows(),DEFAULTS);eq(app.values.get(SETTINGS),original);
});
test('Main DPAD boundaries stay inside the center, skip unavailable actions, and recover outside focus',()=>{
  const app=runtime({status:{available:{bluetooth:false,mirror:false,sleep:false,power:false,speed:false}}});app.open();
  for(const key of Array(10).fill(['ArrowUp','ArrowRight','ArrowLeft','ArrowDown','ArrowDown','Tab']).flat()){app.key(key);activeInside(app);}
  app.get('cc-customize').focus();app.key('ArrowDown');activeInside(app);
  app.get('settingsButton').focus();app.key('ArrowDown');activeInside(app);eq(app.calls.length,0);
});
test('Customization DPAD retains connected in-panel focus through toggles and reorder boundaries',()=>{
  const app=runtime();app.open();app.click('cc-customize');app.get('cc-option-network').focus();app.key('ArrowRight');same(app.center.getState().draftRows,DEFAULTS);
  for(const key of Array(8).fill(['ArrowDown','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Tab']).flat()){app.key(key);activeInside(app);}
  app.get('cc-done').focus();app.key('ArrowDown');eq(app.document.activeElement.id,'cc-done');app.key('ArrowUp');activeInside(app);eq(app.calls.length,0);
});
test('Closing and reloading preserve the last focused shortcut and restore the main launcher focus',()=>{
  const app=runtime();app.get('settingsButton').focus();app.open();app.get('cc-row-sound').focus();app.back();eq(app.center.isOpen(),false);eq(app.document.activeElement.id,'settingsButton');eq(app.config().lastId,'cc-row-sound');
  const restored=runtime({storage:app.values});restored.open();eq(restored.document.activeElement.id,'cc-row-sound');restored.back();
});
test('Prayer immediately closes customization, blocks stale actions and reopening, and never automatically reopens after prayer',()=>{
  const app=runtime();app.open();const stale=app.get('cc-row-network');app.click('cc-customize');app.click('cc-option-network');app.prayer(true);
  eq(app.center.isOpen(),false);eq(app.get('mosqueControlOverlay').hidden,true);eq(app.center.getState().config.rows.length,6);const cleanupCalls=app.calls.length;stale.click();app.flush();eq(app.calls.length,cleanupCalls);eq(operatorCalls(app).length,0);app.open();eq(app.center.isOpen(),false);eq(app.calls.length,cleanupCalls);
  app.prayer(false);eq(app.center.isOpen(),false);app.open();eq(app.center.isOpen(),true);same(app.rows(),DEFAULTS);
});
test('Status summaries render literal bounded text and refresh availability without executing any action',()=>{
  const app=runtime();app.window.MosqueTVNative.controlStatus=()=>JSON.stringify({device:'<img onerror=x>',rows:{network:'<img src=x onerror=alert(1)> '+'ن'.repeat(200)},available:{sound:false}});app.open();
  eq(app.get('cc-row-sound').disabled,true);const summary=app.get('cc-row-network').querySelector('.cc-row-summary');eq(summary.children.length,0);eq(summary.textContent.length,140);assert(summary.textContent.includes('<img'));
  app.window.MosqueTVNative.controlStatus=()=>({available:{sound:true},rows:{network:'متصل'}});app.center.refreshNative();app.flush();eq(app.get('cc-row-sound').disabled,false);eq(app.get('cc-row-network').querySelector('.cc-row-summary').textContent,'متصل');eq(app.calls.length,0);
});
test('Every old settings category remains reachable from the app shortcut with its original draft and cancellation behavior',()=>{
  const app=runtime();app.open();app.click('cc-row-app');eq(app.window.MosqueTV.isOpen(),true);eq(app.window.MosqueTV.getUIState().section,'mosque');eq(app.window.MosqueTV.getUIState().pane,'menu');
  const ids=app.window.TEST.sections().map(item=>item.id);same(ids,['mosque','iqama','display','donation','data','backup','tv-home','tv-system','tv-power','tv-update','tv-device-setup']);for(const id of ids){app.section(id);eq(app.window.MosqueTV.getUIState().section,id);assert(app.get('tvSettingsRows'));}
  app.section('iqama');app.click(app.row('iqama','الفجر'));app.key('ArrowRight');app.click('tvEditorConfirm');eq(app.window.TEST.draft().iqama.offsets.fajr,26);app.click('cancelButton');eq(app.window.TEST.saved().iqama.offsets.fajr,25);eq(app.window.TEST.current().iqama.offsets.fajr,25);eq(app.center.isOpen(),true);eq(app.document.activeElement.id,'cc-row-app');
});
test('Saving original mosque settings through the center persists the original key and later cancellation keeps the saved value',()=>{
  const app=runtime();app.open();app.click('cc-row-app');app.section('iqama');app.click(app.row('iqama','الفجر'));app.key('ArrowRight');app.click('tvEditorConfirm');app.click('saveButton');
  eq(JSON.parse(app.values.get(SETTINGS)).iqama.offsets.fajr,26);eq(app.window.TEST.saved().iqama.offsets.fajr,26);eq(app.center.isOpen(),true);eq(app.document.activeElement.id,'cc-row-app');
  app.click('cc-row-app');app.section('iqama');app.click(app.row('iqama','الفجر'));app.key('ArrowRight');app.click('tvEditorConfirm');app.click('cancelButton');eq(JSON.parse(app.values.get(SETTINGS)).iqama.offsets.fajr,26);eq(app.window.TEST.current().iqama.offsets.fajr,26);eq(app.values.has(TABLE),false);assert(app.writes.every(item=>[SETTINGS,CENTER].includes(item.key)));
});
test('Update, HOME, and power shortcuts open their existing sections and Back returns to the remembered center row',()=>{
  for(const [id,section]of [['update','tv-update'],['home','tv-home'],['power','tv-power']]){const app=runtime({storage:new Map([[CENTER,pref([id],'cc-row-'+id)]])});app.open();app.click('cc-row-'+id);eq(app.window.MosqueTV.isOpen(),true);eq(app.window.MosqueTV.getUIState().section,section);eq(app.window.MosqueTV.getUIState().pane,'rows');app.key('Escape');eq(app.window.MosqueTV.isOpen(),true);app.key('Escape');eq(app.window.MosqueTV.isOpen(),false);eq(app.center.isOpen(),true);eq(app.document.activeElement.id,'cc-row-'+id);app.back();eq(app.center.isOpen(),false);}
});
test('Every native shortcut delegates its allowlisted ID once and no shortcut acts during prayer',()=>{
  for(const id of CATALOG.filter(id=>!['app','update','home','power'].includes(id))){const app=runtime({storage:new Map([[CENTER,pref([id],'cc-row-'+id)]])});const original=app.window.MosqueTVNative.controlAction;assert(typeof original==='function','Missing actual bridge controlAction');const actions=[];app.window.MosqueTVNative.controlAction=value=>{actions.push(value);return original(value);};app.open();app.click('cc-row-'+id);same(actions,[id]);eq(app.config().lastId,'cc-row-'+id);eq(app.center.isOpen(),true);eq(app.document.activeElement.id,'cc-row-'+id);app.prayer(true);app.open();eq(app.center.isOpen(),false);eq(actions.length,1);}
  for(const id of ['bluetooth','mirror','sleep','power']){const app=runtime();const original=app.window.MosqueTVNative.controlAction,actions=[];app.window.MosqueTVNative.controlAction=value=>{actions.push(value);return original(value);};app.open();app.click('cc-quick-'+id);same(actions,[id]);eq(app.center.isOpen(),id!=='power');}
});
test('The original gear and Menu keyboard handler launch the center, and the original Back button returns from settings to the remembered row',()=>{
  const app=runtime();app.get('settingsButton').focus();app.click('settingsButton');eq(app.center.isOpen(),true);eq(app.window.MosqueTV.isOpen(),false);app.menu();eq(app.center.isOpen(),false);eq(app.document.activeElement.id,'settingsButton');app.menu();eq(app.center.isOpen(),true);app.click('cc-row-app');eq(app.window.MosqueTV.isOpen(),true);eq(app.window.MosqueTV.getUIState().pane,'menu');app.click('tvSettingsBack');eq(app.window.MosqueTV.isOpen(),false);eq(app.center.isOpen(),true);eq(app.document.activeElement.id,'cc-row-app');app.back();eq(app.document.activeElement.id,'settingsButton');
});
test('Actual native status marks offline speed unavailable and reading/opening/refreshing never starts a network test',()=>{
  const app=runtime({device:{manufacturer:'TCL',model:'offline fixture',network:{validated:false,connected:true,label:'Wi-Fi'},available:{wifi:true,sound:true}}});const status=app.window.MosqueTVNative.controlStatus();eq(status.available.speed,false);assert(status.rows.network.includes('دون إنترنت'));eq(operatorCalls(app).length,0);app.open();eq(app.get('cc-row-speed').disabled,true);app.click('cc-row-speed');app.center.refreshNative();app.flush();eq(operatorCalls(app).length,0);app.back();eq(operatorCalls(app).length,0);
});
test('The real native adapter rejects unknown actions, maps allowed actions, and suppresses all operator actions during prayer',()=>{
  const app=runtime(),adapter=app.window.MosqueTVNative;for(const id of ['unlisted','network;pm disable-user anything','https://example.com','app']){let rejected=false;try{adapter.controlAction(id);}catch(_){rejected=true;}assert(rejected,'Unknown action was accepted: '+id);}eq(app.calls.length,0);
  for(const [id,target]of [['network','network'],['sound','audio-output'],['bluetooth','bluetooth'],['mirror','mirror'],['tv','tv'],['phone','phone'],['display','display'],['screensaver','screensaver']]){adapter.controlAction(id);same(app.calls.at(-1),['openControl',target]);}
  for(const [id,method]of [['sleep','sleepMenu'],['power','displayOff'],['deviceSetup','deviceSetup']]){adapter.controlAction(id);eq(app.calls.at(-1)[0],method);}
  const count=app.calls.length;app.prayer(true);for(const id of ['network','sound','speed','sleep','power','deviceSetup'])adapter.controlAction(id);eq(app.calls.length,count);
});
test('A requested speed test toggles to cancellation, survives status refresh, and is cancelled when the center closes',()=>{
  const app=runtime();app.open();app.click('cc-row-speed');same(operatorCalls(app),[['startSpeedTest']]);eq(app.center.isOpen(),true);app.center.refreshNative();app.flush();eq(app.calls.filter(call=>call[0]==='cancelSpeedTest').length,0);app.click('cc-row-speed');eq(app.calls.at(-1)[0],'cancelSpeedTest');app.click('cc-row-speed');eq(app.calls.at(-1)[0],'startSpeedTest');app.back();eq(app.calls.at(-1)[0],'cancelSpeedTest');eq(app.center.isOpen(),false);
});
test('OK and Space recover unexpected background focus without clicking the background or starting an action',()=>{
  const app=runtime(),outside=app.document.createElement('button');outside.id='outside-control-fixture';let clicked=0;outside.addEventListener('click',()=>clicked++);app.document.body.appendChild(outside);app.open();outside.focus();assert(app.key('Enter').defaultPrevented);activeInside(app);eq(clicked,0);eq(operatorCalls(app).length,0);app.click('cc-customize');outside.focus();assert(app.key(' ').defaultPrevented);activeInside(app);eq(clicked,0);eq(operatorCalls(app).length,0);
});
test('Native notices render literal text only while open and never reopen the center during or after prayer',()=>{
  const app=runtime();app.open();const text='<img src=x onerror=alert(1)> رسالة محلية';app.event('mosque-native-notice',{message:text});eq(app.get('ccMessage').textContent,text);eq(app.get('ccMessage').children.length,0);eq(operatorCalls(app).length,0);app.prayer(true);app.event('mosque-native-notice',{message:'message while praying'});eq(app.get('ccMessage').textContent,text);eq(app.center.isOpen(),false);app.prayer(false);app.event('mosque-native-notice',{message:'message after prayer'});eq(app.center.isOpen(),false);eq(app.get('ccMessage').textContent,text);
});
test('Stale customization callbacks cannot reset, toggle, save, or reopen a prayer-closed center',()=>{
  const app=runtime();app.open();app.click('cc-customize');app.click('cc-option-network');const stale=['cc-option-sound','cc-reset','cc-done'].map(id=>app.get(id));app.prayer(true);const writes=app.writes.length,cleanup=app.calls.length;for(const node of stale)node.click();app.flush();same(app.center.getState().config.rows,DEFAULTS);eq(app.writes.length,writes);eq(app.calls.length,cleanup);app.prayer(false);for(const node of stale)node.click();app.flush();eq(app.center.isOpen(),false);same(app.center.getState().config.rows,DEFAULTS);eq(app.writes.length,writes);eq(app.calls.length,cleanup);
});
const report={executedAt:new Date().toISOString(),method:'Actual dev/control-center.js, native bridge, and existing settings UI/validator/save-cancel source evaluated in a minimal simulated DOM with localStorage and MutationObserver service fakes. No browser, Android, TV remote, actual focus geometry, or device action executed.',centerSHA256:crypto.createHash('sha256').update(centerSource).digest('hex'),appSHA256:crypto.createHash('sha256').update(appSource).digest('hex'),bridgeSHA256:crypto.createHash('sha256').update(bridgeSource).digest('hex'),passed:checks.filter(item=>item.pass).length,total:checks.length,failed:checks.filter(item=>!item.pass).length,checks};
fs.writeFileSync(path.join(__dirname,'control-center-test-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failed||!report.total)process.exitCode=1;
