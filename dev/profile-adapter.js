/* Operational setup adapter: explicit calculation/import, then one validated local commit. */
(function(){
  'use strict';
  const core=window.MosqueInstall,engine=window.MosqueLocation,store=window.MosqueProfileStore;
  if(!core||!engine||!store||!window.MosqueSetup)return;
  let worker=null,workerUrl='',workerTimeout=0,pendingWorker=null,pendingFetch=null,pendingFile=null,requestId=0,operationId=0;
  const context=()=>core.getContext();
  const language=()=>window.MosqueSetup.getState().profile?.language||context().profile?.language||'ar';
  function failure(error){return {ok:false,canCalculate:true,messageAr:'لم يكتمل تجهيز الجدول. '+String(error?.messageAr||error?.message||error),messageEn:String(error?.messageEn||error?.message||error||'Could not prepare the timetable.')};}
  function checked(profile,table){core.validatePrepared(profile,table);return {ok:true,table,profileKey:JSON.stringify(engine.validateProfile(profile,context().catalog)),provenance:{labelAr:table.metadata.source,labelEn:table.metadata.source,source:table.metadata.source,verificationStatus:table.metadata.verificationStatus},coverage:{start:table.metadata.displayStart,end:table.metadata.displayEnd},messageAr:table.metadata.verificationStatus==='calculated-needs-review'?'تم تجهيز مواقيت محسوبة. راجعها محليًا قبل اعتمادها.':'تم التحقق من بنية الجدول المستورد؛ راجع مصدره.',messageEn:table.metadata.verificationStatus==='calculated-needs-review'?'Calculated times prepared. Local review is required.':'The imported timetable passed structural checks. Review its provenance.'};}
  function cancelPrepare(){
    operationId++;if(workerTimeout)clearTimeout(workerTimeout);workerTimeout=0;if(workerUrl)URL.revokeObjectURL(workerUrl);workerUrl='';
    if(worker){worker.terminate();worker=null;}if(pendingWorker){pendingWorker.resolve(failure(new Error('Preparation cancelled.')));pendingWorker=null;}
    if(pendingFetch){pendingFetch.resolve(failure(new Error('Download cancelled.')));pendingFetch=null;}
    if(pendingFile){pendingFile.resolve(failure(new Error('Import cancelled.')));pendingFile=null;}
    try{window.MosqueAndroid?.cancelSetupFetch?.();}catch(_){}
  }
  function calculate(profile){
    cancelPrepare();const token=operationId,p=engine.validateProfile(profile,context().catalog),year=Number(engine.dateKey(Date.now(),p.timezone).slice(0,4));
    return new Promise((resolve,reject)=>{
      if(typeof Worker!=='function'||typeof Blob!=='function'){reject(new Error('This WebView cannot prepare offline timetables. Update Android System WebView.'));return;}
      const library=document.getElementById('prayer-calculation-library'),source=document.getElementById('location-engine-code');if(!library||!source){reject(new Error('The bundled prayer calculation engine is missing.'));return;}
      const code=library.textContent+'\n'+source.textContent+'\nself.onmessage=function(e){try{self.postMessage({ok:true,table:MosqueLocation.calculate(e.data.profile,e.data.year,e.data.calendar)});}catch(error){self.postMessage({ok:false,message:String(error.message||error)});}};';
      const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));workerUrl=url;
      const cleanup=()=>{if(token!==operationId)return;worker?.terminate();worker=null;pendingWorker=null;if(workerTimeout)clearTimeout(workerTimeout);workerTimeout=0;URL.revokeObjectURL(url);workerUrl='';};
      try{worker=new Worker(url);pendingWorker={resolve,reject};worker.onmessage=event=>{if(token!==operationId)return;const data=event.data;cleanup();try{if(!data||data.ok!==true)throw Error(data?.message||'Calculation failed.');resolve(checked(p,data.table));}catch(error){reject(error);}};worker.onerror=()=>{if(token!==operationId)return;cleanup();reject(new Error('Offline calculation failed. Choose another location or import a reviewed timetable.'));};workerTimeout=setTimeout(()=>{if(token!==operationId)return;cleanup();reject(new Error('Calculation timed out. Try another location or import a reviewed timetable.'));},90000);worker.postMessage({profile:p,year,calendar:context().calendar});}
      catch(error){cleanup();reject(error);}
    });
  }
  function importFile(profile){
    cancelPrepare();const token=operationId,p=engine.validateProfile(profile,context().catalog);
    return new Promise(resolve=>{
      let input=document.getElementById('setupTimetableFile');if(!input){input=document.createElement('input');input.id='setupTimetableFile';input.type='file';input.accept='application/json,.json';input.hidden=true;document.body.appendChild(input);}
      pendingFile={resolve};input.value='';
      input.oncancel=()=>{if(token===operationId&&pendingFile){pendingFile=null;resolve(failure(new Error('File selection cancelled.')));}};
      input.onchange=()=>{const file=input.files?.[0];if(token!==operationId||!pendingFile)return;if(!file){pendingFile=null;resolve(failure(new Error('No file selected.')));return;}if(file.size>3000000){pendingFile=null;resolve(failure(new Error('Timetable files must be 3 MB or smaller.')));return;}
        const reader=new FileReader();reader.onerror=()=>{if(token===operationId&&pendingFile){pendingFile=null;resolve(failure(new Error('Could not read the selected file.')));}};reader.onload=()=>{if(token!==operationId||!pendingFile)return;pendingFile=null;try{const raw=JSON.parse(reader.result);resolve(checked(p,raw.timetable||raw));}catch(error){resolve(failure(error));}};reader.readAsText(file,'UTF-8');};
      input.click();
    });
  }
  function download(profile){
    cancelPrepare();const p=engine.validateProfile(profile,context().catalog),year=Number(engine.dateKey(Date.now(),p.timezone).slice(0,4)),id=++requestId;
    return new Promise((resolve,reject)=>{pendingFetch={id,resolve,reject,profile:p,year};try{window.MosqueAndroid.startSetupFetch(JSON.stringify({...p,targetYear:year,requestId:id}));}catch(error){pendingFetch=null;reject(error);}});
  }
  window.addEventListener('mosque-native-setup-result',event=>{
    const data=event.detail||{},pending=pendingFetch;if(!pending||data.requestId!==pending.id)return;
    if(data.state==='fetching'){window.MosqueSetup.refreshStatus?.(data);return;}
    pendingFetch=null;
    if(data.state!=='ready'){pending.resolve({ok:false,canCalculate:true,messageAr:data.messageAr||'تعذر جلب الجدول. يمكنك استخدام الحساب المحلي.',messageEn:data.messageEn||'Could not download. Offline calculation remains available.'});return;}
    try{const table=window.MosqueSetupProvider.fromUmmah(data.payload,pending.profile,pending.year,context().calendar);pending.resolve(checked(pending.profile,table));}catch(error){pending.resolve(failure(error));}
  });
  const countries=context().catalog.countries,sa=countries.find(c=>c.id==='SA'),dammam=sa?.cities.find(c=>c.id==='110336')||sa?.cities[0];
  try{if(context().profile)window.MosqueAndroid?.setProfileTimezone?.(context().profile.timezone);}catch(_){}
  window.MosqueProfile={
    catalog:()=>context().catalog,
    load:()=>context().profile?{...context().profile,mosqueName:context().settings.mosque.fields.name.value}:{language:'ar',countryId:sa?.id||countries[0]?.id||'',cityId:dammam?.id||'',latitude:dammam?.latitude,longitude:dammam?.longitude,timezone:dammam?.timezone||'Asia/Riyadh',hourFormat:12,dateStyle:'both',methodId:'UmmAlQura',neighborhood:'',mosqueName:context().required?'':context().settings.mosque.fields.name.value},
    prepare:async profile=>{try{return await calculate(profile);}catch(error){return failure(error);}},
    importData:importFile,
    save:(profile,prepared)=>{try{if(!prepared||prepared.ok!==true||!prepared.table||prepared.profileKey!==JSON.stringify(engine.validateProfile(profile,context().catalog)))throw Error('The prepared data no longer matches these choices. Prepare it again.');return core.commit(profile,prepared.table);}catch(error){return failure(error);}},
    onCancel:cancelPrepare,cancelPrepare,
    onFinish:()=>{cancelPrepare();},
    openKeyboard:typeof window.MosqueAndroid?.showKeyboard==='function'?()=>window.MosqueAndroid.showKeyboard():undefined,
    openPhone:typeof window.MosqueAndroid?.openControl==='function'?()=>window.MosqueAndroid.openControl('phone'):undefined
  };
  if(typeof window.MosqueAndroid?.startSetupFetch==='function')window.MosqueProfile.downloadData=download;
  if(context().required)window.MosqueSetup.open({required:true});
})();
