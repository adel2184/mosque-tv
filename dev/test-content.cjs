/* Development-only behavioral test: actual index.html IIFE in a minimal simulated DOM.
 * This is NOT browser automation and cannot verify rendering, line wrapping, clipping,
 * font metrics, CSS animation smoothness, or physical-screen readability. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const filename=path.join(root,'index.html');
const html=fs.readFileSync(filename,'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(match=>({attributes:match[1],text:match[2]}));
const embedded=new Map(scripts.filter(script=>/application\/json/i.test(script.attributes)).map(script=>[script.attributes.match(/\bid=["']([^"']+)["']/i)?.[1],script.text]));
const application=scripts.find(script=>script.text.includes('window.MosqueApp='));
if(!application)throw Error('Actual inline application script was not found in index.html.');
const manifest=JSON.parse(embedded.get('slides-data')).filter(slide=>slide.visible!==false);
const stamp=text=>Date.parse(text+'+03:00');
const clone=value=>JSON.parse(JSON.stringify(value));
const reports=[];
let qrIntegrity=null;
const assert=(value,message)=>{if(!value)throw Error(message||'Unexpected result');};
const describe=value=>{try{return JSON.stringify(value);}catch(_){return Object.prototype.toString.call(value);}};
const equal=(actual,expected,message)=>assert(actual===expected,(message||'')+' expected '+describe(expected)+', actual '+describe(actual));
function test(name,fn){try{fn();reports.push({name,pass:true});}catch(error){reports.push({name,pass:false,error:error.message});}}
function rejects(fn){let failed=false;try{fn();}catch(_){failed=true;}assert(failed,'Invalid settings were unexpectedly accepted');}

function createRuntime(boot=stamp('2026-11-16T09:15:00')){
  const byID=new Map(),listeners=new Map(),intervals=[],downloads=[];
  class Element {
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this._text='';this._classes=new Set();this.style={_writes:[],setProperty(name,value){this[name]=value;this._writes.push({name,value});},removeProperty(name){delete this[name];}};this.dataset={};this.attributes={};this.hidden=false;this.open=false;this.value='';this.checked=false;this.events=new Map();this.classList={add:(...names)=>names.forEach(name=>this._classes.add(name)),remove:(...names)=>names.forEach(name=>this._classes.delete(name)),contains:name=>this._classes.has(name),toggle:(name,force)=>{const on=force===undefined?!this._classes.has(name):!!force;on?this._classes.add(name):this._classes.delete(name);return on;}};}
    get className(){return [...this._classes].join(' ');}set className(value){this._classes=new Set(String(value).split(/\s+/).filter(Boolean));}
    get src(){return this._src||'';}set src(value){this._src=String(value);this._srcAssignments=(this._srcAssignments||0)+1;}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this._text=String(value??'');this.children=[];}
    get childElementCount(){return this.children.filter(child=>child.tagName!=='#TEXT').length;}
    get childNodes(){return this.children;}get firstElementChild(){return this.children.find(child=>child.tagName!=='#TEXT')||null;}
    get clientHeight(){return this.id==='mosqueInfo'?188:this.id==='slideContent'?580:600;}get scrollHeight(){return this.clientHeight;}
    get clientWidth(){return this.id==='stage'?1920:880;}get scrollWidth(){for(let node=this;node;node=node.parentNode)if(node.hidden)return 0;return this.clientWidth;}
    get offsetHeight(){return this.clientHeight;}get offsetWidth(){return this.clientWidth;}
    append(...nodes){nodes.forEach(node=>{if(typeof node==='string'){const text=new Element('#text');text.textContent=node;node=text;}if(node.parentNode)node.remove();node.parentNode=this;this.children.push(node);});}
    appendChild(node){this.append(node);return node;}
    replaceChildren(...nodes){this.children.forEach(child=>child.parentNode=null);this.children=[];this._text='';this.append(...nodes);}
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}}
    setAttribute(name,value){this.attributes[name]=String(value);if(name==='id'){this.id=String(value);byID.set(this.id,this);}else if(name==='class')this.className=value;else if(name==='hidden')this.hidden=true;else if(name==='open')this.open=true;else if(name==='src')this.src=value;}
    getAttribute(name){return this.attributes[name]??null;}removeAttribute(name){delete this.attributes[name];if(name==='hidden')this.hidden=false;}
    addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(fn);}
    removeEventListener(){}click(){for(const fn of this.events.get('click')||[])fn({target:this,preventDefault(){}});}focus(){}blur(){}
    showModal(){this.open=true;}close(){this.open=false;}
    getBoundingClientRect(){return {left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight};}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){const matches=[],parts=selector.trim().split(/\s+/),last=parts.at(-1);const match=node=>{if(node.tagName==='#TEXT')return false;if(last.startsWith('#'))return node.id===last.slice(1);const tag=last.match(/^[a-z][\w-]*/i)?.[0];if(tag&&node.tagName!==tag.toUpperCase())return false;return [...last.matchAll(/\.([\w-]+)/g)].every(m=>node.classList.contains(m[1]));};function visit(node){for(const child of node.children){if(match(child))matches.push(child);visit(child);}}visit(this);return matches;}
  }
  const document={createElement:tag=>new Element(tag),getElementById:id=>byID.get(id)||null,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},removeEventListener(){},fonts:{ready:Promise.resolve()},hidden:false,visibilityState:'visible'};
  const documentRoot=new Element('document');
  const clean=html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi,'<script $1></script>').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
  const stack=[documentRoot],voidTags=new Set(['meta','link','input','img','br','hr','source','wbr','area','base','col','embed','param','track']);
  for(const token of clean.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)){
    const text=token[0];if(text.startsWith('</')){if(stack.length>1)stack.pop();continue;}
    if(text.startsWith('<')){const tag=text.match(/^<([a-z][\w:-]*)/i)?.[1];if(!tag)continue;const node=new Element(tag);for(const attribute of text.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)){const name=attribute[1];if(name===tag)continue;node.setAttribute(name,attribute[2]??attribute[3]??attribute[4]??'');}stack.at(-1).append(node);if(!voidTags.has(tag.toLowerCase())&&!text.endsWith('/>'))stack.push(node);}
    else if(text.trim()){const node=new Element('#text');node.textContent=text;stack.at(-1).append(node);}
  }
  for(const [id,text]of embedded){const node=byID.get(id);if(!node)throw Error('Missing embedded node '+id);node.textContent=text;}
  document.documentElement=documentRoot.querySelector('html');document.body=documentRoot.querySelector('body');
  document.querySelector=selector=>documentRoot.querySelector(selector);document.querySelectorAll=selector=>documentRoot.querySelectorAll(selector);
  const storage=new Map();let now=boot;
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  class FileReader{readAsText(file){this.result=file.content;this.onload?.({target:this});}}
  class TestBlob{constructor(parts,options){this.textContent=parts.map(String).join('');this.type=options?.type||'';}}
  class TestURL extends URL{static createObjectURL(blob){downloads.push(blob);return 'blob:simulated-'+downloads.length;}static revokeObjectURL(){}}
  const sandbox={document,Date:ClockDate,Intl,Map,Set,URLSearchParams,URL:TestURL,Blob:TestBlob,FileReader,console,innerWidth:1920,innerHeight:1080,location:{search:'?test=1',href:'file:///index.html?test=1'},parent:{postMessage(){}},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},addEventListener:document.addEventListener.bind(document),removeEventListener(){},setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},clearInterval(){},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>fn(),cancelAnimationFrame(){},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),getComputedStyle:node=>({fontSize:node.style.fontSize||'50px',lineHeight:'1.8',animationPlayState:node.style.animationPlayState||'running',getPropertyValue:name=>node.style[name]||''}),performance:{now:()=>now},confirm:()=>false};
  sandbox.window=sandbox;sandbox.globalThis=sandbox;
  vm.runInNewContext(application.text,sandbox,{filename:'index.html:inline-application',timeout:10000});
  const api=sandbox.MosqueApp;if(!api)throw Error('Application test API was not exposed.');api.setNow(()=>now);
  return {api,document,intervals,downloads,setNow(ms){now=ms;api.tick();},emit(name){for(const fn of listeners.get(name)||[])fn({type:name});},fire(node,name){const event={type:name,target:node,preventDefault(){}};for(const fn of node.events.get(name)||[])fn(event);if(typeof node['on'+name]==='function')node['on'+name](event);},edit(label,value){const match=document.getElementById('settingsBody').querySelectorAll('label').find(node=>node.children.find(child=>child.tagName==='SPAN')?.textContent===label);if(!match)throw Error('Settings label not found: '+label);const control=match.children.find(child=>['INPUT','TEXTAREA','SELECT'].includes(child.tagName));if(!control)throw Error('Settings control not found: '+label);if(control.type==='checkbox')control.checked=value;else control.value=String(value);this.fire(control,control.tagName==='SELECT'?'change':'input');return control;},now:()=>now};
}

