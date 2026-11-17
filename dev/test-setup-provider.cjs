/* Actual pure parser with generated full coverage and a sanitized real UmmahAPI day capture. No network. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),engine=require('./location-engine.js'),provider=require('./setup-provider.js');
const calendar=JSON.parse(fs.readFileSync(path.join(root,'data/setup-calendar.json'),'utf8'));
const fields=['fajr','sunrise','dhuhr','asr','maghrib','isha'],checks=[],clone=value=>JSON.parse(JSON.stringify(value));
const profile=(changes={})=>({language:'ar',countryId:'SA',cityId:'legacy-dammam',timezone:'Asia/Riyadh',hourFormat:12,dateStyle:'both',methodId:'UmmAlQura',neighborhood:'',mosqueName:'جامع اختبار',latitude:26.4207,longitude:50.0888,...changes});
function assert(value,message='Assertion failed'){if(!value)throw Error(message);}
function eq(a,b){assert(a===b,'Expected '+JSON.stringify(b)+'; got '+JSON.stringify(a));}
function test(name,fn){try{fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}}
function reject(fn,code){let error;try{fn();}catch(value){error=value;}assert(error,'Expected rejection');if(code)assert([].concat(code).includes(error.code),'Unexpected code '+error.code+': '+error.message);return error;}
function rawDay(record,day){const times={},datetimes={};for(const field of fields){times[field]=record[field];datetimes[field]=new Date(record.instants[field]).toISOString();}return{date:record.date,...(day?{day}:{}),prayer_times:times,prayer_datetimes:datetimes};}
function payloadFor(p,y){
  const table=engine.calculate(p,y,p.methodId==='UmmAlQura'?calendar:undefined),byDate=new Map(table.records.map(row=>[row.date,row]));
  const meta=()=>({location:{latitude:p.latitude,longitude:p.longitude},timezone:p.timezone,calculation_method:p.methodId,madhab:'Shafi',high_latitude_rule:'MiddleOfTheNight (default)'});
  const months=[];
  for(let year=y;year<=y+1;year++)for(let month=1;month<=12;month++){
    const total=new Date(Date.UTC(year,month,0)).getUTCDate(),days=[];
    for(let day=1;day<=total;day++){const date=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');days.push(rawDay(byDate.get(date),day));}
    months.push({...meta(),year,month,total_days:total,days});
  }
  const boundary=[table.records[0],table.records[table.records.length-1]].map(record=>({...meta(),...rawDay(record)}));
  return{fetchedAt:'2026-11-17T11:47:49.725Z',months,boundary};
}
const p=profile(),base=payloadFor(p,2026),mwl=profile({methodId:'MuslimWorldLeague'}),mwlBase=payloadFor(mwl,2026);
const parse=(payload=base,input=p,year=2026,cal=calendar)=>provider.fromUmmah(payload,input,year,cal);

// This row is copied from the supplied real API capture's data, without any IP, token or private path.
const capturedRow={date:'2026-11-17',day:17,prayer_times:{fajr:'04:37',sunrise:'06:00',dhuhr:'11:25',asr:'14:28',maghrib:'16:49',isha:'18:19'},prayer_datetimes:{fajr:'2026-11-17T04:37:00+03:00',sunrise:'2026-11-17T06:00:00+03:00',dhuhr:'2026-11-17T11:25:00+03:00',asr:'2026-11-17T14:28:00+03:00',maghrib:'2026-11-17T16:49:00+03:00',isha:'2026-11-17T18:19:00+03:00'}};
test('The sanitized real provider day is accepted in its actual monthly schema and preserves exact absolute instants',()=>{
  const source=clone(base);source.months[10].days[16]=clone(capturedRow);const table=parse(source),row=table.records.find(x=>x.date==='2026-11-17');
  eq(table.records.length,732);for(const field of fields){eq(row[field],capturedRow.prayer_times[field]);eq(row.instants[field],Date.parse(capturedRow.prayer_datetimes[field]));}
});
test('All dates and source counters are complete and canonical; no input object is mutated',()=>{
  const before=JSON.stringify(base),table=parse();eq(JSON.stringify(base),before);eq(table.metadata.sourceResponsesValidated,26);eq(table.metadata.sourceMonthlyResponses,24);eq(table.metadata.sourceBoundaryResponses,2);eq(table.metadata.rangeStart,'2025-12-31');eq(table.metadata.rangeEnd,'2028-01-01');eq(table.metadata.schemaVersion,1);eq(table.metadata.verificationStatus,'calculated-needs-review');assert(table.metadata.source.includes('not an official'));eq(table.metadata.sourceUrl,'https://ummahapi.com/api/docs');eq(table.metadata.calculation.library,'UmmahAPI (remote astronomical calculation)');eq(table.metadata.fetchedAt,base.fetchedAt);eq(table.metadata.fetchedAtSource,'caller-provided');
  for(let i=0;i<table.records.length;i++)eq(table.records[i].date,engine.addDays(table.metadata.rangeStart,i));
});
test('Response count, null/array objects and invalid years fail before returning a table',()=>{
  for(const input of [null,[],{}, {...base,months:base.months.slice(1)},{...base,boundary:base.boundary.slice(1)}])reject(()=>parse(input));
  for(const y of [1999,2076,2026.5,'2026',NaN])reject(()=>parse(base,p,y),'INVALID_YEAR');
});
test('Every month and both guards must match coordinates, exact method, Shafi and the whitelisted high-latitude policy',()=>{
  for(const [key,value,code]of [['calculation_method','Egyptian','METHOD_MISMATCH'],['madhab','Hanafi','MADHAB_MISMATCH'],['high_latitude_rule','recommended','HIGH_LATITUDE_MISMATCH']]){const source=clone(base);source.months[23][key]=value;reject(()=>parse(source),code);}
  for(const mutate of [s=>s.months[4].location.latitude+=0.000002,s=>s.boundary[1].location.longitude+=0.1,s=>s.months[0].location.latitude='26.4207']){const source=clone(base);mutate(source);reject(()=>parse(source),'LOCATION_MISMATCH');}
});
test('Unrelated zones are rejected even with the same UTC offset; real IANA aliases are accepted',()=>{
  const source=clone(base);source.months[12].timezone='Asia/Dubai';reject(()=>parse(source),'TIMEZONE_MISMATCH');source.months[12].timezone='Not/AZone';reject(()=>parse(source),'INVALID_TIMEZONE');
  const india=profile({timezone:'Asia/Kolkata',methodId:'Karachi'}),payload=payloadFor(india,2026);payload.months[0].timezone='Asia/Calcutta';eq(parse(payload,india).records.length,732);
});
test('Duplicate, reordered and out-of-range month responses are rejected',()=>{
  for(const mutate of [s=>s.months[1]=clone(s.months[0]),s=>s.months.reverse(),s=>s.months[0].month=13,s=>s.months[0].year=2025]){const source=clone(base);mutate(source);reject(()=>parse(source),'MONTH_ORDER');}
});
test('Real Gregorian month lengths, exact day order and valid dates prevent gaps and duplicates',()=>{
  for(const mutate of [s=>s.months[1].total_days=29,s=>s.months[0].days.pop(),s=>s.months[0].days[1]=clone(s.months[0].days[0]),s=>s.months[1].days[0].date='2026-02-30',s=>s.months[0].days.reverse()]){const source=clone(base);mutate(source);reject(()=>parse(source));}
});
test('The two guards must have their exact required date and complete metadata',()=>{
  for(const mutate of [s=>s.boundary.reverse(),s=>s.boundary[0].date='2026-01-01',s=>delete s.boundary[1].location]){const source=clone(base);mutate(source);reject(()=>parse(source));}
});
test('Every one of the six wall clocks and ISO fields must be present and syntactically valid',()=>{
  for(const mutate of [s=>delete s.months[3].days[4].prayer_times.sunrise,s=>s.months[3].days[4].prayer_times.fajr='4:37',s=>s.months[3].days[4].prayer_times.fajr='24:00',s=>delete s.months[3].days[4].prayer_datetimes.isha,s=>s.months[3].days[4].prayer_datetimes.isha='2026-04-05T19:00:00',s=>s.months[3].days[4].prayer_datetimes.isha='2026-02-30T19:00:00+03:00',s=>s.months[3].days[4].prayer_datetimes.isha='2026-04-05T19:00:00+24:00']){const source=clone(base);mutate(source);reject(()=>parse(source));}
});
test('Wall text must match the selected zone after explicit timestamp conversion',()=>{
  const source=clone(base);source.months[10].days[16]=clone(capturedRow);source.months[10].days[16].prayer_datetimes.fajr='2026-11-17T04:37:00+02:00';reject(()=>parse(source),'WALL_TIME_MISMATCH');
});
test('Whole-minute rounding is explicit and cannot accept contradictory provider clock text',()=>{
  const source=clone(base);source.months[10].days[16]=clone(capturedRow);source.months[10].days[16].prayer_datetimes.fajr='2026-11-17T04:37:29+03:00';eq(parse(source).records.find(x=>x.date==='2026-11-17').instants.fajr,Date.parse(capturedRow.prayer_datetimes.fajr));source.months[10].days[16].prayer_datetimes.fajr='2026-11-17T04:37:30+03:00';reject(()=>parse(source),'WALL_TIME_MISMATCH');
});
test('Prayers may cross midnight when their absolute order and next-day Fajr remain valid',()=>{
  const source=clone(mwlBase),day=source.months[0].days[4];day.prayer_times.isha='00:15';day.prayer_datetimes.isha='2026-01-06T00:15:00+03:00';const table=parse(source,mwl);eq(table.records.find(x=>x.date==='2026-01-05').isha,'00:15');
});
test('Absolute prayer order and Isha-to-next-Fajr overlap are rejected without sorting or repair',()=>{
  const source=clone(mwlBase);source.months[0].days[4].prayer_times.asr='10:00';source.months[0].days[4].prayer_datetimes.asr='2026-01-05T10:00:00+03:00';reject(()=>parse(source,mwl),'PRAYER_ORDER');
  const overlap=clone(mwlBase),current=overlap.months[0].days[4],next=overlap.months[0].days[5];current.prayer_times.isha=next.prayer_times.fajr;current.prayer_datetimes.isha=next.prayer_datetimes.fajr;reject(()=>parse(overlap,mwl),'OVERLAPPING_PRAYERS');
});
test('Dhuhr must anchor the declared civil day and every instant stays within 36 hours of its local noon',()=>{
  const source=clone(mwlBase),day=source.months[0].days[4];for(const field of fields)day.prayer_datetimes[field]=new Date(Date.parse(day.prayer_datetimes[field])+86400000).toISOString();reject(()=>parse(source,mwl),'CIVIL_DATE_MISMATCH');
  const far=clone(mwlBase),last=far.months[0].days[4];last.prayer_datetimes.isha='2030-01-01T19:00:00+03:00';last.prayer_times.isha='19:00';reject(()=>parse(far,mwl),'UNREASONABLE_INSTANT');
});
test('Ramadan Isha is checked on all exact Umm al-Qura boundary dates without silently fixing a 90-minute remote error',()=>{
  const table=parse();for(const row of table.records)eq((row.instants.isha-row.instants.maghrib)/60000,engine.hijriFromCalendar(row.date,calendar).month===9?120:90);
  for(const date of ['2026-02-18','2026-03-19','2027-02-08','2027-03-08']){
    const source=clone(base),day=source.months.flatMap(x=>x.days).find(x=>x.date===date),wrong=Date.parse(day.prayer_datetimes.maghrib)+90*60000,p=engine.wallParts(wrong,'Asia/Riyadh');day.prayer_datetimes.isha=new Date(wrong).toISOString();day.prayer_times.isha=String(p.hour).padStart(2,'0')+':'+String(p.minute).padStart(2,'0');reject(()=>parse(source),'RAMADAN_ISHA_MISMATCH');
  }
});
test('Incomplete calendar coverage and wrong non-Ramadan 120-minute intervals are rejected',()=>{
  reject(()=>parse(base,p,2026,null),'INVALID_PAYLOAD');const limited=clone(calendar);limited.rangeStart='2026-01-01';reject(()=>parse(base,p,2026,limited),'HIJRI_OUT_OF_RANGE');
  const source=clone(base),day=source.months[0].days[0],wrong=Date.parse(day.prayer_datetimes.maghrib)+120*60000,pieces=engine.wallParts(wrong,p.timezone);day.prayer_datetimes.isha=new Date(wrong).toISOString();day.prayer_times.isha=String(pieces.hour).padStart(2,'0')+':'+String(pieces.minute).padStart(2,'0');reject(()=>parse(source),'RAMADAN_ISHA_MISMATCH');
});
test('Other methods keep nullable Ramadan/elevation/adjustment claims and do not inherit Umm al-Qura assumptions',()=>{
  for(const methodId of ['MuslimWorldLeague','Egyptian','NorthAmerica','Karachi']){const other=profile({methodId}),payload=methodId==='MuslimWorldLeague'?mwlBase:payloadFor(other,2026),table=parse(payload,other,2026,null);eq(table.metadata.calculation.method,methodId);eq(table.metadata.calculation.ramadanCalendar,null);eq(table.metadata.calculation.ishaMinutesOutsideRamadan,null);eq(table.metadata.calculation.adjustmentsMinutes,null);eq(table.metadata.calculation.elevationMeters,null);}
});
test('Leap-year coverage contains 733 records and one February 29 including both guards',()=>{
  const source=payloadFor(mwl,2027),table=parse(source,mwl,2027,null);eq(table.records.length,733);eq(table.records.filter(x=>x.date==='2028-02-29').length,1);eq(table.metadata.rangeEnd,'2029-01-01');
});
test('Caller retrieval timestamps are validated; absence is labelled as the importing-device timestamp',()=>{
  const source=clone(base);source.fetchedAt='https://example.invalid/not-a-date';reject(()=>parse(source),'INVALID_INSTANT');delete source.fetchedAt;eq(parse(source).metadata.fetchedAtSource,'importing-device');
});
test('Browser UMD uses the supplied local engine without requiring network globals',()=>{
  const scope={MosqueLocation:engine,Date,Intl,JSON,Set,Number,Array,Object,String,Math,Error};scope.globalThis=scope;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'setup-provider.js'),'utf8'),scope,{filename:'setup-provider.js'});assert(typeof scope.MosqueSetupProvider.fromUmmah==='function');eq(scope.MosqueSetupProvider.fromUmmah(base,p,2026,calendar).records.length,732);
});
const passed=checks.filter(x=>x.pass).length;console.log(JSON.stringify({method:'Actual pure provider parser; full synthetic coverage from local engine plus sanitized real API day; no network, Android or TV execution.',passed,total:checks.length,failed:checks.length-passed,checks},null,2));if(passed!==checks.length)process.exitCode=1;
