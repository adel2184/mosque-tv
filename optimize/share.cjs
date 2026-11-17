#!/usr/bin/env node
'use strict';
/* Original local-preview-first agent CLI. No ADB, telemetry collection or automatic transmission. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const schema=require('../services/reports/public/report-schema.js');
const config=require('../services/reports/service-config.json');
function usage(){return 'Preview: node optimize/share.cjs --preview --problem --owner "Your message" "Additional notes" [--app-version 2.3.0] [--out FILE]\nSend only after reviewing FILE: node optimize/share.cjs --send FILE --confirm\nNothing is collected from the TV. The default preview file is outside the repository, in your temporary directory.';}
function args(values){const out={notes:[]};for(let i=0;i<values.length;i++){const value=values[i];if(['--preview','--problem','--setup','--confirm','--help'].includes(value)){if(out[value])throw Error('Repeated flag '+value);out[value]=true;}else if(['--send','--owner','--out','--app-version'].includes(value)){if(out[value]!==undefined||i+1>=values.length||values[i+1].startsWith('--'))throw Error('Missing or repeated '+value);out[value]=values[++i];}else if(value.startsWith('--'))throw Error('Unknown option '+value);else out.notes.push(value);}return out;}
function readPreview(file){const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(schema.MAX_BYTES+1);let length=0;try{if(!fs.fstatSync(fd).isFile())throw Error('Select a regular preview file.');for(;;){const read=fs.readSync(fd,buffer,length,buffer.length-length,null);length+=read;if(length>schema.MAX_BYTES)throw Error('Report exceeds 12 KiB.');if(!read)break;}return buffer.subarray(0,length);}finally{fs.closeSync(fd);}}
async function readResponse(response){const reader=response.body?.getReader();if(!reader)throw Error('Empty server response');let size=0,parts=[];try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>4096)throw Error('Server response too large');parts.push(x.value);}const all=new Uint8Array(size);let at=0;for(const x of parts){all.set(x,at);at+=x.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}finally{reader.cancel().catch(()=>{});}}
async function run(values,options={}){
  const a=args(values),print=options.print||console.log;
  if(a['--help']){print(usage());return{kind:'help'};}
  if(a['--preview']){
    if(a['--send']||a['--confirm']||Boolean(a['--problem'])===Boolean(a['--setup'])||a['--owner']===undefined)throw Error(usage());
    const payload=schema.prepare({schemaVersion:1,category:a['--setup']?'setup':'problem',message:a['--owner'],notes:a.notes.join(' '),appVersion:a['--app-version']||config.defaultAppVersion,consent:true,nonce:crypto.randomUUID()}),body=schema.serialize(payload);
    const file=path.resolve(a['--out']||path.join(os.tmpdir(),'mosque-tv-reports','report-'+payload.nonce+'.json'));
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body,{encoding:'utf8',flag:'wx',mode:0o600});
    print(body);print('LOCAL PREVIEW ONLY. Nothing was sent. Inspect and remove any remaining personal details before sending.');print('Reviewed file: '+file);print('Send explicitly: node optimize/share.cjs --send "'+file+'" --confirm');
    return{kind:'preview',file,body};
  }
  if(!a['--send']||!a['--confirm']||a['--problem']||a['--setup']||a['--owner']!==undefined||a['--out']!==undefined||a['--app-version']!==undefined||a.notes.length)throw Error(usage());
  const file=path.resolve(a['--send']),bytes=readPreview(file);
  const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes),payload=schema.validate(JSON.parse(body));
  if(schema.serialize(payload)!==body)throw Error('The file must be the exact canonical preview. Generate and review a new preview.');
  const origin=new URL(config.origin);if(origin.protocol!=='https:'||origin.origin!==config.origin||origin.username||origin.password||origin.port||config.endpoint!=='/api/reports')throw Error('Invalid public service configuration.');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await(options.fetcher||globalThis.fetch)(config.origin+config.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
    if(response.status===429)throw Error('Too many requests. Wait one minute and retry manually.');
    const result=await readResponse(response);if(![200,201].includes(response.status)||result.ok!==true||result.id!==payload.nonce)throw Error('The service did not confirm storage.');
    print('Service confirmed report storage. Reference: '+result.id+(result.duplicate?' (same report already stored)':''));return{kind:'sent',id:result.id,body};
  }catch(error){throw Error('Delivery was not confirmed; no offline queue exists. Retry the same reviewed file manually. '+(error.message||''));}finally{clearTimeout(timeout);}
}
module.exports={run};
if(require.main===module)run(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
