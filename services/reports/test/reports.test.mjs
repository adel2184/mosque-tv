import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createReportsHandler,storeScope } from '../lib/handler.mjs';
import health from '../netlify/functions/health.mjs';
import schema from '../public/report-schema.js';
const require=createRequire(import.meta.url),cli=require('../../../optimize/share.cjs'),checks=[];
const valid=(change={})=>({schemaVersion:1,category:'problem',message:'The settings button did not open.',notes:'Reopening the app helped.',appVersion:'2.3.0',consent:true,nonce:'77ffb9e7-5e87-4138-91ec-d6d60f2970fd',...change});
const req=(body,headers={},method='POST')=>new Request('https://mosque-tv-reports-adel2184.netlify.app/api/reports',{method,headers:{'content-type':'application/json',...headers},...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
const fixture=()=>{const data=new Map();let opens=0,writes=0;return{data,get opens(){return opens;},get writes(){return writes;},openStore(){opens++;return{async setJSON(key,value,options){assert.equal(options.onlyIfNew,true);if(data.has(key))return{modified:false};writes++;data.set(key,value);return{modified:true};},async get(key,options){assert.equal(options.consistency,'strong');return data.get(key)||null;}};}};};
async function test(name,fn){try{await fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}}

await test('Standalone reports require a supplied app version and the offline CLI defaults to the release manifest',()=>{
  const manifest=fs.readFileSync(new URL('../../../android/AndroidManifest.xml',import.meta.url),'utf8');
  const config=JSON.parse(fs.readFileSync(new URL('../service-config.json',import.meta.url),'utf8'));
  assert.equal(config.defaultAppVersion,manifest.match(/android:versionName="([^"]+)"/)[1]);
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const versionInput=html.match(/<input\b[^>]*\bid="appVersion"[^>]*>/)[0];
  assert.doesNotMatch(versionInput,/\bvalue="[^"]+"/);assert.match(versionInput,/\brequired\b/);
});

await test('Sanitization removes IPv4, compressed/full IPv6, MAC, email, URL, Arabic phone and labelled tokens; repeated sanitization is stable',()=>{
  const raw='IPv4 192.168.1.100 IPv6 2001:db8::1 full 2001:db8:0:0:0:0:0:1 MAC aa:bb:cc:dd:ee:ff mail person@example.com URL https://example.com/a?token=secret phone ٠٥٥١٢٣٤٥٦٧ token=abcdef SSID="Private Network"\nauthorization: Bearer something';
  const clean=schema.sanitize(raw);for(const secret of ['192.168','2001:db8','aa:bb','person@','https://','0551234567','abcdef','Private Network','something'])assert.ok(!clean.includes(secret),secret);assert.equal(schema.sanitize(clean),clean);assert.ok(schema.sanitize('Clock 13:17:00').includes('13:17:00'));
});
await test('Prepare sanitizes before literal canonical preview and does not mutate the operator input',()=>{const input=valid({message:'Contact person@example.com'}),copy=JSON.stringify(input),prepared=schema.prepare(input);assert.equal(JSON.stringify(input),copy);assert.equal(prepared.message,'Contact [redacted]');assert.equal(JSON.parse(schema.serialize(prepared)).message,prepared.message);});
await test('Strict schema rejects unknown keys, bad enum/unit/version/UUID/consent and overlong free text',()=>{
  for(const bad of [null,[],valid({ip:'192.0.2.1'}),valid({category:'other'}),valid({consent:false}),valid({nonce:'not-uuid'}),valid({androidApi:23}),valid({androidApi:'30'}),valid({manufacturer:'Unique Device'}),valid({appVersion:'<script>'}),valid({appVersion:'01.2.3'}),valid({appVersion:'1.2.3-01'}),valid({setup:{disabledCount:1,restoredCount:0,extra:1}}),valid({setup:{disabledCount:-1,restoredCount:0}}),valid({message:'x'.repeat(2001)})])assert.throws(()=>schema.validate(bad));
  assert.equal(schema.validate(valid({appVersion:'1234.0.0-rc.1+build.2026'})).appVersion,'1234.0.0-rc.1+build.2026');
});
await test('UTF-8 report size uses bytes, not characters',()=>{assert.throws(()=>schema.serialize(valid({message:'漢'.repeat(2000),notes:'漢'.repeat(2000),androidApi:30,manufacturer:'Samsung',setup:{disabledCount:1000,restoredCount:1000}})),/12 KiB/);});
await test('Server stores exactly sanitized fields plus receivedAt; no IP, headers, cookies or context data',async()=>{
  const f=fixture(),handler=createReportsHandler({openStore:()=>f.openStore(),now:()=>new Date('2026-11-17T00:00:00Z')}),body=valid({androidApi:30,manufacturer:'TCL',setup:{disabledCount:2,restoredCount:1}}),response=await handler(req(body,{cookie:'private=secret'}),{ip:'192.0.2.1',geo:{city:'Private'}});assert.equal(response.status,201);assert.equal((await response.json()).id,body.nonce);assert.equal(f.writes,1);const stored=f.data.values().next().value;assert.deepEqual(stored,{schemaVersion:1,receivedAt:'2026-11-17T00:00:00.000Z',report:schema.validate(body)});assert.equal(JSON.stringify(stored).includes('192.0.2.1'),false);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(response.headers.get('cache-control'),'no-store');
});
await test('Identical UUID retries are idempotent; different content cannot overwrite an existing UUID',async()=>{
  const f=fixture(),handler=createReportsHandler({openStore:()=>f.openStore()});assert.equal((await handler(req(valid()))).status,201);const same=await handler(req(valid()));assert.equal(same.status,200);assert.equal((await same.json()).duplicate,true);assert.equal((await handler(req(valid({message:'Changed content'})))).status,409);assert.equal(f.writes,1);
});
await test('Wrong method and cross-origin browser requests are rejected before opening any store',async()=>{
  const f=fixture(),handler=createReportsHandler({openStore:()=>f.openStore()});assert.equal((await handler(req(null,{},'GET'))).status,405);for(const headers of [{origin:'https://elsewhere.example'},{origin:'null'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}])assert.equal((await handler(req(valid(),headers))).status,403);assert.equal(f.opens,0);
});
await test('Same-origin JSON browser request and origin-free native/CLI JSON are accepted',async()=>{for(const headers of [{origin:'https://mosque-tv-reports-adel2184.netlify.app','sec-fetch-site':'same-origin'},{}]){const f=fixture(),handler=createReportsHandler({openStore:()=>f.openStore()});assert.equal((await handler(req(valid(),headers))).status,201);}});
await test('HTML, malformed JSON, unknown fields and unsanitized content never enter storage',async()=>{
  const f=fixture(),handler=createReportsHandler({openStore:()=>f.openStore()});assert.equal((await handler(req('<html>',{'content-type':'text/html'}))).status,415);for(const body of ['{','[]',valid({extra:true}),valid({message:'192.168.1.22'})])assert.equal((await handler(req(body))).status,400);assert.equal(f.opens,0);
});
await test('Body byte cap applies with declared length and streaming without Content-Length',async()=>{
  const f=fixture(),handler=createReportsHandler({openStore:()=>f.openStore()});assert.equal((await handler(req(valid(),{'content-length':'12289'}))).status,413);assert.equal((await handler(req(' '.repeat(12289)))).status,413);assert.equal(f.opens,0);
});
await test('Invalid UTF-8 and a stalled upload terminate with explicit errors before persistence',async()=>{
  const f=fixture(),handler=createReportsHandler({openStore:()=>f.openStore(),readTimeoutMs:20});const invalid=new Request('https://mosque-tv-reports-adel2184.netlify.app/api/reports',{method:'POST',headers:{'content-type':'application/json'},body:new Uint8Array([0xc3,0x28])});assert.equal((await handler(invalid)).status,400);
  const stalled=new Request('https://mosque-tv-reports-adel2184.netlify.app/api/reports',{method:'POST',headers:{'content-type':'application/json'},body:new ReadableStream({start(){}}),duplex:'half'});assert.equal((await handler(stalled)).status,408);assert.equal(f.opens,0);
});
await test('Storage failure never returns saved/queued; health never opens storage',async()=>{const handler=createReportsHandler({openStore:()=>{throw Error('Unavailable');}}),response=await handler(req(valid()));assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,error:'delivery-unconfirmed'});const healthy=await health(new Request('https://example/api/health'));assert.equal(healthy.status,200);assert.equal((await healthy.json()).storageWrite,false);});
await test('Production uses persistent scope only for a published production deployment; previews/manual draft contexts stay isolated',()=>{assert.equal(storeScope({deploy:{context:'production',published:true}}),'production');for(const c of [{},{deploy:{context:'production',published:false}},{deploy:{context:'deploy-preview',published:true}},{deploy:{context:'branch-deploy',published:true}}])assert.equal(storeScope(c),'deploy');});
await test('CLI preview does no network; send requires explicit confirm and posts the exact reviewed bytes',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'mosque-report-test-')),file=path.join(folder,'preview.json');let sent=0;
  try{const preview=await cli.run(['--preview','--problem','--owner','Private person@example.com','Notes','--out',file],{print(){},fetcher:async()=>{throw Error('Preview contacted network');}});assert.equal(preview.kind,'preview');assert.ok(!preview.body.includes('person@example.com'));await assert.rejects(cli.run(['--send',file],{print(){}}));
    const result=await cli.run(['--send',file,'--confirm'],{print(){},fetcher:async(url,options)=>{sent++;assert.equal(url,'https://mosque-tv-reports-adel2184.netlify.app/api/reports');assert.equal(options.body,fs.readFileSync(file,'utf8'));assert.equal(options.redirect,'error');return Response.json({ok:true,id:JSON.parse(options.body).nonce},{status:201});}});assert.equal(result.kind,'sent');assert.equal(sent,1);
    fs.writeFileSync(file,JSON.stringify(valid({message:'person@example.com'})));await assert.rejects(cli.run(['--send',file,'--confirm'],{print(){},fetcher:async()=>{throw Error('Invalid file contacted network');}}));
  }finally{for(const name of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,name));fs.rmdirSync(folder);}
});
await test('CLI transport failures cannot claim successful storage or queue a report',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'mosque-report-test-')),file=path.join(folder,'preview.json');try{fs.writeFileSync(file,schema.serialize(valid()));await assert.rejects(cli.run(['--send',file,'--confirm'],{print(){throw Error('False success output');},fetcher:async()=>Response.json({ok:false},{status:503})}),/not confirmed/);}finally{fs.unlinkSync(file);fs.rmdirSync(folder);}
});

