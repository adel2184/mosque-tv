/* Original offline location/time engine. Adhan JS 4.4.3 is vendored separately (MIT). */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/adhan/package/lib/bundles/adhan.umd.js'));
  else root.MosqueLocation=factory(root.adhan);
})(typeof globalThis!=='undefined'?globalThis:typeof self!=='undefined'?self:this,function(adhan){
  'use strict';
  const DAY=86400000,MINUTE=60000,FIELDS=['fajr','sunrise','dhuhr','asr','maghrib','isha'];
  const PRESETS={
    UmmAlQura:{fajrAngle:18.5,ishaAngle:0,ishaMinutesOutsideRamadan:90,ishaMinutesRamadan:120,dhuhrAdjustment:0},
    MuslimWorldLeague:{fajrAngle:18,ishaAngle:17,ishaMinutesOutsideRamadan:null,ishaMinutesRamadan:null,dhuhrAdjustment:1},
    Egyptian:{fajrAngle:19.5,ishaAngle:17.5,ishaMinutesOutsideRamadan:null,ishaMinutesRamadan:null,dhuhrAdjustment:1},
    NorthAmerica:{fajrAngle:15,ishaAngle:15,ishaMinutesOutsideRamadan:null,ishaMinutesRamadan:null,dhuhrAdjustment:1},
    Karachi:{fajrAngle:18,ishaAngle:18,ishaMinutesOutsideRamadan:null,ishaMinutesRamadan:null,dhuhrAdjustment:1}
  };
  const formatters=new Map(),zones=new Map(),offsetCandidates=new Map();
  const copy=value=>JSON.parse(JSON.stringify(value)),pad=value=>String(value).padStart(2,'0');
  function fail(code,message){const error=new Error(message);error.code=code;throw error;}
  function boundedCache(cache,key,value,limit){if(cache.size>=limit)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}
  function zoneFormatter(zone){
    if(typeof zone!=='string'||zone.length>100||!(/^(?:UTC|GMT|[A-Za-z_]+(?:\/[A-Za-z0-9_+.\-]+)+)$/.test(zone)))fail('INVALID_TIMEZONE','Choose a valid IANA time zone.');
    if(formatters.has(zone))return formatters.get(zone);
    let formatter;
    try{formatter=new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn',{timeZone:zone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formatter.format(0);}
    catch(_){fail('INVALID_TIMEZONE','The selected IANA time zone is unavailable on this device.');}
    boundedCache(zones,zone,formatter.resolvedOptions().timeZone,128);
    return boundedCache(formatters,zone,formatter,64);
  }
  function validDate(key){
    if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key))return false;
    const ms=Date.parse(key+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===key;
  }
  function requireDate(key){if(!validDate(key))fail('INVALID_DATE','Use a real Gregorian date in YYYY-MM-DD form.');return key;}
  function utcStamp(key){return Date.parse(requireDate(key)+'T00:00:00Z');}
  function addDays(key,count){
    if(!Number.isInteger(count)||Math.abs(count)>366000)fail('INVALID_DAY_OFFSET','Day offset must be a bounded integer.');
    const ms=utcStamp(key)+count*DAY,out=new Date(ms).toISOString().slice(0,10);return requireDate(out);
  }
  function wallParts(ms,zone){
    if(typeof ms!=='number'||!Number.isFinite(ms)||!Number.isFinite(new Date(ms).getTime()))fail('INVALID_TIMESTAMP','Timestamp must be a finite epoch millisecond value.');
    const values={};for(const part of zoneFormatter(zone).formatToParts(new Date(ms)))if(['year','month','day','hour','minute','second'].includes(part.type))values[part.type]=Number(part.value);
    if(values.hour===24)values.hour=0;
    if(Object.keys(values).length!==6||Object.values(values).some(value=>!Number.isInteger(value)))fail('UNSUPPORTED_INTL','This device cannot format the selected time zone.');
    return values;
  }
  function keyOf(parts){return String(parts.year).padStart(4,'0')+'-'+pad(parts.month)+'-'+pad(parts.day);}
  function dateKey(ms,zone){return requireDate(keyOf(wallParts(ms,zone)));}
  function offsetMillis(ms,zone){const p=wallParts(ms,zone);return Date.parse(keyOf(p)+'T'+pad(p.hour)+':'+pad(p.minute)+':'+pad(p.second)+'Z')-Math.floor(ms/1000)*1000;}
  function timestamp(key,time,zone){
    requireDate(key);if(typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))fail('INVALID_TIME','Use HH:mm in the 24-hour clock.');
    zoneFormatter(zone);const naive=Date.parse(key+'T'+time+':00Z'),cacheKey=zone+'|'+key;
    let offsets=offsetCandidates.get(cacheKey);
    if(!offsets){const unique=new Set();for(let h=-48;h<=48;h+=6)unique.add(offsetMillis(naive+h*3600000,zone));offsets=[...unique];boundedCache(offsetCandidates,cacheKey,offsets,2048);}
    const expectedHour=Number(time.slice(0,2)),expectedMinute=Number(time.slice(3)),matches=[];
    for(const offset of offsets){const ms=naive-offset,p=wallParts(ms,zone);if(keyOf(p)===key&&p.hour===expectedHour&&p.minute===expectedMinute&&p.second===0)matches.push(ms);}
    if(!matches.length)fail('NONEXISTENT_LOCAL_TIME','This local time does not exist because the time-zone clock changes.');
    return Math.min(...matches); // Explicit policy for a repeated DST hour: the earlier occurrence.
  }
  function text(value,limit,label,required){if(typeof value!=='string'||value.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||(required&&!value.trim()))fail('INVALID_PROFILE',label+' is missing or too long.');return value;}
  function coordinate(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('INVALID_COORDINATE',label+' is outside the supported range.');return value;}
  function validateProfile(input,catalog){
    if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_PROFILE','Location profile must be an object.');
    if(!['ar','en'].includes(input.language)||![12,24].includes(input.hourFormat)||!['both','hijri','gregorian'].includes(input.dateStyle)||!Object.prototype.hasOwnProperty.call(PRESETS,input.methodId))fail('INVALID_PROFILE','Choose a supported language, clock, date style, and calculation method.');
    const countryId=text(input.countryId,2,'Country',true),cityId=text(input.cityId,80,'City',true);
    if(!/^[A-Z]{2}$/.test(countryId)||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(cityId))fail('INVALID_CITY','Choose a valid country and city.');
    zoneFormatter(input.timezone);
    const output={language:input.language,countryId,cityId,timezone:input.timezone,hourFormat:input.hourFormat,dateStyle:input.dateStyle,methodId:input.methodId,neighborhood:text(input.neighborhood,180,'Neighborhood',false),mosqueName:text(input.mosqueName,180,'Mosque name',true),latitude:coordinate(input.latitude,-89,89,'Latitude'),longitude:coordinate(input.longitude,-180,180,'Longitude')};
    if(catalog!==undefined&&catalog!==null){
      const countries=Array.isArray(catalog)?catalog:catalog.countries;
      if(!Array.isArray(countries))fail('INVALID_CATALOG','The bundled country/city catalog is unavailable.');
      const country=countries.find(item=>item&&item.id===countryId),city=country&&Array.isArray(country.cities)&&country.cities.find(item=>item&&String(item.id)===cityId);
      if(!city)fail('INVALID_CITY','The selected city does not belong to the selected country.');
      const latitude=coordinate(city.latitude,-89,89,'City latitude'),longitude=coordinate(city.longitude,-180,180,'City longitude');
      if(Math.abs(latitude-output.latitude)>0.00001||Math.abs(longitude-output.longitude)>0.00001)fail('CITY_COORDINATE_MISMATCH','Coordinates must match the selected catalog city.');
      output.latitude=latitude;output.longitude=longitude;
      // The operator may deliberately choose a zone different from the city default.
    }
    return output;
  }
  function convertDigits(value,style){if(style!=='arabic'&&style!=='western'&&style!==undefined)fail('INVALID_DIGITS','Unsupported digit style.');return style==='arabic'?String(value).replace(/[0-9]/g,n=>'٠١٢٣٤٥٦٧٨٩'[Number(n)]):String(value);}
  function clockOptions(profile){if(!profile||!['ar','en'].includes(profile.language)||![12,24].includes(profile.hourFormat))fail('INVALID_PROFILE','Clock options require language and hourFormat.');zoneFormatter(profile.timezone);return profile;}
  function formatClock(ms,profile,digitStyle){
    const p=wallParts(ms,clockOptions(profile).timezone),twelve=profile.hourFormat===12,hour=twelve?p.hour%12||12:p.hour;
    return {time:convertDigits(pad(hour)+':'+pad(p.minute)+':'+pad(p.second),digitStyle),period:twelve?(profile.language==='ar'?(p.hour<12?'ص':'م'):(p.hour<12?'AM':'PM')):''};
  }
  function formatTime(ms,profile,digitStyle){const value=formatClock(ms,profile,digitStyle);return value.time.slice(0,-3)+(value.period?' '+value.period:'');}
  function monthValid(month){return month&&validDate(month.start)&&Number.isInteger(month.year)&&month.year>0&&Number.isInteger(month.month)&&month.month>=1&&month.month<=12;}
  function lookupHijri(key,calendar){
    requireDate(key);if(!calendar||!Array.isArray(calendar.months)||calendar.months.length<2||!validDate(calendar.rangeStart)||!validDate(calendar.rangeEnd))fail('INVALID_CALENDAR','A local Umm al-Qura month-start table is required.');
    if(key<calendar.rangeStart||key>calendar.rangeEnd)return null;
    const months=calendar.months;let lo=0,hi=months.length-1;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(!monthValid(months[mid]))fail('INVALID_CALENDAR','Invalid local calendar month.');if(months[mid].start<=key)lo=mid;else hi=mid;}
    const current=months[lo],next=months[lo+1];if(!monthValid(current)||!monthValid(next)||key<current.start||key>=next.start)fail('INVALID_CALENDAR','Local calendar has no complete month boundary for this date.');
    const day=Math.round((utcStamp(key)-utcStamp(current.start))/DAY)+1;if(day<1||day>31)fail('INVALID_CALENDAR','Local calendar contains an invalid month length.');
    return{year:current.year,month:current.month,day};
  }
  function hijriFromCalendar(key,calendar){return lookupHijri(key,calendar);}
  function checkedCalendar(calendar){
    if(!calendar||!Array.isArray(calendar.months)||calendar.months.length<2)fail('INVALID_CALENDAR','A local Umm al-Qura month-start table is required.');
    for(let i=0;i<calendar.months.length;i++){
      const item=calendar.months[i];if(!monthValid(item))fail('INVALID_CALENDAR','Invalid local calendar month.');
      // Preserve historical 28/31-day entries in the verified source table unchanged.
      if(i){const prev=calendar.months[i-1],days=(utcStamp(item.start)-utcStamp(prev.start))/DAY;if(days<28||days>31||item.month!==prev.month%12+1||item.year!==prev.year+(prev.month===12?1:0))fail('INVALID_CALENDAR','Local calendar month sequence is invalid.');}
    }
    lookupHijri(calendar.rangeStart,calendar);lookupHijri(calendar.rangeEnd,calendar);return key=>lookupHijri(key,calendar);
  }
  function civilInputDate(key){
    const parts=key.split('-').map(Number),date=new Date(parts[0],parts[1]-1,parts[2],12,0,0,0),tomorrow=new Date(parts[0],parts[1]-1,parts[2]+1,12,0,0,0),expected=addDays(key,1);
    const localKey=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
    if(localKey(date)!==key||localKey(tomorrow)!==expected)fail('UNSUPPORTED_HOST_DATE','The host calendar skips this civil date; calculation cannot safely continue.');
    return date; // Adhan reads civil Date components, never a selected-zone instant.
  }
  function parameters(methodId,ramadan){
    if(!adhan||!adhan.CalculationMethod||typeof adhan.CalculationMethod[methodId]!=='function')fail('MISSING_LIBRARY','The bundled Adhan JS 4.4.3 library is unavailable.');
    const params=adhan.CalculationMethod[methodId]();params.madhab=adhan.Madhab.Shafi;params.rounding=adhan.Rounding.Nearest;
    if(methodId==='UmmAlQura')params.ishaInterval=ramadan?120:90;
    return params;
  }
  function calculate(input,targetYear,calendar){
    const profile=validateProfile(input);
    if(!Number.isInteger(targetYear)||targetYear<2000||targetYear>2100)fail('INVALID_YEAR','Choose a target year from 2000 through 2100.');
    let hijriForDate=null;
    if(profile.methodId==='UmmAlQura')hijriForDate=typeof calendar==='function'?calendar:checkedCalendar(calendar);
    const start=(targetYear-1)+'-12-31',end=(targetYear+2)+'-01-01',records=[],preset=PRESETS[profile.methodId];
    let previousIsha=null;
    for(let key=start;key<=end;key=addDays(key,1)){
      let ramadan=false;
      if(hijriForDate){const h=hijriForDate(key);if(!h||!Number.isInteger(h.year)||!Number.isInteger(h.month)||h.month<1||h.month>12||!Number.isInteger(h.day)||h.day<1||h.day>31)fail('HIJRI_OUT_OF_RANGE','The local Umm al-Qura table does not cover '+key+'.');ramadan=h.month===9;}
      let solarKey=key,times=null;
      for(let attempt=0;attempt<4;attempt++){
        times=new adhan.PrayerTimes(new adhan.Coordinates(profile.latitude,profile.longitude),civilInputDate(solarKey),parameters(profile.methodId,ramadan));
        const noon=times.dhuhr&&times.dhuhr.getTime();if(!Number.isFinite(noon))fail('UNRESOLVED_PRAYERS','No finite prayer calculation for '+key+' at these coordinates.');
        const noonKey=dateKey(noon,profile.timezone);if(noonKey===key)break;
        const shift=Math.round((utcStamp(key)-utcStamp(noonKey))/DAY);if(Math.abs(shift)>2||attempt===3)fail('CIVIL_DATE_MISMATCH','Prayer calculation cannot be aligned to the selected civil date.');solarKey=addDays(solarKey,shift);
      }
      const row={date:key,instants:{}};let last=-Infinity;
      for(const field of FIELDS){
        const ms=times[field]&&times[field].getTime();if(!Number.isFinite(ms)||ms<=last)fail('UNRESOLVED_PRAYERS','Prayers are unavailable or out of order on '+key+'; a local reviewed high-latitude policy is required.');
        const p=wallParts(ms,profile.timezone);row[field]=pad(p.hour)+':'+pad(p.minute);row.instants[field]=ms;last=ms;
      }
      if(previousIsha!==null&&row.instants.fajr<=previousIsha)fail('OVERLAPPING_PRAYERS','Calculated Isha and the following Fajr overlap near '+key+'; a local reviewed policy is required.');
      previousIsha=row.instants.isha;records.push(row);
    }
    const sample=parameters(profile.methodId,false),generatedOn=dateKey(Date.now(),'UTC');
    return{metadata:{schemaVersion:1,dataVersion:'location-'+profile.countryId+'-'+profile.cityId+'-'+targetYear+'-'+(targetYear+1)+'-calculated-1',targetYear,displayYears:[targetYear,targetYear+1],countryId:profile.countryId,cityId:profile.cityId,city:profile.cityId,timezone:profile.timezone,utcOffset:'iana-dynamic',utcOffsetRule:'IANA time-zone rules from this device Intl implementation, evaluated separately at each absolute instant.',coordinates:{latitude:profile.latitude,longitude:profile.longitude,note:'Selected city coordinates; verify the exact mosque location and local timetable.'},rangeStart:start,rangeEnd:end,displayStart:targetYear+'-01-01',displayEnd:(targetYear+1)+'-12-31',boundaryOnly:[start,end],source:'Calculated locally with vendored Adhan JS 4.4.3 (Batoul Apps, MIT). Not an official or mosque-approved timetable.',sourceUrl:'https://github.com/batoulapps/adhan-js/tree/v4.4.3',generatedOn,verificationStatus:'calculated-needs-review',statusArabic:'مواقيت محسوبة — تحتاج مراجعة',civilDateAnchor:'dhuhr',instantRule:'Each row contains absolute UTC epoch milliseconds. Other prayers may cross civil midnight; do not reconstruct them from HH:mm alone.',calculation:{library:'Adhan JS 4.4.3',method:profile.methodId,fajrAngle:preset.fajrAngle,ishaAngle:preset.ishaAngle,asrShadowFactor:1,ishaMinutesOutsideRamadan:preset.ishaMinutesOutsideRamadan,ishaMinutesRamadan:preset.ishaMinutesRamadan,ramadanCalendar:profile.methodId==='UmmAlQura'?'Caller-supplied local civil Umm al-Qura table; dates follow the selected zone.':null,ramadanRule:profile.methodId==='UmmAlQura'?'Isha interval is exactly 120 minutes on Ramadan dates and 90 otherwise; no extra +30 adjustment.':null,adjustmentsMinutes:copy(sample.adjustments),methodAdjustmentsMinutes:copy(sample.methodAdjustments),rounding:'Nearest whole minute; seconds >=30 round upward (Adhan Rounding.Nearest).',highLatitudeRule:'MiddleOfTheNight library default; unresolved polar days or overlapping night prayers are rejected. Local review is required.',polarCircleResolution:'Unresolved; no fabricated replacement day or location.',elevationMeters:0,presets:copy(PRESETS)}},records};
  }
  return{validateProfile,wallParts,dateKey,addDays,timestamp,formatClock,formatTime,hijriFromCalendar,calculate,methodPresets:copy(PRESETS)};
});
