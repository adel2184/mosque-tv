/* Optional development automation. The delivered index.html and test.html need no Node. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createHash}=require('node:crypto');
const root = path.resolve(__dirname, '..');
const candidates = [process.env.MOSQUE_PLAYWRIGHT_PATH, 'playwright-core', 'C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core'].filter(Boolean);
let playwright;
for (const candidate of candidates) { try { playwright=require(candidate); break; } catch (_) {} }
if (!playwright) { console.error('Development automation requires an existing playwright-core package. Set MOSQUE_PLAYWRIGHT_PATH, or double-click test.html for the dependency-free local harness.'); process.exit(1); }
const browsers = [
  {name:'Chrome', executablePath:process.env.MOSQUE_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'},
  {name:'Edge', executablePath:process.env.MOSQUE_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}
].filter(browser => fs.existsSync(browser.executablePath));
const output = path.join(root,'qa');fs.mkdirSync(output,{recursive:true});
// The historical dashboard tests use a pre-wizard installation. Explicitly seed its
// settings once, leaving reloads, imports and the separate clean-install check genuine.
async function seedLegacySettings(context) {
  const legacy=JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8'));
  delete legacy.silentPhoneReminder;
  delete legacy.postPrayerMinutes;
  await context.addInitScript(settings=>{
    if(location.protocol==='file:'&&localStorage.getItem('mosque-display.settings.v1')===null) {
      localStorage.setItem('mosque-display.settings.v1',JSON.stringify(settings));
    }
  },legacy);
}
async function run(browserConfig) {
  const browser = await playwright.chromium.launch({executablePath:browserConfig.executablePath,headless:true});
  const context = await browser.newContext({viewport:{width:1920,height:1080},locale:'ar-SA',timezoneId:'America/New_York',serviceWorkers:'block',reducedMotion:'reduce'});
  await context.setOffline(true);
  await seedLegacySettings(context);
  const page = await context.newPage();
  const errors=[],network=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/i.test(request.url()))network.push(request.url());});
  const checks=[];
  async function check(name,fn){try{const details=await fn();checks.push({name,pass:true,details});}catch(error){checks.push({name,pass:false,error:error.message});}}
  function assert(value,message){if(!value)throw new Error(message);}
  const url=pathToFileURL(path.join(root,'index.html')).href;
  await page.goto(url+'?test=1');
  await page.waitForFunction(()=>window.MosqueApp);
  await page.evaluate(()=>{MosqueApp.setNow(()=>Date.parse('2026-11-16T09:15:00+03:00'));MosqueApp.tick();});
  await page.addScriptTag({path:path.join(__dirname,'acceptance.js')});
  let core;
  try { core=await page.evaluate(()=>runMosqueAcceptance((method,...args)=>window.MosqueApp[method](...args),property=>window.MosqueApp[property])); }
  catch(error){core={total:1,passed:0,failed:1,results:[{name:'تهيئة مجموعة الاختبارات',pass:false,error:error.message}]};}
  await check('إطلاق file:// بإعدادات تثبيت سابق وشبكة معطلة دون طلبات HTTP(S)',async()=>{assert(network.length===0,network.join('\n'));assert(errors.length===0,errors.join('\n'));return{networkRequests:network.length,pageErrors:errors.length};});
  await check('الشاشة 1920×1080 بلا تمرير أو خروج للوحة',async()=>{
    const layout=await page.evaluate(()=>{const stage=document.getElementById('stage').getBoundingClientRect();return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,stage:{left:stage.left,top:stage.top,right:stage.right,bottom:stage.bottom},rows:document.querySelectorAll('#prayerRows tr').length};});
    assert(layout.documentWidth<=1920&&layout.documentHeight<=1080,JSON.stringify(layout));assert(layout.rows===6,'يجب عرض ستة صفوف');assert(layout.stage.right<=1921&&layout.stage.bottom<=1081,JSON.stringify(layout));return layout;
  });
  await check('التخزين المحظور والممتلئ لا يرميان استثناء',async()=>{
    const result=await page.evaluate(()=>{const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('full');}};return{read:MosqueApp.safeRead(blocked,'a'),write:MosqueApp.safeWrite(blocked,'a','b')};});
    assert(!result.read.ok&&!result.write.ok,JSON.stringify(result));return result;
  });
  await check('رفض ملء الشاشة وعدم توفره يعيدان نتيجة آمنة',async()=>{
    const result=await page.evaluate(async()=>({rejected:await MosqueApp.attemptFullscreen({requestFullscreen:()=>Promise.reject(new Error('denied'))}),missing:await MosqueApp.attemptFullscreen({})}));
    assert(result.rejected===false&&result.missing===false,JSON.stringify(result));return result;
  });
  await check('مزود الساعة: بدء التطبيق في الصلاة واستئنافه عند نهايتها',async()=>{
    const result=await page.evaluate(()=>{const db=MosqueApp.validateTimetable(MosqueApp.database);const events=MosqueApp.buildEvents(db,MosqueApp.defaults);const event=events.find(e=>e.date==='2026-11-16');MosqueApp.setNow(()=>event.iqama+6*60000);MosqueApp.tick();const during={phase:MosqueApp.getState().phase,hidden:document.getElementById('prayerOverlay').hidden};MosqueApp.setNow(()=>event.end);MosqueApp.tick();const after={phase:MosqueApp.getState().phase,hidden:document.getElementById('prayerOverlay').hidden};MosqueApp.resetNow();MosqueApp.tick();return{during,after};});
    assert(result.during.phase==='PRAYER_MODE'&&!result.during.hidden,JSON.stringify(result));assert(result.after.phase!=='PRAYER_MODE'&&result.after.hidden,JSON.stringify(result));return result;
  });
  await check('تناسق الرياض مع جهاز مضبوط على طوكيو',async()=>{
    const baseline=await page.evaluate(()=>({key:MosqueApp.dateKey(Date.parse('2026-11-15T21:00:00Z')),clock:MosqueApp.formatClock(Date.parse('2026-11-15T21:00:00Z'),'western'),events:MosqueApp.buildEvents(MosqueApp.validateTimetable(MosqueApp.database),MosqueApp.defaults).filter(e=>e.date==='2026-11-16')}));
    const otherContext=await browser.newContext({viewport:{width:1920,height:1080},timezoneId:'Asia/Tokyo',locale:'ar-SA'});await otherContext.setOffline(true);await seedLegacySettings(otherContext);const other=await otherContext.newPage();await other.goto(url+'?test=1');await other.waitForFunction(()=>window.MosqueApp);const compared=await other.evaluate(()=>({key:MosqueApp.dateKey(Date.parse('2026-11-15T21:00:00Z')),clock:MosqueApp.formatClock(Date.parse('2026-11-15T21:00:00Z'),'western'),events:MosqueApp.buildEvents(MosqueApp.validateTimetable(MosqueApp.database),MosqueApp.defaults).filter(e=>e.date==='2026-11-16')}));await otherContext.close();assert(JSON.stringify(baseline)===JSON.stringify(compared),'اختلفت نتيجة الرياض بين منطقتي الجهاز');return{hostTimezones:['America/New_York','Asia/Tokyo'],identical:true};
  });
  const openSettings=async()=>{await page.evaluate(()=>{document.body.classList.remove('idle');MosqueApp.setNow(()=>Date.parse('2026-11-16T09:15:00+03:00'));MosqueApp.tick();});await page.click('#settingsButton');};
  await check('معاينة الاسم والعنوان الطويلين ثم الإلغاء دون قص النص',async()=>{
    await openSettings();
    const name=('جامع لطيفة الخالدي ضاحية الملك فهد ').repeat(6).slice(0,180);
    const address=('ضاحية الملك فهد، الدمام، ').repeat(20).slice(0,360);
    await page.getByLabel('اسم الجامع',{exact:true}).fill(name);await page.getByLabel('العنوان',{exact:true}).fill(address);await page.click('#previewButton');
    const result=await page.evaluate(()=>{const host=document.getElementById('mosqueInfo');const bounds=host.getBoundingClientRect();return{text:host.textContent,scrollHeight:host.scrollHeight,clientHeight:host.clientHeight,nameSize:getComputedStyle(host.querySelector('h1')).fontSize,detailsSize:getComputedStyle(host.querySelector('.mosque-details')).fontSize,childrenWithin:[...host.children].every(child=>child.getBoundingClientRect().bottom<=bounds.bottom+1)};});
    await page.screenshot({path:path.join(output,browserConfig.name.toLowerCase()+'-long-header.png')});
    await page.click('#cancelButton');
    assert(result.text.includes(name)&&result.text.includes(address),'فُقد جزء من النص');assert(result.scrollHeight<=result.clientHeight+1&&result.childrenWithin,JSON.stringify(result));
    assert(await page.evaluate(()=>MosqueApp.getSettings().mosque.fields.name.value===MosqueApp.defaults.mosque.fields.name.value),'لم يُلغَ التعديل');return result;
  });
  await check('أقصى نصوص الحقول الاختيارية والثمانية المخصصة تتكيف داخل الترويسة',async()=>{
    const result=await page.evaluate(()=>{const candidate=JSON.parse(JSON.stringify(MosqueApp.defaults));for(const [key,field]of Object.entries(candidate.mosque.fields)){field.visible=true;field.value=('نص عربي للمراجعة والاختبار ').repeat(30).slice(0,key==='name'?180:360);}candidate.mosque.custom=Array.from({length:8},(_,i)=>({id:'max-'+i,label:'عنوان '+i,value:('معلومة إضافية للاختبار ').repeat(20).slice(0,240),visible:true}));MosqueApp.useSettings(candidate);const host=document.getElementById('mosqueInfo');return{textLength:host.textContent.length,scrollHeight:host.scrollHeight,clientHeight:host.clientHeight,nameSize:getComputedStyle(host.querySelector('h1')).fontSize,detailsSize:getComputedStyle(host.querySelector('.mosque-details')).fontSize};});await page.screenshot({path:path.join(output,browserConfig.name.toLowerCase()+'-maximum-information.png')});await page.evaluate(()=>MosqueApp.useSettings(MosqueApp.defaults));assert(result.scrollHeight<=result.clientHeight+1,JSON.stringify(result));return result;
  });
  await check('حفظ الإعدادات وإعادة التحميل وتصدير JSON والنص المستورد لا ينفذ HTML',async()=>{
    await openSettings();const malicious='<img src=x onerror="window.__mosqueInjected=true"> اسم اختبار';await page.getByLabel('اسم الجامع',{exact:true}).fill(malicious);await page.click('#saveButton');
    const rendered=await page.evaluate(()=>({text:document.getElementById('mosqueInfo').textContent,images:document.querySelectorAll('#mosqueInfo img').length,injected:!!window.__mosqueInjected}));
    assert(rendered.text.includes(malicious)&&rendered.images===0&&!rendered.injected,JSON.stringify(rendered));
    await page.reload();await page.waitForFunction(()=>window.MosqueApp);assert(await page.evaluate(()=>MosqueApp.getSettings().mosque.fields.name.value.includes('<img')),'لم يستمر الإعداد بعد إعادة التحميل');
    await openSettings();const downloadWait=page.waitForEvent('download');await page.click('#exportSettingsButton');const download=await downloadWait;const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert(exported.schemaVersion===1&&exported.mosque.fields.name.value===malicious,'محتوى التصدير لا يطابق المسودة');await page.click('#cancelButton');
    return{literalHTML:true,executed:false,persistedAfterReload:true,exportedSchema:exported.schemaVersion};
  });
  await check('إظهار وإخفاء كل حقل والقسم كاملًا مع بقاء القيم',async()=>{
    await openSettings();const fields=page.getByLabel('إظهار / إخفاء',{exact:true});for(let i=0;i<await fields.count();i++)await fields.nth(i).uncheck();await page.click('#saveButton');
    assert(await page.evaluate(()=>document.getElementById('mosqueInfo').textContent.trim()===''),'تركت الحقول المخفية نصًا أو فواصل');
    assert(await page.evaluate(()=>MosqueApp.getSettings().mosque.fields.name.value.includes('<img')),'فُقدت قيمة الحقل المخفي');
    await openSettings();await page.getByLabel('إظهار قسم بيانات الجامع كاملًا',{exact:true}).uncheck();await page.click('#saveButton');
    const hidden=await page.evaluate(()=>({hidden:document.getElementById('mosqueInfo').hidden,reflow:document.getElementById('stage').classList.contains('info-hidden')}));assert(hidden.hidden&&hidden.reflow,JSON.stringify(hidden));
    await openSettings();const payload=await page.evaluate(()=>MosqueApp.defaults);payload.mosque.fields.name.value='اسم مستورد للاختبار';await page.locator('#settingsFile').setInputFiles({name:'settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});await page.waitForFunction(()=>document.getElementById('settingsMessage').textContent.includes('استُوردت'));assert(await page.getByLabel('اسم الجامع',{exact:true}).inputValue()==='اسم مستورد للاختبار','لم تُحمّل المسودة المستوردة');await page.click('#saveButton');
    assert(await page.evaluate(()=>!document.getElementById('mosqueInfo').hidden&&document.getElementById('mosqueInfo').textContent.includes('اسم مستورد للاختبار')),'لم يظهر القسم بعد الاستيراد');return{individualFields:6,hiddenValuesPreserved:true,masterReflow:true,importApplied:true};
  });
  await check('رفض JSON المشوه والمخطط الخاطئ قبل تطبيقهما',async()=>{
    await openSettings();
    for(const content of ['{not-json',JSON.stringify({schemaVersion:999}),JSON.stringify({schemaVersion:1,mosque:'invalid'})]){
      await page.locator('#settingsFile').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(content)});await page.waitForFunction(()=>document.getElementById('settingsMessage').textContent.includes('لم يُطبّق'));
    }
    await page.click('#cancelButton');assert(await page.evaluate(()=>MosqueApp.getSettings().mosque.fields.name.value==='اسم مستورد للاختبار'),'غيّر الاستيراد المرفوض الإعدادات');return{invalidImportsRejected:3};
  });
  await check('الحقول المخصصة: إضافة وتحرير وترتيب وحذف',async()=>{
    await openSettings();await page.getByRole('button',{name:'إضافة حقل نصي',exact:true}).click();let row=page.locator('.custom-row').first();await row.getByLabel('عنوان اختياري',{exact:true}).fill('الأول');await row.getByLabel('نص إضافي',{exact:true}).fill('نص الحقل الأول');await page.getByRole('button',{name:'إضافة حقل نصي',exact:true}).click();row=page.locator('.custom-row').last();await row.getByLabel('عنوان اختياري',{exact:true}).fill('الثاني');await row.getByLabel('نص إضافي',{exact:true}).fill('نص الحقل الثاني');await row.getByRole('button',{name:'أعلى',exact:true}).click();await page.click('#previewButton');assert(await page.evaluate(()=>MosqueApp.getSettings().mosque.custom[0].label==='الثاني'),'لم يتغير ترتيب الحقول');await page.locator('.custom-row').last().getByRole('button',{name:'حذف',exact:true}).click();await page.click('#saveButton');assert(await page.evaluate(()=>MosqueApp.getSettings().mosque.custom.length===1),'لم يُحذف الحقل');return{added:2,reordered:true,deleted:1};
  });
  await check('بداية الصلاة تغلق الإعدادات وتغطي الشاشة بالسواد الكامل',async()=>{
    await openSettings();const result=await page.evaluate(()=>{const db=MosqueApp.validateTimetable(MosqueApp.database);const event=MosqueApp.buildEvents(db,MosqueApp.defaults).find(e=>e.date==='2026-11-16');MosqueApp.setNow(()=>event.iqama);MosqueApp.tick();const overlay=document.getElementById('prayerOverlay');const box=overlay.getBoundingClientRect();return{phase:MosqueApp.getState().phase,dialogOpen:document.getElementById('settingsDialog').open,hidden:overlay.hidden,background:getComputedStyle(overlay).backgroundColor,bounds:{left:box.left,top:box.top,width:box.width,height:box.height}};});assert(result.phase==='PRAYER_MODE'&&!result.dialogOpen&&!result.hidden&&result.background==='rgb(0, 0, 0)'&&result.bounds.width===1920&&result.bounds.height===1080,JSON.stringify(result));await page.screenshot({path:path.join(output,browserConfig.name.toLowerCase()+'-prayer-mode.png')});await page.keyboard.press('Control+Alt+m');assert(await page.evaluate(()=>document.getElementById('prayerOverlay').hidden),'لم يعمل اختصار الصيانة');await page.evaluate(()=>{const db=MosqueApp.validateTimetable(MosqueApp.database);const next=MosqueApp.buildEvents(db,MosqueApp.defaults).filter(e=>e.date==='2026-11-16')[1];MosqueApp.setNow(()=>next.iqama);MosqueApp.tick();});assert(await page.evaluate(()=>!document.getElementById('prayerOverlay').hidden),'أوقف التجاوز صلاة لاحقة');await page.evaluate(()=>{MosqueApp.setNow(()=>Date.parse('2026-11-16T09:15:00+03:00'));MosqueApp.tick();});return{...result,maintenanceShortcut:true,laterPrayerAutomatic:true};
  });
  await check('استعادة القيم الأصلية تتطلب التأكيد المحلي ثم الحفظ',async()=>{
    await openSettings();
    const savedName=await page.getByLabel('اسم الجامع',{exact:true}).inputValue();
    const confirmation=page.waitForEvent('dialog');
    const reset=page.click('#defaultsButton');
    await (await confirmation).accept();
    await reset;
    assert(await page.evaluate(()=>MosqueApp.getSettings().mosque.fields.name.value)===savedName,'حُفظت المسودة قبل اختيار حفظ');
    await page.click('#saveButton');
    const result=await page.evaluate(()=>({actual:MosqueApp.getSettings(),normalizedDefaults:MosqueApp.validateSettings(MosqueApp.defaults)}));
    require('node:assert/strict').deepStrictEqual(result.actual,result.normalizedDefaults);
    return{confirmationObserved:true,draftSavedExplicitly:true};
  });
  await check('تأكيد الإقامة يُحفظ مع بقاء تنبيهات المراجعة مخفية عن العرض العادي',async()=>{
    assert(await page.evaluate(()=>MosqueApp.getSettings().iqama.confirmed===false),'يجب أن تكون الإقامة غير مؤكدة أولًا');assert(await page.evaluate(()=>document.getElementById('displayStatus').hidden),'يجب إخفاء تنبيهات المراجعة في العرض العادي');await openSettings();await page.getByLabel('تمت مراجعة إعدادات الإقامة مع إدارة الجامع',{exact:true}).check();await page.click('#saveButton');assert(await page.evaluate(()=>MosqueApp.getSettings().iqama.confirmed===true),'لم يُحفظ تأكيد الإقامة');assert(await page.evaluate(()=>document.getElementById('displayStatus').hidden),'ظهرت تنبيهات المراجعة في العرض العادي');await openSettings();page.once('dialog',dialog=>dialog.accept());await page.click('#defaultsButton');await page.click('#saveButton');return{unconfirmedInitially:true,operatorAcknowledgmentWorks:true,normalFooterHidden:true};
  });
  await check('حفظ تعديل يبدأ وضع الصلاة يثبت المسودة قبل إغلاق الإعدادات',async()=>{
    const before=await page.evaluate(()=>{const candidate=JSON.parse(JSON.stringify(MosqueApp.defaults));candidate.iqama.offsets.dhuhr=30;MosqueApp.useSettings(candidate);const event=MosqueApp.buildEvents(MosqueApp.validateTimetable(MosqueApp.database),MosqueApp.defaults).find(e=>e.date==='2026-11-16'&&e.prayer==='dhuhr');window.__qaSaveMoment=event.iqama+30000;MosqueApp.setNow(()=>window.__qaSaveMoment);MosqueApp.tick();MosqueApp.openSettings();return MosqueApp.getState().phase;});assert(before==='WAITING_FOR_IQAMA',before);await page.click('#saveButton');const after=await page.evaluate(()=>({phase:MosqueApp.getState().phase,offset:MosqueApp.getSettings().iqama.offsets.dhuhr,stored:JSON.parse(localStorage.getItem('mosque-display.settings.v1')).iqama.offsets.dhuhr,overlay:!document.getElementById('prayerOverlay').hidden}));assert(after.phase==='PRAYER_MODE'&&after.offset===20&&after.stored===20&&after.overlay,JSON.stringify(after));await page.reload();await page.waitForFunction(()=>window.MosqueApp);const reloaded=await page.evaluate(()=>{const event=MosqueApp.buildEvents(MosqueApp.validateTimetable(MosqueApp.database),MosqueApp.defaults).find(e=>e.date==='2026-11-16'&&e.prayer==='dhuhr');MosqueApp.setNow(()=>event.iqama+30000);MosqueApp.tick();return{phase:MosqueApp.getState().phase,offset:MosqueApp.getSettings().iqama.offsets.dhuhr};});assert(reloaded.phase==='PRAYER_MODE'&&reloaded.offset===20,JSON.stringify(reloaded));await page.evaluate(()=>{MosqueApp.setNow(()=>Date.parse('2026-11-16T09:15:00+03:00'));MosqueApp.tick();});return{before,after,reloaded};
  });
  await check('نافذة المعاينة 1280×720 تتسع للوحة كاملة',async()=>{
    await page.setViewportSize({width:1280,height:720});await page.waitForFunction(()=>document.getElementById('stage').getBoundingClientRect().right<=1281);const result=await page.evaluate(()=>{const box=document.getElementById('stage').getBoundingClientRect();return{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,stage:{left:box.left,top:box.top,right:box.right,bottom:box.bottom}};});await page.screenshot({path:path.join(output,browserConfig.name.toLowerCase()+'-1280x720.png')});await page.setViewportSize({width:1920,height:1080});await page.waitForFunction(()=>document.getElementById('stage').getBoundingClientRect().right>=1919);assert(result.width===1280&&result.height===720&&result.stage.right<=1281&&result.stage.bottom<=721,JSON.stringify(result));return result;
  });
  await check('الشرائح الثماني عشرة كاملة بلا قص والصورة المحلية تُفك وتُعرض بكامل نسبتها',async()=>{
    const result=await page.evaluate(async()=>{const manifest=JSON.parse(document.getElementById('slides-data').textContent);const measurements=[];for(const slide of manifest.filter(item=>item.type==='text')){MosqueApp.setSlides([slide]);const host=document.getElementById('slideContent');const bounds=host.getBoundingClientRect();measurements.push({id:slide.id,scrollHeight:host.scrollHeight,clientHeight:host.clientHeight,childrenWithin:[...host.children].every(child=>{const box=child.getBoundingClientRect();return box.top>=bounds.top-1&&box.bottom<=bounds.bottom+1;})});}const local=manifest.find(item=>item.type==='image')||{id:'qa-local-image',type:'image',visible:true,path:'assets/announcements/etiquette.svg',caption:'صورة محلية للاختبار'};MosqueApp.setSlides([{...local,visible:true}]);const image=document.querySelector('#slideContent img');await image.decode();const decoded={width:image.naturalWidth,height:image.naturalHeight,fit:getComputedStyle(image).objectFit,source:image.src};MosqueApp.setSlides(manifest);return{measurements,decoded};});assert(result.measurements.length===18&&result.measurements.every(item=>item.scrollHeight<=item.clientHeight+1&&item.childrenWithin),JSON.stringify(result));assert(result.decoded.width>0&&result.decoded.height>0&&result.decoded.fit==='contain'&&result.decoded.source.startsWith('file:'),JSON.stringify(result.decoded));return result;
  });
  await check('الشرائح: عشرون ثانية وصفر وشريحة واحدة وصورة مفقودة أو تالفة',async()=>{
    const result=await page.evaluate(async()=>{
      const a={id:'qa-a',type:'text',visible:true,title:'شريحة اختبار أ',text:'نص اختبار محلي',reference:'اختبار فقط'};
      const b={id:'qa-b',type:'text',visible:true,title:'شريحة اختبار ب',text:'نص اختبار محلي',reference:'اختبار فقط'};
      window.__qaNow=Date.parse('2026-11-16T09:15:00+03:00');MosqueApp.setNow(()=>window.__qaNow);MosqueApp.setSlides([a,b]);MosqueApp.tick();
      window.__qaNow+=19999;MosqueApp.tick();const before=MosqueApp.getSlidesState().index;window.__qaNow+=1;MosqueApp.tick();const exact=MosqueApp.getSlidesState().index;
      MosqueApp.setSlides([]);MosqueApp.tick();const empty={count:MosqueApp.getSlidesState().count,text:document.getElementById('slideContent').textContent};
      MosqueApp.setSlides([a]);MosqueApp.tick();window.__qaNow+=40000;MosqueApp.tick();const single=MosqueApp.getSlidesState();
      MosqueApp.setSlides([{id:'qa-missing',type:'image',visible:true,path:'assets/announcements/qa-does-not-exist.svg',caption:'صورة اختبار مفقودة'},{id:'qa-corrupt',type:'image',visible:true,path:'data:image/png;base64,AAAA',caption:'صورة اختبار تالفة'},a]);
      await new Promise((resolve,reject)=>{let retries=0;const poll=()=>{const state=MosqueApp.getSlidesState();if(state.failed.includes('qa-missing')&&state.failed.includes('qa-corrupt'))return resolve();if(++retries>40)return reject(new Error('لم تتجاوز الشاشة الصور غير الصالحة'));setTimeout(poll,50);};poll();});
      const failed=MosqueApp.getSlidesState();const content=document.getElementById('slideContent').textContent;
      MosqueApp.setSlides(JSON.parse(document.getElementById('slides-data').textContent));MosqueApp.tick();return{before,exact,empty,single,failed,content};
    });assert(result.before===0&&result.exact===1,'لم تتغير الشريحة عند20ثانية: '+JSON.stringify(result));assert(result.empty.count===0&&result.empty.text.includes('مرحبًا'),'لم يظهر البديل عند انعدام الشرائح');assert(result.single.count===1&&result.single.index===0,'فشل عرض الشريحة الواحدة');assert(result.failed.count===1&&result.content.includes('شريحة اختبار أ'),'لم تستمر الشرائح النصية بعد فشل الصور');return result;
  });
  await check('توقف الشرائح أثناء الصلاة واستئناف عشرين ثانية دون إعادة الشرائح الفائتة',async()=>{
    const result=await page.evaluate(()=>{
      const slides=[{id:'qa-a',type:'text',visible:true,title:'أ',text:'اختبار'},{id:'qa-b',type:'text',visible:true,title:'ب',text:'اختبار'}];const db=MosqueApp.validateTimetable(MosqueApp.database);const event=MosqueApp.buildEvents(db,MosqueApp.defaults).filter(e=>e.date==='2026-11-16')[1];window.__qaNow=event.adhan-60000;MosqueApp.setNow(()=>window.__qaNow);MosqueApp.setSlides(slides);MosqueApp.tick();window.__qaNow+=10000;MosqueApp.tick();const before=MosqueApp.getSlidesState();window.__qaNow=event.iqama;MosqueApp.tick();window.__qaNow+=600000;MosqueApp.tick();const during=MosqueApp.getSlidesState();window.__qaNow=event.end;MosqueApp.tick();const afterPrayer=MosqueApp.getContentMode();window.__qaNow+=MosqueApp.getSettings().postPrayerMinutes*60000;MosqueApp.tick();const resumed=MosqueApp.getSlidesState();window.__qaNow+=19999;MosqueApp.tick();const beforeNext=MosqueApp.getSlidesState();window.__qaNow+=1;MosqueApp.tick();const afterNext=MosqueApp.getSlidesState();MosqueApp.setSlides(JSON.parse(document.getElementById('slides-data').textContent));window.__qaNow=Date.parse('2026-11-16T09:15:00+03:00');MosqueApp.tick();return{before,during,afterPrayer,resumed,beforeNext,afterNext,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,transition:getComputedStyle(document.getElementById('slideContent')).transitionDuration};
    });assert(result.afterPrayer==='post-prayer',JSON.stringify(result));assert(result.before.index===result.during.index&&result.resumed.index===result.during.index&&result.resumed.elapsed===0,JSON.stringify(result));assert(result.beforeNext.index===result.resumed.index&&result.afterNext.index!==result.resumed.index,JSON.stringify(result));assert(result.reducedMotion&&result.transition==='0s',JSON.stringify(result));return result;
  });
  for(const failureMode of ['blocked','corrupt','native-calendar-unavailable'])await check('إطلاق مستقل: '+failureMode,async()=>{
    const special=await browser.newContext({viewport:{width:1920,height:1080},timezoneId:'America/Los_Angeles'});await special.setOffline(true);
    if(failureMode==='blocked')await special.addInitScript(()=>Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('storage blocked for test');}}));
    if(failureMode==='corrupt')await special.addInitScript(()=>{localStorage.setItem('mosque-display.settings.v1','{corrupt');localStorage.setItem('mosque-display.timetable.v1','{"metadata":null}');});
    if(failureMode==='native-calendar-unavailable')await seedLegacySettings(special);
    if(failureMode==='native-calendar-unavailable')await special.addInitScript(()=>{const Native=Intl.DateTimeFormat;Intl.DateTimeFormat=function(locale,options){if(options&&options.calendar==='islamic-umalqura')throw new Error('unsupported calendar for test');return new Native(locale,options);};});
    const p=await special.newPage();const issues=[];p.on('pageerror',error=>issues.push(error.message));await p.goto(url+'?test=1');await p.waitForFunction(()=>window.MosqueApp);const result=await p.evaluate(()=>{MosqueApp.setNow(()=>Date.parse('2026-11-16T09:15:00+03:00'));MosqueApp.tick();const required=MosqueInstall.getContext().required;if(!required)MosqueApp.openSettings();return{required,wizardOpen:MosqueSetup.isOpen(),phase:MosqueApp.getState().phase,rows:document.querySelectorAll('#prayerRows tr').length,native:MosqueApp.calendarNativeOK,hijri:document.getElementById('hijriDate').textContent,settings:document.getElementById('settingsBody').textContent};});await special.close();assert(issues.length===0&&result.rows===6,JSON.stringify({issues,result}));if(failureMode==='blocked')assert(result.required&&result.wizardOpen&&result.phase==='UNAVAILABLE',JSON.stringify(result));else assert(!result.required&&result.phase!=='UNAVAILABLE',JSON.stringify(result));if(failureMode==='native-calendar-unavailable')assert(result.native===false&&result.hijri.includes('1448'),JSON.stringify(result));if(failureMode==='corrupt')assert(result.settings.includes('غير صالح'),'لم يفسر التطبيق فساد التخزين');return{pageErrors:issues.length,rows:result.rows,phase:result.phase,setupRequired:result.required,nativeCalendar:result.native};
  });
  await check('الإطلاق العادي دون وضع الاختبار يعمل ولا يعرض واجهة الاختبارات',async()=>{
    const fresh=await browser.newContext({viewport:{width:1920,height:1080},serviceWorkers:'block'});await fresh.setOffline(true);const plain=await fresh.newPage();const requests=[],issues=[];plain.on('request',request=>{if(/^https?:/i.test(request.url()))requests.push(request.url());});plain.on('pageerror',error=>issues.push(error.message));await plain.goto(url);
    const result=await plain.evaluate(()=>{
      const settings=MosqueInstall.getContext();
      return{testAPI:typeof window.MosqueApp,lang:document.documentElement.lang,direction:document.documentElement.dir,
        required:settings.required,setupOpen:MosqueSetup.isOpen(),hasProfile:settings.profile!==null,clock:document.getElementById('clockTime').textContent,
        rows:document.querySelectorAll('#prayerRows tr').length,mosqueHidden:document.getElementById('mosqueInfo').hidden,
        status:document.getElementById('dataStatus').textContent};
    });
    await fresh.close();
    assert(result.testAPI==='undefined'&&result.lang==='ar'&&result.direction==='rtl'&&result.required&&result.setupOpen&&!result.hasProfile&&result.rows===6&&result.clock.length===8&&result.mosqueHidden&&result.status.includes('غير متوفرة')&&requests.length===0&&issues.length===0,JSON.stringify({result,requests,issues}));
    return{...result,networkRequests:requests.length,pageErrors:issues.length};
  });
  await page.screenshot({path:path.join(output,browserConfig.name.toLowerCase()+'-1920x1080.png')});
  await check('ملف test.html المستقل يتصل بمنطق التطبيق عبر file://',async()=>{
    const harness=await context.newPage();await harness.goto(pathToFileURL(path.join(root,'test.html')).href);await harness.locator('#run').waitFor({state:'visible'});await harness.waitForFunction(()=>!document.getElementById('run').disabled,null,{timeout:20000});await harness.click('#run');await harness.waitForFunction(()=>window.mosqueTestReport,null,{timeout:60000});const report=await harness.evaluate(()=>window.mosqueTestReport);await harness.close();assert(report.failed===0,JSON.stringify(report.results.filter(item=>!item.pass)));return{total:report.total,passed:report.passed};
  });
  await check('نهاية جميع التفاعلات بلا استثناءات صفحة أو طلبات HTTP(S)',async()=>{assert(errors.length===0,errors.join('\n'));assert(network.length===0,network.join('\n'));return{pageErrors:errors.length,networkRequests:network.length};});
  const report={browser:browserConfig.name,version:browser.version(),url,networkDisabled:true,viewport:'1920x1080',reducedMotion:true,core,checks,errors,network};
  await browser.close();return report;
}
(async()=>{
  const reports=[];for(const browser of browsers){console.log('Testing '+browser.name);reports.push(await run(browser));}
  const summary={executedAt:new Date().toISOString(),indexSHA256:createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex'),reports};fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(summary,null,2));
  const failures=reports.flatMap(report=>[...report.core.results,...report.checks].filter(check=>!check.pass).map(check=>({browser:report.browser,...check})));
  console.log(JSON.stringify({browsers:reports.map(report=>({name:report.browser,version:report.version,corePassed:report.core.passed,coreTotal:report.core.total,uiPassed:report.checks.filter(check=>check.pass).length,uiTotal:report.checks.length})),failures},null,2));if(failures.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
