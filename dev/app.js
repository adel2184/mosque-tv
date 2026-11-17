(function () {
  'use strict';
  // All civil keys and event timestamps use Riyadh (+03:00), never the host zone.
  const ZONE = 'Asia/Riyadh', DAY = 86400000, OFFSET = 10800000;
  const KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const NAMES = {fajr:'الفجر', sunrise:'الشروق', dhuhr:'الظهر', asr:'العصر', maghrib:'المغرب', isha:'العشاء'};
  const WEEKDAYS = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const HIJRI_MONTHS = ['محرم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة','رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة'];
  const FIELD_LABELS = {name:'اسم الجامع',address:'العنوان',subtitle:'وصف مختصر',imam:'اسم الإمام',contact:'رقم التواصل',announcement:'نص الإعلان أو التواصل'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const embedded = id => JSON.parse(document.getElementById(id).textContent);
  const defaults = embedded('config-data');
  const calendar = embedded('calendar-data');
  const fixtures = embedded('calendar-fixtures').fixtures;
  const sourceDatabase = embedded('prayer-data');
  const manifest = embedded('slides-data');
  const displayContent = embedded('display-content-data');
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2,'0');
  const digits = (value, style) => style === 'arabic' ? String(value).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : String(value);
  const dateKey = ms => new Date(ms + OFFSET).toISOString().slice(0,10);
  const validDate = key => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(Date.parse(key+'T00:00:00+03:00')) && dateKey(Date.parse(key+'T00:00:00+03:00')) === key;
  const addDays = (key,n) => dateKey(Date.parse(key+'T12:00:00+03:00') + n*DAY);
  const weekday = key => new Date(Date.parse(key+'T12:00:00+03:00')+OFFSET).getUTCDay();
  const timestamp = (key,time) => Date.parse(key+'T'+time+':00+03:00');
  function formatClock(ms, style) {
    const d = new Date(ms+OFFSET), hour = d.getUTCHours();
    return {time:digits(pad(hour%12||12)+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds()),style),period:hour<12?'ص':'م'};
  }
  function formatTime(ms, style) {
    const d = new Date(ms+OFFSET), h = d.getUTCHours();
    return digits(pad(h%12||12)+':'+pad(d.getUTCMinutes()),style)+' '+(h<12?'ص':'م');
  }
  function hijriFallback(key) {
    if (!validDate(key) || key < calendar.rangeStart || key > calendar.rangeEnd) return null;
    const months=calendar.months;
    for(let i=months.length-2;i>=0;i--) {
      if(key>=months[i].start && key<months[i+1].start) return {year:months[i].year,month:months[i].month,day:Math.round((timestamp(key,'12:00')-timestamp(months[i].start,'12:00'))/DAY)+1};
    }
    return null;
  }
  function nativeHijri(key) {
    const f = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura-nu-latn',{timeZone:ZONE,calendar:'islamic-umalqura',year:'numeric',month:'numeric',day:'numeric'});
    if(f.resolvedOptions().calendar!=='islamic-umalqura') throw new Error('calendar');
    const p = Object.fromEntries(f.formatToParts(timestamp(key,'12:00')).map(x=>[x.type,x.value]));
    return {year:Number(p.year),month:Number(p.month),day:Number(p.day)};
  }
  let calendarNativeOK=false;
  try { calendarNativeOK=fixtures.every(f=>JSON.stringify(nativeHijri(f.date))===JSON.stringify({year:f.year,month:f.month,day:f.day})); } catch (_) { /* verified table is the deterministic offline fallback */ }
  function hijri(key) {
    const fallback=hijriFallback(key);
    if(!fallback) return null;
    if(calendarNativeOK) { try { const n=nativeHijri(key); if(JSON.stringify(n)===JSON.stringify(fallback)) return n; } catch (_) {} }
    return fallback;
  }
  function fail(message) { throw new Error(message); }
  function textValue(value,limit,label) { if(typeof value!=='string'||value.length>limit) fail(label+' غير صالح أو أطول من الحد المسموح.'); return value; }
  function bool(value,label) { if(typeof value!=='boolean') fail('قيمة الإظهار غير صالحة: '+label); return value; }
  function number(value,min,max,label,integer) { if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value))) fail(label+' يجب أن يكون بين '+min+' و'+max+'.'); return value; }
  function validateSettings(c) {
    if(!c||typeof c!=='object'||Array.isArray(c)||c.schemaVersion!==1) fail('إصدار ملف الإعدادات غير مدعوم.');
    const out={schemaVersion:1,mosque:{enabled:bool(c.mosque?.enabled,'بيانات الجامع'),fields:{},custom:[]},iqama:{offsets:{},confirmed:bool(c.iqama?.confirmed,'تأكيد الإقامة'),overrides:[]}};
    for(const k of Object.keys(FIELD_LABELS)) {
      const f=c.mosque.fields?.[k];
      out.mosque.fields[k]={value:textValue(f?.value,k==='name'?180:360,FIELD_LABELS[k]),visible:bool(f?.visible,FIELD_LABELS[k])};
    }
    if(!Array.isArray(c.mosque.custom)||c.mosque.custom.length>8) fail('الحد الأقصى للحقول الإضافية ثمانية.');
    const ids=new Set();
    c.mosque.custom.forEach(f=>{const id=textValue(f.id,60,'معرّف الحقل');if(ids.has(id)||!id)fail('معرّف حقل مكرر.');ids.add(id);out.mosque.custom.push({id,label:textValue(f.label,60,'عنوان الحقل'),value:textValue(f.value,240,'نص الحقل'),visible:bool(f.visible,'الحقل الإضافي')});});
    PRAYERS.forEach(k=>out.iqama.offsets[k]=number(c.iqama.offsets?.[k],1,180,'فاصل إقامة '+NAMES[k],true));
    if(!Array.isArray(c.iqama.overrides)||c.iqama.overrides.length>80) fail('قائمة مواعيد الإقامة الثابتة غير صالحة.');
    const matches=new Set();
    c.iqama.overrides.forEach(o=>{
      if(!o||!PRAYERS.includes(o.prayer)||!['weekday','date'].includes(o.kind)||typeof o.time!=='string'||typeof o.match!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(o.time)) fail('موعد إقامة ثابت غير صالح.');
      if(o.kind==='date'?!validDate(o.match):!(/^[0-6]$/.test(o.match))) fail('يوم موعد الإقامة غير صالح.');
      const signature=o.kind+'|'+o.match+'|'+o.prayer;
      if(matches.has(signature))fail('يوجد موعدان ثابتان للصلاة نفسها في اليوم نفسه.');matches.add(signature);
      out.iqama.overrides.push({id:textValue(o.id,60,'معرّف الموعد'),kind:o.kind,match:o.match,prayer:o.prayer,time:o.time,label:textValue(o.label||'',80,'وصف الموعد')});
    });
    out.prayerModeMinutes=number(c.prayerModeMinutes,1,60,'مدة وضع الصلاة',true);
    out.slideSeconds=number(c.slideSeconds,5,300,'فاصل الشرائح',true);
    if(!['arabic','western'].includes(c.digitStyle))fail('نمط الأرقام غير مدعوم.');out.digitStyle=c.digitStyle;
    out.location={latitude:number(c.location?.latitude,-60,60,'خط العرض'),longitude:number(c.location?.longitude,-180,180,'خط الطول')};
    // Existing version-1 backups predate this card; preserve their other settings.
    const donation=c.donation===undefined?defaults.donation:c.donation;
    if(!donation||typeof donation!=='object'||Array.isArray(donation))fail('بيانات بطاقة التبرع غير صالحة.');
    out.donation={visible:bool(donation.visible,'بطاقة التبرع'),title:textValue(donation.title,90,'عنوان مشروع التبرع'),description:textValue(donation.description,180,'وصف المشروع')};
    if(out.donation.visible&&!out.donation.title.trim())fail('أدخل عنوان مشروع التبرع قبل إظهار البطاقة.');
    return out;
  }
  function validateTimetable(db) {
    if(!db||typeof db!=='object'||!db.metadata||!Array.isArray(db.records))fail('ملف المواقيت يجب أن يتضمن metadata وrecords.');
    const m=db.metadata, y=m.targetYear;
    if(m.schemaVersion!==1||!Number.isInteger(y)||y<2000||y>2100||m.timezone!==ZONE||m.utcOffset!=='+03:00'||!['Dammam','الدمام'].includes(m.city)||!Array.isArray(m.displayYears)||m.displayYears.length!==2||m.displayYears[0]!==y||m.displayYears[1]!==y+1)fail('مدينة الجدول أو منطقته الزمنية أو سنواته أو إصداره غير صحيحة.');
    for(const k of ['source','dataVersion','generatedOn','verificationStatus'])textValue(m[k],2000,'بيانات المصدر: '+k);
    if(!['calculated-needs-review','authority-supplied-unverified'].includes(m.verificationStatus))fail('حالة التحقق غير مدعومة؛ يلزم الاحتفاظ ببيان مراجعة مستقل.');
    if(!m.source.trim()||!m.dataVersion.trim()||!validDate(m.generatedOn))fail('بيانات المصدر أو تاريخ التوليد ناقصة.');
    if(m.verificationStatus==='calculated-needs-review'){
      if(!m.coordinates||!m.calculation||typeof m.calculation!=='object'||Array.isArray(m.calculation))fail('إحداثيات المواقيت المحسوبة ومعاملاتها مطلوبة.');
      number(m.coordinates.latitude,-60,60,'خط عرض الجدول');number(m.coordinates.longitude,-180,180,'خط طول الجدول');
      const calc=m.calculation;
      if(calc.fajrAngle!==18.5||calc.asrShadowFactor!==1||calc.ishaMinutesOutsideRamadan!==90||calc.ishaMinutesRamadan!==120)fail('معاملات المواقيت المحسوبة لا تطابق طريقة أم القرى الموثقة لهذه النسخة.');
      for(const k of ['library','method','rounding','ramadanCalendar'])textValue(calc[k],500,'معامل الحساب '+k);
    }
    const start=(y-1)+'-12-31', end=(y+2)+'-01-01';
    if(m.rangeStart!==start||m.rangeEnd!==end||m.displayStart!==y+'-01-01'||m.displayEnd!==(y+1)+'-12-31')fail('حدود التغطية لا تطابق سنوات العرض.');
    if(!Array.isArray(m.boundaryOnly)||m.boundaryOnly.length!==2||!m.boundaryOnly.includes(start)||!m.boundaryOnly.includes(end))fail('بيان سجلات الحدود غير صحيح.');
    if(start<calendar.rangeStart||end>calendar.rangeEnd)fail('تغطية تقويم أم القرى المرفق لا تشمل هذا الجدول؛ حدّث ملف التطبيق وتقويمه أولًا.');
    const index=new Map();
    for(const row of db.records){
      if(!row||!validDate(row.date)||row.date<start||row.date>end||index.has(row.date))fail('تاريخ مكرر أو غير صالح في جدول المواقيت.');
      let previous=-1;
      for(const k of KEYS){if(typeof row[k]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row[k]))fail('وقت غير صالح في '+row.date+' / '+NAMES[k]);const minutes=Number(row[k].slice(0,2))*60+Number(row[k].slice(3));if(minutes<=previous)fail('ترتيب المواقيت غير صحيح في '+row.date);previous=minutes;}
      index.set(row.date,clone(row));
    }
    let count=0;for(let key=start;key<=end;key=addDays(key,1)){if(!index.has(key))fail('تاريخ مفقود من جدول المواقيت: '+key);count++;}
    if(db.records.length!==count)fail('عدد سجلات المواقيت لا يطابق التغطية.');
    return {metadata:clone(m),records:Array.from(index.values()).sort((a,b)=>a.date.localeCompare(b.date)),index};
  }
  function buildEvents(db,c) {
    const events=[];
    for(const r of db.records){
      const following=db.index.get(addDays(r.date,1));
      for(const p of PRAYERS){
        // The last guard day is needed only for its Fajr boundary; no invented following date.
        if(!following&&p!=='fajr')continue;
        const adhan=timestamp(r.date,r[p]);
        const candidates=c.iqama.overrides.filter(o=>o.prayer===p&&((o.kind==='date'&&o.match===r.date)||(o.kind==='weekday'&&Number(o.match)===weekday(r.date))));
        const fixed=candidates.find(o=>o.kind==='date')||candidates[0];
        let iqama=fixed?timestamp(r.date,fixed.time):adhan+c.iqama.offsets[p]*60000;
        if(fixed&&p==='isha'&&iqama<adhan)iqama+=DAY;
        const nextKey={fajr:'dhuhr',dhuhr:'asr',asr:'maghrib',maghrib:'isha'}[p];
        const nextAdhan=p==='isha'?timestamp(following.date,following.fajr):timestamp(r.date,r[nextKey]);
        const deadline=p==='fajr'?timestamp(r.date,r.sunrise):nextAdhan;
        const end=iqama+c.prayerModeMinutes*60000;
        if(iqama<adhan||iqama>=deadline||end>nextAdhan)fail('إعداد إقامة '+NAMES[p]+' في '+r.date+' خارج فترة الصلاة أو يتداخل مع الصلاة التالية. راجع الفاصل والموعد الثابت ومدة وضع الصلاة.');
        events.push({id:r.date+'/'+p,date:r.date,prayer:p,adhan,iqama,end,deadline});
      }
    }
    return events.sort((a,b)=>a.adhan-b.adhan);
  }
  function resolveState(ms,events,db,suppressedId) {
    const key=dateKey(ms), year=Number(key.slice(0,4));
    if(!db)return {phase:'UNAVAILABLE',active:null,next:null,targetAt:null,highlight:null};
    const active=events.find(e=>ms>=e.adhan&&ms<e.end);
    // Let the final supported day's Isha finish across the terminal boundary.
    if(!db.metadata.displayYears.includes(year)||!db.index.has(key)){
      if(active&&db.metadata.displayYears.includes(Number(active.date.slice(0,4)))){
        if(ms<active.iqama)return {phase:'WAITING_FOR_IQAMA',active,next:active,targetAt:active.iqama,highlight:active.prayer};
        if(active.id!==suppressedId)return {phase:'PRAYER_MODE',active,next:null,targetAt:active.end,highlight:active.prayer};
      }
      return {phase:'UNAVAILABLE',active:null,next:null,targetAt:null,highlight:null};
    }
    if(active&&ms<active.iqama)return {phase:'WAITING_FOR_IQAMA',active,next:active,targetAt:active.iqama,highlight:active.prayer};
    if(active&&active.id!==suppressedId)return {phase:'PRAYER_MODE',active,next:null,targetAt:active.end,highlight:active.prayer};
    const next=events.find(e=>e.adhan>ms)||null;
    const hasPrevious=events.some(e=>e.end<=ms||(e.id===suppressedId&&e.iqama<=ms));
    return {phase:hasPrevious?'WAITING_FOR_NEXT_ADHAN':'WAITING_FOR_ADHAN',active:null,next,targetAt:next?.adhan||null,highlight:next?.prayer||null};
  }
  function safeRead(storage,key){try{return {ok:true,value:storage.getItem(key)};}catch(error){return {ok:false,value:null,error:String(error)};}}
  function safeWrite(storage,key,value){try{storage.setItem(key,value);return {ok:true};}catch(error){return {ok:false,error:String(error)};}}
  async function attemptFullscreen(element){try{const fn=element.requestFullscreen||element.webkitRequestFullscreen;if(!fn)return false;await fn.call(element);return true;}catch(_){return false;}}
  const slideAdvance=(i,count)=>count>0?(i+1)%count:0;
  let storageNote='', savedSettings=clone(defaults), currentSettings, draft=null, database=null, events=[], databaseError='', nowProvider=()=>Date.now();
  let suppressedId=null, state=null, lastDate='', lastRenderSignature='', lastPhase='', settingsOpen=false;
  const STORE='mosque-display.settings.v1', TABLE_STORE='mosque-display.timetable.v1';
  let storage;try{storage=window.localStorage;}catch(_){storageNote='التخزين المحلي غير متاح؛ صدّر الإعدادات للاحتفاظ بها بعد إغلاق الصفحة.';}
  if(storage){const s=safeRead(storage,STORE);if(!s.ok)storageNote='تعذر قراءة التخزين المحلي؛ تعمل الإعدادات في هذه الجلسة.';else if(s.value){try{savedSettings=validateSettings(JSON.parse(s.value));}catch(_){storageNote='ملف الإعدادات المحفوظ غير صالح؛ استُخدمت الإعدادات الأصلية.';}}}
  try{database=validateTimetable(sourceDatabase);if(storage){const stored=safeRead(storage,TABLE_STORE);if(stored.value){try{database=validateTimetable(JSON.parse(stored.value));}catch(_){storageNote+=' جدول المواقيت المحفوظ غير صالح؛ استُخدم الجدول المرفق.';}}}}catch(error){databaseError=error.message;}
  try{currentSettings=validateSettings(savedSettings);if(database)events=buildEvents(database,currentSettings);}catch(error){savedSettings=clone(defaults);currentSettings=clone(defaults);storageNote+=' تعارضت إعدادات الإقامة مع الجدول؛ استُخدمت الأمثلة الأصلية.';try{if(database)events=buildEvents(database,currentSettings);}catch(e){databaseError=e.message;database=null;}}
  function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
  function renderMosque(){
    const host=$('mosqueInfo');host.replaceChildren();host.hidden=!currentSettings.mosque.enabled;
    $('stage').classList.toggle('info-hidden',!currentSettings.mosque.enabled);
    $('stage').classList.toggle('empty-info',!currentSettings.mosque.enabled);
    if(!currentSettings.mosque.enabled)return;
    const fields=currentSettings.mosque.fields;
    if(fields.name.visible&&fields.name.value.trim())host.append(el('h1','mosque-name',fields.name.value));
    const extras=el('div','mosque-details');
    for(const k of Object.keys(FIELD_LABELS).filter(k=>k!=='name')){const f=fields[k];if(f.visible&&f.value.trim()){const n=el('span','mosque-field '+k);if(k==='contact')n.dir='ltr';n.textContent=(k==='imam'?'الإمام: ':'')+f.value;extras.append(n);}}
    currentSettings.mosque.custom.filter(f=>f.visible&&f.value.trim()).forEach(f=>extras.append(el('span','mosque-field',(f.label?f.label+': ':'')+f.value)));
    if(extras.childElementCount)host.append(extras);
    host.classList.toggle('compact-info',host.textContent.length>200);
    host.classList.toggle('dense-info',host.textContent.length>650);
    fitInformation();
  }
  const rows=new Map();
  KEYS.forEach(k=>{const row=el('tr');row.dataset.prayer=k;const name=el('th',null,NAMES[k]);name.scope='row';const adhan=el('td','time-cell','—'),iqama=el('td','time-cell','—');adhan.dir='ltr';iqama.dir='ltr';row.append(name,adhan,iqama);$('prayerRows').append(row);rows.set(k,{row,adhan,iqama});});
  function renderPrayerTable(ms){
    const key=dateKey(ms), r=database?.index.get(key), supported=database?.metadata.displayYears.includes(Number(key.slice(0,4)));
    KEYS.forEach(k=>{const ui=rows.get(k);ui.adhan.textContent=supported&&r?formatTime(timestamp(key,r[k]),currentSettings.digitStyle):'—';const event=events.find(e=>e.date===key&&e.prayer===k);ui.iqama.textContent=supported&&event&&k!=='sunrise'?formatTime(event.iqama,currentSettings.digitStyle):'—';ui.row.classList.toggle('informational',k==='sunrise');});
    const unavailable=!database||!supported||!r;
    $('displayStatus').hidden=!unavailable;
    $('dataStatus').textContent=unavailable?'بيانات المواقيت غير متوفرة لهذا التاريخ — حدّث الجدول من الإعدادات':'';
  }
  function renderDates(ms){
    const key=dateKey(ms), d=new Date(ms+OFFSET), h=hijri(key);
    $('weekday').textContent=WEEKDAYS[d.getUTCDay()];
    const gm=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    $('gregorianDate').textContent=digits(d.getUTCDate()+' '+gm[d.getUTCMonth()]+' '+d.getUTCFullYear()+' م',currentSettings.digitStyle);
    $('hijriDate').textContent=h?digits(h.day+' '+HIJRI_MONTHS[h.month-1]+' '+h.year+' هـ',currentSettings.digitStyle):'تقويم أم القرى يحتاج تحديثًا لهذا التاريخ';
  }
  let slides=[],slideIndex=0,slideElapsed=0,lastTick=0,slidesPaused=false,slideGeneration=0,contentMode='';
  const failedSlides=new Set();
  let donationImageAvailable=true;
  function fitDonationText(){
    const card=$('donationCard');if(card.hidden)return;
    const title=$('donationTitle'),description=$('donationDescription');
    title.style.fontSize='';description.style.fontSize='';
    // Prioritize the real QR's dimensions; fit only the editable project copy.
    for(let size=22;size>=14&&card.scrollHeight>card.clientHeight;size--){description.style.fontSize=size+'px';title.style.fontSize=Math.max(22,size+8)+'px';}
  }
  function renderDonation(){
    const cfg=currentSettings.donation,card=$('donationCard');
    const show=cfg.visible&&contentMode!=='prayer';
    card.hidden=!show;$('stage').classList.toggle('donation-hidden',!cfg.visible);
    $('donationTitle').textContent=cfg.title;
    $('donationDescription').textContent=cfg.description;
    $('donationDescription').hidden=!cfg.description.trim();
    $('donationQRFrame').hidden=!donationImageAvailable;
    $('donationCallout').hidden=!donationImageAvailable;
    $('donationError').hidden=donationImageAvailable;
    fitDonationText();
  }
  function enabledSlides(){return manifest.filter(s=>s.visible!==false&&!failedSlides.has(s.id));}
  function fitSlideText(){
    const host=$('slideContent'), paragraph=host.querySelector('.slide-text');
    if(!paragraph)return;
    const initial=contentMode==='adhan'?46:paragraph.textContent.length>200?42:paragraph.textContent.length>140?46:50;
    paragraph.style.lineHeight='1.7';
    // Keep each supplied dhikr complete on one slide, including the long invocations.
    for(let size=initial;size>=22;size--){
      paragraph.style.fontSize=size+'px';
      if(host.scrollHeight<=host.clientHeight+1&&paragraph.scrollWidth<=paragraph.clientWidth+1)break;
    }
  }
  function renderPostAdhan(){
    ++slideGeneration;const host=$('slideContent'),dua=displayContent.postAdhan;
    host.replaceChildren();host.classList.add('adhan-content');host.classList.remove('long-slide');
    host.append(el('div','slide-category','بين الأذان والإقامة'),el('h2','slide-title',dua.title),el('p','slide-text',dua.text),el('p','slide-reference',dua.reference));
    $('slideCounter').textContent='دعاء بعد الأذان';$('slideProgress').style.width='0%';
    fitSlideText();
  }
  function renderSlide(){
    if(contentMode!=='slides')return;
    const host=$('slideContent');host.replaceChildren();const generation=++slideGeneration;
    host.classList.remove('adhan-content');
    slides=enabledSlides();if(slideIndex>=slides.length)slideIndex=0;
    const s=slides[slideIndex];
    if(!s){host.append(el('p','slide-text','مرحبًا بكم في بيت الله. نرجو المحافظة على هدوء الجامع ونظافته.'));$('slideCounter').textContent='';return;}
    if(s.type==='image'){
      const image=el('img','announcement-image');image.alt=s.caption;image.src=s.path;
      image.onerror=()=>{if(generation!==slideGeneration)return;failedSlides.add(s.id);slideElapsed=0;renderSlide();};
      host.append(image);if(s.caption)host.append(el('p','image-caption',s.caption));
    }else{host.append(el('div','slide-category',s.category||'ذكر ودعاء'),el('h2','slide-title',s.title),el('p','slide-text',s.text));const note=[s.repeat,s.reference].filter(Boolean).join(' · ');if(note)host.append(el('p','slide-reference',note));}
    $('slideCounter').textContent=digits((slideIndex+1)+' / '+slides.length,currentSettings.digitStyle);
    host.classList.toggle('long-slide',Boolean(s.text&&s.text.length>150));
    fitSlideText();
  }
  function syncContentMode(){
    const next=state.phase==='PRAYER_MODE'?'prayer':state.phase==='WAITING_FOR_IQAMA'?'adhan':'slides';
    if(next===contentMode)return;
    contentMode=next;
    // Restore the ticker before measuring the resumed slide's available height.
    $('mosqueTicker').hidden=next==='prayer';
    $('mosqueTicker').classList.toggle('ticker-paused',next==='prayer');
    renderDonation();
    if(next!=='prayer')sizeTicker();
    if(next==='adhan')renderPostAdhan();
    else if(next==='slides')renderSlide();
    else ++slideGeneration;
  }
  function updateSlideshow(ms,paused){
    const delta=lastTick?Math.max(0,ms-lastTick):0;lastTick=ms;
    if(paused){slidesPaused=true;return;}
    if(slidesPaused){slidesPaused=false;slideElapsed=0;$('slideProgress').style.width='0%';return;}
    // A resumed browser advances at most one slide; missed transitions are never replayed.
    slideElapsed+=Math.min(delta,currentSettings.slideSeconds*1000);
    if(slideElapsed>=currentSettings.slideSeconds*1000){slideElapsed=0;slideIndex=slideAdvance(slideIndex,enabledSlides().length);renderSlide();}
    $('slideProgress').style.width=(slideElapsed/(currentSettings.slideSeconds*1000)*100)+'%';
  }
  function sizeTicker(){
    const track=$('tickerTrack'),cycle=track.children[0];if(!cycle)return;
    const width=cycle.scrollWidth;
    if(width<=0)return; // Hidden prayer-mode content has no measurable width.
    track.style.setProperty('--ticker-distance',width+'px');
    track.style.setProperty('--ticker-duration',Math.max(60,width/42)+'s');
  }
  function renderTicker(){
    const track=$('tickerTrack');track.replaceChildren();
    for(let copy=0;copy<2;copy++){
      const cycle=el('div','ticker-cycle');if(copy)cycle.setAttribute('aria-hidden','true');
      displayContent.ticker.forEach(item=>{const node=el('span','ticker-item');node.append(el('strong','ticker-label',item.label+' :'),el('span','ticker-text',item.text));cycle.append(node);});
      track.append(cycle);
    }
    sizeTicker();
  }
  function tick(){
    const ms=nowProvider(), key=dateKey(ms), clock=formatClock(ms,currentSettings.digitStyle);
    $('clockTime').textContent=clock.time;$('clockPeriod').textContent=clock.period;
    state=resolveState(ms,events,database,suppressedId);
    if(key!==lastDate){lastDate=key;renderDates(ms);renderPrayerTable(ms);}
    const signature=key+'/'+state.phase+'/'+state.highlight+'/'+(state.next?.date||'')+'/'+currentSettings.digitStyle;
    if(signature!==lastRenderSignature){
      lastRenderSignature=signature;
      rows.forEach((ui,k)=>ui.row.classList.toggle('next-prayer',k===state.highlight));
      if(state.phase==='UNAVAILABLE')$('countdownLabel').textContent='بيانات المواقيت غير متوفرة لهذا التاريخ';
      else if(state.phase==='WAITING_FOR_IQAMA')$('countdownLabel').textContent='المتبقي على إقامة '+NAMES[state.active.prayer];
      else if(state.phase==='PRAYER_MODE')$('countdownLabel').textContent='تُقام الصلاة الآن';
      else $('countdownLabel').textContent=state.next?'المتبقي على أذان '+NAMES[state.next.prayer]:'حدّث جدول المواقيت';
      $('nextDateLabel').textContent=state.next&&state.next.date!==key?'موعد اليوم التالي':'';
    }
    const remaining=state.targetAt?Math.max(0,Math.ceil((state.targetAt-ms)/1000)):null;
    $('countdownValue').textContent=remaining===null?'— — : — — : — —':digits(pad(Math.floor(remaining/3600))+':'+pad(Math.floor(remaining/60)%60)+':'+pad(remaining%60),currentSettings.digitStyle);
    const inPrayer=state.phase==='PRAYER_MODE';
    if(inPrayer&&lastPhase!=='PRAYER_MODE'){if(settingsOpen){closeSettings(true);return;}$('prayerOverlay').hidden=false;$('prayerOverlay').setAttribute('aria-hidden','false');document.body.classList.add('praying');}
    if(!inPrayer&&lastPhase==='PRAYER_MODE'){$('prayerOverlay').hidden=true;$('prayerOverlay').setAttribute('aria-hidden','true');document.body.classList.remove('praying');}
    lastPhase=state.phase;syncContentMode();updateSlideshow(ms,contentMode!=='slides');
    if(!settingsOpen&&ms-lastInteraction>5000)document.body.classList.add('idle');
  }
  function fitInformation(){
    const info=$('mosqueInfo');if(info.hidden)return;
    // Fit long editable content inside the bounded TV header, never ellipsize it.
    info.style.height='188px';info.style.fontSize='23px';const name=info.querySelector('h1');if(name)name.style.fontSize='43px';
    let scale=1;
    for(let i=0;i<24&&info.scrollHeight>info.clientHeight;i++){
      scale*=Math.min(.96,Math.max(.35,(info.clientHeight-4)/info.scrollHeight));
      info.style.fontSize=(23*scale)+'px';if(name)name.style.fontSize=(43*scale)+'px';
    }
  }
  function refresh(){lastDate='';lastRenderSignature='';contentMode='';renderMosque();tick();}
  function useSettings(candidate){const validated=validateSettings(candidate);const next=database?buildEvents(database,validated):[];currentSettings=validated;events=next;refresh();}
  let lastInteraction=Date.now();
  function interaction(){if(state?.phase==='PRAYER_MODE')return;lastInteraction=nowProvider();document.body.classList.remove('idle');}
  function resize(){const scale=Math.min(innerWidth/1920,innerHeight/1080);$('stage').style.transform='scale('+scale+')';$('stage').style.left=((innerWidth-1920*scale)/2)+'px';$('stage').style.top=((innerHeight-1080*scale)/2)+'px';fitInformation();fitSlideText();fitDonationText();sizeTicker();}
  function message(text,error){$('settingsMessage').textContent=text;$('settingsMessage').className=error?'error':'success';}
  function input(label,value,type,onchange,opts){const wrap=el('label','field'),caption=el('span',null,label),control=el('input');control.type=type||'text';if(type==='checkbox')control.checked=value;else control.value=value;Object.assign(control,opts||{});control.addEventListener('input',()=>onchange(type==='checkbox'?control.checked:type==='number'?Number(control.value):control.value));wrap.append(caption,control);return wrap;}
  function section(title){const node=el('section','settings-section');node.append(el('h3',null,title));$('settingsBody').append(node);return node;}
  function button(text,action){const b=el('button',null,text);b.type='button';b.addEventListener('click',action);return b;}
  function select(label,value,options,onchange){const wrap=el('label','field'),s=el('select');options.forEach(([v,t])=>{const o=el('option',null,t);o.value=v;s.append(o);});s.value=value;s.addEventListener('change',()=>onchange(s.value));wrap.append(el('span',null,label),s);return wrap;}
  function drawLegacySettings(){
    $('settingsBody').replaceChildren();
    let s=section('بيانات الجامع');s.append(input('إظهار قسم بيانات الجامع كاملًا',draft.mosque.enabled,'checkbox',v=>draft.mosque.enabled=v));
    for(const k of Object.keys(FIELD_LABELS)){const row=el('div','inline');row.append(input(FIELD_LABELS[k],draft.mosque.fields[k].value,'text',v=>draft.mosque.fields[k].value=v,{maxLength:k==='name'?180:360}),input('إظهار / إخفاء',draft.mosque.fields[k].visible,'checkbox',v=>draft.mosque.fields[k].visible=v));s.append(row);}
    s.append(el('p','notice','تُحفظ قيم الحقول عند إخفائها. اترك المعلومات غير المعروفة فارغة.'));
    draft.mosque.custom.forEach((f,i)=>{const row=el('div','custom-row');row.dataset.tvGroup=f.id;row.dataset.tvLabel='الحقل الإضافي '+(i+1);row.append(input('عنوان اختياري',f.label,'text',v=>f.label=v,{maxLength:60}),input('نص إضافي',f.value,'text',v=>f.value=v,{maxLength:240}),input('إظهار',f.visible,'checkbox',v=>f.visible=v),button('أعلى',()=>{if(i){[draft.mosque.custom[i-1],draft.mosque.custom[i]]=[f,draft.mosque.custom[i-1]];drawSettings();}}),button('أسفل',()=>{if(i<draft.mosque.custom.length-1){[draft.mosque.custom[i+1],draft.mosque.custom[i]]=[f,draft.mosque.custom[i+1]];drawSettings();}}),button('حذف',()=>{draft.mosque.custom.splice(i,1);drawSettings();}));s.append(row);});
    s.append(button('إضافة حقل نصي',()=>{if(draft.mosque.custom.length>=8)return message('الحد الأقصى ثمانية حقول.',true);draft.mosque.custom.push({id:'field-'+Date.now(),label:'',value:'',visible:true});drawSettings();}));
    s=section('الإقامة ووضع الصلاة');s.append(el('p','notice','الفواصل التالية أمثلة أولية تحتاج تأكيد إدارة الجامع. مواقيت الإقامة إعدادات محلية وليست نتائج فلكية.'));
    const intervals=el('div','inline');PRAYERS.forEach(p=>intervals.append(input(NAMES[p]+' (دقيقة)',draft.iqama.offsets[p],'number',v=>draft.iqama.offsets[p]=v,{min:1,max:180,step:1})));s.append(intervals,input('تمت مراجعة إعدادات الإقامة مع إدارة الجامع',draft.iqama.confirmed,'checkbox',v=>draft.iqama.confirmed=v),input('مدة وضع الصلاة (دقيقة)',draft.prayerModeMinutes,'number',v=>draft.prayerModeMinutes=v,{min:1,max:60,step:1}));
    s.append(el('p','notice','يمكن تحديد إقامة ثابتة ليوم أسبوعي، بما فيه الجمعة، أو لتاريخ بعينه. يتقدم موعد التاريخ على الموعد الأسبوعي. لا يوجد موعد جمعة مفترض. وقت الإقامة هنا بنظام 24 ساعة وتوقيت الرياض؛ للعشاء فقط يمكن أن يمتد إلى اليوم التالي.'));
    draft.iqama.overrides.forEach((o,i)=>{const row=el('div','override-row');row.dataset.tvGroup=o.id;row.dataset.tvLabel='موعد الإقامة '+(i+1);row.append(select('الصلاة',o.prayer,PRAYERS.map(k=>[k,NAMES[k]]),v=>o.prayer=v),select('التكرار',o.kind,[['weekday','يوم في الأسبوع'],['date','تاريخ محدد']],v=>{o.kind=v;o.match=v==='weekday'?'5':dateKey(nowProvider());drawSettings();}));if(o.kind==='weekday')row.append(select('اليوم',o.match,WEEKDAYS.map((n,j)=>[String(j),n]),v=>o.match=v));else row.append(input('التاريخ',o.match,'date',v=>o.match=v));row.append(input('الإقامة 24 ساعة',o.time,'time',v=>o.time=v),input('وصف مثل ترتيب الجمعة',o.label,'text',v=>o.label=v,{maxLength:80}),button('حذف',()=>{draft.iqama.overrides.splice(i,1);drawSettings();}));s.append(row);});
    s.append(button('إضافة موعد إقامة ثابت',()=>{if(draft.iqama.overrides.length>=80)return message('الحد الأقصى ثمانون موعدًا.',true);draft.iqama.overrides.push({id:'override-'+Date.now(),kind:'weekday',match:'5',prayer:'dhuhr',time:'',label:''});drawSettings();}));
    s=section('العرض والأرقام');s.append(input('فاصل الشرائح (ثانية)',draft.slideSeconds,'number',v=>draft.slideSeconds=v,{min:5,max:300,step:1}),select('نمط الأرقام',draft.digitStyle,[['western','0123456789 — أرقام غربية'],['arabic','٠١٢٣٤٥٦٧٨٩ — أرقام عربية']],v=>draft.digitStyle=v));
    s=section('بطاقة التبرع');
    s.append(input('إظهار بطاقة التبرع',draft.donation.visible,'checkbox',v=>draft.donation.visible=v),input('عنوان مشروع التبرع',draft.donation.title,'text',v=>draft.donation.title=v,{maxLength:90}),input('وصف مختصر للمشروع',draft.donation.description,'text',v=>draft.donation.description=v,{maxLength:180}),el('p','notice','تظهر البطاقة ثابتة بجوار الأذكار، وتختفي أثناء وضع الصلاة. إخفاؤها يحفظ النصوص. رمز التبرع هو الصورة المحلية المرفقة؛ تعديل النص لا يغير وجهة الرمز.'));
    s=section('المواقيت والتقويم');
    s.append(el('p','notice',database?'المصدر: '+(database.metadata.verificationStatus==='calculated-needs-review'?'حساب محلي بمكتبة Adhan JS 4.4.3؛ ليس جدولًا رسميًا.':database.metadata.source)+' | السنوات: '+database.metadata.displayYears.join('، ')+' | الحالة: '+(database.metadata.verificationStatus==='calculated-needs-review'?'مواقيت محسوبة — تحتاج مراجعة':'جدول مستورد — يحتاج مراجعة مصدره'):'تعذر تحميل المواقيت: '+databaseError));
    s.append(input('خط العرض للمراجعة وإعادة التوليد',draft.location.latitude,'number',v=>draft.location.latitude=v,{step:'0.0001'}),input('خط الطول للمراجعة وإعادة التوليد',draft.location.longitude,'number',v=>draft.location.longitude=v,{step:'0.0001'}),el('p','notice','تغيير الإحداثيات لا يعيد حساب الجدول داخل المتصفح. أعد توليده بأداة التطوير ثم استورد الملف الناتج؛ يظل مصدر الجدول وإحداثياته الأصلية محفوظين.'));
    s.append(button('استيراد جدول مواقيت JSON',()=>$('timetableFile').click()),button('تصدير جدول المواقيت',exportTimetable));
    const daysLeft=database?Math.floor((timestamp(database.metadata.displayYears[1]+'-12-31','23:59')-nowProvider())/DAY):0;
    if(daysLeft<90)s.append(el('p','error',daysLeft<0?'انتهت تغطية المواقيت؛ استورد جدولًا جديدًا.':'تنتهي تغطية المواقيت خلال '+daysLeft+' يومًا؛ جهّز جدول السنة الجديدة.'));
    s.append(el('p','notice','تقويم أم القرى مدني ويتغير عند منتصف الليل بتوقيت السعودية. التغطية المحلية: '+calendar.rangeStart+' إلى '+calendar.rangeEnd+'. '+(calendarNativeOK?'دعم المتصفح اجتاز المراجع؛ يطابق كل تاريخ الجدول المحلي.':'يُستخدم جدول أم القرى المحلي الموثق.')));
    s=section('الحفظ والتشغيل');s.append(el('p','notice',storageNote||'التخزين المحلي متاح لهذه الجلسة. يُنصح بتصدير نسخة احتياطية.'));
    s.append(el('p','notice','قد يختلف حفظ الإعدادات تحت file:// باختلاف المتصفح. نقل الملف أو تغيير اسمه قد يغيّر مساحة التخزين. ملف JSON المصدّر هو النسخة الاحتياطية القابلة للنقل. لا يُكتب ملف index.html من المتصفح.'));
    s.append(el('p','notice','الإعدادات: Ctrl + , أو زر الإعدادات. ملء الشاشة من الزر أو F11 في المتصفحات الداعمة. للخروج الاضطراري من السواد: Ctrl + Alt + M؛ يخص التجاوز فترة الصلاة الحالية فقط. اضبط ساعة الجهاز وأوقف السكون وشاشة التوقف من إعدادات النظام. لا يستطيع التطبيق غير المتصل مزامنة الساعة.'));
  }
  // TV_SETTINGS_UI_START — presentation only; the existing validated draft owns all mosque data.
  const tvMode=Boolean(window.MosqueAndroid);
  let tvSections=[],tvSectionId='mosque',tvPane='menu',tvEditor=null,tvLastFocus='',tvScroll={};
  function tvKey(text){let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return(hash>>>0).toString(36);}
  function tvKeepSelectedMenuVisible(){const selected=$('tv-section-'+tvSectionId);if(selected&&selected.scrollIntoView)selected.scrollIntoView({block:'nearest',inline:'nearest'});}
  function tvFocus(id){const node=$(id);if(!node||node.disabled)return;try{node.focus({preventScroll:true});}catch(_){node.focus();}if(node.scrollIntoView)node.scrollIntoView({block:'nearest',inline:'nearest'});tvLastFocus=id;if(id.startsWith('tv-row-'))tvKeepSelectedMenuVisible();}
  function tvValue(row){const value=typeof row.value==='function'?row.value():row.value;return value===undefined||value===null?'':value;}
  function tvSummary(row){const value=tvValue(row);if(row.kind==='checkbox')return value?'نعم':'لا';if(row.kind==='select'){const choice=(row.options||[]).find(item=>String(item[0])===String(value));return choice?choice[1]:String(value);}return String(value).trim()||'غير محدد';}
  function tvLegacySections(){
    const names=['mosque','iqama','display','donation','data','backup'];
    return Array.from($('settingsBody').children).filter(node=>node.classList.contains('settings-section')).map((source,index)=>{
      const title=source.querySelector('h3').textContent,section={id:names[index]||'section-'+index,title,help:Array.from(source.querySelectorAll('.notice,.error')).map(node=>node.textContent).join('\n'),rows:[]},seen=new Map();
      source.querySelectorAll('label.field,button').forEach(node=>{
        const control=node.tagName==='BUTTON'?null:node.querySelector('input,select,textarea');if(!control&&node.tagName!=='BUTTON')return;
        const caption=control?node.querySelector('span').textContent:node.textContent;
        const group=node.closest('[data-tv-group]'),inline=node.closest('.inline');
        let context=group?group.dataset.tvLabel:'';
        if(!context&&control&&control.type==='checkbox'&&inline){const first=inline.querySelector('label.field span');if(first&&first.textContent!==caption)context=first.textContent;}
        const base=section.id+'-'+(group?group.dataset.tvGroup:'')+'-'+tvKey(caption),count=seen.get(base)||0;seen.set(base,count+1);
        const row={id:'tv-field-'+base+'-'+count,label:context?context+' — '+caption:caption,help:'',kind:'action'};
        if(!control){row.action=()=>node.click();row.value='فتح';}
        else{
          row.kind=control.tagName==='SELECT'?'select':control.type==='checkbox'?'checkbox':control.type==='number'?'number':control.type==='date'?'date':control.type==='time'?'time':'text';
          row.value=()=>row.kind==='checkbox'?control.checked:control.value;
          row.options=row.kind==='select'?Array.from(control.options).map(option=>[option.value,option.textContent]):undefined;
          row.min=control.min===''||control.min===undefined?-Infinity:Number(control.min);row.max=control.max===''||control.max===undefined?Infinity:Number(control.max);row.step=Number(control.step)||1;row.maxLength=control.maxLength>0?control.maxLength:1000;
          row.help=row.kind==='number'?'يمين: زيادة، يسار: إنقاص. المجال '+row.min+' إلى '+row.max:row.kind==='time'?'الوقت بنظام 24 ساعة: HH:mm':row.kind==='date'?'التاريخ: YYYY-MM-DD':'اضغط OK للتحرير؛ الرجوع يلغي تحرير الحقل فقط.';
          row.commit=value=>{if(row.kind==='checkbox')control.checked=Boolean(value);else control.value=value;control.dispatchEvent(new Event(row.kind==='select'?'change':'input',{bubbles:true}));};
        }
        section.rows.push(row);
      });
      if(section.id==='backup')for(const [id,label]of [['exportSettingsButton','تصدير إعدادات الجامع'],['importSettingsButton','استيراد إعدادات الجامع'],['exportTimetableButton','تصدير جدول المواقيت'],['importTimetableButton','استيراد جدول المواقيت'],['defaultsButton','استعادة الافتراضيات']])section.rows.push({id:'tv-action-'+id,label,kind:'action',value:'فتح',action:()=>$(id).click()});
      return section;
    });
  }
  function tvRenderHub(preferredFocus){
    const oldList=$('tvSettingsRows');if(oldList)tvScroll[tvSectionId]=oldList.scrollTop;
    const current=tvSections.find(section=>section.id===tvSectionId)||tvSections[0];if(!current)return;tvSectionId=current.id;
    const hub=el('div','tv-hub');hub.id='tvSettingsHub';
    const menu=el('nav','tv-settings-menu');menu.setAttribute('aria-label','أقسام الإعدادات');
    tvSections.forEach(section=>{const b=button(section.title,()=>{tvSectionId=section.id;tvPane='rows';tvRenderHub();tvFocus($('tvSettingsRows')?.querySelector('button:not([disabled])')?.id);});b.id='tv-section-'+section.id;b.className='tv-menu-item';b.classList.toggle('selected',section.id===tvSectionId);b.dataset.tvZone='menu';menu.append(b);});
    const pane=el('section','tv-settings-pane');pane.append(el('h3','tv-section-heading',current.title));
    if(current.help)pane.append(el('p','tv-section-help',current.help));
    const list=el('div','tv-settings-rows');list.id='tvSettingsRows';
    current.rows.forEach(row=>{
      const b=button('',()=>{tvLastFocus=b.id;if(row.kind==='action'){try{row.action();if(settingsOpen&&!tvEditor)drawSettings();}catch(error){message(error.message,true);}}else if(row.kind!=='info')tvOpenEditor(row);});
      b.id='tv-row-'+row.id;b.className='tv-setting-row';b.dataset.tvZone='rows';b.disabled=Boolean(row.disabled)||row.kind==='info';
      const copy=el('span','tv-row-copy');copy.append(el('span','tv-row-label',row.label));if(row.help)copy.append(el('span','tv-row-help',row.help));b.append(copy,el('span','tv-row-value',tvSummary(row)));list.append(b);
    });
    pane.append(list);hub.append(menu,pane);$('settingsBody').replaceChildren(hub);list.scrollTop=tvScroll[tvSectionId]||0;
    if(preferredFocus&&$(preferredFocus))tvFocus(preferredFocus);
    tvKeepSelectedMenuVisible();
  }
  function drawSettings(){
    const preferred=tvMode?(document.activeElement?.id||tvLastFocus):'';
    if(tvMode&&$('tvSettingsRows'))tvScroll[tvSectionId]=$('tvSettingsRows').scrollTop;
    drawLegacySettings();if(!tvMode)return;
    tvSections=tvLegacySections();
    if(window.MosqueTVNative&&typeof window.MosqueTVNative.getSections==='function'){try{tvSections.push(...window.MosqueTVNative.getSections());}catch(_){message('تعذر قراءة بعض خيارات التلفاز؛ تبقى إعدادات الجامع متاحة.',true);}}
    $('settingsDialog').classList.add('tv-settings');$('defaultsButton').hidden=true;tvRenderHub(preferred);
  }
  function tvEditorValue(){if(!tvEditor)return;const node=$('tvEditorValue');if(node)node.textContent=String(tvEditor.temp);}
  function tvEditorError(text){message(text,true);const node=$('tvEditorError');if(node)node.textContent=text;}
  function tvChangeNumber(direction){if(!tvEditor)return;const row=tvEditor.row,step=Number(row.step)||1,min=Number.isFinite(row.min)?row.min:-1000000,max=Number.isFinite(row.max)?row.max:1000000;tvEditor.temp=Math.min(max,Math.max(min,Number((Number(tvEditor.temp)+direction*step).toFixed(6))));tvEditorValue();}
  function tvChangeTime(segment,direction){
    if(!tvEditor||tvEditor.row.kind!=='time')return;
    const parts=String(tvEditor.temp).split(':').map(Number),index=segment==='hours'?0:1,limit=index===0?24:60;
    parts[index]=(parts[index]+direction+limit)%limit;
    tvEditor.temp=parts.map(value=>String(value).padStart(2,'0')).join(':');
    $('tvEditorHours').textContent=String(parts[0]).padStart(2,'0');$('tvEditorMinutes').textContent=String(parts[1]).padStart(2,'0');
  }
  function tvCloseEditor(commit){
    if(!tvEditor)return;const editing=tvEditor,row=editing.row;let value=editing.temp;
    if(commit){
      if(row.kind==='text'||row.kind==='date')value=$('tvEditorInput').value;
      if(row.kind==='number'&&(!Number.isFinite(Number(value))||Number(value)<row.min||Number(value)>row.max)){tvEditorError('القيمة خارج المجال المسموح.');return;}
      if(row.kind==='time'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)){tvEditorError('أدخل الوقت بصيغة HH:mm، مثل 13:25.');return;}
      if(row.kind==='date'&&!validDate(value)){tvEditorError('أدخل تاريخًا صحيحًا بصيغة YYYY-MM-DD.');return;}
      if(typeof value==='string'&&value.length>(row.maxLength||1000)){tvEditorError('النص أطول من الحد المسموح.');return;}
    }
    tvEditor=null;$('tvEditor')?.remove();
    try{if(commit)row.commit(value);drawSettings();tvFocus('tv-row-'+row.id);}catch(error){message(error.message,true);}
  }
  function tvOpenEditor(row){
    if(state?.phase==='PRAYER_MODE')return;tvEditor={row,temp:tvValue(row)};
    if(row.kind==='time'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(tvEditor.temp)))tvEditor.temp='00:00';
    const panel=el('div','tv-editor');panel.id='tvEditor';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',row.label);
    const editorHelp=row.kind==='time'?(row.help?row.help+'\n':'')+'يمين ويسار: تغيير القيمة. أعلى وأسفل: التنقل بين الساعات والدقائق وأزرار التأكيد. رجوع: إلغاء التعديل.':row.help||'OK للتأكيد، رجوع لإلغاء هذا التعديل.';
    const card=el('div','tv-editor-card');card.classList.toggle('tv-time-editor',row.kind==='time');card.append(el('p','tv-editor-eyebrow','تحرير الإعداد'),el('h3','tv-editor-title',row.label),el('p','tv-editor-help',editorHelp));
    let initial='tvEditorConfirm';
    if(row.kind==='number'){
      const controls=el('div','tv-number-controls'),minus=button('−',()=>tvChangeNumber(-1)),value=button(String(tvEditor.temp),()=>tvCloseEditor(true)),plus=button('+',()=>tvChangeNumber(1));
      minus.id='tvEditorMinus';plus.id='tvEditorPlus';value.id='tvEditorValue';value.className='tv-number-value';controls.append(minus,value,plus);card.append(controls);initial='tvEditorValue';
    }else if(row.kind==='time'){
      const controls=el('div','tv-time-controls');controls.dir='ltr';
      const parts=tvEditor.temp.split(':'),hoursGroup=el('div','tv-time-segment'),minutesGroup=el('div','tv-time-segment');
      const hoursLabel=el('span','tv-time-label','الساعات (00–23)'),minutesLabel=el('span','tv-time-label','الدقائق (00–59)');hoursLabel.dir='rtl';minutesLabel.dir='rtl';
      const hours=button(parts[0],()=>tvFocus('tvEditorMinutes')),minutes=button(parts[1],()=>tvFocus('tvEditorConfirm'));
      hours.id='tvEditorHours';minutes.id='tvEditorMinutes';hours.className='tv-time-value';minutes.className='tv-time-value';
      hours.setAttribute('aria-label','الساعات، يمين للزيادة ويسار للنقصان');minutes.setAttribute('aria-label','الدقائق، يمين للزيادة ويسار للنقصان');
      const colon=el('span','tv-time-separator',':');colon.setAttribute('aria-hidden','true');
      hoursGroup.append(hoursLabel,hours);minutesGroup.append(minutesLabel,minutes);controls.append(hoursGroup,colon,minutesGroup);card.append(controls);initial='tvEditorHours';
    }else if(row.kind==='checkbox'||row.kind==='select'){
      const choices=row.kind==='checkbox'?[[true,'نعم'],[false,'لا']]:row.options||[];const group=el('div','tv-editor-choices');
      choices.forEach((choice,index)=>{const b=button(choice[1],()=>{tvEditor.temp=choice[0];tvCloseEditor(true);});b.id='tv-choice-'+index;b.className='tv-choice';b.classList.toggle('selected',String(choice[0])===String(tvEditor.temp));if(String(choice[0])===String(tvEditor.temp))initial=b.id;group.append(b);});card.append(group);
    }else{
      const control=el('input','tv-editor-input');control.id='tvEditorInput';control.type='text';control.value=String(tvEditor.temp);control.maxLength=row.maxLength||1000;if(row.kind==='date'){control.dir='ltr';control.inputMode='numeric';}card.append(control);initial=control.id;
    }
    const editorError=el('p','error');editorError.id='tvEditorError';editorError.setAttribute('role','status');card.append(editorError);
    const actions=el('div','tv-editor-actions'),confirm=button('تأكيد',()=>tvCloseEditor(true)),cancel=button('إلغاء التعديل',()=>tvCloseEditor(false));confirm.id='tvEditorConfirm';cancel.id='tvEditorCancel';actions.append(confirm,cancel);card.append(actions);panel.append(card);$('settingsForm').append(panel);tvFocus(initial);
  }
  function tvMove(nodes,delta){const items=Array.from(nodes).filter(node=>!node.disabled&&!node.hidden);if(!items.length)return;const index=items.indexOf(document.activeElement);tvFocus(items[Math.max(0,Math.min(items.length-1,index<0?0:index+delta))].id);}
  function tvHandleBack(){
    if(!settingsOpen)return false;
    if(tvEditor){tvCloseEditor(false);return true;}
    if($('settingsDialog').classList.contains('previewing')){$('settingsDialog').classList.remove('previewing');$('previewButton').textContent='معاينة';drawSettings();tvFocus(tvLastFocus||'tv-section-'+tvSectionId);return true;}
    if(tvPane!=='menu'){tvPane='menu';tvFocus('tv-section-'+tvSectionId);return true;}
    closeSettings(true);return true;
  }
  function tvHandleKey(event){
    if(!tvMode||!settingsOpen||event.ctrlKey||event.altKey)return;
    const key=event.key||({19:'ArrowUp',20:'ArrowDown',21:'ArrowLeft',22:'ArrowRight',23:'Enter'})[event.keyCode];
    if(key==='Escape'||key==='BrowserBack'){event.preventDefault();event.stopImmediatePropagation();tvHandleBack();return;}
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(key))return;
    if($('settingsDialog').classList.contains('previewing')&&key!=='Enter'){event.preventDefault();event.stopImmediatePropagation();tvMove($('settingsDialog').querySelectorAll('.settings-actions button'),key==='ArrowLeft'||key==='ArrowDown'?1:-1);return;}
    if(tvEditor){
      if(tvEditor.row.kind==='number'&&(key==='ArrowRight'||key==='ArrowLeft')){event.preventDefault();event.stopImmediatePropagation();tvChangeNumber(key==='ArrowRight'?1:-1);return;}
      if(tvEditor.row.kind==='time'&&(key==='ArrowRight'||key==='ArrowLeft')&&['tvEditorHours','tvEditorMinutes'].includes(document.activeElement?.id)){event.preventDefault();event.stopImmediatePropagation();tvChangeTime(document.activeElement.id==='tvEditorHours'?'hours':'minutes',key==='ArrowRight'?1:-1);return;}
      if(document.activeElement?.id==='tvEditorInput'&&(key==='ArrowLeft'||key==='ArrowRight'))return;
      if(key==='Enter'&&document.activeElement?.id==='tvEditorInput'){event.preventDefault();event.stopImmediatePropagation();tvCloseEditor(true);return;}
      if(key!=='Enter'){event.preventDefault();event.stopImmediatePropagation();tvMove($('tvEditor').querySelectorAll('button,input'),key==='ArrowUp'||key==='ArrowLeft'?-1:1);}return;
    }
    if(key==='Enter')return;
    event.preventDefault();event.stopImmediatePropagation();
    const active=document.activeElement,footer=active&&active.closest('.settings-footer');
    if(footer){if(key==='ArrowUp'){tvPane='rows';tvFocus(tvLastFocus.startsWith('tv-row-')?tvLastFocus:$('tvSettingsRows')?.querySelector('button:not([disabled])')?.id);}else tvMove($('settingsDialog').querySelectorAll('.settings-actions button'),key==='ArrowLeft'?1:-1);return;}
    if(tvPane==='menu'){if(key==='ArrowLeft'){const focusedSection=tvSections.find(section=>'tv-section-'+section.id===active?.id);if(focusedSection&&focusedSection.id!==tvSectionId){tvSectionId=focusedSection.id;tvRenderHub();}tvPane='rows';tvFocus($('tvSettingsRows')?.querySelector('button:not([disabled])')?.id);}else tvMove($('settingsBody').querySelectorAll('.tv-menu-item'),key==='ArrowUp'?-1:1);return;}
    if(key==='ArrowRight'){tvPane='menu';tvFocus('tv-section-'+tvSectionId);return;}
    const rows=Array.from($('tvSettingsRows').querySelectorAll('button:not([disabled])'));if(key==='ArrowDown'&&rows.indexOf(active)===rows.length-1){tvFocus('saveButton');return;}tvMove(rows,key==='ArrowUp'?-1:1);
  }
  if(tvMode){
    document.addEventListener('keydown',tvHandleKey,true);
    document.addEventListener('focusin',event=>{if(event.target?.id?.startsWith('tv-row-')){tvLastFocus=event.target.id;tvPane='rows';}});
    window.MosqueTV={isOpen:()=>settingsOpen,handleBack:tvHandleBack,toggleSettings:()=>settingsOpen?closeSettings(true):openSettings(),refreshNative:()=>{if(settingsOpen&&!tvEditor)drawSettings();},getUIState:()=>({section:tvSectionId,pane:tvPane,editing:tvEditor?tvEditor.row.id:null,focus:document.activeElement?.id||''})};
  }
  // TV_SETTINGS_UI_END
  function openSettings(){if(state?.phase==='PRAYER_MODE')return;draft=clone(savedSettings);settingsOpen=true;tvPane='menu';$('settingsDialog').classList.remove('previewing');$('previewButton').textContent='معاينة';drawSettings();message('التغييرات مسودة؛ عاينها ثم احفظها أو ألغها.');$('settingsDialog').showModal();if(tvMode)tvFocus('tv-section-'+tvSectionId);interaction();}
  function closeSettings(cancel){tvEditor=null;$('tvEditor')?.remove();settingsOpen=false;draft=null;$('settingsDialog').close();$('settingsDialog').classList.remove('previewing');$('previewButton').textContent='معاينة';if(window.MosqueTVNative?.onClose)window.MosqueTVNative.onClose();if(cancel){try{useSettings(savedSettings);}catch(error){message(error.message,true);}}if(tvMode&&state?.phase!=='PRAYER_MODE')tvFocus('settingsButton');interaction();}
  function download(name,value){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportTimetable(){if(database)download('dammam-prayer-timetable.json',{metadata:database.metadata,records:database.records});}
  function readFile(file,onload){if(!file)return;if(file.size>3000000)return message('الملف أكبر من الحد المسموح (3 ميغابايت).',true);const reader=new FileReader();reader.onload=()=>{try{onload(JSON.parse(reader.result));}catch(error){message('لم يُطبّق الملف: '+error.message,true);}};reader.onerror=()=>message('تعذرت قراءة الملف المحلي.',true);reader.readAsText(file,'UTF-8');}
  $('settingsButton').addEventListener('click',openSettings);
  $('previewButton').addEventListener('click',()=>{try{if(tvMode&&$('settingsDialog').classList.contains('previewing')){$('settingsDialog').classList.remove('previewing');$('previewButton').textContent='معاينة';drawSettings();tvFocus('tv-section-'+tvSectionId);return;}useSettings(draft);message('المعاينة مطبّقة مؤقتًا. احفظ للاعتماد أو ألغِ للرجوع.');$('settingsDialog').classList.add('previewing');if(tvMode){$('previewButton').textContent='العودة للإعدادات';tvFocus('previewButton');}}catch(error){message(error.message,true);}});
  $('saveButton').addEventListener('click',()=>{try{
    // Commit the validated draft before rendering: saving may itself enter prayer mode.
    const candidate=validateSettings(draft);if(database)buildEvents(database,candidate);
    savedSettings=clone(candidate);closeSettings(false);useSettings(candidate);
    const result=storage?safeWrite(storage,STORE,JSON.stringify(savedSettings)):{ok:false};
    if(!result.ok){storageNote='تعذر حفظ الإعدادات محليًا؛ تعمل مؤقتًا. صدّر نسخة JSON قبل إغلاق الصفحة.';openSettings();}
  }catch(error){message(error.message,true);}});
  $('cancelButton').addEventListener('click',()=>closeSettings(true));
  $('settingsDialog').addEventListener('cancel',e=>{e.preventDefault();if(tvMode)tvHandleBack();else closeSettings(true);});
  $('settingsForm').addEventListener('submit',e=>e.preventDefault());
  $('defaultsButton').addEventListener('click',()=>{if(window.confirm('استعادة الإعدادات الأصلية في المسودة؟ لن تُحفظ إلا بعد اختيار حفظ.')){draft=clone(defaults);drawSettings();message('استُعيدت القيم الأصلية في المسودة.');}});
  $('exportSettingsButton').addEventListener('click',()=>{try{download('mosque-settings.json',validateSettings(draft));message('صُدّرت المسودة الحالية. لم تتغير الإعدادات المحفوظة.');}catch(error){message(error.message,true);}});
  $('importSettingsButton').addEventListener('click',()=>$('settingsFile').click());
  $('settingsFile').addEventListener('change',e=>{readFile(e.target.files[0],value=>{const candidate=validateSettings(value);if(database)buildEvents(database,candidate);draft=candidate;drawSettings();message('استُوردت الإعدادات في المسودة. عاينها ثم احفظها.');});e.target.value='';});
  $('timetableFile').addEventListener('change',e=>{readFile(e.target.files[0],value=>{const next=validateTimetable(value),nextEvents=buildEvents(next,currentSettings);buildEvents(next,savedSettings);database=next;events=nextEvents;const result=storage?safeWrite(storage,TABLE_STORE,JSON.stringify(value)):{ok:false};if(!result.ok)storageNote='جدول المواقيت المستورد متاح لهذه الجلسة فقط؛ احتفظ بملفه وأعد استيراده بعد التشغيل.';refresh();if(settingsOpen){drawSettings();message('تم التحقق من الجدول واستيراده. '+(result.ok?'حُفظ محليًا.':'تعذر حفظه محليًا؛ احتفظ بالملف.'),!result.ok);}});e.target.value='';});
  if($('importTimetableButton'))$('importTimetableButton').addEventListener('click',()=>$('timetableFile').click());
  if($('exportTimetableButton'))$('exportTimetableButton').addEventListener('click',exportTimetable);
  $('fullscreenButton').addEventListener('click',async()=>{const ok=await attemptFullscreen(document.documentElement);if(!ok){openSettings();message('تعذر ملء الشاشة. جرّب F11 على Windows أو اختصار ملء الشاشة الخاص بالمتصفح.',true);}});
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey&&e.altKey&&e.code==='KeyM'){e.preventDefault();if(state?.phase==='PRAYER_MODE'){suppressedId=state.active.id;tick();}return;}
    if(e.ctrlKey&&e.code==='Comma'){e.preventDefault();if(settingsOpen)closeSettings(true);else openSettings();}
    interaction();
  });
  document.addEventListener('mousemove',interaction,{passive:true});document.addEventListener('pointerdown',interaction,{passive:true});
  $('donationQR').addEventListener('error',()=>{donationImageAvailable=false;renderDonation();fitSlideText();});
  $('donationQR').addEventListener('load',()=>{donationImageAvailable=true;renderDonation();});
  if($('donationQR').complete&&$('donationQR').naturalWidth===0)donationImageAvailable=false;
  window.addEventListener('resize',resize);
  const motionPreference=typeof window.matchMedia==='function'?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
  if(motionPreference?.addEventListener)motionPreference.addEventListener('change',resize);
  else if(motionPreference?.addListener)motionPreference.addListener(resize);
  function resume(){lastDate='';lastTick=0;slideElapsed=0;tick();}
  window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);
  renderTicker();resize();refresh();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{fitInformation();fitSlideText();fitDonationText();sizeTicker();});
  // One scheduler only. Absolute timestamps make throttling, resume and clock jumps harmless.
  window.setInterval(tick,250);
  if(new URLSearchParams(location.search).get('test')==='1'){
    const api={defaults:clone(defaults),database,calendar,calendarNativeOK,validateSettings,validateTimetable,dateKey,addDays,formatClock,hijriFallback,buildEvents,resolveState,slideAdvance,safeRead,safeWrite,attemptFullscreen,tick,setNow:fn=>{nowProvider=fn;lastTick=0;},resetNow:()=>{nowProvider=()=>Date.now();lastTick=0;},getState:()=>clone(state),getSettings:()=>clone(currentSettings),useSettings,openSettings,
      setSlides:items=>{manifest.splice(0,manifest.length,...clone(items));failedSlides.clear();slideIndex=0;slideElapsed=0;lastTick=0;slidesPaused=false;renderSlide();},
      getSlidesState:()=>({index:slideIndex,elapsed:slideElapsed,failed:[...failedSlides],count:enabledSlides().length}),
      getContentMode:()=>contentMode,
      getDonationState:()=>({hidden:$('donationCard').hidden,visible:currentSettings.donation.visible,source:displayContent.donation.image,title:currentSettings.donation.title,description:currentSettings.donation.description,imageAvailable:donationImageAvailable}),
      getTickerState:()=>({hidden:$('mosqueTicker').hidden,paused:$('mosqueTicker').classList.contains('ticker-paused'),texts:displayContent.ticker.map(item=>item.text)})};
    window.MosqueApp=api;
    window.addEventListener('message',async event=>{
      if(event.source!==parent||!event.data||event.data.type!=='mosque-test-rpc')return;
      const {id,method,args=[],property}=event.data;
      try{
        let value;
        if(property&&['defaults','database','calendar','calendarNativeOK'].includes(property))value=api[property];
        else if(['dateKey','addDays','formatClock','hijriFallback','validateSettings','validateTimetable','buildEvents','resolveState','slideAdvance'].includes(method))value=api[method](...args);
        else throw Error('اختبار غير مدعوم');
        event.source.postMessage({type:'mosque-test-result',id,ok:true,value},'*');
      }catch(error){event.source.postMessage({type:'mosque-test-result',id,ok:false,error:error.message},'*');}
    });
    parent.postMessage({type:'mosque-test-ready'},'*');
  }
})();
