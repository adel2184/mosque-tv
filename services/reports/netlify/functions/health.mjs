export default async function(request){
  if(request.method!=='GET')return new Response(JSON.stringify({ok:false,error:'method-not-allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','allow':'GET'}});
  return new Response(JSON.stringify({ok:true,service:'mosque-tv-reports',schemaVersion:1,storageWrite:false}),{
    status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}
  });
}
export const config={path:'/api/health',method:'GET'};
