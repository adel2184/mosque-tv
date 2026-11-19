/* One local commit keeps a location, its timetable and the mosque settings together. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MosqueProfileStore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEY='mosque-display.installation.v1',MAX_BYTES=3000000;
  function bytes(text){let size=0;for(const c of text){const n=c.codePointAt(0);size+=n>65535?4:n>2047?3:n>127?2:1;}return size;}
  function validate(value){
    const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
    if(!object(value)||value.schemaVersion!==1||!object(value.profile)||!object(value.settings)||!object(value.timetable)||typeof value.completedAt!=='string'||!Number.isFinite(Date.parse(value.completedAt))||new Date(value.completedAt).toISOString()!==value.completedAt)throw Error('Invalid installation snapshot.');
    return value;
  }
  function read(storage){const raw=storage.getItem(KEY);if(raw===null)return null;if(bytes(raw)>MAX_BYTES)throw Error('Installation snapshot is too large.');return validate(JSON.parse(raw));}
  function commit(storage,value){const candidate=validate(value),raw=JSON.stringify(candidate);if(bytes(raw)>MAX_BYTES)throw Error('Installation snapshot is too large.');storage.setItem(KEY,raw);return candidate;}
  // A phone edit changes the profile/settings but keeps the validated timetable.
  // Serialize its rows in bounded slices, then replace the same atomic key once.
  async function prepareSettingsCommit(value, checkpoint) {
    validate(value);
    const {timetable,...installation}=value, {records,...tableInfo}=timetable;
    if(!Array.isArray(records))throw Error('Invalid installation timetable.');
    const prefix=JSON.stringify(installation).slice(0,-1)+',"timetable":{'+
      Object.entries(tableInfo).map(([key,data])=>JSON.stringify(key)+':'+JSON.stringify(data)).join(',')+
      (Object.keys(tableInfo).length?',':'')+'"records":[';
    const parts=[prefix];
    let used=bytes(prefix)+3; // trailing ]}}
    if(used>MAX_BYTES)throw Error('Installation snapshot is too large.');
    for(let i=0;i<records.length;i++) {
      const row=(i?',':'')+JSON.stringify(records[i]);
      parts.push(row);used+=bytes(row);
      if(used>MAX_BYTES)throw Error('Installation snapshot is too large.');
      if((i&7)===7){const pause=checkpoint();if(pause)await pause;}
    }
    parts.push(']}}');
    const serialized=parts.join('');
    return storage=>storage.setItem(KEY,serialized);
  }
  return {key:KEY,read,commit,prepareSettingsCommit};
});
