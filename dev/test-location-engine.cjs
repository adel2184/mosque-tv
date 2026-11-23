/* Pure offline engine tests. No network, browser, Android, TV, or OS-clock change. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),childProcess=require('node:child_process');
const root=path.resolve(__dirname,'..'),engine=require('./location-engine.js'),adhan=require('./vendor/adhan/adhan.umd.cjs');
const calendar=JSON.parse(fs.readFileSync(path.join(root,'data/setup-calendar.json'),'utf8'));
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/location-catalog.json'),'utf8'));
const source=fs.readFileSync(path.join(__dirname,'location-engine.js'),'utf8'),fields=['fajr','sunrise','dhuhr','asr','maghrib','isha'],checks=[];
const assert=(value,message='Assertion failed')=>{if(!value)throw Error(message);};
const eq=(actual,expected)=>assert(actual===expected,`Expected ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`);
const same=(actual,expected)=>eq(JSON.stringify(actual),JSON.stringify(expected));
function rejects(fn,codes){let error;try{fn();}catch(value){error=value;}assert(error,'Expected rejection');if(codes)assert([].concat(codes).includes(error.code),'Unexpected error: '+error.code+' '+error.message);return error;}
function test(name,fn){const start=Date.now();try{fn();checks.push({name,pass:true,milliseconds:Date.now()-start});}catch(error){checks.push({name,pass:false,error:error.stack});}}
const profile=(changes={})=>({language:'ar',countryId:'SA',cityId:'110336',timezone:'Asia/Riyadh',hourFormat:12,dateStyle:'both',methodId:'UmmAlQura',neighborhood:'',mosqueName:'جامع الاختبار',latitude:26.43442,longitude:50.10326,...changes});
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function tableChecks(table,p,y){
  const expected=(Date.UTC(y+2,0,1)-Date.UTC(y,0,1))/86400000+2;eq(table.records.length,expected);eq(table.metadata.rangeStart,(y-1)+'-12-31');eq(table.metadata.rangeEnd,(y+2)+'-01-01');same(table.metadata.displayYears,[y,y+1]);
  let previousIsha=-Infinity;for(let i=0;i<table.records.length;i++){const row=table.records[i];eq(row.date,engine.addDays(table.metadata.rangeStart,i));let previous=-Infinity;for(const field of fields){assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(row[field]));const ms=row.instants[field];assert(Number.isFinite(ms)&&ms>previous);eq(ms%60000,0);const parts=engine.wallParts(ms,p.timezone);eq(row[field],String(parts.hour).padStart(2,'0')+':'+String(parts.minute).padStart(2,'0'));previous=ms;}assert(row.instants.fajr>previousIsha);previousIsha=row.instants.isha;eq(engine.dateKey(row.instants.dhuhr,p.timezone),row.date);}
  function finite(value){if(typeof value==='number')assert(Number.isFinite(value));else if(value&&typeof value==='object')Object.values(value).forEach(finite);}finite(table);same(JSON.parse(JSON.stringify(table)),table);
}

test('Profiles use only bounded whitelisted fields and a matching catalog country/city/coordinate tuple',()=>{
  const input=profile({untrustedURL:'https://example.invalid/never-fetched',unknown:true}),out=engine.validateProfile(input,catalog);eq(out.cityId,'110336');eq(out.latitude,26.43442);eq(out.longitude,50.10326);eq('untrustedURL'in out,false);eq('unknown'in out,false);eq(input.unknown,true);
  rejects(()=>engine.validateProfile(profile({countryId:'US'}),catalog),'INVALID_CITY');rejects(()=>engine.validateProfile(profile({cityId:'unlisted'}),catalog),'INVALID_CITY');rejects(()=>engine.validateProfile(profile({latitude:26.5}),catalog),'CITY_COORDINATE_MISMATCH');rejects(()=>engine.validateProfile(profile({longitude:50}),catalog),'CITY_COORDINATE_MISMATCH');
});
test('The operator timezone override remains independent of the catalog city default',()=>{
  const value=engine.validateProfile(profile({timezone:'America/New_York'}),catalog);eq(value.timezone,'America/New_York');eq(value.latitude,26.43442);
});
test('Published city IDs still validate with their saved coordinates and timezones after the November catalog refresh',()=>{
  const prior=[
    ['IN','1254745',10.01115,77.47772,'Asia/Kolkata'],['UA','13545885',49.08899,33.42984,'Europe/Kyiv'],
    ['UA','13580034',47.11498,37.58519,'Europe/Kyiv'],['NG','2338612',5.66526,5.76564,'Africa/Lagos'],
    ['UA','616743',48.61995,37.52537,'Europe/Kyiv'],['BD','7683974',23.74,90.385,'Asia/Dhaka'],
    ['CN','11694038',44.05305,80.87173,'Asia/Urumqi']
  ];
  for(const [countryId,cityId,latitude,longitude,timezone] of prior){
    const saved=profile({countryId,cityId,latitude,longitude,timezone});
    const result=engine.validateProfile(saved,catalog);
    eq(result.latitude,latitude);eq(result.longitude,longitude);eq(result.timezone,timezone);
    rejects(()=>engine.validateProfile({...saved,countryId:'SA'},catalog),'INVALID_CITY');
    rejects(()=>engine.validateProfile({...saved,longitude:longitude+0.001},catalog),'CITY_COORDINATE_MISMATCH');
  }
  const all=catalog.countries.flatMap(country=>country.cities);
  eq(all.filter(city=>city.retired).length,5);eq(all.filter(city=>!city.retired).length,catalog.cityCount);
  eq(all.find(city=>city.id==='7683974').longitude,90.369);eq(all.find(city=>city.id==='11694038').timezone,'Asia/Shanghai');
  eq(all.some(city=>city.id==='7259466'),false);assert(all.some(city=>city.id==='5006917'));
});
test('Malformed types, controls, URLs as IDs/zones/methods, out-of-range coordinates, and invalid clock settings are rejected',()=>{
  const invalid=[{language:'fr'},{hourFormat:0},{hourFormat:'12'},{dateStyle:'unknown'},{methodId:'https://example.com'},{methodId:'toString'},{timezone:'https://example.com'},{timezone:'Imaginary/Nowhere'},{timezone:'+03:00'},{countryId:'sa'},{cityId:'../city'},{latitude:NaN},{latitude:90},{longitude:181},{longitude:'50'},{mosqueName:''},{mosqueName:'a'.repeat(181)},{neighborhood:'x'.repeat(181)},{mosqueName:'bad\u0000name'}];
  for(const change of invalid)rejects(()=>engine.validateProfile(profile(change)));rejects(()=>engine.validateProfile(null));rejects(()=>engine.validateProfile([]));
});
test('Wall parts and local date keys ignore UTC date boundaries, including Auckland and fractional Kolkata offsets',()=>{
  same(engine.wallParts(Date.parse('2026-12-31T11:05:06Z'),'Pacific/Auckland'),{day:1,month:1,year:2027,hour:0,minute:5,second:6});
  eq(engine.dateKey(Date.parse('2026-12-31T11:05:06Z'),'Pacific/Auckland'),'2027-01-01');eq(engine.dateKey(Date.parse('2026-12-31T11:05:06Z'),'Pacific/Honolulu'),'2026-12-31');
  const india=engine.wallParts(Date.parse('2026-01-01T00:00:00Z'),'Asia/Kolkata');eq(india.hour,5);eq(india.minute,30);
});
test('Civil date arithmetic handles leap days and year changes without adding zoned 24-hour days',()=>{
  eq(engine.addDays('2028-02-28',1),'2028-02-29');eq(engine.addDays('2028-02-29',1),'2028-03-01');eq(engine.addDays('2026-12-31',1),'2027-01-01');eq(engine.addDays('2027-01-01',-1),'2026-12-31');rejects(()=>engine.addDays('2026-02-29',1),'INVALID_DATE');rejects(()=>engine.addDays('2028-02-28',0.5),'INVALID_DAY_OFFSET');
});
test('New York spring DST gaps are rejected and adjoining civil dates have the correct 23-hour distance',()=>{
  rejects(()=>engine.timestamp('2026-03-08','02:30','America/New_York'),'NONEXISTENT_LOCAL_TIME');eq(engine.timestamp('2026-03-08','03:30','America/New_York'),Date.parse('2026-03-08T07:30:00Z'));
  eq(engine.timestamp('2026-03-08','12:00','America/New_York')-engine.timestamp('2026-03-07','12:00','America/New_York'),23*3600000);
});
test('New York repeated DST time deterministically selects the earlier occurrence and fall civil days span 25 hours',()=>{
  eq(engine.timestamp('2026-11-01','01:30','America/New_York'),Date.parse('2026-11-01T05:30:00Z'));eq(engine.timestamp('2026-11-01','12:00','America/New_York')-engine.timestamp('2026-10-31','12:00','America/New_York'),25*3600000);
});
test('Thirty-minute Lord Howe DST transitions and the historic Apia skipped date are handled without invented times',()=>{
  rejects(()=>engine.timestamp('2026-10-04','02:15','Australia/Lord_Howe'),'NONEXISTENT_LOCAL_TIME');eq(engine.timestamp('2026-10-04','02:30','Australia/Lord_Howe'),Date.parse('2026-10-03T15:30:00Z'));eq(engine.timestamp('2026-04-05','01:45','Australia/Lord_Howe'),Date.parse('2026-04-04T14:45:00Z'));
  rejects(()=>engine.timestamp('2011-12-30','12:00','Pacific/Apia'),'NONEXISTENT_LOCAL_TIME');
});
test('Fractional-zone timestamp conversion round-trips exactly and malformed local times are rejected',()=>{
  eq(engine.timestamp('2026-01-01','00:15','Asia/Kolkata'),Date.parse('2025-12-31T18:45:00Z'));for(const time of ['24:00','29:99','1:00','00:00:00',''])rejects(()=>engine.timestamp('2026-01-01',time,'Asia/Riyadh'),'INVALID_TIME');rejects(()=>engine.timestamp('2026-02-30','12:00','UTC'),'INVALID_DATE');
});
test('12/24-hour clocks use Arabic/English period labels and explicit digit styles',()=>{
  const midnight=Date.parse('2026-11-16T21:05:06Z');same(engine.formatClock(midnight,profile({hourFormat:24}),'western'),{time:'00:05:06',period:''});same(engine.formatClock(midnight,profile({language:'en'}),'western'),{time:'12:05:06',period:'AM'});same(engine.formatClock(midnight,profile(),'arabic'),{time:'١٢:٠٥:٠٦',period:'ص'});eq(engine.formatTime(midnight,profile({language:'en'}),'western'),'12:05 AM');eq(engine.formatTime(Date.parse('2026-11-17T09:00:00Z'),profile({language:'en'}),'western'),'12:00 PM');rejects(()=>engine.formatClock(midnight,profile(),'bad'),'INVALID_DIGITS');
});
test('The exact bundled Umm al-Qura table supplies Ramadan and year boundaries and preserves historical 28/31-day entries',()=>{
  for(const [key,year,month,day]of [['2026-02-17',1447,8,29],['2026-02-18',1447,9,1],['2026-03-19',1447,9,30],['2026-03-20',1447,10,1],['2027-02-07',1448,8,30],['2027-02-08',1448,9,1],['2027-03-08',1448,9,29],['2027-03-09',1448,10,1]])same(engine.hijriFromCalendar(key,calendar),{year,month,day});
  let anomalies=0;for(let i=0;i<calendar.months.length-1;i++){const month=calendar.months[i],next=calendar.months[i+1],days=(Date.parse(next.start)-Date.parse(month.start))/86400000;if([28,31].includes(days)){anomalies++;eq(engine.hijriFromCalendar(engine.addDays(next.start,-1),calendar).day,days);}}eq(anomalies,8);eq(engine.hijriFromCalendar('1900-01-01',calendar),null);
});
const tables=new Map();
test('All five exact Adhan presets generate complete two-year records and honest method metadata',()=>{
  const expected={UmmAlQura:[18.5,0,0],MuslimWorldLeague:[18,17,1],Egyptian:[19.5,17.5,1],NorthAmerica:[15,15,1],Karachi:[18,18,1]};
  for(const [id,[fajr,isha,dhuhr]]of Object.entries(expected)){const p=profile({methodId:id}),table=engine.calculate(p,2026,calendar);tables.set(id,table);tableChecks(table,p,2026);const m=table.metadata;eq(m.verificationStatus,'calculated-needs-review');eq(m.timezone,p.timezone);eq(m.utcOffset,'iana-dynamic');eq(m.calculation.library,'Adhan JS 4.4.6');eq(m.calculation.method,id);eq(m.calculation.fajrAngle,fajr);eq(m.calculation.ishaAngle,isha);eq(m.calculation.asrShadowFactor,1);eq(m.calculation.methodAdjustmentsMinutes.dhuhr,dhuhr);assert(m.source.includes('Not an official'));eq(Object.keys(m.calculation.presets).length,5);}
});
test('Umm al-Qura Isha is exactly 90/120 absolute minutes once, including both Ramadan boundaries',()=>{
  const table=tables.get('UmmAlQura');assert(table);for(const row of table.records){const h=engine.hijriFromCalendar(row.date,calendar);eq((row.instants.isha-row.instants.maghrib)/60000,h.month===9?120:90);}
  const byDate=new Map(table.records.map(row=>[row.date,row]));for(const [key,minutes]of [['2026-02-17',90],['2026-02-18',120],['2026-03-19',120],['2026-03-20',90],['2027-02-07',90],['2027-02-08',120],['2027-03-08',120],['2027-03-09',90]])eq((byDate.get(key).instants.isha-byDate.get(key).instants.maghrib)/60000,minutes);
});
test('The engine reproduces every legacy Dammam wall time when given the old unchanged coordinates',()=>{
  const old=JSON.parse(fs.readFileSync(path.join(root,'data/timetable.json'),'utf8')),table=engine.calculate(profile({cityId:'legacy-dammam',latitude:26.4207,longitude:50.0888}),2026,calendar);eq(old.records.length,table.records.length);for(let i=0;i<old.records.length;i++)for(const field of ['date',...fields])eq(table.records[i][field],old.records[i][field]);
});
test('Leap-year coverage has 733 rows including the two boundary guards and contains February 29 exactly once',()=>{
  const p=profile({methodId:'MuslimWorldLeague'}),table=engine.calculate(p,2027);tableChecks(table,p,2027);eq(table.records.length,733);eq(table.records.filter(row=>row.date==='2028-02-29').length,1);
});
test('New York calculated rows retain dynamic DST offsets and absolute epoch order',()=>{
  const p=profile({countryId:'US',cityId:'5128581',timezone:'America/New_York',latitude:40.71427,longitude:-74.00597,methodId:'MuslimWorldLeague'}),table=engine.calculate(p,2026);tableChecks(table,p,2026);const rows=new Map(table.records.map(row=>[row.date,row]));eq(engine.wallParts(rows.get('2026-03-08').instants.dhuhr,p.timezone).hour-engine.wallParts(rows.get('2026-03-07').instants.dhuhr,p.timezone).hour,1);eq(engine.wallParts(rows.get('2026-11-01').instants.dhuhr,p.timezone).hour-engine.wallParts(rows.get('2026-10-31').instants.dhuhr,p.timezone).hour,-1);
});
test('Auckland and international-date-line Kiritimati use the correct solar day, not an arbitrary 24-hour shift',()=>{
  for(const p of [profile({countryId:'NZ',cityId:'auckland',timezone:'Pacific/Auckland',latitude:-36.8485,longitude:174.7633,methodId:'MuslimWorldLeague'}),profile({countryId:'KI',cityId:'kiritimati',timezone:'Pacific/Kiritimati',latitude:1.87,longitude:-157.36,methodId:'MuslimWorldLeague'})]){const table=engine.calculate(p,2026);tableChecks(table,p,2026);const row=table.records.find(row=>row.date==='2026-06-01');eq(engine.dateKey(row.instants.dhuhr,p.timezone),'2026-06-01');if(p.countryId==='KI'){const reference=new adhan.PrayerTimes(new adhan.Coordinates(p.latitude,p.longitude),new Date(2026,4,31,12),adhan.CalculationMethod.MuslimWorldLeague());for(const field of fields)eq(row.instants[field],reference[field].getTime());}else assert(new Date(row.instants.fajr).toISOString().slice(0,10)<row.date);}
});
test('Calendar objects and explicit local Hijri callbacks calculate identical absolute prayer records',()=>{
  const viaCallback=engine.calculate(profile(),2026,key=>engine.hijriFromCalendar(key,calendar));eq(digest(viaCallback.records),digest(tables.get('UmmAlQura').records));
});
test('Unavailable calendar coverage, malformed months, invalid years, and unresolved polar days reject the whole table honestly',()=>{
  rejects(()=>engine.calculate(profile(),2026),'INVALID_CALENDAR');rejects(()=>engine.calculate(profile(),2077,calendar),'HIJRI_OUT_OF_RANGE');rejects(()=>engine.calculate(profile(),2026,()=>null),'HIJRI_OUT_OF_RANGE');rejects(()=>engine.calculate(profile(),1999,calendar),'INVALID_YEAR');rejects(()=>engine.calculate(profile(),2026.5,calendar),'INVALID_YEAR');
  const broken=JSON.parse(JSON.stringify(calendar));broken.months[1].month=13;rejects(()=>engine.calculate(profile(),2026,broken),'INVALID_CALENDAR');rejects(()=>engine.calculate(profile({countryId:'NO',cityId:'polar',latitude:89,longitude:18.9553,timezone:'Europe/Oslo',methodId:'MuslimWorldLeague'}),2026),['UNRESOLVED_PRAYERS','OVERLAPPING_PRAYERS']);
});
test('The browser/worker UMD path runs the actual vendored Adhan and engine without DOM, storage, or network globals',()=>{
  const sandbox={Intl};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'vendor/adhan/adhan.umd.cjs'),'utf8'),sandbox,{timeout:4000});vm.runInContext(source,sandbox,{timeout:4000});eq(typeof sandbox.MosqueLocation.calculate,'function');eq(sandbox.document,undefined);eq(sandbox.fetch,undefined);const result=sandbox.MosqueLocation.calculate(profile(),2026,calendar);eq(digest(result.records),digest(tables.get('UmmAlQura').records));
});
test('Actual full-year calculations remain identical under UTC, New York, Tokyo, and Auckland host process zones',()=>{
  const p=profile({countryId:'NZ',cityId:'auckland',timezone:'Pacific/Auckland',latitude:-36.8485,longitude:174.7633,methodId:'MuslimWorldLeague'}),code="const e=require('./dev/location-engine.js'),c=require('node:crypto');const x=e.calculate("+JSON.stringify(p)+",2026);process.stdout.write(c.createHash('sha256').update(JSON.stringify(x.records)).digest('hex'));";
  const results=['UTC','America/New_York','Asia/Tokyo','Pacific/Auckland'].map(TZ=>childProcess.execFileSync(process.execPath,['-e',code],{cwd:root,env:{...process.env,TZ},encoding:'utf8',timeout:20000}).trim());for(const value of results)eq(value,results[0]);
});
const report={executedAt:new Date().toISOString(),engineSHA256:crypto.createHash('sha256').update(source).digest('hex'),method:'Actual vendored Adhan 4.4.6 and pure engine executed in Node and a DOM-free VM worker simulation. Host-TZ checks use child processes only; OS/TV clocks and zones are unchanged. No network, Android, browser rendering, official-timetable comparison, or physical-device test.',passed:checks.filter(item=>item.pass).length,total:checks.length,failed:checks.filter(item=>!item.pass).length,checks};console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
