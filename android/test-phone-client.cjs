// Exercise the packaged phone client without opening a socket or sending a command to a TV.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'phone.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const keyNames=Array.from(html.matchAll(/data-key="([^"]+)"/g),match=>match[1]);
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function phone(){
  function element(id){
    return {id,disabled:true,hidden:false,textContent:'',value:'',addEventListener(name,handler){this[name]=handler;}};
  }
  const nodes=Object.fromEntries(['state','code','text','send'].map(id=>[id,element(id)]));
  const keys=keyNames.map(key=>Object.assign(element(key),{dataset:{key}}));
  const controls=[...keys,nodes.text,nodes.send],requests=[],timers=new Map();
  let now=0,sequence=0;
  const sandbox={
    document:{getElementById:id=>nodes[id],querySelectorAll:selector=>selector==='[data-key]'?keys:controls},
    location:{hash:'#'+'1'.repeat(48),pathname:'/'},history:{replaceState(){}},
    performance:{now:()=>now},crypto:require('node:crypto').webcrypto,AbortController,
    setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);},
    fetch(url,options){return new Promise((resolve,reject)=>{
      const reply=(status,data={})=>resolve({status,ok:status>=200&&status<300,json:async()=>data});
      options.signal.addEventListener('abort',()=>reject(Error('Deadline')),{once:true});
      requests.push({url,options,reply});
    });}
  };
  vm.runInNewContext(source,sandbox);
  async function advance(ms){
    now+=ms;
    for(const [id,timer] of [...timers])if(timer.at<=now&&timers.delete(id))timer.fn();
    await settle();
  }
  return {keys,controls,nodes,requests,advance};
}

async function main(){
  const client=phone(),{requests,nodes,keys,controls}=client;
  assert(controls.every(control=>control.disabled));
  assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/status');
  assert.match(requests[0].options.headers['X-Mosque-Client'],/^[0-9a-f]{32}$/);
  requests[0].reply(202,{pending:true,code:'001234'});await settle();
  assert.equal(nodes.code.textContent,'001234');assert(!nodes.code.hidden);
  keys[0].click();assert.equal(requests.length,1);
  await client.advance(2000);assert.equal(requests.length,2);
  requests[1].reply(200,{connected:true});await settle();
  assert(nodes.code.hidden);assert(controls.every(control=>!control.disabled));
  nodes.text.value='نص تجريبي';nodes.send.click();
  assert.equal(requests[2].url,'/api/text');
  assert.equal(JSON.parse(requests[2].options.body).text,nodes.text.value);
  assert.deepEqual(requests[2].options.headers['X-Mosque-Client'],requests[0].options.headers['X-Mosque-Client']);
  assert.equal(requests[2].options.redirect,'error');assert.equal(requests[2].options.credentials,'omit');
  await client.advance(5000);assert.equal(requests.length,3);assert.match(nodes.state.textContent,/لم يتأكد/);
  keys[0].click();requests[3].reply(429);await settle();assert.match(nodes.state.textContent,/انتظر/);
  keys[0].click();requests[4].reply(403);await settle();assert(controls.every(control=>control.disabled));assert(nodes.code.hidden);
  const expired=phone();
  expired.requests[0].reply(202,{pending:true,code:'123456'});await settle();await expired.advance(60000);
  assert(expired.nodes.code.hidden);assert.equal(expired.requests.length,1);
  assert(expired.controls.every(control=>control.disabled));
  console.log('Phone client passed pending, physical approval, expiry, command deadline and rate-limit checks.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
