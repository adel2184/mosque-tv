package sa.mosque.display;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.HttpsURLConnection;

/** Explicit optional calculated-table download. It never changes stored mosque/profile data. */
final class SetupTimetableFetcher {
    interface Host { boolean permitted(); void onResult(JSONObject result); }
    private static final ThreadFactory THREADS=r->{Thread t=new Thread(r,"mosque-setup-download");t.setDaemon(true);return t;};
    private final WeakReference<Activity> activity;
    private Host host;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor(THREADS);
    private final ScheduledExecutorService cleanup=Executors.newScheduledThreadPool(2,THREADS);
    private final AtomicInteger generation=new AtomicInteger();
    private volatile boolean destroyed;
    private volatile Active active;
    private Future<?> task;
    private ScheduledFuture<?> expiry;
    private String state="idle",messageAr="لم يبدأ تنزيل مواقيت من الإنترنت.",messageEn="No timetable download has been started.";
    private long requestId;
    private int progress;
    SetupTimetableFetcher(Activity activity,Host host){this.activity=new WeakReference<>(activity);this.host=host;}
    synchronized JSONObject status(){
        JSONObject out=new JSONObject();try{
            out.put("state",state).put("requestId",requestId).put("progress",progress).put("messageAr",messageAr).put("messageEn",messageEn)
                    .put("source","UmmahAPI calculated prayer times").put("official",false);
        }catch(Exception ignored){}return out;
    }
    private boolean permitted(){Activity live=activity.get();return !destroyed&&host!=null&&live!=null&&!live.isFinishing()&&!live.isDestroyed()&&host.permitted();}
    private void publish(int token,JSONObject value){main.post(()->{if(!destroyed&&generation.get()==token&&permitted())host.onResult(value);});}
    private synchronized void update(String next,int percentage,String ar,String en){state=next;progress=percentage;messageAr=ar;messageEn=en;}
    void start(String profileJson){main.post(()->{
        if(!permitted())return;
        stopOperation();final int token=generation.incrementAndGet();
        long suppliedId=0;
        try{
            if(profileJson==null||profileJson.length()>16384||profileJson.getBytes(StandardCharsets.UTF_8).length>16384)throw new IOException("profile size");
            JSONTokener input=new JSONTokener(profileJson);Object parsed=input.nextValue();
            if(!(parsed instanceof JSONObject)||input.nextClean()!=0)throw new IOException("profile object");
            JSONObject profile=(JSONObject)parsed;
            suppliedId=unsigned(profile.get("requestId"));
            final Profile selection=new Profile(profile);
            synchronized(this){requestId=suppliedId;}
            update("fetching",0,"جارٍ تنزيل مواقيت محسوبة لعامين؛ تحتاج مراجعة.","Downloading two years of calculated timings; review required.");
            publish(token,status());
            final long deadline=System.nanoTime()+SetupFetchHttp.OVERALL_NANOS;
            expiry=cleanup.schedule(()->{
                finish(token,"error","انتهت مهلة التنزيل. لم تتغير المواقيت المحفوظة.","Download timed out. Saved timings were not changed.",null);
                Active live=active;if(live!=null&&live.token==token)live.connection.disconnect();
            },150,TimeUnit.SECONDS);
            task=worker.submit(()->download(token,selection,deadline));
        }catch(Exception invalid){
            synchronized(this){requestId=suppliedId;}
            update("error",0,"بيانات طلب التنزيل غير صالحة؛ لم يُرسل طلب شبكة.","Invalid download profile; no network request was sent.");
            publish(token,status());
        }
    });}
    private static long unsigned(Object value)throws IOException{
        if(!(value instanceof Number))throw new IOException("request id");double number=((Number)value).doubleValue();
        if(Double.isNaN(number)||Double.isInfinite(number)||number<0||number>4294967295L||number!=Math.floor(number))throw new IOException("request id");return(long)number;
    }
    private static final class Profile{
        final double latitude,longitude;final String timezone,method;final int year;
        Profile(JSONObject value)throws Exception{
            Object lat=value.get("latitude"),lon=value.get("longitude"),yearValue=value.get("targetYear");
            if(!(lat instanceof Number)||!(lon instanceof Number)||!(yearValue instanceof Number))throw new IOException("profile number");
            latitude=((Number)lat).doubleValue();longitude=((Number)lon).doubleValue();
            double candidateYear=((Number)yearValue).doubleValue();if(candidateYear!=Math.floor(candidateYear)||!SetupFetchHttp.year((int)candidateYear))throw new IOException("year");year=(int)candidateYear;
            Object zone=value.get("timezone"),preset=value.get("methodId");if(!(zone instanceof String)||!(preset instanceof String))throw new IOException("profile text");
            timezone=(String)zone;method=(String)preset;
            if(!SetupFetchHttp.coordinates(latitude,longitude)||!SetupFetchHttp.timezone(timezone)||!SetupFetchHttp.method(method))throw new IOException("unsupported profile");
            for(String key:new String[]{"mosqueName","neighborhood","cityId","countryId","language"})if(value.has(key)&&(!(value.get(key)instanceof String)||value.getString(key).length()>200))throw new IOException("profile label");
        }
    }
    private boolean workerPermitted(int token)throws InterruptedException{
        CountDownLatch done=new CountDownLatch(1);final boolean[] allowed={false};
        main.post(()->{try{allowed[0]=generation.get()==token&&permitted();}finally{done.countDown();}});
        return done.await(2,TimeUnit.SECONDS)&&allowed[0]&&!destroyed&&generation.get()==token;
    }
    private void ensure(int token)throws IOException{if(destroyed||generation.get()!=token||Thread.currentThread().isInterrupted())throw new java.io.InterruptedIOException("cancelled");}
    private void download(int token,Profile profile,long deadline){
        try{
            JSONArray months=new JSONArray(),boundary=new JSONArray();JSONObject payload=new JSONObject().put("months",months).put("boundary",boundary);
            int used=0,completed=0;
            for(int y=profile.year;y<=profile.year+1;y++)for(int month=1;month<=12;month++){
                Response response=fetch(token,SetupFetchHttp.monthUrl(profile.latitude,profile.longitude,profile.timezone,profile.method,y,month),"prayer-times-month",SetupFetchHttp.TOTAL_LIMIT-used,deadline);
                used+=response.bytes;months.put(response.data);payloadLimit(payload);reportProgress(token,++completed);
            }
            String[] dates={String.format(Locale.ROOT,"%04d-12-31",profile.year-1),String.format(Locale.ROOT,"%04d-01-01",profile.year+2)};
            for(String date:dates){
                Response response=fetch(token,SetupFetchHttp.dayUrl(profile.latitude,profile.longitude,profile.timezone,profile.method,date),"prayer-times",SetupFetchHttp.TOTAL_LIMIT-used,deadline);
                used+=response.bytes;boundary.put(response.data);payloadLimit(payload);reportProgress(token,++completed);
            }
            ensure(token);
            finish(token,"ready","اكتمل التنزيل: مواقيت محسوبة من UmmahAPI تحتاج مراجعة قبل التطبيق.","Downloaded calculated UmmahAPI timings; review them before applying.",payload);
        }catch(Exception error){finish(token,"error","تعذر إكمال التنزيل. تحقق من الإنترنت أو ألغِ واختر الحساب المحلي؛ لم تتغير المواقيت المحفوظة.","Download could not complete. Check the connection or cancel and choose local calculation; saved timings were not changed.",null);}
    }
    private static void payloadLimit(JSONObject payload)throws IOException{
        String text=payload.toString();
        if(text.length()>440_000||text.getBytes(StandardCharsets.UTF_8).length>SetupFetchHttp.PAYLOAD_LIMIT)throw new IOException("bridge payload size");
    }
    private Response fetch(int token,String address,String service,int remaining,long deadline)throws Exception{
        ensure(token);if(!workerPermitted(token))throw new java.io.InterruptedIOException("not permitted");ensure(token);
        URL url=new URL(address);
        if(!"https".equals(url.getProtocol())||!"ummahapi.com".equals(url.getHost())||url.getPort()!=-1
                ||!("/api/prayer-times/month".equals(url.getPath())||"/api/prayer-times".equals(url.getPath())))throw new IOException("fixed endpoint only");
        HttpsURLConnection connection=(HttpsURLConnection)url.openConnection();Active holder=new Active(token,connection);active=holder;
        try{
            byte[] bytes=SetupFetchHttp.read(connection,remaining,deadline,()->destroyed||generation.get()!=token);
            ensure(token);JSONTokener tokener=new JSONTokener(SetupFetchHttp.jsonText(bytes));Object value=tokener.nextValue();
            if(!(value instanceof JSONObject)||tokener.nextClean()!=0)throw new IOException("JSON object");JSONObject response=(JSONObject)value;
            if(!Boolean.TRUE.equals(response.opt("success"))||!service.equals(response.optString("service"))||!(response.opt("data")instanceof JSONObject))throw new IOException("provider rejected request");
            return new Response(response.getJSONObject("data"),bytes.length);
        }finally{connection.disconnect();if(active==holder)active=null;}
    }
    private void reportProgress(int token,int completed){main.post(()->{
        if(destroyed||generation.get()!=token)return;
        update("fetching",completed*100/26,"جارٍ تنزيل المواقيت المحسوبة: "+completed+" من 26.","Downloading calculated timings: "+completed+" of 26.");publish(token,status());
    });}
    private void finish(int token,String next,String ar,String en,JSONObject payload){main.post(()->{
        if(destroyed||!generation.compareAndSet(token,token+1))return;if(expiry!=null)expiry.cancel(false);
        update(next,"ready".equals(next)?100:progress,ar,en);JSONObject result=status();
        try{if(payload!=null)result.put("payload",payload);}catch(Exception ignored){}
        publish(token+1,result);
    });}
    private void stopOperation(){
        generation.incrementAndGet();if(expiry!=null)expiry.cancel(false);if(task!=null)task.cancel(true);
        Active holder=active;if(holder!=null&&!cleanup.isShutdown())cleanup.execute(holder.connection::disconnect);
    }
    void cancel(){if(Looper.myLooper()==Looper.getMainLooper())cancelNow();else main.post(this::cancelNow);}
    private void cancelNow(){stopOperation();if("fetching".equals(state)){
        update("cancelled",progress,"أُلغي التنزيل؛ لم تتغير المواقيت المحفوظة.","Download cancelled; saved timings were not changed.");publish(generation.get(),status());
    }}
    void destroy(){
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(this::destroy);return;}if(destroyed)return;
        destroyed=true;stopOperation();host=null;activity.clear();main.removeCallbacksAndMessages(null);worker.shutdownNow();cleanup.shutdown();
    }
    private static final class Active{final int token;final HttpsURLConnection connection;Active(int token,HttpsURLConnection connection){this.token=token;this.connection=connection;}}
    private static final class Response{final JSONObject data;final int bytes;Response(JSONObject data,int bytes){this.data=data;this.bytes=bytes;}}
}
