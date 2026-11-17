/* Original shared browser/Node report policy. Redaction is heuristic, not an anonymity guarantee. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MosqueReports=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var MAX_BYTES=12288,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var SEMVER=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][A-Za-z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][A-Za-z0-9-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  function fail(message){var error=new Error(message);error.code='INVALID_REPORT';throw error;}
  function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))fail(label+' must be an object.');return value;}
  function keys(value,allowed,label){Object.keys(value).forEach(function(key){if(allowed.indexOf(key)<0)fail('Unknown '+label+' field: '+key);});}
  function sanitize(value){
    if(typeof value!=='string')fail('Report text must be a string.');
    return value.replace(/[٠-٩۰-۹]/g,function(c){var n=c.charCodeAt(0);return String(n>=1776?n-1776:n-1632);})
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
      .replace(/\b(authorization)\s*[:=]\s*[^\n]+/gi,'$1=[redacted]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [redacted]')
      .replace(/\b(api[_-]?key|access[_-]?token|token|password|passwd|secret|ssid|serial(?:number)?|session(?:id)?|latitude|longitude)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,'$1=[redacted]')
      .replace(/(اسم\s*الشبكة|الرقم\s*التسلسلي|كلمة\s*المرور|رمز\s*الوصول)\s*[:=]\s*[^\n]+/g,'$1=[redacted]')
      .replace(/\b[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+\b/gi,'[redacted]')
      .replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi,'[redacted]')
      .replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi,'[redacted]')
      .replace(/[0-9a-f:.]+(?:%[A-Za-z0-9_.-]+)?/gi,function(token){return token.indexOf('::')>=0||(token.match(/:/g)||[]).length>=7?'[redacted]':token;})
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[redacted]')
      .replace(/\+?\d[\d ()-]{5,}\d/g,function(token){return(token.match(/\d/g)||[]).length>=7?'[redacted]':token;});
  }
  function text(value,label,required){if(typeof value!=='string'||value.length>2000||(required&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(label+' must contain '+(required?'1':'0')+' to 2000 characters.');return value;}
  function count(value,label){if(!Number.isInteger(value)||value<0||value>1000)fail(label+' must be an integer from 0 to 1000.');return value;}
  function validate(input){
    object(input,'Report');keys(input,['schemaVersion','category','message','notes','appVersion','androidApi','manufacturer','setup','consent','nonce'],'report');
    if(input.schemaVersion!==1||['problem','setup'].indexOf(input.category)<0||input.consent!==true||typeof input.nonce!=='string'||!UUID.test(input.nonce))fail('Invalid schema, category, consent or UUID v4 nonce.');
    var message=text(input.message,'Message',true),notes=text(input.notes,'Notes',false);
    if(sanitize(message)!==message||sanitize(notes)!==notes)fail('Review a newly sanitized preview before sending.');
    if(typeof input.appVersion!=='string'||input.appVersion.length>50||!SEMVER.test(input.appVersion))fail('Invalid app version.');
    var out={schemaVersion:1,category:input.category,message:message,notes:notes,appVersion:input.appVersion};
    if(input.androidApi!==undefined){if(!Number.isInteger(input.androidApi)||input.androidApi<24||input.androidApi>100)fail('Android API must be an integer from 24 to 100.');out.androidApi=input.androidApi;}
    if(input.manufacturer!==undefined){if(['TCL','Sony','Samsung','Other'].indexOf(input.manufacturer)<0)fail('Unsupported generic manufacturer.');out.manufacturer=input.manufacturer;}
    if(input.setup!==undefined){object(input.setup,'Setup');keys(input.setup,['disabledCount','restoredCount'],'setup');out.setup={disabledCount:count(input.setup.disabledCount,'Disabled count'),restoredCount:count(input.setup.restoredCount,'Restored count')};}
    out.consent=true;out.nonce=input.nonce.toLowerCase();return out;
  }
  function serialize(input){var body=JSON.stringify(validate(input),null,2);if(new TextEncoder().encode(body).length>MAX_BYTES)fail('Report exceeds 12 KiB.');return body;}
  function prepare(input){object(input,'Report');var copy=Object.assign({},input);text(copy.message,'Message',true);text(copy.notes,'Notes',false);copy.message=sanitize(copy.message);copy.notes=sanitize(copy.notes);var result=validate(copy);serialize(result);return result;}
  return{MAX_BYTES:MAX_BYTES,sanitize:sanitize,prepare:prepare,validate:validate,serialize:serialize};
});
