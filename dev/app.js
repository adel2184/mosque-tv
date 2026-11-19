(function () {
  'use strict';
  // Legacy screens retain Riyadh; configured screens use their selected IANA zone.
  const DAY = 86400000, OFFSET = 10800000;
  let ZONE='Asia/Riyadh',activeProfile=null,installation=null,installationError='',setupPending=false;
  const locationEngine=window.MosqueLocation,profileStore=window.MosqueProfileStore;
  const KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const POST_PRAYER_MINUTES = [0,3,5,7];
  const NAMES = {fajr:'الفجر', sunrise:'الشروق', dhuhr:'الظهر', asr:'العصر', maghrib:'المغرب', isha:'العشاء'};
  const WEEKDAYS = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const HIJRI_MONTHS = ['محرم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة','رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة'];
  const FIELD_LABELS = {name:'اسم الجامع',address:'العنوان',subtitle:'وصف مختصر',imam:'اسم الإمام',contact:'رقم التواصل',announcement:'نص الإعلان أو التواصل'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const embedded = id => JSON.parse(document.getElementById(id).textContent);
  const defaults = embedded('config-data');
  let calendar = embedded('calendar-data');
  const setupCalendar=document.getElementById('setup-calendar-data')?embedded('setup-calendar-data'):calendar;
  const setupCatalog=window.MosquePlaces||{countries:[],methods:[]};
  const fixtures = embedded('calendar-fixtures').fixtures;
  const sourceDatabase = embedded('prayer-data');
  const manifest = embedded('slides-data');
  const displayContent = embedded('display-content-data');
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2,'0');
  const digits = (value, style) => style === 'arabic' ? String(value).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : String(value);
  const dateKey = (ms,zone=ZONE) => activeProfile&&locationEngine?locationEngine.dateKey(ms,zone):new Date(ms + OFFSET).toISOString().slice(0,10);
  const validDate = key => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(Date.parse(key+'T00:00:00Z')) && new Date(key+'T00:00:00Z').toISOString().slice(0,10)===key;
  const addDays = (key,n) => new Date(Date.parse(key+'T12:00:00Z') + n*DAY).toISOString().slice(0,10);
  const weekday = key => new Date(key+'T12:00:00Z').getUTCDay();
  const timestamp = (key,time,zone=ZONE) => locationEngine&&(activeProfile||zone!=='Asia/Riyadh')?locationEngine.timestamp(key,time,zone):Date.parse(key+'T'+time+':00+03:00');
  const english=()=>activeProfile?.language==='en';
  const tr=(ar,en)=>english()?en:ar;
  const prayerName=k=>english()?({fajr:'Fajr',sunrise:'Sunrise',dhuhr:'Dhuhr',asr:'Asr',maghrib:'Maghrib',isha:'Isha'})[k]:NAMES[k];
  const scheduledPrayerName=(k,date)=>k==='dhuhr'&&weekday(date)===5?tr('الجمعة','Jumu’ah'):prayerName(k);
  function formatClock(ms, style) {
    if(activeProfile&&locationEngine)return locationEngine.formatClock(ms,activeProfile,style);
    const d = new Date(ms+OFFSET), hour = d.getUTCHours();
    return {time:digits(pad(hour%12||12)+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds()),style),period:hour<12?'ص':'م'};
  }
  function formatTime(ms, style) {
    if(activeProfile&&locationEngine)return locationEngine.formatTime(ms,activeProfile,style);
    const d = new Date(ms+OFFSET), h = d.getUTCHours();
    return digits(pad(h%12||12)+':'+pad(d.getUTCMinutes()),style)+' '+(h<12?'ص':'م');
  }
  function hijriFallback(key) {
    if (!validDate(key) || key < calendar.rangeStart || key > calendar.rangeEnd) return null;
    const months=calendar.months;
    for(let i=months.length-2;i>=0;i--) {
      if(key>=months[i].start && key<months[i+1].start) return {year:months[i].year,month:months[i].month,day:Math.round((Date.parse(key+'T12:00:00Z')-Date.parse(months[i].start+'T12:00:00Z'))/DAY)+1};
    }
    return null;
  }
  let hijriFormatter, hijriFormatterZone;
  function nativeHijri(key) {
    if(hijriFormatterZone!==ZONE){
      const formatter=new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura-nu-latn',{timeZone:ZONE,calendar:'islamic-umalqura',year:'numeric',month:'numeric',day:'numeric'});
      if(formatter.resolvedOptions().calendar!=='islamic-umalqura') throw new Error('calendar');
      hijriFormatter=formatter;hijriFormatterZone=ZONE;
    }
    const p = Object.fromEntries(hijriFormatter.formatToParts(timestamp(key,'12:00')).map(x=>[x.type,x.value]));
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
    // Version-1 backups and installed profiles from before 2.4 have neither field.
    out.silentPhoneReminder=c.silentPhoneReminder===undefined?defaults.silentPhoneReminder:bool(c.silentPhoneReminder,'تنبيه إغلاق الجوالات');
    out.postPrayerMinutes=c.postPrayerMinutes===undefined?defaults.postPrayerMinutes:c.postPrayerMinutes;
    if(!POST_PRAYER_MINUTES.includes(out.postPrayerMinutes))fail('اختر مدة معتمدة لأذكار ما بعد الصلاة.');
    out.adhanAdjustments={};KEYS.forEach(k=>out.adhanAdjustments[k]=number(c.adhanAdjustments?.[k]??0,-120,120,'تعديل وقت '+NAMES[k],true));
    out.slideSeconds=number(c.slideSeconds,5,300,'فاصل الشرائح',true);
    if(!['arabic','western'].includes(c.digitStyle))fail('نمط الأرقام غير مدعوم.');out.digitStyle=c.digitStyle;
    out.location={latitude:number(c.location?.latitude,activeProfile?-89:-60,activeProfile?89:60,'خط العرض'),longitude:number(c.location?.longitude,-180,180,'خط الطول')};
    // Existing version-1 backups predate this card; preserve their other settings.
    const donation=c.donation===undefined?defaults.donation:c.donation;
    if(!donation||typeof donation!=='object'||Array.isArray(donation))fail('بيانات بطاقة التبرع غير صالحة.');
    out.donation={visible:bool(donation.visible,'بطاقة التبرع'),title:textValue(donation.title,90,'عنوان مشروع التبرع'),description:textValue(donation.description,180,'وصف المشروع')};
    if(out.donation.visible&&!out.donation.title.trim())fail('أدخل عنوان مشروع التبرع قبل إظهار البطاقة.');
    return out;
  }
  function validateTimetable(db, {savedInstallation=false}={}) {
    if(!db||typeof db!=='object'||!db.metadata||!Array.isArray(db.records))fail('ملف المواقيت يجب أن يتضمن metadata وrecords.');
    const m=db.metadata, y=m.targetYear;
    const configured=Boolean(activeProfile&&locationEngine);
    if(m.schemaVersion!==1||!Number.isInteger(y)||y<2000||y>2075||m.timezone!==ZONE||(!configured&&m.utcOffset!=='+03:00')||(configured&&!['iana-dynamic','+03:00'].includes(m.utcOffset))||(!configured&&!['Dammam','الدمام'].includes(m.city))||typeof m.city!=='string'||!m.city.trim()||!Array.isArray(m.displayYears)||m.displayYears.length!==2||m.displayYears[0]!==y||m.displayYears[1]!==y+1)fail('مدينة الجدول أو منطقته الزمنية أو سنواته أو إصداره غير صحيحة.');
    for(const k of ['source','dataVersion','generatedOn','verificationStatus'])textValue(m[k],2000,'بيانات المصدر: '+k);
    if(!['calculated-needs-review','authority-supplied-unverified'].includes(m.verificationStatus))fail('حالة التحقق غير مدعومة؛ يلزم الاحتفاظ ببيان مراجعة مستقل.');
    if(!m.source.trim()||!m.dataVersion.trim()||!validDate(m.generatedOn))fail('بيانات المصدر أو تاريخ التوليد ناقصة.');
    if(configured){
      if(m.countryId!==undefined && m.countryId!==activeProfile.countryId)fail('بلد الجدول لا يطابق البلد المختار.');
      if(m.cityId!==undefined && m.cityId!==activeProfile.cityId)fail('مدينة الجدول لا تطابق المدينة المختارة.');
      // Existing installations can have an authority's free-form city label.
      // Require a matching catalog identity whenever an operator brings in a new table.
      if(!savedInstallation && m.verificationStatus==='authority-supplied-unverified' && m.cityId===undefined){
        const country=setupCatalog.countries.find(item=>item.id===activeProfile.countryId);
        const city=country?.cities.find(item=>String(item.id)===activeProfile.cityId);
        const name=m.city.trim().toLowerCase();
        if(![activeProfile.cityId,city?.nameAr,city?.nameEn].some(value=>value&&value.trim().toLowerCase()===name))fail('حدّد معرّف المدينة الصحيح في بيانات الجدول قبل الاستيراد.');
      }
    }
    if(m.verificationStatus==='calculated-needs-review'){
      if(!m.coordinates||!m.calculation||typeof m.calculation!=='object'||Array.isArray(m.calculation))fail('إحداثيات المواقيت المحسوبة ومعاملاتها مطلوبة.');
      number(m.coordinates.latitude,configured?-89:-60,configured?89:60,'خط عرض الجدول');number(m.coordinates.longitude,-180,180,'خط طول الجدول');
      const calc=m.calculation;
      if(configured){
        const preset=locationEngine.methodPresets[activeProfile.methodId];
        if(!preset||calc.method!==activeProfile.methodId||Math.abs(m.coordinates.latitude-activeProfile.latitude)>0.00001||Math.abs(m.coordinates.longitude-activeProfile.longitude)>0.00001)fail('مصدر الجدول لا يطابق الموقع وطريقة الحساب المختارين.');
        const remote=calc.library==='UmmahAPI (remote astronomical calculation)'&&m.sourceUrl==='https://ummahapi.com/api/docs';
        if((remote?(calc.fajrAngle!==null||calc.ishaAngle!==null):(calc.fajrAngle!==preset.fajrAngle||calc.ishaAngle!==preset.ishaAngle))||calc.asrShadowFactor!==1||calc.ishaMinutesOutsideRamadan!==preset.ishaMinutesOutsideRamadan||calc.ishaMinutesRamadan!==preset.ishaMinutesRamadan)fail('معاملات الجدول لا تطابق طريقة الحساب المختارة.');
      }else if(calc.fajrAngle!==18.5||calc.asrShadowFactor!==1||calc.ishaMinutesOutsideRamadan!==90||calc.ishaMinutesRamadan!==120)fail('معاملات المواقيت المحسوبة لا تطابق طريقة أم القرى الموثقة لهذه النسخة.');
      for(const k of configured?['library','method','rounding']:['library','method','rounding','ramadanCalendar'])textValue(calc[k],500,'معامل الحساب '+k);
    }
    const start=(y-1)+'-12-31', end=(y+2)+'-01-01';
    if(m.rangeStart!==start||m.rangeEnd!==end||m.displayStart!==y+'-01-01'||m.displayEnd!==(y+1)+'-12-31')fail('حدود التغطية لا تطابق سنوات العرض.');
    if(!Array.isArray(m.boundaryOnly)||m.boundaryOnly.length!==2||!m.boundaryOnly.includes(start)||!m.boundaryOnly.includes(end))fail('بيان سجلات الحدود غير صحيح.');
    if(start<calendar.rangeStart||end>calendar.rangeEnd)fail('تغطية تقويم أم القرى المرفق لا تشمل هذا الجدول؛ حدّث ملف التطبيق وتقويمه أولًا.');
    const index=new Map();
    for(const row of db.records){
      if(!row||!validDate(row.date)||row.date<start||row.date>end||index.has(row.date))fail('تاريخ مكرر أو غير صالح في جدول المواقيت.');
      if(configured&&m.verificationStatus==='calculated-needs-review'&&(!row.instants||typeof row.instants!=='object'||Array.isArray(row.instants)))fail('المواقيت المحسوبة يجب أن تتضمن التوقيت المطلق لكل صلاة.');
      let previous=-Infinity;const anchor=row.instants?timestamp(row.date,'12:00',m.timezone):0;
      for(const k of KEYS){if(typeof row[k]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row[k]))fail('وقت غير صالح في '+row.date+' / '+NAMES[k]);const instant=row.instants?.[k],value=row.instants?instant:Number(row[k].slice(0,2))*60+Number(row[k].slice(3));if(row.instants){if(!configured||!Number.isSafeInteger(instant)||instant%60000!==0||Math.abs(instant-anchor)>36*3600000)fail('الوقت المطلق غير صالح في '+row.date);const wall=locationEngine.wallParts(instant,m.timezone);if(pad(wall.hour)+':'+pad(wall.minute)!==row[k])fail('الوقت المطلق لا يطابق المنطقة الزمنية في '+row.date);}if(value<=previous)fail('ترتيب المواقيت غير صحيح في '+row.date);previous=value;}
      if(row.instants&&dateKey(row.instants.dhuhr,m.timezone)!==row.date)fail('تاريخ الظهر لا يطابق يوم الجدول.');
      if(configured&&m.verificationStatus==='calculated-needs-review'&&activeProfile.methodId==='UmmAlQura'){const h=locationEngine.hijriFromCalendar(row.date,calendar),minutes=h?.month===9?120:90;if(!h||row.instants.isha-row.instants.maghrib!==minutes*60000)fail('فاصل العشاء لا يطابق قاعدة أم القرى ورمضان.');}
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
        const eventAt=(row,key)=>(row.instants?.[key]??timestamp(row.date,row[key],db.metadata.timezone))+(c.adhanAdjustments?.[key]||0)*60000;
        const adhan=eventAt(r,p);
        const candidates=c.iqama.overrides.filter(o=>o.prayer===p&&((o.kind==='date'&&o.match===r.date)||(o.kind==='weekday'&&Number(o.match)===weekday(r.date))));
        const fixed=candidates.find(o=>o.kind==='date')||candidates[0];
        let iqama=fixed?timestamp(r.date,fixed.time,db.metadata.timezone):adhan+c.iqama.offsets[p]*60000;
        if(fixed&&p==='isha'&&iqama<adhan)iqama=timestamp(addDays(r.date,1),fixed.time,db.metadata.timezone);
        const nextKey={fajr:'dhuhr',dhuhr:'asr',asr:'maghrib',maghrib:'isha'}[p];
        const nextAdhan=p==='isha'?eventAt(following,'fajr'):eventAt(r,nextKey);
        const deadline=p==='fajr'?eventAt(r,'sunrise'):nextAdhan;
        const end=iqama+c.prayerModeMinutes*60000;
        if(iqama<adhan||iqama>=deadline||end>nextAdhan)fail('إعداد إقامة '+NAMES[p]+' في '+r.date+' خارج فترة الصلاة أو يتداخل مع الصلاة التالية. راجع الفاصل والموعد الثابت ومدة وضع الصلاة.');
        events.push({id:r.date+'/'+p,date:r.date,prayer:p,adhan,iqama,end,deadline});
      }
    }
    return events.sort((a,b)=>a.adhan-b.adhan);
  }
  function resolveState(ms,events,db,suppressedId,key=dateKey(ms)) {
    const year=Number(key.slice(0,4));
    if(!db)return {phase:'UNAVAILABLE',active:null,next:null,targetAt:null,highlight:null};
    // buildEvents validates non-overlap and sorts by adhan. Find the first future event.
    let low=0,high=events.length;
    while(low<high){
      const middle=low+Math.floor((high-low)/2);
      if(events[middle].adhan<=ms)low=middle+1;else high=middle;
    }
    const latest=low>0?events[low-1]:null;
    const active=latest&&ms<latest.end?latest:null;
    // A guard date supplies the next Fajr, but must not start its own post-prayer programme.
    const previous=latest&&latest.end<=ms&&latest.id!==suppressedId&&db.metadata.displayYears.includes(Number(latest.date.slice(0,4)))?latest:null;
    // Let the final supported day's Isha finish across the terminal boundary.
    if(!db.metadata.displayYears.includes(year)||!db.index.has(key)){
      if(active&&db.metadata.displayYears.includes(Number(active.date.slice(0,4)))){
        if(ms<active.iqama)return {phase:'WAITING_FOR_IQAMA',active,next:active,targetAt:active.iqama,highlight:active.prayer};
        if(active.id!==suppressedId)return {phase:'PRAYER_MODE',active,next:null,targetAt:active.end,highlight:active.prayer};
      }
      return {phase:'UNAVAILABLE',active:null,next:null,targetAt:null,highlight:null,previous};
    }
    if(active&&ms<active.iqama)return {phase:'WAITING_FOR_IQAMA',active,next:active,targetAt:active.iqama,highlight:active.prayer};
    if(active&&active.id!==suppressedId)return {phase:'PRAYER_MODE',active,next:null,targetAt:active.end,highlight:active.prayer};
    const next=events[low]||null;
    const hasPrevious=Boolean(latest&&(latest.end<=ms||(latest.id===suppressedId&&latest.iqama<=ms)));
    return {phase:hasPrevious?'WAITING_FOR_NEXT_ADHAN':'WAITING_FOR_ADHAN',active:null,next,targetAt:next?.adhan||null,highlight:next?.prayer||null,previous};
  }
  function safeRead(storage,key){try{return {ok:true,value:storage.getItem(key)};}catch(error){return {ok:false,value:null,error:String(error)};}}
  function safeWrite(storage,key,value){try{storage.setItem(key,value);return {ok:true};}catch(error){return {ok:false,error:String(error)};}}
  async function attemptFullscreen(element){try{const fn=element.requestFullscreen||element.webkitRequestFullscreen;if(!fn)return false;await fn.call(element);return true;}catch(_){return false;}}
  const slideAdvance=(i,count)=>count>0?(i+1)%count:0;
  let storageNote='', savedSettings=clone(defaults), currentSettings, draft=null, database=null, events=[], databaseError='', nowProvider=()=>Date.now();
  let suppressedId=null, state=null, lastDate='', lastRenderSignature='', lastPhase='', settingsOpen=false, previewApplied=false;
  const STORE='mosque-display.settings.v1', TABLE_STORE='mosque-display.timetable.v1';
  const acceptanceFixture=!window.MosqueAndroid && location.hash==='#acceptance' && new URLSearchParams(location.search).get('test')==='1';
  let storage,legacySettingsPresent=acceptanceFixture,nativeInstall={};try{if(!acceptanceFixture)storage=window.localStorage;}catch(_){storageNote='التخزين المحلي غير متاح؛ صدّر الإعدادات للاحتفاظ بها بعد إغلاق الصفحة.';}
  try{if(typeof window.MosqueAndroid?.setupStatus==='function')nativeInstall=JSON.parse(String(window.MosqueAndroid.setupStatus()));else if(window.MosqueAndroid)nativeInstall={legacyUpgrade:true};}catch(_){nativeInstall={legacyUpgrade:true};}
  if(storage){
    const s=safeRead(storage,STORE);legacySettingsPresent=Boolean(s.value);
    if(profileStore&&locationEngine){try{const candidate=profileStore.read(storage);if(candidate){activeProfile=locationEngine.validateProfile(candidate.profile,setupCatalog);ZONE=activeProfile.timezone;calendar=setupCalendar;savedSettings=validateSettings(candidate.settings);database=validateTimetable(candidate.timetable,{savedInstallation:true});installation=candidate;}}catch(error){installationError=String(error.message||error);databaseError=installationError;database=null;}}
    if(!installation&&!installationError){if(!s.ok)storageNote='تعذر قراءة التخزين المحلي؛ تعمل الإعدادات في هذه الجلسة.';else if(s.value){try{savedSettings=validateSettings(JSON.parse(s.value));}catch(_){storageNote='ملف الإعدادات المحفوظ غير صالح؛ استُخدمت الإعدادات الأصلية.';}}}
  }
  if(!installation&&!installationError)try{database=validateTimetable(sourceDatabase);if(storage){const stored=safeRead(storage,TABLE_STORE);if(stored.value){try{database=validateTimetable(JSON.parse(stored.value));}catch(_){storageNote+=' جدول المواقيت المحفوظ غير صالح؛ استُخدم الجدول المرفق.';}}}}catch(error){databaseError=error.message;}
  setupPending=Boolean(locationEngine&&profileStore&&(installationError||(!installation&&!legacySettingsPresent&&!nativeInstall.legacyUpgrade)));
  if(setupPending){database=null;savedSettings=clone(defaults);savedSettings.donation.visible=false;savedSettings.mosque.enabled=false;}
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
    KEYS.forEach(k=>{const ui=rows.get(k);ui.row.querySelector('th').textContent=scheduledPrayerName(k,key);ui.adhan.textContent=supported&&r?formatTime((r.instants?.[k]??timestamp(key,r[k]))+(currentSettings.adhanAdjustments?.[k]||0)*60000,currentSettings.digitStyle):'—';const event=events.find(e=>e.date===key&&e.prayer===k);ui.iqama.textContent=supported&&event&&k!=='sunrise'?formatTime(event.iqama,currentSettings.digitStyle):'—';ui.row.classList.toggle('informational',k==='sunrise');});
    const unavailable=!database||!supported||!r;
    $('displayStatus').hidden=!unavailable;
    $('dataStatus').textContent=unavailable?tr('بيانات المواقيت غير متوفرة لهذا التاريخ — حدّث الجدول من الإعدادات','Prayer times unavailable for this date — update the timetable in settings'):'';
  }
  function renderDates(ms){
    if(activeProfile&&locationEngine){
      const key=dateKey(ms),parts=locationEngine.wallParts(ms,ZONE),h=hijri(key),en=english();
      $('weekday').textContent=new Intl.DateTimeFormat(en?'en-US':'ar-SA',{timeZone:ZONE,weekday:'long',calendar:'gregory'}).format(new Date(ms));
      $('gregorianDate').textContent=digits(new Intl.DateTimeFormat(en?'en-GB':'ar-SA-u-nu-latn',{timeZone:ZONE,calendar:'gregory',day:'numeric',month:'long',year:'numeric'}).format(new Date(ms)),currentSettings.digitStyle);
      $('gregorianDate').dir=en?'ltr':'rtl';$('hijriDate').dir=en?'ltr':'rtl';$('weekday').dir=en?'ltr':'rtl';
      const names=en?['Muharram','Safar','Rabi I','Rabi II','Jumada I','Jumada II','Rajab','Shaban','Ramadan','Shawwal','Dhul Qadah','Dhul Hijjah']:HIJRI_MONTHS;
      $('hijriDate').textContent=h?digits(h.day+' '+names[h.month-1]+' '+h.year+(en?' AH':' هـ'),currentSettings.digitStyle):tr('التقويم الهجري خارج نطاق التغطية','Hijri calendar coverage needs updating');
      $('hijriDate').hidden=activeProfile.dateStyle==='gregorian';$('gregorianDate').hidden=activeProfile.dateStyle==='hijri';
      document.querySelectorAll('.dates .date-divider').forEach((node,index)=>node.hidden=index===1&&activeProfile.dateStyle!=='both');
      const country=setupCatalog.countries.find(c=>c.id===activeProfile.countryId),city=country?.cities.find(c=>c.id===activeProfile.cityId),line=document.querySelector('.city-line');
      if(line)line.textContent=(en?city?.nameEn:city?.nameAr||city?.nameEn)+' · '+ZONE;
      return;
    }
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
    const show=cfg.visible&&contentMode!=='prayer'&&contentMode!=='post-prayer';
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
  const guide=displayContent.prayerGuide, guideState={};
  let guideDay, shownCue, shownFriday, shownPhone, shownRamadan, shownLanguage;
  let shownPostCard=-1, shownRamadanSeconds=-1;
  function formatDuration(seconds){
    return digits(pad(Math.floor(seconds/3600))+':'+pad(Math.floor(seconds/60)%60)+':'+pad(seconds%60),currentSettings.digitStyle);
  }
  function syncGuide(ms){
    const {cue,phone,friday,ramadan,ramadanAt,postStart}=guideState;
    const lang=english()?'en':'ar',languageChanged=lang!==shownLanguage;
    const cueChanged=cue!==shownCue,fridayChanged=friday!==shownFriday;
    if(cueChanged||fridayChanged||languageChanged){
      const visit=cue==='entrance'||cue==='exit', fridayCard=friday!=='none'&&cue!=='rows';
      const contextual=visit||fridayCard;
      const ticker=$('mosqueTicker'),scrolling=!contextual&&cue!=='rows'&&cue!=='adhkar';
      ticker.hidden=!contextual&&!scrolling;
      ticker.classList.toggle('contextual',contextual);
      ticker.classList.toggle('ticker-paused',!scrolling);
      $('contextTicker').hidden=!contextual;
      $('tickerViewport').hidden=!scrolling;
      $('visitReminder').hidden=!visit;
      $('exitReminder').hidden=cue!=='exit';
      if(visit){
        $('visitLabel').textContent=cue==='exit'?tr('دعاء الخروج من المسجد','Leaving the mosque'):tr('دعاء دخول المسجد','Entering the mosque');
        $('visitText').textContent=cue==='exit'?guide.exit:guide.entrance;
        if(cue==='exit')$('exitReminder').textContent=guide.exitReminder[lang];
      }
      $('fridayReminders').hidden=!fridayCard;
      $('fridayBlessings').hidden=friday!=='morning';
      if(fridayCard){
        $('fridayMessage').textContent=friday==='listen'?guide.khutbah:guide.fridayKahf;
        if(friday==='morning')$('fridayBlessings').textContent=guide.fridayBlessings;
      }
      $('rowsKhutbah').hidden=!(cue==='rows'&&friday==='listen');
      if(cue==='rows'&&friday==='listen')$('rowsKhutbah').textContent=guide.khutbah;
      if(scrolling)sizeTicker();
    }
    if(cueChanged||phone!==shownPhone||languageChanged){
      $('phoneReminder').hidden=!(phone&&cue==='entrance');
      $('rowsPhoneReminder').hidden=!(phone&&cue==='rows');
      if(phone){
        const reminder=tr('الرجاء إغلاق الجوالات أو وضعها على الصامت','Please silence or turn off your mobile phones');
        $(cue==='rows'?'rowsPhoneReminder':'phoneReminder').textContent=reminder;
      }
      if(!cueChanged&&phone!==shownPhone&&cue==='entrance')fitSlideText();
    }
    if(cue==='adhkar'){
      const cards=guide.postPrayer;
      // Even the shortest configured session includes every card. Resumes use wall time.
      const dwell=Math.min(30000,currentSettings.postPrayerMinutes*60000/cards.length);
      const cardIndex=Math.floor((ms-postStart)/dwell)%cards.length;
      if(cueChanged||languageChanged)$('postPrayerHeading').textContent=tr('أذكار ما بعد الصلاة','Post-prayer adhkar');
      if(cueChanged||languageChanged||cardIndex!==shownPostCard){
        const card=cards[cardIndex],body=$('postPrayerText');
        $('postPrayerTitle').textContent=card.title[lang];
        body.textContent=card.text;
        body.classList.toggle('long-dhikr',card.text.length>170);
        $('postPrayerNote').textContent=card.note[lang];
        $('postPrayerNote').hidden=!card.note[lang];
        shownPostCard=cardIndex;
      }
    }
    if(ramadan!==shownRamadan||languageChanged){
      $('ramadanPill').hidden=ramadan==='none';
      if(ramadan!=='none'){
        const label=ramadan==='iftar'?tr('المتبقي للإفطار','Until iftar'):ramadan==='fajr-only'?tr('المتبقي للفجر','Until Fajr'):tr('المتبقي للإمساك (الفجر)','Until imsak (Fajr)');
        $('ramadanLabel').textContent=label;
      }
    }
    if(ramadanAt!==null&&cue!=='rows'){
      const seconds=Math.max(0,Math.ceil((ramadanAt-ms)/1000));
      if(seconds!==shownRamadanSeconds||languageChanged)$('ramadanTime').textContent=formatDuration(seconds);
      shownRamadanSeconds=seconds;
    }
    shownCue=cue;shownFriday=friday;shownPhone=phone;shownRamadan=ramadan;shownLanguage=lang;
  }
  function syncContentMode(){
    const cue=guideState.cue;
    const next=cue==='rows'?'prayer':cue==='adhkar'?'post-prayer':cue==='entrance'?'adhan':'slides';
    if(next===contentMode)return;
    contentMode=next;
    $('mainDashboard').hidden=next==='post-prayer';
    $('postPrayerDisplay').hidden=next!=='post-prayer';
    renderDonation();
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
    const width=Math.floor(slideElapsed/1000)/currentSettings.slideSeconds*100+'%';
    if($('slideProgress').style.width!==width)$('slideProgress').style.width=width;
  }
  function sizeTicker(){
    const track=$('tickerTrack'),cycle=track.children[0];if(!cycle||$('tickerViewport').hidden)return;
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
    if($('clockTime').textContent!==clock.time)$('clockTime').textContent=clock.time;if($('clockPeriod').textContent!==clock.period)$('clockPeriod').textContent=clock.period;
    state=resolveState(ms,events,database,suppressedId,key);
    if(key!==lastDate){
      lastDate=key;renderDates(ms);renderPrayerTable(ms);
      const todayHijri=hijriFallback(key);
      const nextMonth=todayHijri?.month===9&&todayHijri.day>=29?hijriFallback(addDays(key,1))?.month:todayHijri?.month;
      guideDay=window.MosquePrayerContext.prepareDay(events,key,todayHijri,nextMonth);
    }
    window.MosquePrayerContext.resolve(ms,state,guideDay,currentSettings,guideState);
    const signature=key+'/'+state.phase+'/'+state.highlight+'/'+(state.next?.date||'')+'/'+currentSettings.digitStyle;
    if(signature!==lastRenderSignature){
      lastRenderSignature=signature;
      rows.forEach((ui,k)=>ui.row.classList.toggle('next-prayer',k===state.highlight));
      if(state.phase==='UNAVAILABLE')$('countdownLabel').textContent=tr('بيانات المواقيت غير متوفرة لهذا التاريخ','Prayer times are unavailable for this date');
      else if(state.phase==='WAITING_FOR_IQAMA')$('countdownLabel').textContent=tr('المتبقي على إقامة ','Until iqama: ')+scheduledPrayerName(state.active.prayer,state.active.date);
      else if(state.phase==='PRAYER_MODE')$('countdownLabel').textContent=tr('تُقام الصلاة الآن','Prayer is in progress');
      else $('countdownLabel').textContent=state.next?tr('المتبقي على أذان ','Until adhan: ')+scheduledPrayerName(state.next.prayer,state.next.date):tr('حدّث جدول المواقيت','Update the prayer timetable');
      $('nextDateLabel').textContent=state.next&&state.next.date!==key?tr('موعد اليوم التالي','Next day'):'';
    }
    const remaining=state.targetAt?Math.max(0,Math.ceil((state.targetAt-ms)/1000)):null;
    const countdownText=remaining===null?'— — : — — : — —':formatDuration(remaining);if($('countdownValue').textContent!==countdownText)$('countdownValue').textContent=countdownText;
    const inPrayer=state.phase==='PRAYER_MODE';
    if(inPrayer&&lastPhase!=='PRAYER_MODE'){if(settingsOpen){closeSettings(true);return;}$('prayerOverlay').hidden=false;$('prayerOverlay').setAttribute('aria-hidden','false');document.body.classList.add('praying');}
    if(!inPrayer&&lastPhase==='PRAYER_MODE'){$('prayerOverlay').hidden=true;$('prayerOverlay').setAttribute('aria-hidden','true');document.body.classList.remove('praying');}
    lastPhase=state.phase;syncGuide(ms);syncContentMode();updateSlideshow(ms,contentMode!=='slides');
    if(!settingsOpen&&ms-lastInteraction>5000&&!document.body.classList.contains('idle'))document.body.classList.add('idle');
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
  function refresh(){lastDate='';lastRenderSignature='';contentMode='';shownLanguage=null;if(window.MosqueLocale)window.MosqueLocale.set(activeProfile?.language||'ar');renderMosque();tick();}
  function applySettings(validated,preparedEvents){
    currentSettings=validated;events=preparedEvents;
    if(settingsOpen)previewApplied=true;
    refresh();
  }
  function useSettings(candidate){
    const validated=validateSettings(candidate);
    applySettings(validated,database?buildEvents(database,validated):[]);
  }
  function plainTimetable(db){return {metadata:clone(db.metadata),records:clone(db.records)};}
  function withProfile(profile,action){const before={profile:activeProfile,zone:ZONE,calendar};try{activeProfile=locationEngine.validateProfile(profile,setupCatalog);ZONE=activeProfile.timezone;calendar=setupCalendar;return action(activeProfile);}finally{activeProfile=before.profile;ZONE=before.zone;calendar=before.calendar;}}
  function setupSettings(profile){
    const candidate=clone(savedSettings);
    if(setupPending&&!installation){for(const k of Object.keys(candidate.mosque.fields)){candidate.mosque.fields[k].value='';candidate.mosque.fields[k].visible=false;}candidate.mosque.custom=[];candidate.donation.visible=false;candidate.iqama={offsets:{fajr:10,dhuhr:10,asr:10,maghrib:5,isha:10},confirmed:false,overrides:[]};candidate.prayerModeMinutes=10;}
    const country=setupCatalog.countries.find(c=>c.id===profile.countryId),city=country.cities.find(c=>c.id===profile.cityId);
    candidate.mosque.enabled=true;candidate.mosque.fields.name={value:profile.mosqueName,visible:true};candidate.mosque.fields.address={value:[profile.neighborhood,profile.language==='en'?city.nameEn:city.nameAr||city.nameEn].filter(Boolean).join('، '),visible:true};candidate.location={latitude:profile.latitude,longitude:profile.longitude};
    return validateSettings(candidate);
  }
  function validateSetup(profile,table){return withProfile(profile,p=>{const data=validateTimetable(table),settings=setupSettings(p),nextEvents=buildEvents(data,settings);return {profile:clone(p),settings,data,events:nextEvents};});}
  function persistCurrent(settings,table){
    if(!storage)return {ok:false};
    if(installation){try{const profile=clone(activeProfile);if(settings.mosque.fields.name.value.trim())profile.mosqueName=settings.mosque.fields.name.value;const snapshot={...installation,profile,settings:clone(settings),timetable:plainTimetable(table)};profileStore.commit(storage,snapshot);installation=snapshot;activeProfile=profile;safeWrite(storage,STORE,JSON.stringify(settings));safeWrite(storage,TABLE_STORE,JSON.stringify(snapshot.timetable));return {ok:true};}catch(error){return {ok:false,error:String(error.message||error)};}}
    return safeWrite(storage,STORE,JSON.stringify(settings));
  }
  if(locationEngine&&profileStore)window.MosqueInstall={
    getContext:()=>({profile:activeProfile&&clone(activeProfile),settings:clone(savedSettings),required:setupPending,hasInstallation:Boolean(installation),error:installationError,calendar:setupCalendar,catalog:setupCatalog,year:Number((activeProfile?locationEngine.dateKey(nowProvider(),activeProfile.timezone):dateKey(nowProvider())).slice(0,4))}),
    validatePrepared:(profile,table)=>{validateSetup(profile,table);return true;},
    commit:(profile,table)=>{
      if(state?.phase==='PRAYER_MODE')throw Error(tr('انتظر انتهاء الصلاة لحفظ الإعداد.','Wait until prayer ends before saving setup.'));
      if(!storage)throw Error('Local storage is unavailable. Setup was not saved.');
      const checked=validateSetup(profile,table),snapshot={schemaVersion:1,profile:checked.profile,settings:checked.settings,timetable:plainTimetable(checked.data),completedAt:new Date(nowProvider()).toISOString()};
      profileStore.commit(storage,snapshot);
      activeProfile=checked.profile;ZONE=activeProfile.timezone;calendar=setupCalendar;installation=snapshot;installationError='';setupPending=false;savedSettings=clone(checked.settings);currentSettings=clone(checked.settings);database=checked.data;events=checked.events;databaseError='';storageNote='';suppressedId=null;
      safeWrite(storage,STORE,JSON.stringify(savedSettings));safeWrite(storage,TABLE_STORE,JSON.stringify(snapshot.timetable));
      try{window.MosqueAndroid?.markSetupCompleted?.(activeProfile.language);window.MosqueAndroid?.setProfileTimezone?.(activeProfile.timezone);}catch(_){}refresh();return {ok:true};
    }
  };
  let lastInteraction=Date.now();
  function interaction(){if(state?.phase==='PRAYER_MODE')return;lastInteraction=nowProvider();if(document.body.classList.contains('idle'))document.body.classList.remove('idle');}
  function resize(){const scale=Math.min(innerWidth/1920,innerHeight/1080);$('stage').style.transform='scale('+scale+')';$('stage').style.left=((innerWidth-1920*scale)/2)+'px';$('stage').style.top=((innerHeight-1080*scale)/2)+'px';fitInformation();fitSlideText();fitDonationText();sizeTicker();}
  function message(text,error){$('settingsMessage').textContent=text;$('settingsMessage').className=error?'error':'success';}
  function input(label,value,type,onchange,opts){const wrap=el('label','field'),caption=el('span',null,label),control=el('input');control.type=type||'text';if(type==='checkbox')control.checked=value;else control.value=value;Object.assign(control,opts||{});control.addEventListener('input',()=>onchange(type==='checkbox'?control.checked:type==='number'?Number(control.value):control.value));wrap.append(caption,control);return wrap;}
  function button(text,action){const b=el('button',null,text);b.type='button';b.addEventListener('click',action);return b;}
  function select(label,value,options,onchange){const wrap=el('label','field'),s=el('select');options.forEach(([v,t])=>{const o=el('option',null,t);o.value=v;s.append(o);});s.value=value;s.addEventListener('change',()=>onchange(s.value));wrap.append(el('span',null,label),s);return wrap;}
  // Desktop renders the complete form. On the TV, create only the section being edited.
  const settingsPages=[
    {id:'mosque', title:'بيانات الجامع', render(s){
      s.append(input('إظهار قسم بيانات الجامع كاملًا',draft.mosque.enabled,'checkbox',v=>draft.mosque.enabled=v));
      for(const k of Object.keys(FIELD_LABELS)){const row=el('div','inline');row.append(input(FIELD_LABELS[k],draft.mosque.fields[k].value,'text',v=>draft.mosque.fields[k].value=v,{maxLength:k==='name'?180:360}),input('إظهار / إخفاء',draft.mosque.fields[k].visible,'checkbox',v=>draft.mosque.fields[k].visible=v));s.append(row);}
      s.append(el('p','notice','تُحفظ قيم الحقول عند إخفائها. اترك المعلومات غير المعروفة فارغة.'));
      draft.mosque.custom.forEach((f,i)=>{const row=el('div','custom-row');row.dataset.tvGroup=f.id;row.dataset.tvLabel='الحقل الإضافي '+(i+1);row.append(input('عنوان اختياري',f.label,'text',v=>f.label=v,{maxLength:60}),input('نص إضافي',f.value,'text',v=>f.value=v,{maxLength:240}),input('إظهار',f.visible,'checkbox',v=>f.visible=v),button('أعلى',()=>{if(i){[draft.mosque.custom[i-1],draft.mosque.custom[i]]=[f,draft.mosque.custom[i-1]];drawSettings();}}),button('أسفل',()=>{if(i<draft.mosque.custom.length-1){[draft.mosque.custom[i+1],draft.mosque.custom[i]]=[f,draft.mosque.custom[i+1]];drawSettings();}}),button('حذف',()=>{draft.mosque.custom.splice(i,1);drawSettings();}));s.append(row);});
      s.append(button('إضافة حقل نصي',()=>{if(draft.mosque.custom.length>=8)return message('الحد الأقصى ثمانية حقول.',true);draft.mosque.custom.push({id:'field-'+Date.now(),label:'',value:'',visible:true});drawSettings();}));
    }},
    {id:'iqama', title:'الإقامة ووضع الصلاة', render(s){
      s.append(el('p','notice','الفواصل التالية أمثلة أولية تحتاج تأكيد إدارة الجامع. مواقيت الإقامة إعدادات محلية وليست نتائج فلكية.'));
      const intervals=el('div','inline');PRAYERS.forEach(p=>intervals.append(input(NAMES[p]+' (دقيقة)',draft.iqama.offsets[p],'number',v=>draft.iqama.offsets[p]=v,{min:1,max:180,step:1})));s.append(intervals,input('تمت مراجعة إعدادات الإقامة مع إدارة الجامع',draft.iqama.confirmed,'checkbox',v=>draft.iqama.confirmed=v),input('مدة وضع الصلاة (دقيقة)',draft.prayerModeMinutes,'number',v=>draft.prayerModeMinutes=v,{min:1,max:60,step:1}));
      s.append(el('p','notice',tr('يمكن تحديد إقامة ثابتة ليوم أسبوعي أو تاريخ بعينه. يتقدم التاريخ على الموعد الأسبوعي. لا يوجد موعد جمعة مفترض. تُستخدم المنطقة الزمنية المختارة وصيغة 24 ساعة؛ للعشاء فقط يمكن الامتداد إلى اليوم التالي.','Set a fixed iqama for a weekday or date. A date override takes priority. No Friday time is assumed. Times use the selected zone and 24-hour format; only Isha may extend into the next day.')));
      draft.iqama.overrides.forEach((o,i)=>{const row=el('div','override-row');row.dataset.tvGroup=o.id;row.dataset.tvLabel='موعد الإقامة '+(i+1);row.append(select('الصلاة',o.prayer,PRAYERS.map(k=>[k,NAMES[k]]),v=>o.prayer=v),select('التكرار',o.kind,[['weekday','يوم في الأسبوع'],['date','تاريخ محدد']],v=>{o.kind=v;o.match=v==='weekday'?'5':dateKey(nowProvider());drawSettings();}));if(o.kind==='weekday')row.append(select('اليوم',o.match,WEEKDAYS.map((n,j)=>[String(j),n]),v=>o.match=v));else row.append(input('التاريخ',o.match,'date',v=>o.match=v));row.append(input('الإقامة 24 ساعة',o.time,'time',v=>o.time=v),input('وصف مثل ترتيب الجمعة',o.label,'text',v=>o.label=v,{maxLength:80}),button('حذف',()=>{draft.iqama.overrides.splice(i,1);drawSettings();}));s.append(row);});
      s.append(button('إضافة موعد إقامة ثابت',()=>{if(draft.iqama.overrides.length>=80)return message('الحد الأقصى ثمانون موعدًا.',true);draft.iqama.overrides.push({id:'override-'+Date.now(),kind:'weekday',match:'5',prayer:'dhuhr',time:'',label:''});drawSettings();}));
    }},
    {id:'display', title:'العرض والأرقام', render(s){
      s.append(input('فاصل الشرائح (ثانية)',draft.slideSeconds,'number',v=>draft.slideSeconds=v,{min:5,max:300,step:1}),select('نمط الأرقام',draft.digitStyle,[['western','0123456789 — أرقام غربية'],['arabic','٠١٢٣٤٥٦٧٨٩ — أرقام عربية']],v=>draft.digitStyle=v));
      s.append(input('تنبيه إغلاق الجوالات',draft.silentPhoneReminder,'checkbox',v=>draft.silentPhoneReminder=v),
        select('مدة عرض أذكار ما بعد الصلاة',String(draft.postPrayerMinutes),
          POST_PRAYER_MINUTES.map(minutes=>[String(minutes),minutes?minutes+' دقائق':'إيقاف']),
          value=>draft.postPrayerMinutes=Number(value)));
    }},
    {id:'donation', title:'بطاقة التبرع', render(s){
      s.append(input('إظهار بطاقة التبرع',draft.donation.visible,'checkbox',v=>draft.donation.visible=v),input('عنوان مشروع التبرع',draft.donation.title,'text',v=>draft.donation.title=v,{maxLength:90}),input('وصف مختصر للمشروع',draft.donation.description,'text',v=>draft.donation.description=v,{maxLength:180}),el('p','notice','تظهر البطاقة ثابتة بجوار الأذكار، وتختفي أثناء وضع الصلاة. إخفاؤها يحفظ النصوص. رمز التبرع هو الصورة المحلية المرفقة؛ تعديل النص لا يغير وجهة الرمز.'));
    }},
    {id:'data', title:'المواقيت والتقويم', render(s){
      s.append(button(tr('إعداد الموقع واللغة والتقويم','Set up location, language and calendar'),()=>{closeSettings(true);if(window.MosqueControl?.isOpen())window.MosqueControl.close({restoreFocus:false});window.MosqueSetup?.open({required:setupPending});}));
      KEYS.forEach(k=>s.append(input(tr('تعديل وقت '+NAMES[k]+' (دقيقة)','Adjust '+prayerName(k)+' (minutes)'),draft.adhanAdjustments?.[k]||0,'number',v=>{draft.adhanAdjustments=draft.adhanAdjustments||{};draft.adhanAdjustments[k]=v;},{min:-120,max:120,step:1})));
      s.append(el('p','notice',database?tr('المصدر: ','Source: ')+database.metadata.source+tr(' | السنوات: ',' | Years: ')+database.metadata.displayYears.join(', ')+tr(' | الحالة: ',' | Status: ')+(database.metadata.verificationStatus==='calculated-needs-review'?tr('مواقيت محسوبة — تحتاج مراجعة','Calculated times — local review required'):tr('جدول مستورد — يحتاج مراجعة مصدره','Imported timetable — review its provenance')):tr('تعذر تحميل المواقيت: ','Could not load prayer times: ')+databaseError));
      s.append(input('خط العرض للمراجعة وإعادة التوليد',draft.location.latitude,'number',v=>draft.location.latitude=v,{step:'0.0001'}),input('خط الطول للمراجعة وإعادة التوليد',draft.location.longitude,'number',v=>draft.location.longitude=v,{step:'0.0001'}),el('p','notice','تغيير الإحداثيات لا يعيد حساب الجدول داخل المتصفح. أعد توليده بأداة التطوير ثم استورد الملف الناتج؛ يظل مصدر الجدول وإحداثياته الأصلية محفوظين.'));
      s.append(button('استيراد جدول مواقيت JSON',()=>$('timetableFile').click()),button('تصدير جدول المواقيت',exportTimetable));
      const daysLeft=database?Math.floor((timestamp(database.metadata.displayYears[1]+'-12-31','23:59')-nowProvider())/DAY):0;
      if(daysLeft<90)s.append(el('p','error',daysLeft<0?'انتهت تغطية المواقيت؛ استورد جدولًا جديدًا.':'تنتهي تغطية المواقيت خلال '+daysLeft+' يومًا؛ جهّز جدول السنة الجديدة.'));
      s.append(el('p','notice',tr('تقويم أم القرى مدني ويتغير عند منتصف الليل. المنطقة الزمنية: ','Umm al-Qura civil dates change at midnight. Time zone: ')+ZONE+tr('. التغطية المحلية: ','. Local coverage: ')+calendar.rangeStart+' — '+calendar.rangeEnd));
    }},
    {id:'backup', title:'الحفظ والتشغيل', render(s){
      s.append(el('p','notice',storageNote||'التخزين المحلي متاح لهذه الجلسة. يُنصح بتصدير نسخة احتياطية.'));
      s.append(el('p','notice','قد يختلف حفظ الإعدادات تحت file:// باختلاف المتصفح. نقل الملف أو تغيير اسمه قد يغيّر مساحة التخزين. ملف JSON المصدّر هو النسخة الاحتياطية القابلة للنقل. لا يُكتب ملف index.html من المتصفح.'));
      s.append(el('p','notice','الإعدادات: Ctrl + , أو زر الإعدادات. ملء الشاشة من الزر أو F11 في المتصفحات الداعمة. للخروج الاضطراري من السواد: Ctrl + Alt + M؛ يخص التجاوز فترة الصلاة الحالية فقط. اضبط ساعة الجهاز وأوقف السكون وشاشة التوقف من إعدادات النظام. لا يستطيع التطبيق غير المتصل مزامنة الساعة.'));
    }}
  ];
  function settingsSection(page){
    const source=el('section','settings-section');
    source.append(el('h3',null,page.title));
    page.render(source);
    return source;
  }
  // TV_SETTINGS_UI_START — presentation only; the existing validated draft owns all mosque data.
  const tvMode=Boolean(window.MosqueAndroid);
  let tvSections=[],tvSectionId='mosque',tvPane='menu',tvEditor=null,tvLastFocus='',tvScroll={},tvControlOrigin=false,tvNativeRefreshPending=false;
  function tvKey(text){let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return(hash>>>0).toString(36);}
  function tvKeepSelectedMenuVisible(){const selected=$('tv-section-'+tvSectionId);if(selected&&selected.scrollIntoView)selected.scrollIntoView({block:'nearest',inline:'nearest'});}
  function tvFocus(id){const node=$(id);if(!node||node.disabled)return;try{node.focus({preventScroll:true});}catch(_){node.focus();}if(node.scrollIntoView)node.scrollIntoView({block:'nearest',inline:'nearest'});tvLastFocus=id;if(id.startsWith('tv-row-'))tvKeepSelectedMenuVisible();}
  function tvValue(row){const value=typeof row.value==='function'?row.value():row.value;return value===undefined||value===null?'':value;}
  function tvSummary(row){const value=tvValue(row);if(row.kind==='checkbox')return value?'نعم':'لا';if(row.kind==='select'){const choice=(row.options||[]).find(item=>String(item[0])===String(value));return choice?choice[1]:String(value);}return String(value).trim()||'غير محدد';}
  function tvLegacySection(page){
    const source=settingsSection(page);
    const section={id:page.id,title:page.title,help:Array.from(source.querySelectorAll('.notice,.error')).map(node=>node.textContent).join('\n'),rows:[]},seen=new Map();
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
  }
  function tvRenderHub(preferredFocus){
    const oldList=$('tvSettingsRows');if(oldList)tvScroll[tvSectionId]=oldList.scrollTop;
    const current=tvSections.find(section=>section.id===tvSectionId)||tvSections[0];if(!current)return;tvSectionId=current.id;
    const hub=el('div','tv-hub tv-pane-'+tvPane);hub.id='tvSettingsHub';
    const back=button(tvPane==='menu'?'‹ مركز التحكم':'‹ كل الإعدادات',tvHandleBack);back.id='tvSettingsBack';back.className='tv-settings-back';hub.append(back);
    if(tvPane==='menu'){
      const menu=el('nav','tv-settings-menu');menu.setAttribute('aria-label','أقسام الإعدادات');
      tvSections.forEach(section=>{const b=button(section.title,()=>{tvSectionId=section.id;tvPane='rows';drawSettings();tvFocus($('tvSettingsRows')?.querySelector('button:not([disabled])')?.id);});b.id='tv-section-'+section.id;b.className='tv-menu-item';b.classList.toggle('selected',section.id===tvSectionId);b.dataset.tvZone='menu';menu.append(b);});
      hub.append(menu);
    }else{
      const pane=el('section','tv-settings-pane');pane.append(el('h3','tv-section-heading',current.title));
      if(current.help)pane.append(el('p','tv-section-help',current.help));
      const list=el('div','tv-settings-rows');list.id='tvSettingsRows';
      current.rows.forEach(row=>{
        const b=button('',()=>{tvLastFocus=b.id;if(row.kind==='action'){try{row.action();if(settingsOpen&&!tvEditor)drawSettings();}catch(error){message(error.message,true);}}else if(row.kind!=='info')tvOpenEditor(row);});
        b.id='tv-row-'+row.id;b.className='tv-setting-row';b.dataset.tvZone='rows';b.dataset.tvKind=row.kind;b.disabled=Boolean(row.disabled)||row.kind==='info';
        const copy=el('span','tv-row-copy');copy.append(el('span','tv-row-label',row.label));if(row.help)copy.append(el('span','tv-row-help',row.help));b.append(copy,el('span','tv-row-value',tvSummary(row)));list.append(b);
      });
      pane.append(list);hub.append(pane);
    }
    $('settingsBody').replaceChildren(hub);
    const visibleRows=$('tvSettingsRows');if(visibleRows)visibleRows.scrollTop=tvScroll[tvSectionId]||0;
    if(preferredFocus&&$(preferredFocus))tvFocus(preferredFocus);
    tvKeepSelectedMenuVisible();
  }
  function drawSettings(){
    tvNativeRefreshPending=false;
    const preferred=tvMode?(document.activeElement?.id||tvLastFocus):'';
    if(tvMode&&$('tvSettingsRows'))tvScroll[tvSectionId]=$('tvSettingsRows').scrollTop;
    if(!tvMode){$('settingsBody').replaceChildren(...settingsPages.map(settingsSection));return;}
    tvSections=settingsPages.map(page=>({id:page.id,title:page.title,rows:[]}));
    const selectedPage=settingsPages.find(page=>page.id===tvSectionId);
    if(window.MosqueTVNative&&typeof window.MosqueTVNative.getSections==='function'){
      try{tvSections.push(...window.MosqueTVNative.getSections(tvPane==='menu'||Boolean(selectedPage)));}
      catch(_){message('تعذر قراءة بعض خيارات التلفاز؛ تبقى إعدادات الجامع متاحة.',true);}
    }
    if(tvPane==='rows'){
      const page=selectedPage||(!tvSections.some(item=>item.id===tvSectionId)&&settingsPages[0]);
      if(page)tvSections[settingsPages.indexOf(page)]=tvLegacySection(page);
    }
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
    try{
      if(commit)row.commit(value);
      // Display choices have no dependent rows. Keep the same controls, focus and scroll.
      if(tvNativeRefreshPending||(commit&&tvSectionId!=='display'))drawSettings();
      else if(commit){
        const valueNode=$('tv-row-'+row.id)?.querySelector('.tv-row-value');
        if(valueNode)valueNode.textContent=tvSummary(row);
      }
      tvFocus('tv-row-'+row.id);
    }catch(error){message(error.message,true);}
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
    const actions=el('div','tv-editor-actions'),confirm=button('تأكيد',()=>tvCloseEditor(true)),cancel=button('إلغاء التعديل',()=>tvCloseEditor(false));confirm.id='tvEditorConfirm';cancel.id='tvEditorCancel';actions.append(confirm,cancel);card.append(actions);panel.append(card);$('settingsForm').append(panel);
    // Native focus scrolls the selected choice into view, including long choice lists.
    // A second explicit scroll here also lays out the settings behind the editor.
    $(initial).focus();tvLastFocus=initial;
  }
  function tvMove(nodes,delta){const items=Array.from(nodes).filter(node=>!node.disabled&&!node.hidden);if(!items.length)return;const index=items.indexOf(document.activeElement);tvFocus(items[Math.max(0,Math.min(items.length-1,index<0?0:index+delta))].id);}
  function tvHandleBack(){
    if(!settingsOpen)return false;
    if(tvEditor){tvCloseEditor(false);return true;}
    if($('settingsDialog').classList.contains('previewing')){$('settingsDialog').classList.remove('previewing');$('previewButton').textContent='معاينة';drawSettings();tvFocus(tvLastFocus||'tv-section-'+tvSectionId);return true;}
    if(tvPane!=='menu'){tvPane='menu';tvRenderHub();tvFocus('tv-section-'+tvSectionId);return true;}
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
    if(footer){if(key==='ArrowUp')tvFocus(tvPane==='menu'?'tv-section-'+tvSectionId:$('tvSettingsRows')?.querySelector('button:not([disabled])')?.id||'tvSettingsBack');else if(key!=='ArrowDown')tvMove($('settingsDialog').querySelectorAll('.settings-actions button'),key==='ArrowLeft'?1:-1);return;}
    if(active?.id==='tvSettingsBack'){if(key==='ArrowDown')tvFocus(tvPane==='menu'?'tv-section-'+tvSectionId:$('tvSettingsRows')?.querySelector('button:not([disabled])')?.id||'saveButton');return;}
    if(tvPane==='menu'){
      const items=Array.from($('settingsBody').querySelectorAll('.tv-menu-item'));
      if(key==='ArrowLeft'){const focusedSection=tvSections.find(section=>'tv-section-'+section.id===active?.id);if(focusedSection)tvSectionId=focusedSection.id;tvPane='rows';drawSettings();tvFocus($('tvSettingsRows')?.querySelector('button:not([disabled])')?.id||'tvSettingsBack');}
      else if(key==='ArrowUp'&&items.indexOf(active)===0)tvFocus('tvSettingsBack');
      else if(key==='ArrowDown'&&items.indexOf(active)===items.length-1)tvFocus('saveButton');
      else if(key==='ArrowUp'||key==='ArrowDown')tvMove(items,key==='ArrowUp'?-1:1);return;
    }
    if(key==='ArrowRight'){tvPane='menu';tvRenderHub();tvFocus('tv-section-'+tvSectionId);return;}
    const rows=Array.from($('tvSettingsRows').querySelectorAll('button:not([disabled])'));if(key==='ArrowDown'&&rows.indexOf(active)===rows.length-1){tvFocus('saveButton');return;}tvMove(rows,key==='ArrowUp'?-1:1);
  }
  if(tvMode){
    document.addEventListener('keydown',tvHandleKey,true);
    document.addEventListener('focusin',event=>{if(event.target?.id?.startsWith('tv-row-')){tvLastFocus=event.target.id;tvPane='rows';}});
    window.MosqueTV={isOpen:()=>settingsOpen,handleBack:tvHandleBack,toggleSettings:()=>settingsOpen?closeSettings(true):openSettings(),openSection:id=>openSettings(id,true),refreshNative:()=>{if(settingsOpen){if(tvEditor)tvNativeRefreshPending=true;else drawSettings();}},getUIState:()=>({section:tvSectionId,pane:tvPane,editing:tvEditor?tvEditor.row.id:null,focus:document.activeElement?.id||''})};
  }
  // TV_SETTINGS_UI_END
  function openSettings(section,fromControl){if(state?.phase==='PRAYER_MODE')return;if(settingsOpen)return;tvControlOrigin=Boolean(fromControl);if(typeof section==='string')tvSectionId=section;draft=clone(savedSettings);settingsOpen=true;document.body.classList.add('settings-open');tvPane=fromControl&&section!=='mosque'?'rows':'menu';$('settingsDialog').classList.remove('previewing');$('previewButton').textContent='معاينة';drawSettings();message('التغييرات مسودة؛ احفظها للاعتماد أو ارجع لإلغائها.');$('settingsDialog').showModal();if(tvMode)tvFocus(tvPane==='menu'?'tv-section-'+tvSectionId:$('tvSettingsRows')?.querySelector('button:not([disabled])')?.id||'tvSettingsBack');interaction();}
  function closeSettings(cancel){
    const restorePreview=previewApplied;
    previewApplied=false;tvEditor=null;$('tvEditor')?.remove();settingsOpen=false;
    document.body.classList.remove('settings-open');draft=null;$('settingsDialog').close();
    if(tvMode){tvSections=[];$('settingsBody').replaceChildren();}
    $('settingsDialog').classList.remove('previewing');$('previewButton').textContent='معاينة';
    if(window.MosqueTVNative?.onClose)window.MosqueTVNative.onClose();
    if(cancel){try{if(restorePreview)useSettings(savedSettings);else tick();}catch(error){message(error.message,true);}}
    if(tvMode&&state?.phase!=='PRAYER_MODE'){if(tvControlOrigin&&window.MosqueControl)window.MosqueControl.open();else tvFocus('settingsButton');}
    tvControlOrigin=false;interaction();
  }
  function launchControls(){if(window.MosqueSetup?.isOpen())return;if(setupPending&&window.MosqueSetup){window.MosqueSetup.open({required:true});return;}if(tvMode&&window.MosqueControl){if(settingsOpen){closeSettings(true);return;}if(window.MosqueControl.isOpen())window.MosqueControl.close();else window.MosqueControl.open();}else openSettings();}
  function download(name,value){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportTimetable(){if(database)download('mosque-prayer-timetable.json',{metadata:database.metadata,records:database.records});}
  let importGeneration=0;
  function readFile(file,onload){
    if(!settingsOpen || !file)return;
    const generation=++importGeneration, session=draft;
    const current=()=>settingsOpen && draft===session && generation===importGeneration && state?.phase!=='PRAYER_MODE';
    if(file.size>3000000)return message('الملف أكبر من الحد المسموح (3 ميغابايت).',true);
    const reader=new FileReader();
    reader.onload=()=>{
      if(!current())return;
      try{onload(JSON.parse(reader.result));}
      catch(error){message('لم يُطبّق الملف: '+error.message,true);}
    };
    reader.onerror=()=>{if(current())message('تعذرت قراءة الملف المحلي.',true);};
    reader.readAsText(file,'UTF-8');
  }
  $('settingsButton').addEventListener('click',launchControls);
  $('previewButton').addEventListener('click',()=>{try{if(tvMode&&$('settingsDialog').classList.contains('previewing')){$('settingsDialog').classList.remove('previewing');$('previewButton').textContent='معاينة';drawSettings();tvFocus('tv-section-'+tvSectionId);return;}useSettings(draft);message('المعاينة مطبّقة مؤقتًا. احفظ للاعتماد أو ألغِ للرجوع.');$('settingsDialog').classList.add('previewing');if(tvMode){$('previewButton').textContent='العودة للإعدادات';tvFocus('previewButton');}}catch(error){message(error.message,true);}});
  $('saveButton').addEventListener('click',()=>{try{
    // Commit the validated draft before rendering: saving may itself enter prayer mode.
    const candidate=validateSettings(draft),nextEvents=database?buildEvents(database,candidate):[];
    const result=persistCurrent(candidate,database);if(!result.ok)throw Error(tr('تعذر الحفظ محليًا؛ لم تُعتمد المسودة. صدّر نسخة احتياطية وحاول مجددًا.','Could not save locally. The draft remains unsaved; export a backup and try again.'));
    savedSettings=clone(candidate);closeSettings(false);applySettings(candidate,nextEvents);
  }catch(error){message(error.message,true);}});
  $('cancelButton').addEventListener('click',()=>closeSettings(true));
  $('settingsDialog').addEventListener('cancel',e=>{e.preventDefault();if(tvMode)tvHandleBack();else closeSettings(true);});
  $('settingsForm').addEventListener('submit',e=>e.preventDefault());
  $('defaultsButton').addEventListener('click',()=>{if(window.confirm(tr('استعادة الإعدادات الأصلية في المسودة؟ لن تُحفظ إلا بعد اختيار حفظ.','Reset the draft? Changes will apply only after saving.'))){draft=clone(defaults);if(activeProfile){draft.mosque.fields.name=clone(savedSettings.mosque.fields.name);draft.mosque.fields.address=clone(savedSettings.mosque.fields.address);draft.location={latitude:activeProfile.latitude,longitude:activeProfile.longitude};draft.donation.visible=false;}drawSettings();message(tr('استُعيدت القيم الأصلية في المسودة.','Default values restored in the draft.'));}});
  $('exportSettingsButton').addEventListener('click',()=>{try{download('mosque-settings.json',validateSettings(draft));message('صُدّرت المسودة الحالية. لم تتغير الإعدادات المحفوظة.');}catch(error){message(error.message,true);}});
  $('importSettingsButton').addEventListener('click',()=>$('settingsFile').click());
  $('settingsFile').addEventListener('change',e=>{readFile(e.target.files[0],value=>{const candidate=validateSettings(value);if(database)buildEvents(database,candidate);draft=candidate;drawSettings();message('استُوردت الإعدادات في المسودة. عاينها ثم احفظها.');});e.target.value='';});
  $('timetableFile').addEventListener('change',e=>{readFile(e.target.files[0],value=>{const next=validateTimetable(value),nextEvents=buildEvents(next,currentSettings);buildEvents(next,savedSettings);let result;if(installation){result=persistCurrent(savedSettings,next);if(!result.ok)fail('Could not save the imported timetable; the previous table is retained.');}else result=storage?safeWrite(storage,TABLE_STORE,JSON.stringify(value)):{ok:false};database=next;events=nextEvents;if(!result.ok)storageNote='جدول المواقيت المستورد متاح لهذه الجلسة فقط؛ احتفظ بملفه وأعد استيراده بعد التشغيل.';refresh();if(settingsOpen){drawSettings();message('تم التحقق من الجدول واستيراده. '+(result.ok?'حُفظ محليًا.':'تعذر حفظه محليًا؛ احتفظ بالملف.'),!result.ok);}});e.target.value='';});
  if($('importTimetableButton'))$('importTimetableButton').addEventListener('click',()=>$('timetableFile').click());
  if($('exportTimetableButton'))$('exportTimetableButton').addEventListener('click',exportTimetable);
  $('fullscreenButton').addEventListener('click',async()=>{const ok=await attemptFullscreen(document.documentElement);if(!ok){openSettings();message('تعذر ملء الشاشة. جرّب F11 على Windows أو اختصار ملء الشاشة الخاص بالمتصفح.',true);}});
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey&&e.altKey&&e.code==='KeyM'){e.preventDefault();if(state?.phase==='PRAYER_MODE'){suppressedId=state.active.id;tick();}return;}
    if(e.ctrlKey&&e.code==='Comma'){e.preventDefault();launchControls();}
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
    if(acceptanceFixture && parent!==window){
      const runner=document.createElement('script');
      runner.src='dev/acceptance.js';
      // The offline harness gets only the status of checks against bundled fixtures.
      const target=location.protocol==='file:'?'*':location.origin;
      const finish=report=>parent.postMessage({type:'mosque-acceptance-complete',report},target);
      runner.onload=async()=>{
        try{
          const report=await window.runMosqueAcceptance((method,...args)=>api[method](...args),key=>api[key]);
          finish(report);
        }catch(_){finish(null);}
      };
      runner.onerror=()=>finish(null);
      document.head.appendChild(runner);
    }
  }
})();
