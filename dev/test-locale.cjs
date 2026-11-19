/* Actual locale module with local DOM fixtures; no browser, device, network, or app storage. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const file=path.join(__dirname,'locale.js'),source=fs.readFileSync(file,'utf8');
function fixture(){
  const observers=[],pending=[],events=[],listeners=new Map();let doc;
  function changed(target,type){for(const observer of observers)if(observer.target===target||observer.options.subtree&&observer.target.contains(target))if(observer.options[type])pending.push(()=>observer.callback([{target,type}]));}
  class TextNode{
    constructor(value){this.nodeType=3;this.parentNode=null;this._value=String(value);}
    get nodeValue(){return this._value;}set nodeValue(value){this._value=String(value);changed(this,'characterData');}
    get textContent(){return this.nodeValue;}set textContent(value){this.nodeValue=value;}
  }
  function simple(node,selector){
    if(node.nodeType!==1)return false;
    const attrs=[...selector.matchAll(/\[([^=\]]+)(?:=([^\]]+))?\]/g)];selector=selector.replace(/\[[^\]]+\]/g,'');
    if(attrs.some(([,name,value])=>node.getAttribute(name)===null||value!==undefined&&node.getAttribute(name)!==value.replace(/['"]/g,'')))return false;
    const id=selector.match(/#([\w-]+)/);if(id&&node.id!==id[1])return false;
    const tag=selector.match(/^[\w-]+/);if(tag&&node.tagName!==tag[0].toUpperCase())return false;
    return [...selector.matchAll(/\.([\w-]+)/g)].every(([,name])=>node.classList.contains(name));
  }
  function match(node,selector){
    if(selector.includes(','))return selector.split(',').some(part=>match(node,part.trim()));
    const child=selector.lastIndexOf('>');if(child>=0)return simple(node,selector.slice(child+1).trim())&&node.parentNode&&match(node.parentNode,selector.slice(0,child).trim());
    const split=selector.lastIndexOf(' ');if(split>=0){if(!simple(node,selector.slice(split+1)))return false;for(let parent=node.parentNode;parent;parent=parent.parentNode)if(match(parent,selector.slice(0,split)))return true;return false;}
    return simple(node,selector);
  }
  class Element{
    constructor(tag){this.nodeType=1;this.tagName=tag.toUpperCase();this.parentNode=null;this.childNodes=[];this.id='';this.dataset={};this.attrs=new Map();this.className='';this.value='';this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:name=>this.className+=' '+name};}
    get textContent(){return this.childNodes.map(node=>node.textContent).join('');}set textContent(value){this.replaceChildren(new TextNode(value));}
    append(...nodes){for(let node of nodes){if(typeof node!=='object')node=new TextNode(node);node.parentNode=this;this.childNodes.push(node);}changed(this,'childList');}
    appendChild(node){this.append(node);return node;}
    replaceChildren(...nodes){for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];this.append(...nodes);}
    contains(node){return node===this||this.childNodes.some(child=>child.nodeType===1?child.contains(node):child===node);}
    getAttribute(name){if(name==='id')return this.id||null;return this.attrs.has(name)?this.attrs.get(name):null;}
    setAttribute(name,value){if(name==='id')this.id=String(value);this.attrs.set(name,String(value));}
    querySelectorAll(selector){const values=[];function walk(node){for(const child of node.childNodes)if(child.nodeType===1){if(match(child,selector))values.push(child);walk(child);}}walk(this);return values;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    closest(selector){for(let node=this;node;node=node.parentNode)if(match(node,selector))return node;return null;}
  }
  const html=new Element('html'),body=new Element('body');html.append(body);
  doc={documentElement:html,body,createElement:tag=>new Element(tag),getElementById:id=>html.querySelector('#'+id),querySelector:selector=>html.querySelector(selector),querySelectorAll:selector=>html.querySelectorAll(selector),addEventListener(name,callback){listeners.set(name,callback);}};
  const win={document:doc,MutationObserver:class{constructor(callback){this.callback=callback;}observe(target,options){observers.push({target,options,callback:this.callback});}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event)};win.window=win;
  const el=(tag,text,classes,id)=>{const node=new Element(tag);if(text!==undefined)node.textContent=text;if(classes)node.className=classes;if(id)node.id=id;return node;};
  const stage=el('main',undefined,undefined,'stage'),settings=el('dialog',undefined,undefined,'settingsDialog'),cc=el('aside',undefined,undefined,'mosqueControlCenter');body.append(stage,settings,cc);
  function row(id,kind,label,value){const node=el('button',undefined,'tv-setting-row',id);if(kind)node.dataset.tvKind=kind;node.append(el('span',label,'tv-row-label'),el('span',value,'tv-row-value'));settings.append(node);return node;}
  const app={doc,win,el,stage,settings,cc,row,events,observers,flush(){let runs=0;while(pending.length){assert.ok(++runs<100,'Translation observer did not settle');for(const callback of pending.splice(0))callback();}},load(){vm.runInNewContext(source,win,{filename:file,timeout:3000});app.locale=win.MosqueLocale;return app;}};return app;
}
const tests=[];function test(name,run){tests.push({name,run});}
test('Phone and post-prayer settings localize their TV rows, selected value and choice buttons in both directions',()=>{
  const app=fixture(),phone=app.row('phone','checkbox','تنبيه إغلاق الجوالات','نعم'),duration=app.row('duration','select','مدة عرض أذكار ما بعد الصلاة','5 دقائق');
  const choices=['إيقاف','3 دقائق','5 دقائق','7 دقائق'].map(label=>app.el('button',label,'tv-choice'));
  app.settings.append(...choices);app.load();app.locale.set('en');app.flush();
  assert.equal(phone.querySelector('.tv-row-label').textContent,'Silent phone reminder');
  assert.equal(duration.querySelector('.tv-row-label').textContent,'Post-prayer adhkar duration');
  assert.equal(duration.querySelector('.tv-row-value').textContent,'5 minutes');
  assert.deepEqual(choices.map(node=>node.textContent),['Off','3 minutes','5 minutes','7 minutes']);
  app.locale.set('ar');app.flush();assert.equal(phone.querySelector('.tv-row-value').textContent,'نعم');
  assert.equal(duration.querySelector('.tv-row-label').textContent,'مدة عرض أذكار ما بعد الصلاة');
  assert.deepEqual(choices.map(node=>node.textContent),['إيقاف','3 دقائق','5 دقائق','7 دقائق']);
});
test('Language selection changes only UI language and keeps the mosque stage RTL',()=>{const app=fixture().load();assert.equal(app.locale.t('معاينة','Custom preview'),'معاينة');app.locale.set('en');assert.equal(app.doc.documentElement.lang,'en');assert.equal(app.doc.documentElement.dir,'ltr');assert.equal(app.stage.dir,'rtl');assert.equal(app.settings.dir,'ltr');assert.equal(app.locale.t('معاينة','Custom preview'),'Custom preview');assert.equal(app.locale.t('حفظ وتطبيق'),'Save and apply');assert.equal(app.events.at(-1).detail.language,'en');});
test('Known captions translate while mosque, donation, and custom field values remain literal',()=>{const app=fixture(),name=app.row('tv-row-name','text','اسم الجامع','الشبكة'),donation=app.row('tv-row-donation','text','عنوان مشروع التبرع','حفظ وتطبيق'),custom=app.row('tv-row-custom','text','الحقل الإضافي 1 — نص إضافي','تأكيد');app.load();app.locale.set('en');assert.equal(name.querySelector('.tv-row-label').textContent,'Mosque name');assert.equal(name.querySelector('.tv-row-value').textContent,'الشبكة');assert.equal(donation.querySelector('.tv-row-value').textContent,'حفظ وتطبيق');assert.equal(custom.querySelector('.tv-row-value').textContent,'تأكيد');assert.equal(custom.querySelector('.tv-row-label').textContent,'Custom field 1 — Additional text');});
test('Structured checkbox, select, action, and information values translate without changing numeric or time values',()=>{const app=fixture(),rows=[app.row('tv-row-flag','checkbox','إظهار بطاقة التبرع','نعم'),app.row('tv-row-select','select','التكرار','يوم في الأسبوع'),app.row('tv-row-action','action','تصدير الإعدادات','فتح'),app.row('tv-row-status','info','الحالة الحالية','التطبيق هو واجهة البدء الافتراضية.'),app.row('tv-row-time','time','بداية العرض اليومي','04:00'),app.row('tv-row-number','number','مدة وضع الصلاة (دقيقة)','15')];app.load();app.locale.set('en');assert.deepEqual(rows.map(row=>row.querySelector('.tv-row-value').textContent),['Yes','Weekday','Open','This app is the default Home app.','04:00','15']);});
test('Arabic restoration preserves original captions, including repeated language changes',()=>{const app=fixture(),heading=app.el('h3','الإقامة ووضع الصلاة');app.settings.append(heading);app.load();for(let i=0;i<3;i++){app.locale.set('en');app.flush();assert.equal(heading.textContent,'Iqama and prayer mode');app.locale.set('ar');app.flush();assert.equal(heading.textContent,'الإقامة ووضع الصلاة');}});
test('New settings nodes and native status replacements translate through scoped observers without a loop',()=>{const app=fixture().load();app.locale.set('en');const value=app.el('p','جارٍ البحث عن تحديث…','notice');app.settings.append(value);app.flush();assert.equal(value.textContent,'Checking for an update…');value.textContent='جارٍ تنزيل التحديث…';app.flush();assert.equal(value.textContent,'Downloading update…');app.locale.set('ar');app.flush();assert.equal(value.textContent,'جارٍ تنزيل التحديث…');assert.deepEqual(app.observers.map(item=>item.target.id),['settingsDialog','mosqueControlCenter']);});
test('Text input values, SSIDs, and model names are never interpreted as captions',()=>{const app=fixture(),input=app.el('input');input.value='إعدادات الجامع';input.setAttribute('type','text');app.settings.append(input);const ssid=app.el('span','الشبكة','cc-row-summary'),device=app.el('p','حفظ وتطبيق','cc-device');app.cc.append(app.el('button',undefined,'cc-row'));app.cc.querySelector('button').append(ssid);app.cc.append(device);app.load();app.locale.set('en');app.flush();assert.equal(input.value,'إعدادات الجامع');assert.equal(input.getAttribute('dir'),'auto');assert.equal(ssid.textContent,'الشبكة');assert.equal(device.textContent,'حفظ وتطبيق');});
test('Unknown status errors use an English fallback but never become HTML or lose their Arabic source',()=>{const app=fixture(),message=app.el('p','خطأ مخصص <script>محلي</script>','error','settingsMessage');app.settings.append(message);app.load();app.locale.set('en');assert.match(message.textContent,/could not be completed/);assert.equal(message.querySelector('script'),null);app.locale.set('ar');assert.equal(message.textContent,'خطأ مخصص <script>محلي</script>');});
test('Accessible attributes translate and restore, including nav and time segment labels',()=>{const app=fixture(),nav=app.el('nav'),hour=app.el('button','00');nav.setAttribute('aria-label','أقسام الإعدادات');hour.setAttribute('aria-label','الساعات، يمين للزيادة ويسار للنقصان');hour.setAttribute('title','تأكيد');app.settings.append(nav,hour);app.load();app.locale.set('en');assert.equal(nav.getAttribute('aria-label'),'Settings categories');assert.equal(hour.getAttribute('aria-label'),'Hours: right increases, left decreases');app.locale.set('ar');assert.equal(nav.getAttribute('aria-label'),'أقسام الإعدادات');assert.equal(hour.getAttribute('title'),'تأكيد');});
test('Safe stage captions translate while religious content and user donation copy remain unchanged',()=>{const app=fixture(),table=app.el('table',undefined,'prayer-table'),head=app.el('thead'),tr=app.el('tr'),th=app.el('th','الصلاة'),religious=app.el('p','الصلاة'),donation=app.el('h2','حفظ وتطبيق',undefined,'donationTitle');tr.append(th);head.append(tr);table.append(head);app.stage.append(table,religious,donation);app.load();app.locale.set('en');assert.equal(th.textContent,'Prayer');assert.equal(religious.textContent,'الصلاة');assert.equal(donation.textContent,'حفظ وتطبيق');});
test('Dynamic static-copy patterns cover intervals, custom rows, progress, versions, and speed results',()=>{const app=fixture().load();app.locale.set('en');for(const [ar,en]of [['الفجر (دقيقة)','Fajr (minutes)'],['تعديل وقت الظهر (دقيقة)','Adjust Dhuhr (minutes)'],['الصف 3','Row 3'],['2.0.3 · يتوفر تحديث','2.0.3 · Update available'],['2.0.3 — جارٍ تنزيل التحديث… — 25%','2.0.3 — Downloading update… — 25%'],['تنزيل تقريبي: 25.5 ميجابت/ث — عينة 5 ميجابايت.','Approximate download: 25.5 Mbps — 5 MB sample.']])assert.equal(app.locale.t(ar),en);assert.equal(app.locale.t('عنوان خاص لا يترجم'),'عنوان خاص لا يترجم');});
let failed=0;for(const item of tests){try{item.run();process.stdout.write('PASS '+item.name+'\n');}catch(error){failed++;process.stderr.write('FAIL '+item.name+'\n'+error.stack+'\n');}}process.stdout.write(`${tests.length-failed}/${tests.length} locale checks passed\n`);if(failed)process.exitCode=1;
