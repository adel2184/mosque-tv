/* Development-only, read-only localhost preview. Never included in the APK runtime. */
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const previewFile=require('./preview-file.cjs');
const root=path.resolve(__dirname,'..');
const mock=`<script id="tv-preview-native-mock">
window.MosqueAndroid={
 prayerState:function(){},exportJson:function(){},
 homeStatus:function(){return JSON.stringify({isDefaultHome:false,canRequestHomeRole:true,canOpenHomeSettings:true});},
 deviceStatus:function(){return JSON.stringify({message:'معاينة تطوير محلية — خيارات النظام ممثلة ببيانات اختبار.'});},
 powerStatus:function(){return JSON.stringify({mode:'always',start:'04:00',end:'23:00',active:true,screenBlack:false,message:'معاينة: لا تتغير إعدادات الجهاز.'});},
 updateStatus:function(){return JSON.stringify({supported:true,configured:false,installedVersion:'معاينة تطوير',installedCode:0,message:'بيانات اختبار؛ لا يوجد تنزيل أو تثبيت.'});},
 requestHomeRole:function(){},openHomeSettings:function(){},openSystemSettings:function(){},openControl:function(){},
 savePower:function(){window.dispatchEvent(new CustomEvent('mosque-native-power-result',{detail:{success:true,message:'معاينة فقط — لم تتغير إعدادات الجهاز.'}}));},
 checkUpdate:function(){},installUpdate:function(){},cancelUpdate:function(){},deviceSetup:function(){}
};
</script>`;
const server=http.createServer((request,response)=>{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);return response.end();}
  const file=previewFile(request);
  if(!file){response.writeHead(404);return response.end('Not found');}
  const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'}[path.extname(file)]||'text/plain; charset=utf-8';
  let body=fs.readFileSync(file);
  if(file===path.join(root,'index.html')){
    let html=body.toString('utf8');
    const bridge=fs.readFileSync(path.join(root,'android/tv-bridge.js'),'utf8');
    html=html.replace('<script id="application-code">',mock+'<script id="tv-preview-bridge">'+bridge+'</script><script id="application-code">');
    html=html.replace('</body>','<script>document.title="معاينة تطوير — شاشة الجامع";if(window.MosqueApp){MosqueApp.setNow(function(){return Date.parse("2026-11-17T09:15:00+03:00");});MosqueApp.tick();}</script></body>');
    body=Buffer.from(html);
  }
  response.writeHead(200,{'content-type':type,'cache-control':'no-store','content-length':body.length});response.end(request.method==='HEAD'?undefined:body);
});
server.listen(8123,'127.0.0.1',()=>console.log('TV development preview: http://127.0.0.1:8123/index.html?test=1'));
