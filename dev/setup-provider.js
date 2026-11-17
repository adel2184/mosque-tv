/* Original, pure parser. Network access and committing settings belong to separate layers. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./location-engine.js'));
  else root.MosqueSetupProvider=factory(root.MosqueLocation);
})(typeof globalThis!=='undefined'?globalThis:typeof self!=='undefined'?self:this,function(location){
  'use strict';
  const FIELDS=['fajr','sunrise','dhuhr','asr','maghrib','isha'],DAY=86400000,MINUTE=60000;
  const METHODS=['UmmAlQura','MuslimWorldLeague','Egyptian','NorthAmerica','Karachi'];
  const HIGH_RULES=['MiddleOfTheNight (default)','MiddleOfTheNight'];
  const copy=value=>JSON.parse(JSON.stringify(value)),pad=value=>String(value).padStart(2,'0');
  function fail(code,message){const error=new Error(message);error.code=code;throw error;}
  function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_PAYLOAD',label+' must be an object.');return value;}
  function date(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
  function zone(value){
    if(typeof value!=='string'||value.length>100||!(/^(?:UTC|GMT|[A-Za-z_]+(?:\/[A-Za-z0-9_+.\-]+)+)$/.test(value)))fail('INVALID_TIMEZONE','Invalid source time zone.');
    try{return new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;}catch(_){fail('INVALID_TIMEZONE','Source time zone is unavailable on this device.');}
  }
  function explicitIso(value,label){
    if(typeof value!=='string'||value.length>40)fail('INVALID_INSTANT',label+' must include an ISO timestamp and explicit offset.');
    const match=value.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):([0-5]\d))$/);
    if(!match||!date(match[1])||(match[6]!=='Z'&&(Number(match[8])>14||Number(match[8])===14&&Number(match[9])!==0)))fail('INVALID_INSTANT',label+' has an invalid ISO date, time or offset.');
    const ms=Date.parse(value);if(!Number.isFinite(ms))fail('INVALID_INSTANT',label+' is not a finite instant.');return ms;
  }
  function sourceMetadata(raw,profile){
    object(raw,'Source response');const coordinates=object(raw.location,'Source location');
    for(const key of ['latitude','longitude'])if(typeof coordinates[key]!=='number'||!Number.isFinite(coordinates[key])||Math.abs(coordinates[key]-profile[key])>1e-6)fail('LOCATION_MISMATCH','Source coordinates do not match the selected location.');
    if(zone(raw.timezone)!==zone(profile.timezone))fail('TIMEZONE_MISMATCH','Source time zone does not match the selected zone.');
    if(raw.calculation_method!==profile.methodId)fail('METHOD_MISMATCH','Source method does not match the selected method.');
    if(raw.madhab!=='Shafi')fail('MADHAB_MISMATCH','Only the requested Shafi Asr policy is accepted.');
    if(!HIGH_RULES.includes(raw.high_latitude_rule))fail('HIGH_LATITUDE_MISMATCH','Source high-latitude rule is not the requested MiddleOfTheNight policy.');
  }
  function calendarLookup(calendar){
    object(calendar,'Umm al-Qura calendar');
    if(calendar.calendar!=='islamic-umalqura'||!date(calendar.rangeStart)||!date(calendar.rangeEnd)||calendar.rangeStart>calendar.rangeEnd||!Array.isArray(calendar.months)||calendar.months.length<2)fail('INVALID_CALENDAR','A complete local Umm al-Qura table is required.');
    calendar.months.forEach((item,index)=>{
      if(!item||!date(item.start)||!Number.isInteger(item.year)||item.year<1||!Number.isInteger(item.month)||item.month<1||item.month>12)fail('INVALID_CALENDAR','Invalid local month-start record.');
      if(index){const previous=calendar.months[index-1],days=(Date.parse(item.start+'T00:00:00Z')-Date.parse(previous.start+'T00:00:00Z'))/DAY;if(days<28||days>31||item.month!==previous.month%12+1||item.year!==previous.year+(previous.month===12?1:0))fail('INVALID_CALENDAR','Local month sequence is invalid.');}
    });
    return key=>{const h=location.hijriFromCalendar(key,calendar);if(!h)fail('HIJRI_OUT_OF_RANGE','The local Umm al-Qura table does not cover '+key+'.');return h;};
  }
  function row(raw,key,profile,hijri){
    object(raw,'Prayer day');if(!date(raw.date)||raw.date!==key)fail('DATE_MISMATCH','Source day does not match '+key+'.');
    const times=object(raw.prayer_times,'Prayer times'),iso=object(raw.prayer_datetimes,'Prayer timestamps');
    const result={date:key,instants:{}};let previous=-Infinity;
    const noon=location.timestamp(key,'12:00',profile.timezone);
    for(const field of FIELDS){
      if(typeof times[field]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(times[field]))fail('INVALID_TIME','Source '+field+' must be HH:mm.');
      const ms=Math.round(explicitIso(iso[field],field)/MINUTE)*MINUTE;
      if(!Number.isFinite(ms)||!Number.isSafeInteger(ms)||ms%MINUTE!==0||Math.abs(ms-noon)>36*3600000)fail('UNREASONABLE_INSTANT','Source '+field+' is outside its reasonable date window.');
      const local=location.wallParts(ms,profile.timezone);
      if(pad(local.hour)+':'+pad(local.minute)!==times[field])fail('WALL_TIME_MISMATCH','Source '+field+' timestamp does not match its local clock text.');
      if(ms<=previous)fail('PRAYER_ORDER','Prayer instants are not strictly ordered.');
      result[field]=times[field];result.instants[field]=ms;previous=ms;
    }
    if(location.dateKey(result.instants.dhuhr,profile.timezone)!==key)fail('CIVIL_DATE_MISMATCH','Dhuhr does not anchor the source civil date.');
    if(hijri){const expected=hijri(key).month===9?120:90;if((result.instants.isha-result.instants.maghrib)/MINUTE!==expected)fail('RAMADAN_ISHA_MISMATCH','Source Umm al-Qura Isha interval must be '+expected+' minutes on '+key+'; it was not corrected.');}
    return result;
  }
  function fromUmmah(input,validatedProfile,targetYear,calendar){
    if(!location||typeof location.validateProfile!=='function')fail('MISSING_ENGINE','The local location/time engine is unavailable.');
    const profile=location.validateProfile(validatedProfile);
    if(!METHODS.includes(profile.methodId))fail('METHOD_MISMATCH','Unsupported calculation method.');
    if(!Number.isInteger(targetYear)||targetYear<2000||targetYear>2075)fail('INVALID_YEAR','Target year must be from 2000 through 2075.');
    const payload=object(input,'Ummah payload');
    if(!Array.isArray(payload.months)||payload.months.length!==24||!Array.isArray(payload.boundary)||payload.boundary.length!==2)fail('RESPONSE_COUNT','Exactly 24 months and two boundary-day responses are required.');
    const hijri=profile.methodId==='UmmAlQura'?calendarLookup(calendar):null;
    const start=(targetYear-1)+'-12-31',end=(targetYear+2)+'-01-01',records=[];
    sourceMetadata(payload.boundary[0],profile);records.push(row(payload.boundary[0],start,profile,hijri));
    const monthsSeen=new Set();
    payload.months.forEach((raw,index)=>{
      sourceMetadata(raw,profile);const expectedYear=targetYear+Math.floor(index/12),expectedMonth=index%12+1;
      if(!Number.isInteger(raw.year)||!Number.isInteger(raw.month)||raw.year!==expectedYear||raw.month!==expectedMonth)fail('MONTH_ORDER','Source months must be unique and ordered across the requested two years.');
      const monthId=raw.year+'-'+pad(raw.month);if(monthsSeen.has(monthId))fail('DUPLICATE_MONTH','Source month is repeated.');monthsSeen.add(monthId);
      const days=new Date(Date.UTC(raw.year,raw.month,0)).getUTCDate();
      if(!Number.isInteger(raw.total_days)||raw.total_days!==days||!Array.isArray(raw.days)||raw.days.length!==days)fail('MONTH_COVERAGE','Source month has missing or extra days.');
      raw.days.forEach((day,index)=>{if(!day||day.day!==index+1)fail('DAY_ORDER','Source days must be unique and in Gregorian order.');records.push(row(day,monthId+'-'+pad(index+1),profile,hijri));});
    });
    sourceMetadata(payload.boundary[1],profile);records.push(row(payload.boundary[1],end,profile,hijri));
    const count=(Date.UTC(targetYear+2,0,1)-Date.UTC(targetYear,0,1))/DAY+2;
    if(records.length!==count)fail('DATE_COVERAGE','Source table is incomplete.');
    const seen=new Set();let previousIsha=-Infinity;
    records.forEach((item,index)=>{
      if(seen.has(item.date)||item.date!==location.addDays(start,index))fail('DATE_COVERAGE','Source dates must be unique and contiguous including guards.');seen.add(item.date);
      if(item.instants.fajr<=previousIsha)fail('OVERLAPPING_PRAYERS','Source Isha overlaps the next Fajr.');previousIsha=item.instants.isha;
    });
    let fetchedAtSource='importing-device',fetchedAt=new Date().toISOString();
    if(payload.fetchedAt!==undefined){explicitIso(payload.fetchedAt,'fetchedAt');fetchedAt=payload.fetchedAt;fetchedAtSource='caller-provided';}
    const generatedOn=new Date().toISOString().slice(0,10),preset=location.methodPresets[profile.methodId];
    return{metadata:{schemaVersion:1,dataVersion:'ummahapi-'+profile.countryId+'-'+profile.cityId+'-'+targetYear+'-'+(targetYear+1)+'-calculated-1',targetYear,displayYears:[targetYear,targetYear+1],countryId:profile.countryId,cityId:profile.cityId,city:profile.cityId,timezone:profile.timezone,utcOffset:'iana-dynamic',utcOffsetRule:'IANA rules from this device Intl implementation; explicit supplied timestamps are checked at each instant.',coordinates:{latitude:profile.latitude,longitude:profile.longitude,note:'Selected location matched to every response within 0.000001 degrees; review the exact mosque site.'},rangeStart:start,rangeEnd:end,displayStart:targetYear+'-01-01',displayEnd:(targetYear+1)+'-12-31',boundaryOnly:[start,end],source:'Calculated timings supplied by UmmahAPI; not an official or mosque-approved timetable. Local review required.',sourceUrl:'https://ummahapi.com/api/docs',generatedOn,fetchedAt,fetchedAtSource,verificationStatus:'calculated-needs-review',statusArabic:'مواقيت محسوبة من UmmahAPI — تحتاج مراجعة',civilDateAnchor:'dhuhr',instantRule:'Absolute UTC epoch milliseconds from explicit provider ISO offsets, rounded to whole minutes and checked against local HH:mm; prayers may cross civil midnight.',sourceResponsesValidated:26,sourceMonthlyResponses:24,sourceBoundaryResponses:2,calculation:{library:'UmmahAPI (remote astronomical calculation)',method:profile.methodId,madhab:'Shafi',asrShadowFactor:1,fajrAngle:null,ishaAngle:null,namedPreset:copy(preset),parameterProvenance:'Named preset parameters are reference descriptions; provider responses do not report their exact angle/adjustment implementation.',ishaMinutesOutsideRamadan:hijri?90:null,ishaMinutesRamadan:hijri?120:null,ramadanCalendar:hijri?'Bundled local civil Umm al-Qura month-start table; interval checked for every supplied date.':null,ramadanRule:hijri?'Exactly 120 minutes in Ramadan and 90 otherwise; reject mismatches without correction.':null,adjustmentsMinutes:null,methodAdjustmentsMinutes:null,rounding:'Nearest whole minute on supplied ISO instants; rounded IANA wall time must match supplied HH:mm.',highLatitudeRule:'Provider-reported MiddleOfTheNight default; invalid or overlapping events rejected.',polarCircleResolution:'Importer fabricates no replacement dates or locations.',elevationMeters:null,presets:copy(location.methodPresets)}},records};
  }
  return{fromUmmah};
});
