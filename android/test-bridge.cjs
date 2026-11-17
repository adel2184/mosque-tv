/* Development-only simulation of the actual tv-bridge.js.
 * No Android device, WebView, document provider, remote, or browser is launched. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const file=path.join(__dirname,'tv-bridge.js'),source=fs.readFileSync(file,'utf8');
const checks=[];
const assert=(value,message)=>{if(!value)throw Error(message||'Unexpected result');};
const describe=value=>{try{return JSON.stringify(value);}catch(_){return Object.prototype.toString.call(value);}};
const eq=(actual,expected)=>{if(actual!==expected)throw Error('Expected '+describe(expected)+'; received '+describe(actual));};
function test(name,fn){try{fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.message});}}

function runtime(options={}){
  const ids=new Map(),docListeners=new Map(),windowListeners=new Map(),observers=[],readers=[],exports=[],prayers=[],revoked=[],nativeCalls=[];
  let serial=0,document,flushingMutations=false,homeJSON=options.homeStatusJSON===undefined?JSON.stringify(options.homeStatus||{isDefaultHome:false,canRequestHomeRole:true,canOpenHomeSettings:true}):options.homeStatusJSON;
  const pendingMutations=[];
  function fire(listeners,name,event){event.type=name;event.preventDefault=event.preventDefault||function(){this.defaultPrevented=true;};for(const listener of listeners.get(name)||[])listener(event);return event;}
  function mutation(target,type,attributeName){
    for(const observer of observers){if(observer.target!==target&&!(observer.options.subtree&&observer.target.contains(target)))continue;if(type==='attributes'&&(!observer.options.attributes||(observer.options.attributeFilter&&!observer.options.attributeFilter.includes(attributeName))))continue;if(type==='childList'&&!observer.options.childList)continue;pendingMutations.push({observer,record:{target,type,attributeName}});}
  }
  function flushMutations(){
    if(flushingMutations)return;
    flushingMutations=true;let rounds=0;
    try{while(pendingMutations.length){if(++rounds>100)throw Error('Mutation observer did not settle; possible repeated settings injection');const batches=new Map();for(const item of pendingMutations.splice(0)){if(!batches.has(item.observer))batches.set(item.observer,[]);batches.get(item.observer).push(item.record);}for(const [observer,records]of batches)observer.callback(records);}}
    finally{flushingMutations=false;}
  }
  function click(node){if(node.disabled)return{target:node,defaultPrevented:false,disabled:true};const event=fire(docListeners,'click',{target:node,defaultPrevented:false});fire(node.listeners,'click',event);if(typeof node.onclick==='function')node.onclick(event);flushMutations();return event;}
  class Element{
    constructor(tag,id){this.tagName=tag.toUpperCase();this.id=id||'';this.children=[];this.parentNode=null;this._text='';this.classes=new Set();this.listeners=new Map();this.attributes=new Map();this.style={};this.dataset={};this.disabled=false;this.hidden=false;this.open=false;this.type='';this.rect={left:0,top:0,width:100,height:40};this.classList={add:(...values)=>{values.forEach(value=>this.classes.add(value));mutation(this,'attributes','class');},remove:(...values)=>{values.forEach(value=>this.classes.delete(value));mutation(this,'attributes','class');},contains:value=>this.classes.has(value),toggle:(value,force)=>{const enabled=force===undefined?!this.classes.has(value):Boolean(force);if(enabled)this.classes.add(value);else this.classes.delete(value);mutation(this,'attributes','class');return enabled;}};}
    get id(){return this._id;}set id(value){if(this._id&&ids.get(this._id)===this)ids.delete(this._id);this._id=String(value);if(this._id)ids.set(this._id,this);}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];mutation(this,'childList');}
    get className(){return [...this.classes].join(' ');}set className(value){this.classes=new Set(value.split(/\s+/).filter(Boolean));mutation(this,'attributes','class');}
    get firstChild(){return this.children[0]||null;}
    get childElementCount(){return this.children.length;}
    addEventListener(name,listener){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(listener);}
    append(...nodes){for(let node of nodes){if(typeof node!=='object'){const span=new Element('span');span.textContent=node;node=span;}this.appendChild(node);}}
    appendChild(node){if(node.parentNode)node.parentNode.removeChild(node);node.parentNode=this;this.children.push(node);mutation(this,'childList');return node;}
    removeChild(node){const index=this.children.indexOf(node);if(index<0)throw Error('Node not found');this.children.splice(index,1);node.parentNode=null;mutation(this,'childList');return node;}
    remove(){if(this.parentNode)this.parentNode.removeChild(this);}
    setAttribute(name,value){if(name==='id')this.id=value;else if(name==='class')this.className=value;else this.attributes.set(name,String(value));mutation(this,'attributes',name);}
    getAttribute(name){return name==='id'?this.id:name==='class'?this.className:this.attributes.get(name)||null;}
    contains(node){return node===this||this.children.some(child=>child.contains(node));}
    closest(selector){if(selector==='a[download]'&&this.tagName==='A'&&this.download!==undefined)return this;return this.parentNode?this.parentNode.closest(selector):null;}
    getBoundingClientRect(){for(let node=this;node;node=node.parentNode)if(node.hidden||(node.tagName==='DIALOG'&&!node.open))return{left:0,top:0,width:0,height:0};return this.rect;}
    querySelectorAll(selector){const result=[];function visit(node){for(const child of node.children){const matches=selector[0]==='#'?child.id===selector.slice(1):selector[0]==='.'?child.classList.contains(selector.slice(1)):selector==='section'?child.tagName==='SECTION':['BUTTON','INPUT','SELECT','TEXTAREA'].includes(child.tagName)&&!child.disabled&&!['hidden','file'].includes(child.type);if(matches)result.push(child);visit(child);}}visit(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    focus(){document.activeElement=this;fire(docListeners,'focusin',{target:this});}
    click(){return click(this);}
    scrollIntoView(){this.scrolled=true;}
  }
  const html=new Element('html'),head=new Element('head'),body=new Element('body'),message=new Element('p','settingsMessage'),dialog=new Element('dialog','settingsDialog'),settingsBody=new Element('div','settingsBody');html.appendChild(head);html.appendChild(body);body.appendChild(message);body.appendChild(dialog);dialog.appendChild(settingsBody);
  document={head,body,activeElement:body,getElementById:id=>{const node=ids.get(id);return node&&html.contains(node)?node:null;},createElement:tag=>new Element(tag),addEventListener(name,listener){if(!docListeners.has(name))docListeners.set(name,[]);docListeners.get(name).push(listener);},querySelectorAll:selector=>html.querySelectorAll(selector),querySelector:selector=>html.querySelector(selector)};
  class MutationObserver{constructor(callback){this.callback=callback;}observe(target,opts){this.target=target;this.options=opts;observers.push(this);}disconnect(){}}
  class FileReader{readAsText(blob){this.blob=blob;readers.push(this);}}
  class Blob{constructor(parts){this.text=parts.map(String).join('');this.size=Buffer.byteLength(this.text,'utf8');}}
  const URL={createObjectURL:()=> 'blob:simulated/'+(++serial),revokeObjectURL:url=>revoked.push(url)};
  const originalCreate=URL.createObjectURL;
  const native={exportJson(name,json){if(options.throwNative)throw Error('Simulated native picker failure');exports.push({name,json});},prayerState(active){prayers.push(active);},homeStatus(){nativeCalls.push({method:'homeStatus'});if(options.throwHomeStatus)throw Error('Simulated HOME status failure');return homeJSON;},requestHomeRole(){nativeCalls.push({method:'requestHomeRole'});return true;},openHomeSettings(){nativeCalls.push({method:'openHomeSettings'});return true;},openSystemSettings(){nativeCalls.push({method:'openSystemSettings'});return true;}};
  const sandbox={Element,MutationObserver,FileReader,Blob,URL,document,Map,Array,console,getComputedStyle:node=>({visibility:node.style.visibility||'visible',display:node.hidden?'none':'block'}),addEventListener(name,listener){if(!windowListeners.has(name))windowListeners.set(name,[]);windowListeners.get(name).push(listener);}};
  if(!options.noNative)sandbox.MosqueAndroid=native;sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:file,timeout:3000});
  flushMutations();
  return{document,Element,Blob,URL,exports,prayers,revoked,message,dialog,settingsBody,readers,originalCreate,sandbox,mutation,flushMutations,nativeCalls,
    control(tag,id,left,top,parent=body){const node=new Element(tag,id);node.rect={left,top,width:100,height:40};parent.appendChild(node);return node;},
    click,
    key(key,extra={}){return fire(docListeners,'keydown',{key,ctrlKey:false,altKey:false,defaultPrevented:false,...extra});},
    result(detail){fire(windowListeners,'mosque-native-export-result',{detail});flushMutations();},
    homeResult(detail={}){fire(windowListeners,'mosque-native-home-result',{detail});flushMutations();},
    focusWindow(){fire(windowListeners,'focus',{});flushMutations();},
    setHomeStatus(value){homeJSON=typeof value==='string'?value:JSON.stringify(value);},
    openSettings(){dialog.open=true;mutation(dialog,'attributes','open');flushMutations();},
    redrawSettings(){settingsBody.replaceChildren();mutation(dialog,'childList');flushMutations();},
    flushRead(error=false){const reader=readers.shift();if(!reader)throw Error('No pending FileReader');if(error)reader.onerror();else{reader.result=reader.blob.text;reader.onload();}},
    download(text='{"message":"بيانات الجامع"}',name='mosque-settings.json'){const blob=new Blob([text]),url=URL.createObjectURL(blob),anchor=new Element('a');anchor.href=url;anchor.download=name;return{blob,url,anchor};}
  };
}

test('Desktop execution without the native interface leaves URL and DOM behavior untouched',()=>{const app=runtime({noNative:true});eq(app.URL.createObjectURL,app.originalCreate);eq(app.Element.prototype.replaceChildren,undefined);eq(app.document.head.children.length,0);app.openSettings();eq(app.document.getElementById('tv-startup-settings'),null);eq(app.settingsBody.children.length,0);eq(app.nativeCalls.length,0);});
test('replaceChildren fallback clears old nodes and preserves replacement node order',()=>{const app=runtime(),parent=new app.Element('div'),old=new app.Element('span'),first=new app.Element('p'),second=new app.Element('p');parent.appendChild(old);parent.replaceChildren(first,second);eq(parent.children.length,2);eq(parent.children[0],first);eq(parent.children[1],second);parent.replaceChildren();eq(parent.children.length,0);});
test('Blob/FileReader export sends original Arabic JSON and filename to the native bridge',()=>{const app=runtime(),json=JSON.stringify({schemaVersion:1,name:'جامع لطيفة الخالدي',text:'<نص حرفي>\nسطر ثانٍ'}),file=app.download(json,'mosque-settings.json'),event=app.click(file.anchor);assert(event.defaultPrevented);eq(app.exports.length,0);app.flushRead();eq(app.exports.length,1);eq(app.exports[0].name,'mosque-settings.json');eq(app.exports[0].json,json);assert(app.message.textContent.includes('اختر مكان'));});
test('Revoked blob URLs are no longer intercepted or exported',()=>{const app=runtime(),file=app.download();app.URL.revokeObjectURL(file.url);eq(app.revoked[0],file.url);assert(!app.click(file.anchor).defaultPrevented);eq(app.readers.length,0);eq(app.exports.length,0);});
test('Oversized blobs, FileReader failures, and native picker errors fail without exporting',()=>{const app=runtime(),file=app.download();file.blob.size=3*1024*1024+1;assert(app.click(file.anchor).defaultPrevented);eq(app.readers.length,0);eq(app.message.className,'error');const next=app.download();app.click(next.anchor);app.flushRead(true);eq(app.exports.length,0);assert(app.message.textContent.includes('تعذرت قراءة'));const throwing=runtime({throwNative:true}),third=throwing.download();throwing.click(third.anchor);throwing.flushRead();eq(throwing.exports.length,0);assert(throwing.message.textContent.includes('تعذر فتح'));});
test('Native success, cancellation, and failure events show distinct safe Arabic messages',()=>{const app=runtime();app.result({success:true,message:'حُفظ الملف للاختبار'});eq(app.message.textContent,'حُفظ الملف للاختبار');eq(app.message.className,'success');app.result({success:false,cancelled:true});eq(app.message.textContent,'أُلغي حفظ الملف.');eq(app.message.className,'success');app.result({success:false,cancelled:false,message:'تعذر الحفظ'});eq(app.message.textContent,'تعذر الحفظ');eq(app.message.className,'error');});
test('Prayer observer reports the initial state and subsequent body prayer changes',()=>{const app=runtime();eq(app.prayers[0],false);app.document.body.classList.add('praying');app.flushMutations();eq(app.prayers.at(-1),true);app.document.body.classList.remove('praying');app.flushMutations();eq(app.prayers.at(-1),false);});
test('Spatial arrow navigation moves focus while Ctrl/Alt shortcuts and prayer state pass through',()=>{const app=runtime(),a=app.control('button','a',100,100),b=app.control('button','b',220,100);a.focus();assert(app.key('ArrowRight').defaultPrevented);eq(app.document.activeElement,b);a.focus();assert(!app.key('ArrowRight',{ctrlKey:true}).defaultPrevented);eq(app.document.activeElement,a);assert(!app.key('ArrowRight',{altKey:true}).defaultPrevented);app.document.body.classList.add('praying');assert(!app.key('ArrowRight').defaultPrevented);eq(app.document.activeElement,a);});
test('Text editing and select arrows remain native; dialog focus excludes hidden and disabled controls',()=>{const app=runtime(),outside=app.control('button','outside',100,100),hidden=app.control('button','hidden',100,100,app.settingsBody),disabled=app.control('button','disabled',100,100,app.settingsBody),text=app.control('input','text',100,180,app.settingsBody),select=app.control('select','select',100,260,app.settingsBody);hidden.hidden=true;disabled.disabled=true;text.type='text';outside.focus();app.openSettings();eq(app.document.activeElement,text);assert(!app.key('ArrowLeft').defaultPrevented);eq(app.document.activeElement,text);select.focus();assert(!app.key('ArrowDown').defaultPrevented);eq(app.document.activeElement,select);assert(select.classList.contains('tv-focus'));assert(!text.classList.contains('tv-focus'));});

const homeActions=app=>app.nativeCalls.filter(call=>call.method!=='homeStatus').map(call=>call.method);
const startupPanel=app=>{const panel=app.document.getElementById('tv-startup-settings');assert(panel,'Missing TV startup settings panel');return panel;};
test('HOME settings are inserted once on open and rebuilt once after redraw, without automatic role or settings requests',()=>{
  const app=runtime();eq(app.document.getElementById('tv-startup-settings'),null);eq(homeActions(app).length,0);
  app.openSettings();const first=startupPanel(app);eq(app.document.querySelectorAll('#tv-startup-settings').length,1);
  for(let i=0;i<12;i++)app.mutation(app.settingsBody,'childList');app.flushMutations();
  eq(startupPanel(app),first);eq(app.document.querySelectorAll('#tv-startup-settings').length,1);
  app.redrawSettings();const second=startupPanel(app);assert(second!==first,'Settings redraw retained the detached panel');
  eq(app.document.querySelectorAll('#tv-startup-settings').length,1);eq(app.settingsBody.children.length,1);
  assert(app.nativeCalls.some(call=>call.method==='homeStatus'),'Native HOME status was not read');eq(homeActions(app).length,0);
});
test('HOME default status and request availability refresh on window focus and native result events',()=>{
  const app=runtime();app.openSettings();const status=app.document.getElementById('tv-home-status'),request=app.document.getElementById('tv-request-home');
  assert(status.textContent.includes('لم يُختر'));eq(request.disabled,false);
  app.setHomeStatus({isDefaultHome:true,canRequestHomeRole:true,canOpenHomeSettings:true});app.focusWindow();
  assert(status.textContent.includes('مفعّل:'));eq(request.disabled,true);
  app.setHomeStatus({isDefaultHome:false,canRequestHomeRole:false,canOpenHomeSettings:true});app.homeResult({success:true});
  assert(status.textContent.includes('لم يُختر'));eq(request.disabled,false);eq(homeActions(app).length,0);
});
test('Malformed native HOME JSON, wrong field types, thrown status reads, and unavailable capabilities use safe fallbacks',()=>{
  const app=runtime();app.openSettings();
  for(const value of ['{','null',JSON.stringify({isDefaultHome:'false',canRequestHomeRole:true,canOpenHomeSettings:true})]){
    app.setHomeStatus(value);app.homeResult();assert(app.document.getElementById('tv-home-status').textContent.includes('تعذر قراءة'));eq(app.document.getElementById('tv-request-home').disabled,true);
  }
  app.setHomeStatus({isDefaultHome:false,canRequestHomeRole:false,canOpenHomeSettings:false});app.focusWindow();
  assert(app.document.getElementById('tv-home-status').textContent.includes('لا يعرض'));eq(app.document.getElementById('tv-request-home').disabled,true);
  eq(app.document.getElementById('tv-change-home').disabled,false);eq(app.document.getElementById('tv-system-settings').disabled,false);
  const throwing=runtime({throwHomeStatus:true});throwing.openSettings();assert(throwing.document.getElementById('tv-home-status').textContent.includes('تعذر قراءة'));eq(throwing.document.getElementById('tv-request-home').disabled,true);
  eq(homeActions(app).length,0);eq(homeActions(throwing).length,0);
});
test('HOME buttons invoke only their matching native action and ignore clicks during prayer mode',()=>{
  const app=runtime();app.openSettings();const routes=[['tv-request-home','requestHomeRole'],['tv-change-home','openHomeSettings'],['tv-system-settings','openSystemSettings']];
  for(const [id,method]of routes){const before=homeActions(app).length;app.click(app.document.getElementById(id));eq(homeActions(app).length,before+1);eq(homeActions(app).at(-1),method);}
  eq(JSON.stringify(homeActions(app)),JSON.stringify(routes.map(route=>route[1])));
  app.document.body.classList.add('praying');app.flushMutations();
  for(const [id]of routes)app.click(app.document.getElementById(id));eq(homeActions(app).length,3);
  app.document.body.classList.remove('praying');app.flushMutations();app.click(app.document.getElementById('tv-system-settings'));eq(homeActions(app).length,4);eq(homeActions(app).at(-1),'openSystemSettings');
});
const report={executedAt:new Date().toISOString(),sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),method:'Actual android/tv-bridge.js evaluated with a minimal simulated DOM, queued MutationObserver records, Blob/FileReader, and native HOME/status interface. No Android, WebView, HOME-role chooser, TV remote, browser, or SAF provider was executed.',passed:checks.filter(check=>check.pass).length,total:checks.length,failed:checks.filter(check=>!check.pass).length,checks};
fs.writeFileSync(path.join(__dirname,'bridge-test-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
