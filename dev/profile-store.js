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
  return {key:KEY,read,commit};
});
