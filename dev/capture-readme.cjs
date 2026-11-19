/* Development-only README previews. Requires Playwright, Sharp and an installed Chromium browser.
 * Usage: node dev/capture-readme.cjs [path-to-chrome-or-msedge]
 * All demo data is applied to an ephemeral browser context. Operational files are never changed.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const sharp=require('sharp');
const previewFile=require('./preview-file.cjs');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'docs','images');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const demo=JSON.parse(read('dev/config.json'));
demo.mosque.fields.name.value='جامع الهدى — نموذج توضيحي';
demo.mosque.fields.address.value='الدمام، المملكة العربية السعودية';
demo.donation.visible=false;
const manifest=read('android/AndroidManifest.xml');
const version=manifest.match(/android:versionName="([^"]+)"/)[1];
const versionCode=Number(manifest.match(/android:versionCode="(\d+)"/)[1]);
const mock=`<script>
window.MosqueAndroid={
 prayerState(){},exportJson(){},markSetupCompleted(){},setProfileTimezone(){},
 homeStatus(){return JSON.stringify({isDefaultHome:false,canRequestHomeRole:true,canOpenHomeSettings:true});},
 deviceStatus(){return JSON.stringify({manufacturer:'Android TV',model:'معاينة',audioOutput:'مكبرات التلفاز',available:{wifi:true,bluetooth:true,tv:true,sound:true}});},
 networkStatus(){return JSON.stringify({connected:true,validated:false,label:'Wi-Fi'});},
 powerStatus(){return JSON.stringify({mode:'always',start:'04:00',end:'23:00',active:true,screenBlack:false});},
 updateStatus(){return JSON.stringify({supported:true,configured:false,installedVersion:${JSON.stringify(version)},installedCode:${versionCode}});},
 requestHomeRole(){},openHomeSettings(){},openSystemSettings(){},openControl(){},deviceSetup(){}
};
</script>`;
const bridge=read('android/tv-bridge.js');
let html=read('index.html').replace(/(<script id="config-data" type="application\/json">)[\s\S]*?(<\/script>)/,
 (_,start,end)=>start+JSON.stringify(demo)+end);
html=html.replace('<script id="application-code">',mock+'<script>'+bridge+'</script><script id="application-code">');
const server=http.createServer((request,response)=>{
 try{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);return response.end();}
  const target=previewFile(request);
  if(!target){response.writeHead(404);return response.end();}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'};
  response.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
  response.end(request.method==='HEAD'?undefined:target===path.join(root,'index.html')?html:fs.readFileSync(target));
 }catch(error){response.writeHead(500);response.end('Preview error');}
});
async function main(){
 fs.mkdirSync(output,{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  const launch={headless:true};
  if(process.argv[2])launch.executablePath=path.resolve(process.argv[2]);else launch.channel='chrome';
  browser=await chromium.launch(launch);
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,locale:'ar-SA',timezoneId:'Asia/Riyadh',reducedMotion:'reduce'});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.route('**/*',route=>{const url=route.request().url();return /^https?:/.test(url)&&!url.startsWith('http://127.0.0.1:')?route.abort():route.continue();});
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html?test=1',{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
   MosqueApp.setNow(()=>Date.parse('2026-11-17T09:15:00+03:00'));MosqueApp.tick();
   const profile=MosqueProfile.load();profile.language='ar';profile.mosqueName='جامع الهدى — نموذج توضيحي';
   const prepared={table:MosqueLocation.calculate(profile,2026,MosqueInstall.getContext().calendar)};
   const result=MosqueInstall.commit(profile,prepared.table);if(!result.ok)throw Error(JSON.stringify(result));
   window.__readmePrepared=prepared;window.__readmeProfile=profile;
   const settings=MosqueApp.getSettings();settings.donation.visible=false;MosqueApp.useSettings(settings);
   await document.fonts.ready;
  });
  async function shot(name){await page.waitForTimeout(350);await sharp(await page.screenshot({animations:'disabled'})).webp({quality:92,effort:6,smartSubsample:true}).toFile(path.join(output,name));console.log(name);}
  await shot('display-ar.webp');
  await page.evaluate(()=>MosqueControl.open());await shot('control-center-ar.webp');
  await page.evaluate(()=>{MosqueControl.close({immediate:true,restoreFocus:false});MosqueSetup.open({required:false});});
  for(let step=0;step<5;step++)await page.click('#setupNext');await shot('setup-ar.webp');
  await page.evaluate(()=>{
   MosqueSetup.close({force:true,restoreFocus:false});
   const profile={...window.__readmeProfile,language:'en',mosqueName:'Demo Mosque'};
   MosqueInstall.commit(profile,window.__readmePrepared.table);
  });
  await shot('display-en.webp');
  await page.evaluate(()=>{
   MosqueInstall.commit(window.__readmeProfile,window.__readmePrepared.table);
   const event=MosqueApp.buildEvents(MosqueApp.validateTimetable(window.__readmePrepared.table),MosqueApp.getSettings()).find(event=>event.prayer==='dhuhr'&&event.date==='2026-11-17');
   if(!event)throw Error('Missing demo Dhuhr event');
   MosqueApp.setNow(()=>event.iqama+1000);MosqueApp.tick();
  });
  await shot('prayer-mode.webp');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Saved browser previews with an isolated demo profile; Android system controls are simulated.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});
