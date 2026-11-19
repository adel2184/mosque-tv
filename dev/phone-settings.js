/* Only plain, bounded display data crosses the paired phone settings boundary. */
(function(root, factory) {
  const schema = factory();
  if (typeof module === 'object' && module.exports) module.exports = schema;
  else root.MosquePhoneSchema = schema;
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  const prayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const fields = ['mosqueName', 'neighborhood', 'announcements', 'iqamaOffsets', 'jumuahTime',
    'prayerModeMinutes', 'manualOverrides', 'silentPhoneReminder', 'postPrayerMinutes', 'hourFormat', 'dateStyle'];
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  function requireValue(condition) { if (!condition) throw Error('invalid'); }
  function object(value, required, optional = []) {
    requireValue(value && typeof value === 'object' && !Array.isArray(value));
    requireValue(required.every(k => Object.prototype.hasOwnProperty.call(value,k)));
    requireValue(Object.keys(value).every(k => required.includes(k) || optional.includes(k)));
  }
  function text(value, max, required = false) {
    requireValue(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0));
    // Keep ordinary punctuation and Arabic combining marks. All consumers use textContent/value.
    requireValue(!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value));
    return value;
  }
  function integer(value, min, max) { requireValue(Number.isInteger(value) && value >= min && value <= max); }
  function validateAnnouncements(items) {
    requireValue(Array.isArray(items) && items.length <= 16);
    return items.map(item => {
      object(item, ['label','text']);
      return {label:text(item.label,60), text:text(item.text,300,true)};
    });
  }
  function validateOverrides(items) {
    requireValue(Array.isArray(items) && items.length <= 80);
    const seen = new Set();
    return items.map(item => {
      object(item, ['date','prayer','time']);
      requireValue(typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
      const stamp = Date.parse(item.date+'T00:00:00Z');
      requireValue(Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0,10) === item.date);
      requireValue(prayers.includes(item.prayer) && typeof item.time === 'string' && clock.test(item.time));
      const key = item.date+'/'+item.prayer;
      requireValue(!seen.has(key)); seen.add(key);
      return {date:item.date, prayer:item.prayer, time:item.time};
    });
  }
  function validatePreferences(p) {
    object(p,['hourFormat','dateStyle','neighborhood']);
    requireValue([12,24].includes(p.hourFormat) && ['both','hijri','gregorian','none'].includes(p.dateStyle));
    return {hourFormat:p.hourFormat,dateStyle:p.dateStyle,neighborhood:text(p.neighborhood,180)};
  }
  function validateEditor(value) {
    object(value, fields);
    text(value.mosqueName,180);
    validatePreferences({hourFormat:value.hourFormat,dateStyle:value.dateStyle,neighborhood:value.neighborhood});
    object(value.iqamaOffsets, prayers);
    prayers.forEach(p => integer(value.iqamaOffsets[p],1,180));
    integer(value.prayerModeMinutes,1,60);
    requireValue(typeof value.jumuahTime === 'string' && (value.jumuahTime === '' || clock.test(value.jumuahTime)));
    requireValue(typeof value.silentPhoneReminder === 'boolean' && [0,3,5,7].includes(value.postPrayerMinutes));
    return {...value, iqamaOffsets:{...value.iqamaOffsets},
      announcements:validateAnnouncements(value.announcements), manualOverrides:validateOverrides(value.manualOverrides)};
  }
  function friday(o) { return o.kind==='weekday' && o.match==='5' && o.prayer==='dhuhr'; }
  function project(s, preferences, defaultTicker) {
    const fixed = s.iqama.overrides.find(friday);
    return {mosqueName:s.mosque.fields.name.value, neighborhood:preferences.neighborhood,
      announcements:(s.announcements ?? defaultTicker).map(({label,text}) => ({label,text})),
      iqamaOffsets:{...s.iqama.offsets}, jumuahTime:fixed?.time || '', prayerModeMinutes:s.prayerModeMinutes,
      manualOverrides:(s.manualOverrides || []).map(o=>({...o})), silentPhoneReminder:s.silentPhoneReminder,
      postPrayerMinutes:s.postPrayerMinutes, hourFormat:preferences.hourFormat, dateStyle:preferences.dateStyle};
  }
  function updateFriday(iqama, time) {
    const index = iqama.overrides.findIndex(friday);
    if (index >= 0) {
      if (time) iqama.overrides[index].time = time;
      else iqama.overrides.splice(index,1);
    } else if (time) {
      let index=0, id='phone-jumuah';
      while (iqama.overrides.some(item=>item.id===id)) id='phone-jumuah-'+(++index);
      iqama.overrides.push({id,kind:'weekday',match:'5',prayer:'dhuhr',time,label:''});
    }
  }
  function validateBackup(b) {
    object(b,['schemaVersion','mosque','iqama','prayerModeMinutes','slideSeconds','digitStyle','location'],
      ['announcements','manualOverrides','displayPreferences','silentPhoneReminder','postPrayerMinutes','adhanAdjustments','donation']);
    object(b.mosque,['enabled','fields','custom']);
    const keys=['name','address','subtitle','imam','contact','announcement'];
    object(b.mosque.fields,keys);
    for(const k of keys) {const f=b.mosque.fields[k];object(f,['value','visible']);text(f.value,k==='name'?180:360);}
    requireValue(Array.isArray(b.mosque.custom)&&b.mosque.custom.length<=8);
    for(const f of b.mosque.custom) {object(f,['id','label','value','visible']);text(f.id,60,true);text(f.label,60);text(f.value,240);}
    object(b.iqama,['offsets','confirmed','overrides']);object(b.iqama.offsets,prayers);
    requireValue(Array.isArray(b.iqama.overrides)&&b.iqama.overrides.length<=80);
    for(const o of b.iqama.overrides) {object(o,['id','kind','match','prayer','time'],['label']);text(o.id,60);if(o.label!==undefined)text(o.label,80);}
    object(b.location,['latitude','longitude']);
    if(b.adhanAdjustments!==undefined)object(b.adhanAdjustments,[],[...prayers,'sunrise']);
    if(b.donation!==undefined){object(b.donation,['visible','title','description']);text(b.donation.title,90);text(b.donation.description,180);}
    // The installation's ordinary validator supplies the remaining numeric and calendar rules.
  }
  return {object, validateEditor, validatePreferences, validateAnnouncements, validateOverrides, validateBackup, project, updateFriday};
});
