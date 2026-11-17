/* Original TV control-centre UI. No network, permission changes, or mosque-data storage. */
(function () {
  'use strict';
  const STORAGE_KEY='mosque-display.control-center.v1';
  const QUICK=[
    {id:'bluetooth',label:'البلوتوث'},
    {id:'mirror',label:'بث الشاشة'},
    {id:'sleep',label:'مؤقت العرض',title:'مؤقت إيقاف العرض'},
    {id:'power',label:'إيقاف العرض',title:'إيقاف العرض الآن'}
  ];
  const CATALOG=[
    {id:'network',label:'الشبكة',fallback:'Wi-Fi والاتصال المحلي'},
    {id:'sound',label:'الصوت',fallback:'مستوى الصوت وإعداداته'},
    {id:'speed',label:'سرعة الاتصال',fallback:'اختبار عند الطلب فقط'},
    {id:'tv',label:'إعدادات التلفاز',fallback:'خيارات النظام'},
    {id:'app',label:'إعدادات الجامع',fallback:'البيانات والإقامة والعرض',section:'mosque'},
    {id:'update',label:'تحديث التطبيق',fallback:'الإصدار والتحديث',section:'tv-update'},
    {id:'phone',label:'التحكم من الجوال',fallback:'اقتران على الشبكة المحلية'},
    {id:'display',label:'الصورة والشاشة',fallback:'إعدادات العرض'},
    {id:'screensaver',label:'شاشة التوقف',fallback:'إذا أتاحها التلفاز'},
    {id:'home',label:'واجهة البدء',fallback:'البدء مع التلفاز',section:'tv-home'},
    {id:'power',label:'جدول تشغيل العرض',fallback:'الطاقة وساعات العرض',section:'tv-power'},
    {id:'deviceSetup',label:'تهيئة التلفاز',fallback:'خطة إعداد الجهاز'}
  ];
  const DEFAULT_ROWS=['network','sound','speed','tv','app','update'];
  const ROW_IDS=new Set(CATALOG.map(row=>row.id));
  const FOCUS_IDS=new Set(QUICK.map(row=>'cc-quick-'+row.id).concat(CATALOG.map(row=>'cc-row-'+row.id),['cc-customize']));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const tx=value=>window.MosqueLocale&&typeof window.MosqueLocale.t==='function'?window.MosqueLocale.t(value):value;
  function localizePanel(){if(window.MosqueLocale&&typeof window.MosqueLocale.translateUI==='function')window.MosqueLocale.translateUI(panel);}
  const defaults=()=>({schemaVersion:1,rows:DEFAULT_ROWS.slice(),lastId:'cc-row-network'});
  let storageNote='',config=defaults(),nativeStatus={},lastStatusSignature=null,opened=false,view='main',customRows=null,returnFocus=null,closeTimer=0;
  let overlay=null,panel=null,content=null,messageNode=null,footer=null;
  function validate(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||!Array.isArray(value.rows)||value.rows.length<1||value.rows.length>6||value.rows.some(id=>typeof id!=='string'||!ROW_IDS.has(id))||new Set(value.rows).size!==value.rows.length||typeof value.lastId!=='string'||!FOCUS_IDS.has(value.lastId))return null;
    return{schemaVersion:1,rows:value.rows.slice(),lastId:value.lastId};
  }
  try{const raw=window.localStorage.getItem(STORAGE_KEY);if(raw){const saved=validate(JSON.parse(raw));if(saved)config=saved;else storageNote='استُخدم ترتيب المركز الافتراضي لأن النسخة المحفوظة غير صالحة.';}}
  catch(_){storageNote='خيارات المركز تعمل لهذه الجلسة؛ تعذر قراءة الحفظ المحلي.';}
  function persist(){try{window.localStorage.setItem(STORAGE_KEY,JSON.stringify(config));return true;}catch(_){storageNote='خيارات المركز تعمل لهذه الجلسة فقط؛ تعذر حفظها محليًا.';return false;}}
  function prayerActive(){return Boolean(document.body&&document.body.classList.contains('praying'));}
  function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node;}
  function statusMessage(text){if(messageNode){messageNode.textContent=tx(text||storageNote);messageNode.hidden=!messageNode.textContent;const active=document.activeElement;if(opened&&panel&&panel.contains(active)&&active.scrollIntoView)active.scrollIntoView({block:'nearest',inline:'nearest'});}}
  function readNative(){
    try{const api=window.MosqueTVNative;if(!api||typeof api.controlStatus!=='function')return{};let value=api.controlStatus();if(typeof value==='string')value=JSON.parse(value);return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
    catch(_){return{message:'تعذر قراءة حالة بعض خيارات التلفاز.'};}
  }
  function available(id){return !(nativeStatus.available&&nativeStatus.available[id]===false);}
  function summary(row){
    if(row.id==='speed'&&!available('speed'))return tx('يحتاج الإنترنت');
    const value=nativeStatus.rows&&nativeStatus.rows[row.id]!==undefined?nativeStatus.rows[row.id]:nativeStatus[row.id];
    if(typeof value==='string')return(row.id==='network'?value:tx(value)).slice(0,140);
    if(typeof value==='boolean')return tx(value?'مفعّل':'متوقف');
    if(value&&typeof value==='object'){const text=value.message||value.summary||value.name;if(typeof text==='string')return(value.name&&!value.message&&!value.summary?text:tx(text)).slice(0,140);}
    return tx(available(row.id)?row.fallback||'': 'غير متاح في هذا التلفاز');
  }
  // Compare only values rendered by this panel, independent of native object key order.
  function statusSignature(){
    const device=typeof nativeStatus.device==='string'?nativeStatus.device:nativeStatus.device&&typeof nativeStatus.device.model==='string'?nativeStatus.device.model:'شاشة الجامع';
    return JSON.stringify([device,QUICK.map(row=>available(row.id)),CATALOG.map(row=>[available(row.id),summary(row)]),Boolean(nativeStatus.screensaverAvailable===true||nativeStatus.available&&nativeStatus.available.screensaver===true),tx(storageNote||nativeStatus.message||'')]);
  }
  const PATHS={
    bluetooth:'M10 3l8 7-6 4 6 4-8 7V3M5 8l12 12M5 20L17 8',
    mirror:'M4 7h20v14H12M4 16a8 8 0 018 8M4 21a3 3 0 013 3M4 25h.1',
    sleep:'M22 17A10 10 0 0111 4a10 10 0 1011 13Z',
    power:'M14 3v11M8 6a10 10 0 1012 0',
    network:'M3 10a18 18 0 0122 0M7 15a12 12 0 0114 0M11 20a5 5 0 016 0M14 24h.1',
    sound:'M3 11h5l7-6v18l-7-6H3V11M19 10a7 7 0 010 8M22 6a12 12 0 010 16',
    speed:'M4 22a11 11 0 1120 0M14 17l6-8M7 22h14',
    tv:'M3 6h22v15H3V6M9 25h10M14 21v4',
    app:'M5 24V10M23 24V10M3 8h4M21 8h4M9 24V15c0-4 3-6 5-9 2 3 5 5 5 9v9M12 24v-6a2 2 0 014 0v6M3 25h22',
    update:'M14 3v16M8 13l6 6 6-6M4 20v5h20v-5',
    phone:'M8 3h12v23H8V3M12 22h4',
    display:'M3 5h22v17H3V5M10 26h8M14 22v4',
    screensaver:'M3 5h22v18H3V5M3 18l6-6 6 6 4-4 6 6M19 9h.1',
    home:'M3 13L14 3l11 10M6 11v14h6v-8h4v8h6V11',
    deviceSetup:'M17 4a6 6 0 00-7 7L3 22l3 3 11-11a6 6 0 007-7l-4 4-4-4 3-3'
  };
  function icon(id){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 28 28');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',PATHS[id]||PATHS.tv);path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.8');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.appendChild(path);return svg;}
  function button(id,className,label,action){const node=element('button',className);node.id=id;node.type='button';node.setAttribute('aria-label',tx(label));node.addEventListener('click',()=>{if(opened&&!prayerActive())action();});return node;}
  function get(id){return document.getElementById(id);}
  const launcher=get('settingsButton');if(window.MosqueAndroid&&launcher){launcher.classList.add('cc-launcher');launcher.setAttribute('aria-label','مركز التحكم');launcher.setAttribute('title','مركز التحكم — MENU');}
  function focus(id){const node=get(id);if(!node||node.disabled)return false;if(node===document.activeElement)return true;try{node.focus({preventScroll:true});}catch(_){node.focus();}if(node.scrollIntoView)node.scrollIntoView({block:'nearest',inline:'nearest'});return true;}
  function allMain(){return QUICK.map(row=>get('cc-quick-'+row.id)).concat(config.rows.map(id=>get('cc-row-'+id)),[get('cc-customize')]).filter(node=>node&&!node.disabled);}
  function activeMainId(){const id=document.activeElement&&document.activeElement.id;return id&&FOCUS_IDS.has(id)?id:null;}
  function remember(){const id=activeMainId();if(id)config.lastId=id;persist();}
  function canRestoreFocus(node){if(!node||!document.contains(node)||node.disabled)return false;for(let parent=node;parent;parent=parent.parentNode)if(parent.hidden||parent.tagName==='DIALOG'&&!parent.open)return false;return true;}
  function close(options){
    if(!opened)return false;
    const settings=options&&typeof options==='object'?options:{};
    if(view==='custom'&&settings.commit!==false&&customRows){config.rows=customRows.slice();persist();}
    else if(view==='main'&&settings.remember!==false)remember();
    opened=false;view='main';customRows=null;
    if(document.body.classList.contains('controls-open'))document.body.classList.remove('controls-open');
    overlay.classList.remove('is-open');overlay.setAttribute('aria-hidden','true');
    try{if(window.MosqueTVNative&&typeof window.MosqueTVNative.onControlClose==='function')window.MosqueTVNative.onControlClose();}catch(_){}
    if(closeTimer)clearTimeout(closeTimer);
    if(settings.immediate)overlay.hidden=true;else closeTimer=setTimeout(()=>{if(!opened)overlay.hidden=true;},220);
    if(settings.restoreFocus!==false&&!prayerActive()){const target=canRestoreFocus(returnFocus)?returnFocus:get('settingsButton');if(target&&typeof target.focus==='function')try{target.focus({preventScroll:true});}catch(_){target.focus();}}
    return true;
  }
  function activate(id,sourceId){
    if(!opened||prayerActive())return;
    const row=CATALOG.find(item=>item.id===id),section=sourceId.startsWith('cc-row-')&&row&&row.section;
    const api=window.MosqueTV,native=window.MosqueTVNative;
    const action=section?()=>{if(api&&typeof api.openSection==='function')api.openSection(section);else if(id==='app'&&api&&typeof api.toggleSettings==='function')api.toggleSettings();else throw Error('هذا القسم يحتاج نسخة التطبيق الحديثة.');}:()=>{if(!native||typeof native.controlAction!=='function')throw Error('هذا الخيار غير متاح في النسخة المثبتة.');native.controlAction(id);};
    config.lastId=sourceId;persist();
    try{
      if(section||id==='power')close({restoreFocus:false,remember:false});
      action();
      if(opened)refreshNative();
    }
    catch(error){if(!opened)open();statusMessage(error&&error.message?error.message:'تعذر فتح هذا الخيار.');}
  }
  function build(){
    if(overlay)return;
    overlay=element('div','mosque-control-overlay');overlay.id='mosqueControlOverlay';overlay.hidden=true;overlay.setAttribute('aria-hidden','true');
    const scrim=element('div','cc-scrim');scrim.addEventListener('click',()=>handleBack());
    panel=element('aside','mosque-control-center');panel.id='mosqueControlCenter';panel.dir='rtl';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','مركز التحكم');
    content=element('div','cc-content');footer=element('div','cc-footer');overlay.append(scrim,panel);document.body.appendChild(overlay);
  }
  function header(title,detail){const head=element('header','cc-header');head.append(element('h2','cc-title',tx(title)),element('p','cc-device',detail));return head;}
  function main(){
    view='main';customRows=null;panel.replaceChildren();
    const device=typeof nativeStatus.device==='string'?nativeStatus.device:nativeStatus.device&&typeof nativeStatus.device.model==='string'?nativeStatus.device.model:'شاشة الجامع';
    const head=header('مركز التحكم',device);head.classList.add('cc-main-header');
    const customize=button('cc-customize','cc-customize','تخصيص مركز التحكم',()=>customizeOpen());customize.textContent=tx('تخصيص');head.appendChild(customize);panel.appendChild(head);
    const quicks=element('div','cc-quicks');quicks.setAttribute('aria-label','خيارات سريعة');
    QUICK.forEach(row=>{const b=button('cc-quick-'+row.id,'cc-quick',row.title||row.label,()=>activate(row.id,'cc-quick-'+row.id));b.disabled=!available(row.id);b.append(element('span','cc-quick-circle'));b.firstChild.appendChild(icon(row.id));b.append(element('span','cc-quick-label',tx(row.label)));quicks.appendChild(b);});
    panel.appendChild(quicks);content=element('div','cc-content');content.id='ccRows';
    config.rows.forEach(id=>{const row=CATALOG.find(item=>item.id===id),b=button('cc-row-'+id,'cc-row',row.label,()=>activate(id,'cc-row-'+id));b.disabled=!available(id);const copy=element('span','cc-row-copy');copy.append(element('span','cc-row-title',tx(row.label)),element('span','cc-row-summary',summary(row)));b.append(icon(id),copy,element('span','cc-row-chevron','‹'));content.appendChild(b);});
    panel.appendChild(content);messageNode=element('p','cc-message');messageNode.id='ccMessage';messageNode.setAttribute('role','status');panel.appendChild(messageNode);
    footer=element('div','cc-footer');footer.appendChild(element('p','cc-footer-hint',tx('↑ ↓ تنقّل • OK اختيار • رجوع إغلاق')));panel.appendChild(footer);statusMessage(storageNote||nativeStatus.message||'');localizePanel();
  }
  function open(){
    if(prayerActive())return false;
    build();if(closeTimer)clearTimeout(closeTimer);
    if(!opened)returnFocus=document.activeElement;
    opened=true;if(!document.body.classList.contains('controls-open'))document.body.classList.add('controls-open');nativeStatus=readNative();lastStatusSignature=statusSignature();main();overlay.hidden=false;overlay.setAttribute('aria-hidden','false');
    const reveal=()=>{if(opened)overlay.classList.add('is-open');};if(typeof requestAnimationFrame==='function')requestAnimationFrame(reveal);else reveal();
    if(!focus(config.lastId)){const first=allMain()[0];if(first)focus(first.id);}return true;
  }
  function optionCatalog(){const chosen=customRows.map(id=>CATALOG.find(row=>row.id===id));const remaining=CATALOG.filter(row=>!customRows.includes(row.id)&&(row.id!=='screensaver'||nativeStatus.screensaverAvailable===true||nativeStatus.available&&nativeStatus.available.screensaver===true));return chosen.concat(remaining);}
  function customizeRender(preferredId){
    panel.replaceChildren();panel.append(header('تخصيص المركز',tx('اختر من صف واحد إلى ستة صفوف.')));
    const help=element('p','cc-custom-help',tx('OK إظهار أو إخفاء • يمين تقديم • يسار تأخير • رجوع يحفظ الترتيب'));panel.appendChild(help);
    content=element('div','cc-content cc-options');content.id='ccCustomize';
    optionCatalog().forEach(row=>{const selected=customRows.includes(row.id),b=button('cc-option-'+row.id,'cc-option',row.label,()=>toggleOption(row.id));b.setAttribute('role','checkbox');b.setAttribute('aria-checked',String(selected));b.dataset.ccId=row.id;const mark=element('span','cc-checkmark',selected?'✓':'');mark.setAttribute('aria-hidden','true');const copy=element('span','cc-row-copy');copy.append(element('span','cc-row-title',tx(row.label)));if(selected)copy.append(element('span','cc-row-summary',tx('الصف '+(customRows.indexOf(row.id)+1))));b.append(mark,copy);content.appendChild(b);});
    panel.appendChild(content);messageNode=element('p','cc-message');messageNode.id='ccMessage';messageNode.setAttribute('role','status');panel.appendChild(messageNode);
    footer=element('div','cc-footer cc-custom-actions');const reset=button('cc-reset','cc-reset','استعادة الترتيب الافتراضي',()=>{customRows=DEFAULT_ROWS.slice();customizeRender('cc-reset');statusMessage('استُعيد الترتيب الافتراضي؛ تم أو رجوع يحفظه.');});reset.textContent=tx('الافتراضي');const done=button('cc-done','cc-done','تم وحفظ الترتيب',()=>customizeDone());done.textContent=tx('تم');footer.append(reset,done);panel.appendChild(footer);statusMessage(storageNote);localizePanel();focus(preferredId||'cc-option-'+customRows[0]);
  }
  function customizeOpen(){if(!opened||prayerActive())return;view='custom';customRows=config.rows.slice();customizeRender();}
  function toggleOption(id){
    if(!customRows||!ROW_IDS.has(id))return;
    if(customRows.includes(id)){if(customRows.length===1){statusMessage('اترك صفًا واحدًا على الأقل.');return;}customRows=customRows.filter(value=>value!==id);}
    else{if(customRows.length>=6){statusMessage('الحد الأقصى ستة صفوف. أخفِ صفًا لإضافة آخر.');return;}customRows.push(id);}
    customizeRender('cc-option-'+id);
  }
  function reorderOption(direction){const active=document.activeElement,id=active&&active.dataset&&active.dataset.ccId,index=customRows&&customRows.indexOf(id);if(index===undefined||index<0)return;const next=index+direction;if(next<0||next>=customRows.length)return;const copy=customRows.slice();[copy[index],copy[next]]=[copy[next],copy[index]];customRows=copy;customizeRender('cc-option-'+id);}
  function customizeDone(){if(!customRows)return;config.rows=customRows.slice();persist();main();focus('cc-customize');}
  function handleBack(){if(!opened)return false;if(view==='custom'){customizeDone();return true;}close();return true;}
  function shift(nodes,direction){const items=Array.from(nodes).filter(node=>!node.disabled&&!node.hidden);if(!items.length)return;const index=items.indexOf(document.activeElement),next=Math.max(0,Math.min(items.length-1,index<0?0:index+direction));focus(items[next].id);}
  function handleKey(event){
    if(!opened)return false;
    const key=event.key||({19:'ArrowUp',20:'ArrowDown',21:'ArrowLeft',22:'ArrowRight',23:'Enter',4:'BrowserBack'})[event.keyCode];
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' ','Escape','BrowserBack','Backspace','Tab'].includes(key))return false;
    event.preventDefault();if(event.stopImmediatePropagation)event.stopImmediatePropagation();else if(event.stopPropagation)event.stopPropagation();
    if(prayerActive()){close({immediate:true,restoreFocus:false,commit:false,remember:false});return true;}
    if(['Escape','BrowserBack','Backspace'].includes(key)){handleBack();return true;}
    if(key==='Enter'||key===' '){const active=document.activeElement;if(active&&panel.contains(active)&&!active.disabled&&typeof active.click==='function')active.click();else{const first=view==='custom'?panel.querySelector('button'):allMain()[0];if(first)focus(first.id);}return true;}
    if(view==='custom'){
      if(key==='ArrowLeft'||key==='ArrowRight'){reorderOption(key==='ArrowRight'?-1:1);return true;}
      shift(panel.querySelectorAll('button'),key==='ArrowUp'||key==='Tab'&&event.shiftKey?-1:1);return true;
    }
    const active=document.activeElement,id=active&&active.id||'',quicks=QUICK.map(row=>get('cc-quick-'+row.id)).filter(node=>node&&!node.disabled),rows=config.rows.map(row=>get('cc-row-'+row)).filter(node=>node&&!node.disabled);
    if(key==='Tab'){shift(allMain(),event.shiftKey?-1:1);return true;}
    if(id.startsWith('cc-quick-')){if(key==='ArrowDown')focus(rows[0]?rows[0].id:'cc-customize');else if(key==='ArrowUp')focus('cc-customize');else if(key==='ArrowLeft'||key==='ArrowRight'){const rtl=panel.dir!=='ltr';shift(quicks,key==='ArrowLeft'?(rtl?1:-1):(rtl?-1:1));}return true;}
    if(id==='cc-customize'){if(key==='ArrowUp'){const last=rows[rows.length-1]||quicks[0];if(last)focus(last.id);}else if(key==='ArrowDown'&&quicks[0])focus(quicks[0].id);return true;}
    if(rows.includes(active)){
      const index=rows.indexOf(active);
      if(key==='ArrowUp'&&index===0){if(quicks[0])focus(quicks[0].id);}else if(key==='ArrowDown'&&index===rows.length-1)focus('cc-customize');else if(key==='ArrowUp'||key==='ArrowDown')shift(rows,key==='ArrowUp'?-1:1);return true;
    }
    const first=allMain()[0];if(first)focus(first.id);return true;
  }
  function refreshNative(force){if(!opened)return;nativeStatus=readNative();const signature=statusSignature();if(force!==true&&signature===lastStatusSignature)return;lastStatusSignature=signature;const id=document.activeElement&&document.activeElement.id;if(view==='custom')customizeRender(id);else{main();if(!focus(id)){const first=allMain()[0];if(first)focus(first.id);}}}
  document.addEventListener('keydown',handleKey,true);
  if(document.body&&typeof MutationObserver==='function')new MutationObserver(()=>{if(opened&&prayerActive())close({immediate:true,restoreFocus:false,commit:false,remember:false});}).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('mosque-native-update-result',refreshNative);window.addEventListener('mosque-native-power-result',refreshNative);window.addEventListener('focus',refreshNative);
  window.addEventListener('mosque-native-notice',event=>{if(opened&&!prayerActive()&&event.detail&&typeof event.detail.message==='string')statusMessage(event.detail.message);});
  window.addEventListener('mosque-locale-change',()=>{if(launcher){launcher.setAttribute('aria-label',tx('مركز التحكم'));launcher.setAttribute('title',tx('مركز التحكم — MENU'));}refreshNative(true);});
  window.MosqueControl={open,close,isOpen:()=>opened,handleBack,handleKey,refreshNative,getState:()=>({view,config:clone(config),draftRows:customRows&&customRows.slice(),focusedId:document.activeElement&&document.activeElement.id||'',storageKey:STORAGE_KEY})};
})();
