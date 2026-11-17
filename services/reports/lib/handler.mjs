import schema from '../public/report-schema.js';

const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const response=(status,value,extra={})=>new Response(JSON.stringify(value),{status,headers:{...HEADERS,...extra}});
export function storeScope(context){return context?.deploy?.context==='production'&&context.deploy.published===true?'production':'deploy';}
export async function readBody(request,timeoutMs=5000){
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>schema.MAX_BYTES))throw Object.assign(Error('Body too large'),{status:413});
  if(!request.body)throw Object.assign(Error('Missing JSON'),{status:400});
  const reader=request.body.getReader(),chunks=[];let size=0,timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Request body timed out'),{status:408})),timeoutMs);});
  try{
    for(;;){const item=await Promise.race([reader.read(),deadline]);if(item.done)break;size+=item.value.byteLength;if(size>schema.MAX_BYTES)throw Object.assign(Error('Body too large'),{status:413});chunks.push(item.value);}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(_){throw Object.assign(Error('Invalid UTF-8'),{status:400});}
  }catch(error){reader.cancel().catch(()=>{});throw error;}finally{clearTimeout(timer);}
}
export function createReportsHandler({openStore,now=()=>new Date(),readTimeoutMs=5000}){
  return async function(request,context={}){
    if(request.method!=='POST')return response(405,{ok:false,error:'method-not-allowed'},{allow:'POST'});
    const origin=request.headers.get('origin'),site=new URL(request.url).origin,fetchSite=request.headers.get('sec-fetch-site');
    if(origin!==null&&origin!==site||fetchSite&&fetchSite!=='same-origin'&&fetchSite!=='none')return response(403,{ok:false,error:'cross-origin-rejected'});
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||''))return response(415,{ok:false,error:'json-required'});
    let payload,canonical;
    try{payload=schema.validate(JSON.parse(await readBody(request,readTimeoutMs)));canonical=schema.serialize(payload);}
    catch(error){return response(error.status||400,{ok:false,error:error.code==='INVALID_REPORT'?'invalid-report':'invalid-json-or-body'});}
    try{
      const store=await openStore(context),key='reports/'+payload.nonce;
      const result=await store.setJSON(key,{schemaVersion:1,receivedAt:now().toISOString(),report:payload},{onlyIfNew:true});
      if(!result||typeof result.modified!=='boolean')throw Error('Storage confirmation unavailable');
      if(!result.modified){const existing=await store.get(key,{type:'json',consistency:'strong'});if(!existing||schema.serialize(existing.report)!==canonical)return response(409,{ok:false,error:'nonce-conflict'});return response(200,{ok:true,id:payload.nonce,duplicate:true});}
      return response(201,{ok:true,id:payload.nonce,duplicate:false});
    }catch(_){return response(503,{ok:false,error:'delivery-unconfirmed'});}
  };
}
