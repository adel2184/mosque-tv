package sa.mosque.display;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Explicit reviewed reports only. No device inventory, background upload, or read endpoint. */
public final class FeedbackActivity extends Activity {
    private static final String PAGE="file:///android_asset/reports/index.html";
    private static final String ENDPOINT="https://mosque-tv-reports-adel2184.netlify.app/api/reports";
    private static volatile boolean prayer;
    private static WeakReference<FeedbackActivity> active=new WeakReference<>(null);
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private volatile HttpURLConnection connection;
    private volatile boolean foreground,released,sending,localPage;
    private volatile long generation;
    private volatile boolean deliveryUncertain;
    private WebView web;
    private AlertDialog confirmation;
    private boolean en;
    static void setPrayerActive(boolean value){prayer=value;if(value){FeedbackActivity current=active.get();if(current!=null)current.runOnUiThread(()->{current.cancel();current.finish();});}}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);if(prayer||MainActivity.prayerActive()){finish();return;}active=new WeakReference<>(this);
        en="en".equals(getSharedPreferences("mosque-tv-setup",MODE_PRIVATE).getString("language","ar"));
        web=new WebView(this);web.setBackgroundColor(Color.rgb(8,15,20));setContentView(web);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);
        settings.setBlockNetworkLoads(true);
        web.addJavascriptInterface(new ReportBridge(),"MosqueReportNative");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean onRenderProcessGone(WebView lost, android.webkit.RenderProcessGoneDetail detail) {
                if (lost != web) return true;
                localPage = false;
                cancel();
                ((android.view.ViewGroup) lost.getParent()).removeView(lost);
                web = null;
                lost.destroy();
                finish();
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){localPage=false;}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !PAGE.equals(request.getUrl().toString());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String value=request.getUrl().toString();if(value.equals(PAGE)||value.matches("file:///android_asset/reports/[A-Za-z0-9_-]+\\.(?:js|css)"))return null;
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view,String url){
                if(view!=web)return;
                localPage=PAGE.equals(url)&&!released;
                if(localPage){
                    String version="";
                    try {version=getPackageManager().getPackageInfo(getPackageName(),0).versionName;}
                    catch(android.content.pm.PackageManager.NameNotFoundException ignored){}
                    view.evaluateJavascript("document.getElementById('appVersion').value="+JSONObject.quote(version==null?"":version)
                            +";window.dispatchEvent(new CustomEvent('mosque-report-language',{detail:"+JSONObject.quote(en?"en":"ar")+"}));",null);
                    publishInterrupted();
                }
            }
        });web.loadUrl(PAGE);
    }
    private boolean allowed(){return foreground&&!released&&localPage&&!prayer&&!MainActivity.prayerActive();}
    final class ReportBridge {
        @JavascriptInterface public void startSend(String body){if(body==null||body.length()>12288||body.getBytes(StandardCharsets.UTF_8).length>12288)return;runOnUiThread(()->review(body));}
    }
    private void review(String body){
        if(!allowed()||confirmation!=null)return;if(sending){publish(false,"",en?"The previous request is still being cancelled. Wait before sending again.":"يجري إنهاء الطلب السابق؛ انتظر قبل الإرسال مجددًا.");return;}
        try{validate(body);}catch(Exception error){publish(false,"",en?"The reviewed report is invalid. Nothing was sent.":"التقرير المعروض غير صالح؛ لم يُرسل شيء.");return;}
        TextView preview=new TextView(this);preview.setText(body);preview.setTextSize(16);preview.setPadding(28,20,28,20);preview.setTextIsSelectable(true);preview.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);
        ScrollView scroll=new ScrollView(this);scroll.addView(preview);
        confirmation=new AlertDialog.Builder(this).setTitle(en?"Send this exact report to Mosque TV?":"إرسال هذا التقرير إلى خدمة شاشة الجامع؟").setView(scroll)
            .setNegativeButton(en?"Cancel":"إلغاء",(dialog,which)->publish(false,"","cancelled"))
            .setPositiveButton(en?"Send report":"إرسال التقرير",(dialog,which)->{if(allowed()&&!sending)send(body);})
            .setOnCancelListener(dialog->publish(false,"","cancelled"))
            .setOnDismissListener(dialog->confirmation=null).show();
    }
    static void validate(String body)throws Exception{
        if(body.length()>12288||body.getBytes(StandardCharsets.UTF_8).length>12288)throw new Exception();
        JSONObject report=new JSONObject(body);Set<String> keys=new HashSet<>(Arrays.asList("schemaVersion","category","message","notes","appVersion","androidApi","manufacturer","setup","consent","nonce"));
        Iterator<String> iterator=report.keys();while(iterator.hasNext())if(!keys.contains(iterator.next()))throw new Exception();
        integer(report,"schemaVersion",1,1);if(!Boolean.TRUE.equals(report.get("consent"))||!Arrays.asList("problem","setup").contains(report.getString("category")))throw new Exception();
        if(!(report.get("message") instanceof String)||report.getString("message").trim().isEmpty()||report.getString("message").length()>2000||!(report.get("notes") instanceof String)||report.getString("notes").length()>2000)throw new Exception();
        if(!report.getString("appVersion").matches("[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}"))throw new Exception();
        if(!report.getString("nonce").matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"))throw new Exception();
        if(report.has("androidApi"))integer(report,"androidApi",24,100);
        if(report.has("manufacturer")&&!Arrays.asList("TCL","Sony","Samsung","Other").contains(report.getString("manufacturer")))throw new Exception();
        if(report.has("setup")){JSONObject setup=report.getJSONObject("setup");Iterator<String> names=setup.keys();while(names.hasNext())if(!Arrays.asList("disabledCount","restoredCount").contains(names.next()))throw new Exception();for(String key:new String[]{"disabledCount","restoredCount"})integer(setup,key,0,1000);}
    }
    private static void integer(JSONObject object,String key,int min,int max)throws Exception{Object value=object.get(key);if(!(value instanceof Number))throw new Exception();double number=((Number)value).doubleValue();if(!Double.isFinite(number)||number!=Math.rint(number)||number<min||number>max)throw new Exception();}
    private void send(String body){
        sending=true;final long ticket=++generation;final byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
        worker.execute(()->{
            boolean ok=false;String id="",message="";HttpURLConnection http=null;
            try{
                if(!allowed()||ticket!=generation)throw new Exception();
                http=(HttpURLConnection)new URL(ENDPOINT).openConnection();connection=http;
                http.setInstanceFollowRedirects(false);http.setConnectTimeout(8000);http.setReadTimeout(12000);http.setRequestMethod("POST");http.setDoOutput(true);http.setUseCaches(false);
                http.setRequestProperty("Content-Type","application/json; charset=utf-8");http.setRequestProperty("Accept","application/json");http.setRequestProperty("User-Agent","MosqueTV-Report");http.setFixedLengthStreamingMode(bytes.length);
                if(!allowed()||ticket!=generation)throw new Exception();try(java.io.OutputStream output=http.getOutputStream()){if(!allowed()||ticket!=generation)throw new Exception();output.write(bytes);}
                int status=http.getResponseCode();if(status!=200&&status!=201)throw new Exception("HTTP "+status);
                JSONObject response;try(InputStream input=http.getInputStream()){ByteArrayOutputStream data=new ByteArrayOutputStream();byte[] buffer=new byte[1024];int count;while((count=input.read(buffer))!=-1){if(data.size()+count>4096)throw new Exception();data.write(buffer,0,count);}response=new JSONObject(new String(data.toByteArray(),StandardCharsets.UTF_8));}
                id=response.optString("id","");if(!response.optBoolean("ok",false)||!id.matches("[A-Za-z0-9_-]{8,100}"))throw new Exception();ok=true;
            }catch(Exception error){message=en?"Delivery was not confirmed. It may have reached the service; do not assume it failed or resend automatically.":"لم يتأكد وصول التقرير. قد يكون وصل إلى الخدمة؛ لن يُعاد إرساله تلقائيًا.";}
            finally{if(http!=null)http.disconnect();connection=null;sending=false;}
            final boolean result=ok;final String receipt=id,detail=message;runOnUiThread(()->{if(allowed()&&ticket==generation)publish(result,receipt,detail);});
        });
    }
    private void publish(boolean ok,String id,String error){if(web==null||released)return;try{JSONObject detail=new JSONObject();detail.put("ok",ok);if(ok)detail.put("id",id);else detail.put("error",error);web.evaluateJavascript("window.dispatchEvent(new CustomEvent('mosque-report-result',{detail:"+detail.toString()+"}));",null);}catch(Exception ignored){}}
    private void cancel(){foreground=false;generation++;if(sending)deliveryUncertain=true;if(confirmation!=null){confirmation.dismiss();confirmation=null;}HttpURLConnection current=connection;if(current!=null)current.disconnect();}
    private void publishInterrupted(){if(deliveryUncertain&&allowed()){deliveryUncertain=false;publish(false,"",en?"Delivery was interrupted and is unconfirmed. It will not be retried automatically.":"انقطع تأكيد الإرسال؛ لن يُعاد تلقائيًا، وقد يكون التقرير وصل.");}}
    @Override protected void onResume(){super.onResume();foreground=true;if(prayer||MainActivity.prayerActive())finish();else publishInterrupted();}
    @Override protected void onPause(){cancel();super.onPause();}
    @Override protected void onDestroy(){released=true;cancel();if(active.get()==this)active.clear();worker.shutdownNow();if(web!=null){web.removeJavascriptInterface("MosqueReportNative");((android.view.ViewGroup)web.getParent()).removeView(web);web.destroy();web=null;}super.onDestroy();}
}