function browser(native=false){
  const nodes={},events={},requests=[];for(const id of ['language','category','message','notes','appVersion','preview','review','payload','consent','send','status','reportForm'])nodes[id]={id,value:({language:'en',category:'problem',message:'Issue person@example.com',notes:'',appVersion:'2.3.0'})[id]||'',checked:false,hidden:id==='review',disabled:false,tagName:id==='message'||id==='notes'?'TEXTAREA':'BUTTON',textContent:'',addEventListener(name,fn){(this.events||(this.events={}))[name]=fn;},focus(){document.activeElement=this;},closest(){return null;}};
  const document={documentElement:{},activeElement:null,getElementById:id=>nodes[id],querySelectorAll:selector=>selector==='[data-i18n]'?[]:Object.values(nodes),addEventListener(name,fn){events[name]=fn;}};
  const window={MosqueReports:schema,crypto:{randomUUID:()=>valid().nonce},confirm:()=>true,addEventListener(name,fn){events[name]=fn;}};
  if(native)window.MosqueReportNative={startSend:body=>requests.push({body,native:true})};
  const scope={window,document,Uint8Array,Array,JSON,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,...options});return Response.json({ok:true,id:JSON.parse(options.body).nonce},{status:201});}};
  vm.runInNewContext(fs.readFileSync(fileURLToPath(new URL('../public/report-form.js',import.meta.url)),'utf8'),scope);return{nodes,events,requests};
}
await test('Browser literal preview is sanitized and sends exactly those bytes only after explicit consent and Send',async()=>{const b=browser();b.nodes.preview.events.click();assert.equal(b.requests.length,0);assert.ok(!b.nodes.payload.textContent.includes('person@example.com'));const body=b.nodes.payload.textContent;await b.nodes.send.events.click();assert.equal(b.requests.length,0);b.nodes.consent.checked=true;b.nodes.consent.events.change();await b.nodes.send.events.click();assert.equal(b.requests.length,1);assert.equal(b.requests[0].body,body);assert.ok(b.nodes.status.textContent.includes('confirmed'));});
await test('Native browser branch never fetches; retained preview goes only to startSend and waits for confirmed native result',async()=>{const b=browser(true);b.events['mosque-report-language']({detail:'ar'});assert.equal(b.nodes.language.value,'ar');b.events['mosque-report-language']({detail:'en'});b.nodes.preview.events.click();b.nodes.consent.checked=true;await b.nodes.send.events.click();assert.equal(b.requests.length,1);assert.equal(b.requests[0].native,true);assert.equal(b.requests[0].body,b.nodes.payload.textContent);assert.ok(b.nodes.status.textContent.includes('Sending'));b.events['mosque-report-result']({detail:{ok:true,id:valid().nonce}});assert.ok(b.nodes.status.textContent.includes('confirmed'));});
await test('Editing a form field invalidates its preview and prevents stale content being sent',async()=>{const b=browser();b.nodes.preview.events.click();b.nodes.consent.checked=true;b.nodes.message.value='Different note';b.nodes.message.events.input();await b.nodes.send.events.click();assert.equal(b.requests.length,0);assert.equal(b.nodes.review.hidden,true);});

const passed=checks.filter(x=>x.pass).length;console.log(JSON.stringify({method:'Local schema/HTTP handler/fake private store/CLI/browser VM; no external transmission or platform-rate-limit execution.',passed,total:checks.length,failed:checks.length-passed,checks},null,2));if(passed!==checks.length)process.exitCode=1;
