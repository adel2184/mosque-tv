#!/usr/bin/env node
'use strict';
/* Offline developer generator: built-in Node modules only; no runtime network or package install. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),vendor=path.join(__dirname,'vendor/geonames');
const stamp='2026-11-17';
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function zipText(file){
  const zip=fs.readFileSync(file),end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(end<0)throw Error('Missing ZIP directory: '+file);
  const entries=zip.readUInt16LE(end+10),offset=zip.readUInt32LE(end+16);let at=offset,best;
  for(let i=0;i<entries;i++){
    if(zip.readUInt32LE(at)!==0x02014b50)throw Error('Invalid ZIP entry');
    const nameBytes=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32);
    const item={name:zip.toString('utf8',at+46,at+46+nameBytes),method:zip.readUInt16LE(at+10),crc:zip.readUInt32LE(at+16),compressed:zip.readUInt32LE(at+20),size:zip.readUInt32LE(at+24),local:zip.readUInt32LE(at+42)};
    if(item.name.endsWith('.txt')&&(!best||item.size>best.size))best=item;
    at+=46+nameBytes+extra+comment;
  }
  if(!best||best.size>64*1024*1024)throw Error('Unexpected text ZIP size');
  const local=best.local;if(zip.readUInt32LE(local)!==0x04034b50)throw Error('Invalid local ZIP header');
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28),data=zip.subarray(start,start+best.compressed);
  const out=best.method===8?zlib.inflateRawSync(data,{maxOutputLength:64*1024*1024}):best.method===0?data:null;
  if(!out||out.length!==best.size||crc32(out)!==best.crc)throw Error('ZIP integrity failure: '+file);
  return out.toString('utf8');
}
const raw=zipText(path.join(vendor,'cities15000.zip'));
const rows=raw.trim().split(/\r?\n/).map(line=>line.split('\t'));
if(rows.length<20000)throw Error('Unexpectedly small city dataset');
const cityIds=new Set(rows.map(c=>c[0]));
const names=new Map(),nameSources=[];
const alternateDirectory=path.join(vendor,'alternatenames');
for(const basename of fs.readdirSync(alternateDirectory).filter(x=>/^[A-Z]{2}\.zip$/.test(x)).sort()){
  const file=path.join(alternateDirectory,basename);nameSources.push({file:'dev/vendor/geonames/alternatenames/'+basename,url:'https://download.geonames.org/export/dump/alternatenames/'+basename,sha256:hash(file)});
  for(const line of zipText(file).split(/\r?\n/)){
    const c=line.split('\t');if(!cityIds.has(c[1])||!['ar','en'].includes(c[2])||!c[3]||c[7]==='1'||c[6]==='1')continue;
    const key=c[1]+':'+c[2],rank=(c[4]==='1'?4:0)+(c[5]==='1'?1:0),previous=names.get(key);
    if(!previous||rank>previous.rank)names.set(key,{name:c[3],rank});
  }
}
const countryRows=fs.readFileSync(path.join(vendor,'countryInfo.txt'),'utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>x.split('\t'));
const ar=new Intl.DisplayNames(['ar'],{type:'region'}),en=new Intl.DisplayNames(['en'],{type:'region'});
const countries=new Map(countryRows.map(c=>[c[0],{id:c[0],nameAr:ar.of(c[0])||c[4],nameEn:en.of(c[0])||c[4],cities:[]}])) ;
const seen=new Set(),skipped=[],timezones=new Set();let arCount=0,enCount=0;
for(const c of rows){
  if(c.length!==19||!/^\d+$/.test(c[0])||seen.has(c[0]))throw Error('Invalid/duplicate city record: '+c[0]);seen.add(c[0]);
  const country=countries.get(c[8]),latitude=Number(c[4]),longitude=Number(c[5]),timezone=c[17];
  if(!country){skipped.push({id:c[0],reason:'country not in countryInfo'});continue;}
  if(!c[4]||!c[5]||!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude< -90||latitude>90||longitude< -180||longitude>180||!timezone)throw Error('Invalid location: '+c[0]);
  try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(0);}catch(error){throw Error('Unknown IANA timezone '+timezone+' for '+c[0]);}
  const arabic=names.get(c[0]+':ar'),english=names.get(c[0]+':en');if(arabic)arCount++;if(english)enCount++;
  country.cities.push({id:c[0],nameAr:arabic?arabic.name:c[2]||c[1],nameEn:english?english.name:c[2]||c[1],timezone,latitude,longitude});timezones.add(timezone);
}
const countryList=[...countries.values()].filter(c=>c.cities.length).sort((a,b)=>a.id.localeCompare(b.id,'en'));
for(const country of countryList)country.cities.sort((a,b)=>a.nameEn.localeCompare(b.nameEn,'en')||Number(a.id)-Number(b.id));
const methods=[
  {id:'UmmAlQura',nameAr:'أم القرى',nameEn:'Umm al-Qura',descriptionAr:'حساب محلي وفق إعداد أم القرى؛ ليس جدولًا رسميًا مستوردًا.',descriptionEn:'Local Umm al-Qura preset; not an imported official timetable.'},
  {id:'MuslimWorldLeague',nameAr:'رابطة العالم الإسلامي',nameEn:'Muslim World League',descriptionAr:'حساب محلي وفق الإعداد المسمى رابطة العالم الإسلامي؛ يحتاج مراجعة.',descriptionEn:'Local Muslim World League preset; review required.'},
  {id:'Egyptian',nameAr:'الهيئة المصرية العامة للمساحة',nameEn:'Egyptian General Authority of Survey',descriptionAr:'حساب محلي وفق الإعداد المصري؛ ليس نسخة من منشورات الهيئة.',descriptionEn:'Local Egyptian preset; not a copy of the authority’s published schedule.'},
  {id:'NorthAmerica',nameAr:'أمريكا الشمالية — ISNA',nameEn:'North America — ISNA',descriptionAr:'حساب محلي وفق إعداد ISNA الشائع؛ يحتاج مراجعة محلية.',descriptionEn:'Local common ISNA preset; local review required.'},
  {id:'Karachi',nameAr:'جامعة العلوم الإسلامية بكراتشي',nameEn:'University of Islamic Sciences, Karachi',descriptionAr:'حساب محلي وفق إعداد كراتشي؛ يحتاج مراجعة.',descriptionEn:'Local Karachi preset; review required.'}
];
const total=countryList.reduce((n,c)=>n+c.cities.length,0);
const catalog={schemaVersion:1,source:'GeoNames cities15000 + countryInfo; language-tagged Arabic/English alternate names where included',sourceUrl:'https://download.geonames.org/export/dump/',license:'CC BY 4.0 — licenses/geonames-CC-BY-4.0.txt; licenses/geonames-NOTICE.txt',snapshotDate:stamp,countryNamesSource:'Node Intl.DisplayNames / Unicode CLDR; generated strings',nameFallback:'GeoNames asciiname, then primary name, when a tagged translated name is unavailable',countryCount:countryList.length,cityCount:total,countries:countryList,methods};
for(const id of ['110336','108410','104515','109223'])if(!countryList.some(country=>country.id==='SA'&&country.cities.some(city=>city.id===id)))throw Error('Required Saudi city missing '+id);
const encoded=JSON.stringify(catalog)+'\n';if(Buffer.byteLength(encoded)>5*1024*1024)throw Error('Catalog exceeds 5MiB');
fs.writeFileSync(path.join(root,'data/location-catalog.json'),encoded);
const compressed=zlib.gzipSync(Buffer.from(encoded,'utf8'),{level:9});
compressed.writeUInt32LE(0,4);compressed[9]=255; // No time stamp or platform-dependent gzip header.
if(!zlib.gunzipSync(compressed,{maxOutputLength:5*1024*1024}).equals(Buffer.from(encoded,'utf8')))throw Error('Catalog gzip round-trip failed');
fs.writeFileSync(path.join(root,'data/location-catalog.json.gz'),compressed);

const calendarFile=path.join(__dirname,'vendor/hijridate/ummalqura.py'),calendarSource=fs.readFileSync(calendarFile,'utf8');
const block=calendarSource.match(/MONTH_STARTS[^=]*=\s*\(([\s\S]*?)\)/);if(!block)throw Error('Calendar source missing');
const starts=block[1].match(/\d+/g).map(Number);if(starts.length!==1897||starts[0]!==23999)throw Error('Calendar table differs from pinned source');
const DAY=86400000,key=ms=>new Date(ms).toISOString().slice(0,10);
const months=starts.map((value,i)=>({start:key((value+2400000-2440588)*DAY),year:1343+Math.floor(i/12),month:i%12+1}));
const lengths={};for(let i=1;i<starts.length;i++){const length=starts[i]-starts[i-1];if(length<28||length>31)throw Error('Invalid source month length');lengths[length]=(lengths[length]||0)+1;}
const calendar={schemaVersion:1,calendar:'islamic-umalqura',source:'HijriDate 2.3.0 by Mohammed Alshehri — MONTH_STARTS',sourceUrl:'https://github.com/dralshehri/hijridate/blob/v2.3.0/src/hijridate/ummalqura.py',sourceDocumentation:'https://hijridate.readthedocs.io/en/stable/background.html',sourceSHA256:hash(calendarFile),license:'MIT — licenses/hijridate-MIT.txt',rangeStart:'1924-08-01',rangeEnd:'2077-11-16',convention:'Saudi civil Umm al-Qura table keyed by Gregorian civil date; not a declaration of local crescent sighting.',months};
if(months[0].start!==calendar.rangeStart||months[months.length-1].start!=='2077-11-17')throw Error('Unexpected calendar boundaries');
fs.writeFileSync(path.join(root,'data/setup-calendar.json'),JSON.stringify(calendar)+'\n');
const manifest={schemaVersion:1,snapshotDate:stamp,generatorNode:process.version,generatorICU:process.versions.icu,generatorCLDR:process.versions.cldr,sources:[{file:'dev/vendor/geonames/cities15000.zip',url:'https://download.geonames.org/export/dump/cities15000.zip',sha256:hash(path.join(vendor,'cities15000.zip'))},{file:'dev/vendor/geonames/countryInfo.txt',url:'https://download.geonames.org/export/dump/countryInfo.txt',sha256:hash(path.join(vendor,'countryInfo.txt'))},...nameSources],output:{countries:countryList.length,cities:total,taggedArabicNames:arCount,taggedEnglishNames:enCount,timezones:timezones.size,catalogBytes:Buffer.byteLength(encoded),catalogSHA256:hash(path.join(root,'data/location-catalog.json')),catalogGzipBytes:compressed.length,catalogGzipSHA256:hash(path.join(root,'data/location-catalog.json.gz')),calendarBytes:fs.statSync(path.join(root,'data/setup-calendar.json')).size,calendarSHA256:hash(path.join(root,'data/setup-calendar.json')),calendarMonths:months.length,sourceMonthLengths:lengths,skipped}};
fs.writeFileSync(path.join(vendor,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest.output,null,2));