const base=createRuntime();
test('Actual inline application starts with one managed scheduler in a simulated DOM',()=>{equal(base.intervals.length,1);equal(base.api.getContentMode(),'slides');equal(base.api.getSlidesState().count,18);});
test('Eighteen nonempty rotating adhkar retain repeated texts and exclude the permanent ticker',()=>{
  equal(manifest.length,18);equal(new Set(manifest.map(slide=>slide.id)).size,18);manifest.forEach(slide=>{equal(slide.type,'text');assert(slide.visible!==false);assert(slide.title?.trim()&&slide.text?.trim());});
  const normalized=text=>text.replace(/[،,.:؛!?؟\s]/g,'');
  const repeated=[...new Set(manifest.map(slide=>normalized(slide.text)))].filter(text=>manifest.filter(slide=>normalized(slide.text)===text).length>1);assert(repeated.length>0,'Requested repeated adhkar were unexpectedly deduplicated');
  manifest.forEach(slide=>equal(typeof slide.repeat,'string','Repeat instruction must be preserved as text'));
  const ticker=base.api.getTickerState();const texts=ticker.texts||[];equal(texts.length,2);texts.forEach(text=>assert(!manifest.some(slide=>slide.text===text),'Permanent ticker text leaked into rotation'));assert(!ticker.hidden&&!ticker.paused);
});
const events=base.api.buildEvents(base.api.database,base.api.defaults).filter(event=>event.date==='2026-11-16');
equal(events.length,5);
for(const event of events)test('All exact state/content boundaries for '+event.prayer,()=>{
  const app=createRuntime(event.adhan-1000);equal(app.api.getContentMode(),'slides');assert(!app.api.getTickerState().hidden&&!app.api.getTickerState().paused);
  app.setNow(event.adhan);equal(app.api.getState().phase,'WAITING_FOR_IQAMA');equal(app.api.getContentMode(),'adhan');const content=app.document.getElementById('slideContent').textContent;assert(content.trim());assert(/الدعوة|الوسيلة|محمد/.test(content),'Stationary post-adhan dua was not rendered');const index=app.api.getSlidesState().index;
  for(const moment of [event.adhan+1000,Math.floor((event.adhan+event.iqama)/2),event.iqama-1000]){app.setNow(moment);equal(app.api.getContentMode(),'adhan');equal(app.document.getElementById('slideContent').textContent,content);equal(app.api.getSlidesState().index,index);assert(!app.api.getTickerState().hidden&&!app.api.getTickerState().paused);}
  app.setNow(event.iqama);equal(app.api.getState().phase,'PRAYER_MODE');equal(app.api.getContentMode(),'prayer');assert(!app.document.getElementById('prayerOverlay').hidden);assert(app.api.getTickerState().hidden&&app.api.getTickerState().paused);
  const track=app.document.getElementById('tickerTrack'),measurements=track.style._writes.length;equal(track.children[0].scrollWidth,0,'Hidden-cycle measurement must simulate display:none');app.emit('resize');equal(track.style._writes.length,measurements,'Resize while hidden must not replace ticker distance with zero');
  app.setNow(event.end-1);equal(app.api.getContentMode(),'prayer');app.setNow(event.end);equal(app.api.getContentMode(),'slides');assert(app.document.getElementById('prayerOverlay').hidden);assert(!app.api.getTickerState().hidden&&!app.api.getTickerState().paused);assert(track.style._writes.length>measurements&&parseFloat(track.style['--ticker-distance'])>0,'Resumed ticker must be remeasured at a positive simulated width');equal(app.document.getElementById('slideProgress').style.width,'0%');equal(app.api.getSlidesState().count,18);const resumed=app.api.getSlidesState().index;app.setNow(event.end+19999);equal(app.api.getSlidesState().index,resumed);app.setNow(event.end+20000);equal(app.api.getSlidesState().index,(resumed+1)%18);
});
test('Reload/focus/sleep-like jumps within the adhan wait restore the same stationary dua',()=>{
  const event=events[1],moment=event.adhan+Math.floor((event.iqama-event.adhan)/2),app=createRuntime(moment);equal(app.api.getContentMode(),'adhan');const content=app.document.getElementById('slideContent').textContent;app.emit('focus');app.emit('visibilitychange');equal(app.api.getContentMode(),'adhan');equal(app.document.getElementById('slideContent').textContent,content);app.setNow(events[4].adhan+1000);equal(app.api.getContentMode(),'adhan');app.setNow(events[4].end+1000);equal(app.api.getContentMode(),'slides');app.setNow(moment);equal(app.api.getContentMode(),'adhan');equal(app.document.getElementById('slideContent').textContent,content);
});
test('A full normal rotation visits all eighteen entries in order and preserves repeat instructions',()=>{
  const app=createRuntime(stamp('2026-11-16T08:00:00')),seen=[];app.api.setSlides(manifest);app.setNow(stamp('2026-11-16T08:00:00'));for(let i=0;i<18;i++){seen.push(app.document.getElementById('slideContent').textContent);assert(seen[i].includes(manifest[i].text),'Rotation changed entry order at '+i);if(manifest[i].repeat)equal(app.document.getElementById('slideContent').querySelector('.slide-reference').textContent,manifest[i].repeat);app.setNow(app.now()+20000);}equal(app.api.getSlidesState().index,0);
});
test('Donation defaults are visible and legacy schema-version-one settings receive compatible defaults',()=>{
  const app=createRuntime(),state=app.api.getDonationState();equal(app.api.defaults.schemaVersion,1);equal(state.visible,true);equal(state.hidden,false);equal(state.title,'تجديد الفرش وإعادة تنجيد سنادات الظهر');assert(state.description.trim().length>0);equal(state.description,app.api.defaults.donation.description);const old=clone(app.api.defaults);delete old.donation;const imported=app.api.validateSettings(old);equal(JSON.stringify(imported.donation),JSON.stringify(app.api.defaults.donation));
});
test('Permanent donation card survives all eighteen slides and all five adhan waits, hiding only during prayer',()=>{
  const app=createRuntime(stamp('2026-11-16T08:00:00')),image=app.document.getElementById('donationQR'),source=app.api.getDonationState().source;for(let index=0;index<18;index++){equal(app.api.getDonationState().hidden,false);equal(app.document.getElementById('donationQR'),image);equal(app.api.getDonationState().source,source);app.setNow(app.now()+20000);}for(const event of events){for(const moment of [event.adhan-1,event.adhan,event.iqama-1]){app.setNow(moment);equal(app.api.getDonationState().hidden,false);}app.setNow(event.iqama);equal(app.api.getDonationState().hidden,true);app.setNow(event.end);equal(app.api.getDonationState().hidden,false);equal(app.document.getElementById('donationQR'),image);}
});
test('Packaged donation QR is a byte-for-byte copy of the supplied Desktop/444.jpg',()=>{
  const app=createRuntime(),source=app.api.getDonationState().source;assert(source&&!/^(?:https?:|data:|blob:)/i.test(source),'QR must use an ordinary packaged local image path');const asset=path.resolve(root,source);assert(asset.startsWith(path.join(root,'assets')+path.sep),'QR path escaped packaged assets');const supplied=path.join(process.env.USERPROFILE||'C:/Users/user','Desktop','444.jpg');assert(fs.existsSync(supplied),'Supplied original QR file unavailable for byte verification');assert(fs.existsSync(asset),'Packaged QR file missing');const original=fs.readFileSync(supplied),packaged=fs.readFileSync(asset);assert(original.equals(packaged),'Packaged QR image differs from supplied original');qrIntegrity={asset:source,originalFilename:'444.jpg',bytes:packaged.length,sha256:crypto.createHash('sha256').update(packaged).digest('hex'),byteForByteIdentical:true};
});
test('Donation schema rejects wrong types and excessive lengths while rendering editable text literally',()=>{
  const app=createRuntime();for(const invalid of [null,[],{visible:'true',title:'عنوان',description:'وصف'},{visible:true,title:4,description:'وصف'},{visible:true,title:'عنوان',description:{}},{visible:true,title:'x'.repeat(91),description:'وصف'},{visible:true,title:'عنوان',description:'x'.repeat(181)},{visible:true,title:'',description:'وصف'}]){const candidate=clone(app.api.defaults);candidate.donation=invalid;rejects(()=>app.api.validateSettings(candidate));}const maximum=clone(app.api.defaults);maximum.donation={visible:true,title:'x'.repeat(90),description:'x'.repeat(180)};app.api.validateSettings(maximum);const candidate=clone(app.api.defaults);candidate.donation.title='<img src=x onerror="malicious()">';candidate.donation.description='نص عربي <script>malicious()</script>';app.api.useSettings(candidate);equal(app.document.getElementById('donationTitle').textContent,candidate.donation.title);equal(app.document.getElementById('donationTitle').children.length,0);equal(app.document.getElementById('donationDescription').textContent,candidate.donation.description);
});
function donationLabels(app){const labels=app.document.getElementById('settingsBody').querySelectorAll('label').map(node=>node.children.find(child=>child.tagName==='SPAN')?.textContent||'');const visible=labels.find(text=>/إظهار/.test(text)&&/بطاقة|مشروع|تبرع/.test(text)),title=labels.find(text=>/عنوان/.test(text)&&/مشروع|بطاقة|تبرع/.test(text)),description=labels.find(text=>/وصف/.test(text)&&/مشروع|بطاقة|تبرع/.test(text));assert(visible&&title&&description,'Donation settings labels not found: '+JSON.stringify(labels));return {visible,title,description};}
test('Donation settings draft preview/cancel/save preserve hidden field values',()=>{
  const app=createRuntime();app.api.openSettings();const labels=donationLabels(app);app.edit(labels.title,'عنوان المشروع المعدّل');app.edit(labels.description,'وصف محفوظ عند إخفاء البطاقة');app.edit(labels.visible,false);app.document.getElementById('previewButton').click();equal(app.api.getDonationState().hidden,true);equal(app.api.getSettings().donation.title,'عنوان المشروع المعدّل');app.document.getElementById('cancelButton').click();equal(app.api.getSettings().donation.title,app.api.defaults.donation.title);equal(app.api.getDonationState().hidden,false);
  app.api.openSettings();app.edit(labels.title,'عنوان المشروع المعدّل');app.edit(labels.description,'وصف محفوظ عند إخفاء البطاقة');app.edit(labels.visible,false);app.document.getElementById('saveButton').click();equal(app.api.getSettings().donation.visible,false);equal(app.api.getSettings().donation.title,'عنوان المشروع المعدّل');app.api.openSettings();app.edit(labels.visible,true);app.document.getElementById('previewButton').click();equal(app.api.getDonationState().hidden,false);equal(app.api.getDonationState().description,'وصف محفوظ عند إخفاء البطاقة');app.document.getElementById('cancelButton').click();equal(app.api.getDonationState().hidden,true);equal(app.api.getSettings().donation.description,'وصف محفوظ عند إخفاء البطاقة');
});
test('Actual simulated donation import/export handlers preserve values and reject malformed imports',()=>{
  const app=createRuntime();app.api.openSettings();const candidate=clone(app.api.defaults);candidate.donation={visible:false,title:'عنوان مستورد',description:'وصف مستورد ومحفوظ'};const file=app.document.getElementById('settingsFile'),json=JSON.stringify(candidate);file.files=[{name:'settings.json',size:Buffer.byteLength(json),content:json}];app.fire(file,'change');assert(app.document.getElementById('settingsMessage').textContent.includes('استُوردت'));app.document.getElementById('exportSettingsButton').click();const exported=JSON.parse(app.downloads.at(-1).textContent);equal(JSON.stringify(exported.donation),JSON.stringify(candidate.donation));app.document.getElementById('previewButton').click();equal(app.api.getSettings().donation.visible,false);equal(app.api.getSettings().donation.title,'عنوان مستورد');file.files=[{name:'broken.json',size:10,content:'{invalid'}];app.fire(file,'change');assert(app.document.getElementById('settingsMessage').textContent.includes('لم يُطبّق'));equal(app.api.getSettings().donation.title,'عنوان مستورد');app.document.getElementById('cancelButton').click();equal(app.api.getDonationState().hidden,false);equal(app.api.getDonationState().title,app.api.defaults.donation.title);
});
test('Donation image error shows actionable fallback without retrying the QR or offering a fake link',()=>{
  const app=createRuntime(),image=app.document.getElementById('donationQR'),assignments=image._srcAssignments||0;app.fire(image,'error');const failure=app.api.getDonationState();equal(failure.imageAvailable,false);equal(failure.hidden,false);assert(image.hidden||app.document.getElementById('donationQRFrame').hidden,'Broken QR image remained visible');assert(app.document.getElementById('donationCallout').hidden,'Scan callout remained visible after image failure');assert(!app.document.getElementById('donationError').hidden&&/تعذر عرض رمز (?:التبرع|المساهمة)/.test(app.document.getElementById('donationError').textContent),'Actionable QR image failure message missing');for(let index=0;index<20;index++)app.setNow(app.now()+20000);app.fire(image,'error');equal(image._srcAssignments||0,assignments,'Image failure created a source retry loop');equal(app.intervals.length,1);equal(app.document.getElementById('donationCard').querySelectorAll('a').length,0);
});
const result={executedAt:new Date().toISOString(),indexSHA256:crypto.createHash('sha256').update(html).digest('hex'),method:'Actual index.html classic IIFE and embedded JSON evaluated by Node vm with a minimal simulated DOM; no browser launched.',limitations:['No real browser, CSS layout, font metrics, animation movement, clipping, screenshot, or physical screen behavior was tested.','Fake DOM layout dimensions exist only to let application code run; they are not visual measurements.','QR verification checks original-file identity only; no decoding, phone scan, distant-screen scan, payment destination, or financial transaction was tested.'],qrIntegrity,passed:reports.filter(report=>report.pass).length,total:reports.length,failed:reports.filter(report=>!report.pass).length,results:reports};
fs.mkdirSync(path.join(root,'qa'),{recursive:true});fs.writeFileSync(path.join(root,'qa/content-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.failed)process.exitCode=1;
