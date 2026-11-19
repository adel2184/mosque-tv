/* Actual UI functions in a minimal DOM simulation. No browser or Android is run. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),appSource=fs.readFileSync(path.join(root,'dev/app.js'),'utf8'),bridgeSource=fs.readFileSync(path.join(__dirname,'tv-bridge.js'),'utf8');
const checks=[];const assert=(value,message='Assertion failed')=>{if(!value)throw Error(message);};const eq=(a,b)=>assert(a===b,`Expected ${JSON.stringify(b)}; got ${JSON.stringify(a)}`);
function test(name,fn){try{fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}}
function runtime(){
  const listeners=new Map(),windowListeners=new Map(),calls=[],stored=new Map();let document;
  function emit(map,name,event={}){event.type=name;event.preventDefault=()=>event.defaultPrevented=true;event.stopImmediatePropagation=()=>event.stopped=true;for(const fn of map.get(name)||[]){fn(event);if(event.stopped)break;}return event;}
  function match(node,selector){
    selector=selector.trim();if(selector.includes(','))return selector.split(',').some(value=>match(node,value));
    if(selector.endsWith(':not([disabled])'))return !node.disabled&&match(node,selector.replace(':not([disabled])',''));
    const space=selector.lastIndexOf(' ');if(space>=0){if(!match(node,selector.slice(space+1)))return false;for(let parent=node.parentNode;parent;parent=parent.parentNode)if(match(parent,selector.slice(0,space)))return true;return false;}
    if(selector.startsWith('#'))return node.id===selector.slice(1);
    if(selector==='[data-tv-group]')return Boolean(node.dataset.tvGroup);
    const part=selector.split('.');return (!part[0]||node.tagName===part[0].toUpperCase())&&part.slice(1).every(value=>node.classList.contains(value));
  }
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this._text='';this.id='';this.classes=new Set();this.dataset={};this.style={};this.listeners=new Map();this.hidden=false;this.disabled=false;this.open=false;this.type='text';this.min='';this.max='';this.step='';this.maxLength=-1;this.value='';this.checked=false;this.scrollTop=0;this.classList={add:(...items)=>items.forEach(value=>this.classes.add(value)),remove:(...items)=>items.forEach(value=>this.classes.delete(value)),contains:value=>this.classes.has(value),toggle:(value,force)=>{const enabled=force===undefined?!this.classes.has(value):force;if(enabled)this.classes.add(value);else this.classes.delete(value);return enabled;}};}
    get className(){return [...this.classes].join(' ');}set className(value){this.classes=new Set(value.split(/\s+/).filter(Boolean));}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
    get options(){return this.children.filter(child=>child.tagName==='OPTION');}
    append(...nodes){for(let node of nodes){if(typeof node!=='object'){const text=new Element('span');text.textContent=node;node=text;}if(node.parentNode)node.remove();node.parentNode=this;this.children.push(node);}}
    appendChild(node){this.append(node);return node;}
    replaceChildren(...nodes){for(const child of this.children)child.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
    remove(){if(this.parentNode){const parent=this.parentNode;parent.children=parent.children.filter(child=>child!==this);this.parentNode=null;}}
    setAttribute(name,value){this[name]=String(value);}
    querySelectorAll(selector){const result=[];const visit=node=>{for(const child of node.children){if(match(child,selector))result.push(child);visit(child);}};visit(this);return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    closest(selector){for(let node=this;node;node=node.parentNode)if(match(node,selector))return node;return null;}
    addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
    dispatchEvent(event){event.target=this;emit(this.listeners,event.type,event);return true;}
    click(){if(!this.disabled)this.dispatchEvent({type:'click'});}
    focus(){document.activeElement=this;emit(listeners,'focusin',{target:this});}
    get clientHeight(){return this.classList.contains('tv-settings-menu')?240:480;}
    get offsetTop(){return this.parentNode?this.parentNode.children.indexOf(this)*56:0;}
    get offsetHeight(){return 56;}
    scrollIntoView(options){this.scrolled=true;this.scrollOptions=options;const menu=this.closest('.tv-settings-menu');if(menu&&menu!==this){if(this.offsetTop<menu.scrollTop)menu.scrollTop=this.offsetTop;else if(this.offsetTop+this.offsetHeight>menu.scrollTop+menu.clientHeight)menu.scrollTop=this.offsetTop+this.offsetHeight-menu.clientHeight;}}
    showModal(){this.open=true;}close(){this.open=false;}
  }
  const body=new Element('body');document={body,activeElement:body,createElement:tag=>new Element(tag),getElementById:id=>body.querySelector('#'+id),addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);}};
  function node(tag,id,parent=body){const value=new Element(tag);value.id=id;parent.append(value);return value;}
  node('button','settingsButton');const dialog=node('dialog','settingsDialog'),form=node('form','settingsForm',dialog);node('div','settingsBody',form);
  const footer=node('footer','settingsFooter',form);footer.className='settings-footer';node('p','settingsMessage',footer);const actions=node('div','actions',footer);actions.className='settings-actions';
  for(const id of ['saveButton','previewButton','cancelButton','defaultsButton','exportSettingsButton','importSettingsButton','exportTimetableButton','importTimetableButton'])node('button',id,actions);
  node('input','settingsFile',form);node('input','timetableFile',form);
  let power={mode:'always',start:'04:00',end:'23:00',active:true,screenBlack:false,message:'test power'};
  const native={homeStatus:()=>JSON.stringify({isDefaultHome:false,canRequestHomeRole:true,canOpenHomeSettings:true}),deviceStatus:()=>JSON.stringify({message:'test device'}),powerStatus:()=>JSON.stringify(power),updateStatus:()=>JSON.stringify({supported:true,configured:true,installedVersion:'1.2',message:'ready',availableVersion:'1.3'}),openControl:value=>calls.push(['openControl',value]),requestHomeRole:()=>calls.push(['requestHomeRole']),openHomeSettings:()=>calls.push(['openHomeSettings']),openSystemSettings:()=>calls.push(['openSystemSettings']),savePower:value=>{calls.push(['savePower',JSON.parse(value)]);power={...power,...JSON.parse(value)};},checkUpdate:()=>calls.push(['checkUpdate']),installUpdate:()=>calls.push(['installUpdate']),cancelUpdate:()=>calls.push(['cancelUpdate']),deviceSetup:()=>calls.push(['deviceSetup'])};
  const sandbox={document,console,Map,Set,Array,Math,Date,Number,JSON,Event:class{constructor(type,opts){this.type=type;Object.assign(this,opts);}},MosqueAndroid:native,confirm:()=>false,addEventListener(name,fn){if(!windowListeners.has(name))windowListeners.set(name,[]);windowListeners.get(name).push(fn);}};sandbox.window=sandbox;
  const constants=appSource.slice(appSource.indexOf('const DAY'),appSource.indexOf('const clone'));
  const dates=appSource.slice(appSource.indexOf('const dateKey'),appSource.indexOf('function formatClock'));
  const validation=appSource.slice(appSource.indexOf('function fail('),appSource.indexOf('function validateTimetable('));
  const applySettingsSource=appSource.slice(appSource.indexOf('function applySettings('),appSource.indexOf('function plainTimetable('));
  const ui=appSource.slice(appSource.indexOf('function message('),appSource.indexOf('function download('));
  const handlers=appSource.slice(appSource.indexOf("$('settingsButton').addEventListener"),appSource.indexOf("$('settingsFile').addEventListener"));
  const provider=bridgeSource.slice(bridgeSource.indexOf('var powerDraft = null;'),bridgeSource.indexOf('var dialog = document.getElementById',bridgeSource.indexOf('var powerDraft = null;')));
  const persistence=appSource.slice(appSource.indexOf('function persistCurrent('),appSource.indexOf('if(locationEngine&&profileStore)window.MosqueInstall='));
  const config=fs.readFileSync(path.join(root,'dev/config.json'),'utf8');
  const script=`${constants}\nconst clone=x=>JSON.parse(JSON.stringify(x));const defaults=${config};const $=id=>document.getElementById(id);${dates}\n${validation}\nconst displayContent={ticker:[]};let renderedAnnouncements=displayContent.ticker,settingsRevision=1,draft=null,savedSettings=clone(defaults),currentSettings=clone(defaults),settingsOpen=false,previewApplied=false,state={phase:'WAITING_FOR_ADHAN'},database=null,databaseError='test',calendar={rangeStart:'2025-01-01',rangeEnd:'2029-01-01'},calendarNativeOK=false,storageNote='',storage={},STORE='test',events=[];const nowProvider=()=>Date.parse('2026-11-17T09:00:00+03:00');function interaction(){}function refresh(){}function tick(){} ${applySettingsSource} function exportTimetable(){}function download(){}function safeWrite(s,k,v){window.recordWrite(k,v);return{ok:true};}function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}var native=window.MosqueAndroid;${provider}\n${persistence}\n${ui}\n${handlers}\nwindow.TEST={draft:()=>clone(draft),saved:()=>clone(savedSettings),current:()=>clone(currentSettings),setPrayer:value=>state.phase=value?'PRAYER_MODE':'WAITING_FOR_ADHAN',sections:()=>tvSections.map(s=>({id:s.id,rows:s.rows.map(r=>({id:r.id,label:r.label,kind:r.kind}))})),redraw:drawSettings};`;
  sandbox.recordWrite=(key,value)=>stored.set(key,value);vm.runInNewContext(script,sandbox,{timeout:4000});
  return{document,window:sandbox,calls,stored,get:id=>document.getElementById(id),open:()=>sandbox.MosqueTV.toggleSettings(),back:()=>sandbox.MosqueTV.handleBack(),click:id=>{const target=document.getElementById(id);assert(target,'Missing '+id);target.click();},key:key=>{const event=emit(listeners,'keydown',{key,ctrlKey:false,altKey:false});if(key==='Enter'&&!event.defaultPrevented)document.activeElement.click();return event;},row:(section,label)=>{const item=sandbox.TEST.sections().find(item=>item.id===section).rows.find(row=>row.label.includes(label));assert(item,'Missing row '+section+'/'+label);return'tv-row-'+item.id;},section:id=>{if(sandbox.MosqueTV.getUIState().editing)sandbox.MosqueTV.handleBack();if(sandbox.MosqueTV.getUIState().pane!=='menu')sandbox.MosqueTV.handleBack();const button=document.getElementById('tv-section-'+id);assert(button,'Missing section '+id);button.click();},event:(name,detail={})=>emit(windowListeners,name,{detail})};
}

test('Actual TV hub opens with stable sections and the gear is inside the safe header',()=>{const app=runtime();app.open();eq(app.window.MosqueTV.isOpen(),true);eq(app.window.TEST.sections().length,11);eq(app.document.activeElement.id,'tv-section-mosque');const shell=fs.readFileSync(path.join(root,'dev/shell.html'),'utf8');assert(shell.indexOf('id="settingsButton"')>shell.indexOf('id="dashboardHeader"'));assert(shell.indexOf('id="settingsButton"')<shell.indexOf('class="identity-area"'));eq((shell.match(/id="settingsButton"/g)||[]).length,1);});
test('TV builds only the requested form and reads native status when entering device settings',()=>{
  const app=runtime(),created=[];
  const create=app.document.createElement;
  app.document.createElement=tag=>{created.push(tag);return create(tag);};
  let homeReads=0;
  const home=app.window.MosqueAndroid.homeStatus;
  app.window.MosqueAndroid.homeStatus=()=>{homeReads++;return home();};
  app.open();
  eq(created.filter(tag=>tag==='input'||tag==='select').length,0);
  eq(homeReads,0);
  app.section('display');
  eq(created.filter(tag=>tag==='input'||tag==='select').length,4);
  eq(homeReads,0);
  app.section('tv-home');
  eq(homeReads,1);
  const activeHomeRow=app.document.activeElement;
  app.event('mosque-native-update-result',{});
  eq(homeReads,1);
  assert(app.document.activeElement===activeHomeRow);
  app.section('tv-system');
  const phone=app.row('tv-system','التحكم من الهاتف'),oldPhone=app.get(phone);
  app.click(phone);
  assert(app.get(phone)===oldPhone);
  app.section('tv-power');
  eq(homeReads,1);
  const powerRow=app.row('tv-power','وضع تشغيل');
  assert(app.get(powerRow));
  app.window.MosqueTV.toggleSettings();
  eq(app.window.TEST.sections().length,0);
  eq(app.get('settingsBody').children.length,0);
});
test('The remote changes the phone reminder and adhkar duration, restores focus and saves both offline',()=>{
  const app=runtime();app.open();
  app.key('ArrowDown');app.key('ArrowDown');eq(app.document.activeElement.id,'tv-section-display');
  app.key('Enter');app.key('ArrowDown');app.key('ArrowDown');
  const reminder=app.row('display','تنبيه إغلاق الجوالات'),duration=app.row('display','مدة عرض أذكار ما بعد الصلاة');
  const originalList=app.get('tvSettingsRows'),originalReminder=app.get(reminder),originalDuration=app.get(duration);
  eq(app.document.activeElement.id,reminder);app.key('Enter');eq(app.document.activeElement.id,'tv-choice-0');
  app.key('ArrowDown');app.key('Enter');eq(app.window.TEST.draft().silentPhoneReminder,false);eq(app.document.activeElement.id,reminder);
  assert(app.get('tvSettingsRows')===originalList&&app.get(reminder)===originalReminder);
  eq(originalReminder.querySelector('.tv-row-value').textContent,'لا');
  app.key('ArrowDown');eq(app.document.activeElement.id,duration);app.key('Enter');
  eq(app.document.activeElement.id,'tv-choice-2');eq(app.get('tv-choice-0').textContent,'إيقاف');
  app.key('ArrowDown');app.back();eq(app.window.TEST.draft().postPrayerMinutes,5);eq(app.document.activeElement.id,duration);
  assert(app.get('tvSettingsRows')===originalList&&app.get(duration)===originalDuration);
  app.key('Enter');app.key('ArrowUp');app.key('ArrowUp');app.key('Enter');
  eq(app.window.TEST.draft().postPrayerMinutes,0);eq(app.document.activeElement.id,duration);
  assert(app.get(duration)===originalDuration);eq(originalDuration.querySelector('.tv-row-value').textContent,'إيقاف');
  eq(app.window.TEST.saved().silentPhoneReminder,true);eq(app.window.TEST.saved().postPrayerMinutes,5);
  app.key('ArrowDown');eq(app.document.activeElement.id,'saveButton');app.key('Enter');
  const saved=JSON.parse(app.stored.get('test'));eq(saved.silentPhoneReminder,false);eq(saved.postPrayerMinutes,0);
  eq(app.window.MosqueTV.isOpen(),false);eq(app.calls.length,0);
});
test('Entering native categories skips disabled status rows and focuses the first editable action',()=>{const app=runtime();app.open();for(const [section,label]of [['tv-power','وضع تشغيل'],['tv-home','اختيار التطبيق'],['tv-update','إلغاء مهمة']]){app.section(section);const expected=app.row(section,label);if(section==='tv-update'){assert(app.document.activeElement.id.startsWith('tv-row-'));assert(!app.document.activeElement.disabled);}else eq(app.document.activeElement.id,expected);assert(!app.document.activeElement.id.startsWith('tv-section-'));}});
test('Number arrows are staged; Back discards the field edit and restores the same row',()=>{const app=runtime();app.open();app.section('iqama');const row=app.row('iqama','الفجر');app.click(row);app.key('ArrowRight');eq(app.get('tvEditorValue').textContent,'26');eq(app.window.TEST.draft().iqama.offsets.fajr,25);app.back();eq(app.window.TEST.draft().iqama.offsets.fajr,25);eq(app.document.activeElement.id,row);eq(app.get('tvEditor'),null);});
test('OK commits the numeric draft; save uses the actual validator and original persistence handler',()=>{const app=runtime();app.open();app.section('iqama');app.click(app.row('iqama','الفجر'));app.key('ArrowRight');app.click('tvEditorConfirm');eq(app.window.TEST.draft().iqama.offsets.fajr,26);eq(app.window.TEST.saved().iqama.offsets.fajr,25);app.click('saveButton');eq(app.window.TEST.saved().iqama.offsets.fajr,26);eq(JSON.parse(app.stored.get('test')).iqama.offsets.fajr,26);eq(app.window.MosqueTV.isOpen(),false);});
test('Text remains literal; preview is reversible and Back unwinds editor, section, menu',()=>{const app=runtime();app.open();app.section('mosque');app.click(app.row('mosque','اسم الجامع'));app.get('tvEditorInput').value='<img src=x onerror=alert(1)> جامع';app.click('tvEditorConfirm');eq(app.window.TEST.draft().mosque.fields.name.value,'<img src=x onerror=alert(1)> جامع');app.click('previewButton');eq(app.window.TEST.current().mosque.fields.name.value,'<img src=x onerror=alert(1)> جامع');app.back();eq(app.get('settingsDialog').classList.contains('previewing'),false);app.back();eq(app.window.MosqueTV.isOpen(),true);app.back();eq(app.window.MosqueTV.isOpen(),false);eq(app.window.TEST.current().mosque.fields.name.value,'جامع لطيفة الخالدي - ضاحية الملك فهد');});
test('Checkbox and select options commit only into the draft and cancellation preserves saved values',()=>{const app=runtime();app.open();app.section('donation');app.click(app.row('donation','إظهار بطاقة'));app.click('tv-choice-1');eq(app.window.TEST.draft().donation.visible,false);eq(app.window.TEST.saved().donation.visible,true);app.section('display');app.click(app.row('display','نمط الأرقام'));app.click('tv-choice-1');eq(app.window.TEST.draft().digitStyle,'arabic');app.window.MosqueTV.toggleSettings();eq(app.window.TEST.current().donation.visible,true);eq(app.window.TEST.current().digitStyle,'western');});
test('Native actions do not run on open; system routing and separate explicit power save are preserved',()=>{const app=runtime();app.open();eq(app.calls.length,0);app.section('tv-system');app.click(app.row('tv-system','الشبكة'));eq(JSON.stringify(app.calls),JSON.stringify([['openControl','wifi']]));app.section('tv-power');app.click(app.row('tv-power','وضع تشغيل'));app.click('tv-choice-1');eq(app.calls.length,1);eq(app.window.TEST.draft().prayerModeMinutes,15);app.click(app.row('tv-power','حفظ إعداد'));eq(app.calls.length,2);eq(app.calls[1][0],'savePower');eq(app.calls[1][1].mode,'scheduled');});
test('Blank fixed-iqama time accepts remote-only hours/minutes and explicit confirmation without an IME input',()=>{const app=runtime();app.open();app.section('iqama');app.click(app.row('iqama','إضافة موعد إقامة ثابت'));const row=app.row('iqama','الإقامة 24 ساعة');app.click(row);eq(app.document.activeElement.id,'tvEditorHours');eq(app.get('tvEditorHours').textContent,'00');eq(app.get('tvEditorMinutes').textContent,'00');eq(app.get('tvEditorInput'),null);eq(app.get('tvEditor').querySelectorAll('input').length,0);for(let i=0;i<13;i++)app.key('ArrowRight');app.key('ArrowDown');eq(app.document.activeElement.id,'tvEditorMinutes');for(let i=0;i<42;i++)app.key('ArrowRight');eq(app.window.TEST.draft().iqama.overrides[0].time,'');app.key('Enter');eq(app.document.activeElement.id,'tvEditorConfirm');app.key('Enter');eq(app.get('tvEditor'),null);eq(app.document.activeElement.id,row);eq(app.window.TEST.draft().iqama.overrides[0].time,'13:42');eq(app.window.TEST.saved().iqama.overrides.length,0);eq(app.stored.size,0);});
test('Blank time remains blank after either explicit Cancel or Back and focus returns to its row',()=>{const app=runtime();app.open();app.section('iqama');app.click(app.row('iqama','إضافة موعد إقامة ثابت'));const row=app.row('iqama','الإقامة 24 ساعة');app.click(row);app.key('ArrowRight');app.key('ArrowDown');app.key('ArrowRight');app.key('ArrowDown');app.key('ArrowDown');eq(app.document.activeElement.id,'tvEditorCancel');app.key('Enter');eq(app.window.TEST.draft().iqama.overrides[0].time,'');eq(app.document.activeElement.id,row);app.click(row);eq(app.get('tvEditorHours').textContent,'00');eq(app.get('tvEditorMinutes').textContent,'00');app.key('ArrowLeft');app.back();eq(app.window.TEST.draft().iqama.overrides[0].time,'');eq(app.document.activeElement.id,row);eq(app.get('tvEditor'),null);});
test('Existing scheduled time loads canonical segments, stages edits, and saves only through the native power action',()=>{const app=runtime();app.open();app.section('tv-power');const row=app.row('tv-power','بداية العرض');app.click(row);eq(app.get('tvEditorHours').textContent,'04');eq(app.get('tvEditorMinutes').textContent,'00');app.key('ArrowRight');app.key('Enter');eq(app.document.activeElement.id,'tvEditorMinutes');for(let i=0;i<7;i++)app.key('ArrowRight');app.key('Enter');eq(app.document.activeElement.id,'tvEditorConfirm');app.key('Enter');eq(app.calls.length,0);assert(app.get(row).textContent.includes('05:07'));app.click(app.row('tv-power','حفظ إعداد'));eq(app.calls[0][0],'savePower');eq(app.calls[0][1].start,'05:07');eq(app.calls[0][1].end,'23:00');});
test('Remote time boundaries wrap independently at 00/23 hours and 00/59 minutes with zero padding',()=>{const app=runtime();app.open();app.section('iqama');app.click(app.row('iqama','إضافة موعد إقامة ثابت'));const row=app.row('iqama','الإقامة 24 ساعة');app.click(row);app.key('ArrowLeft');eq(app.get('tvEditorHours').textContent,'23');app.key('ArrowRight');eq(app.get('tvEditorHours').textContent,'00');app.key('ArrowDown');app.key('ArrowLeft');eq(app.get('tvEditorMinutes').textContent,'59');eq(app.get('tvEditorHours').textContent,'00');app.key('ArrowRight');eq(app.get('tvEditorMinutes').textContent,'00');app.key('ArrowLeft');app.key('ArrowUp');eq(app.document.activeElement.id,'tvEditorHours');app.key('ArrowLeft');app.key('Enter');app.key('Enter');app.key('Enter');eq(app.window.TEST.draft().iqama.overrides[0].time,'23:59');});
test('Native status refresh restores the focused row after cancelling its time editor',()=>{const app=runtime();app.open();app.section('tv-power');const row=app.row('tv-power','بداية العرض');app.click(row);app.key('ArrowRight');app.back();eq(app.document.activeElement.id,row);app.event('mosque-native-power-result',{success:true,message:'حُفظ'});eq(app.document.activeElement.id,row);assert(app.get(row).textContent.includes('04:00'));});
test('A lower category returns visibly selected when Back replaces its dedicated rows with the category menu',()=>{const app=runtime();app.open();app.section('tv-update');eq(app.window.MosqueTV.getUIState().pane,'rows');eq(app.get('tv-section-tv-update'),null);assert(app.document.activeElement.id.startsWith('tv-row-'));assert(app.get('tvSettingsRows').contains?app.get('tvSettingsRows').contains(app.document.activeElement):app.document.activeElement.parentNode===app.get('tvSettingsRows'));app.key('ArrowDown');assert(app.document.activeElement.id.startsWith('tv-row-'));app.back();let selected=app.get('tv-section-tv-update'),menu=selected.closest('.tv-settings-menu');eq(app.window.MosqueTV.getUIState().pane,'menu');eq(app.document.activeElement.id,'tv-section-tv-update');assert(selected.classList.contains('selected'));assert(selected.offsetTop>menu.clientHeight,'Fixture must place this category below the initial menu viewport');assert(menu.scrollTop>0);assert(selected.offsetTop>=menu.scrollTop);assert(selected.offsetTop+selected.offsetHeight<=menu.scrollTop+menu.clientHeight);eq(selected.scrollOptions.block,'nearest');app.event('mosque-native-update-result',{});selected=app.get('tv-section-tv-update');menu=selected.closest('.tv-settings-menu');eq(app.document.activeElement.id,'tv-section-tv-update');assert(selected.offsetTop>=menu.scrollTop);assert(selected.offsetTop+selected.offsetHeight<=menu.scrollTop+menu.clientHeight);app.key('ArrowLeft');eq(app.get('tv-section-tv-update'),null);assert(app.document.activeElement.id.startsWith('tv-row-'));});
test('Menu arrows enter the focused category, footer follows RTL order, and prayer prevents opening',()=>{const app=runtime();app.open();app.key('ArrowDown');eq(app.document.activeElement.id,'tv-section-iqama');app.key('ArrowLeft');eq(app.window.MosqueTV.getUIState().section,'iqama');assert(app.document.activeElement.id.startsWith('tv-row-'));app.get('saveButton').focus();app.key('ArrowLeft');eq(app.document.activeElement.id,'previewButton');app.window.MosqueTV.toggleSettings();app.window.TEST.setPrayer(true);app.open();eq(app.window.MosqueTV.isOpen(),false);});
const report={executedAt:new Date().toISOString(),method:'Actual settings UI/validator/handlers and native adapter source evaluated in a minimal simulated DOM; menu nearest-scrolling is simulated with a 240px viewport and 56px rows. No browser, Android, TV remote, IME, actual screen visibility, or emulator executed.',appSHA256:crypto.createHash('sha256').update(appSource).digest('hex'),bridgeSHA256:crypto.createHash('sha256').update(bridgeSource).digest('hex'),passed:checks.filter(item=>item.pass).length,total:checks.length,failed:checks.filter(item=>!item.pass).length,checks};fs.writeFileSync(path.join(__dirname,'tv-settings-test-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
