package sa.mosque.display;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Environment;
import android.os.StatFs;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Mosque profile: fixed, optional candidates only; no uninstall, custom commands, or launcher changes. */
final class DeviceSetup {
    static final String[][] CANDIDATES={
        {"com.tcl.bi","إحصاءات استخدام TCL","إحصاءات الاستخدام؛ قد يفيد تعطيله في تقليل نشاط الخلفية."},
        {"com.tcl.overseasappshow","عروض تطبيقات TCL","واجهة عرض التطبيقات المقترحة."},
        {"com.tcl.messagebox","رسائل TCL الترويجية","رسائل وعروض الشركة؛ راجع حاجتك إليها."},
        {"com.tcl.esticker","ملصقات العرض الترويجية","ملصقات وضع العرض الترويجي."},
        {"com.tcl.exhibit","العرض التجريبي للمتجر","وضع العرض التجريبي؛ ليس مشغّل الشاشة الرئيسي."},
        {"com.google.android.tvrecommendations","توصيات Android TV","صفوف التوصيات؛ لا يعطّل واجهة المصنع نفسها."},
        {"com.google.android.feedback","ملاحظات Google","أداة إرسال ملاحظات التشخيص."},
        {"com.google.android.play.games","ألعاب Google Play","اختياري إذا لم تُستخدم الألعاب على شاشة الجامع."}
    };
    static final class Row {
        final String name,title,reason,protectedReason;final boolean enabled;final int setting;
        Row(String name,String title,String reason,String protectedReason,boolean enabled,int setting){this.name=name;this.title=title;this.reason=reason;this.protectedReason=protectedReason;this.enabled=enabled;this.setting=setting;}
        boolean selectable(){return enabled&&protectedReason.isEmpty()&&setting<=1;}
    }
    private final Context context;
    private final PackageManager packages;
    private final AtomicFile journalFile;
    private JSONObject journal=new JSONObject();
    private IOException journalProblem;
    private volatile AdbLocal adb;
    private volatile boolean mutationInFlight;
    DeviceSetup(Context context){
        this.context=context.getApplicationContext();packages=this.context.getPackageManager();
        journalFile=new AtomicFile(new File(this.context.getFilesDir(),"device-setup-journal.json"));
        if(journalFile.getBaseFile().exists())try(InputStream input=journalFile.openRead()){
            JSONObject saved=new JSONObject(new String(read(input,65536),StandardCharsets.UTF_8));
            if(saved.getInt("version")!=1)throw new IOException("إصدار سجل الاستعادة غير مدعوم.");
            journal=saved.getJSONObject("packages");Iterator<String> names=journal.keys();
            while(names.hasNext()){String name=names.next();int before=journal.getJSONObject(name).getInt("before");if(!allowed(name)||(before!=0&&before!=1))throw new IOException("سجل الاستعادة غير صالح.");}
        }catch(Exception error){journalProblem=new IOException("تعذر قراءة سجل الاستعادة؛ لن يُنفذ أي تعطيل أو استعادة آلية.",error);}
    }
    static boolean allowed(String name){for(String[] entry:CANDIDATES)if(entry[0].equals(name))return true;return false;}
    boolean connected(){return adb!=null;}
    int journalCount(){return journal.length();}
    String journalWarning(){return journalProblem==null?"":journalProblem.getMessage();}
    List<Row> rows(){
        List<Row> result=new ArrayList<>();
        for(String[] entry:CANDIDATES)try{
            ApplicationInfo info=packages.getApplicationInfo(entry[0],PackageManager.MATCH_DISABLED_COMPONENTS);
            int state=packages.getApplicationEnabledSetting(entry[0]);
            result.add(new Row(entry[0],entry[1],entry[2],protect(entry[0],info),info.enabled,state));
        }catch(PackageManager.NameNotFoundException|RuntimeException ignored){}
        return result;
    }
    private String protect(String name,ApplicationInfo info){
        if(!allowed(name)||name.equals(context.getPackageName()))return "خارج قائمة شاشة الجامع المحددة.";
        if(info.uid%100000<10000)return "مكوّن يعمل بهوية نظام مشتركة؛ يُترك مفعّلًا.";
        String lower=name.toLowerCase(Locale.ROOT);
        for(String token:new String[]{"bluetooth","webview","network","systemui","settings","remote","autopair","input","launcher","setupwraith","permissioncontroller","packageinstaller","documentsui","updater","firmware","accessibility","talkback","mediashell","airplay","miracast"})
            if(lower.contains(token))return "مكوّن محمي لخدمات النظام أو التحكم أو الاتصال.";
        try{
            Intent home=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(name);
            if(!packages.queryIntentActivities(home,PackageManager.MATCH_DEFAULT_ONLY|PackageManager.MATCH_DISABLED_COMPONENTS).isEmpty())return "واجهة HOME محمية؛ لا يُعطّلها هذا الملف.";
            PackageInfo details=packages.getPackageInfo(name,PackageManager.GET_PERMISSIONS|PackageManager.GET_SERVICES|PackageManager.MATCH_DISABLED_COMPONENTS);
            if(details.requestedPermissions!=null)for(String permission:details.requestedPermissions)
                if(Arrays.asList("android.permission.TV_INPUT_HARDWARE","android.permission.BLUETOOTH_PRIVILEGED","android.permission.NETWORK_STACK").contains(permission))return "يطلب صلاحية خدمة محمية؛ يُترك مفعّلًا.";
            if(details.services!=null)for(ServiceInfo service:details.services){
                String permission=service.permission==null?"":service.permission;
                if(permission.contains("BIND_INPUT_METHOD")||permission.contains("BIND_TV_INPUT")||permission.contains("BIND_ACCESSIBILITY_SERVICE")||permission.contains("BIND_VPN_SERVICE"))return "يقدّم خدمة إدخال أو وصول أو اتصال محمية.";
            }
            for(String action:new String[]{"android.media.tv.TvInputService","android.view.InputMethod","android.accessibilityservice.AccessibilityService"})
                if(!packages.queryIntentServices(new Intent(action).setPackage(name),PackageManager.MATCH_DISABLED_COMPONENTS).isEmpty())return "يقدّم خدمة إدخال أو وصول محمية.";
            return "";
        }catch(PackageManager.NameNotFoundException|RuntimeException error){return "تعذر فحص خدماته؛ لن يُعطّل آليًا.";}
    }
    void connect(AdbLocal.Progress progress)throws IOException{
        disconnect();
        try{if(DeviceSetupActivity.isPrayerActive())throw new IOException("بدأ وضع الصلاة.");adb=AdbLocal.connect(keyPair(),new AdbLocal.Progress(){public void update(String value){if(progress!=null)progress.update(value);}public void opened(AdbLocal transport){adb=transport;if(DeviceSetupActivity.isPrayerActive())disconnect();}});if(DeviceSetupActivity.isPrayerActive())throw new IOException("بدأ وضع الصلاة.");AdbLocal.Reply test=adb.run("id");if(test.code!=0||!test.output.contains("uid=2000(shell)"))throw new IOException("لم يمنح الجهاز جلسة ADB shell المتوقعة.");}
        catch(IOException|RuntimeException error){disconnect();throw new IOException("لم يتوفر اتصال ADB المحلي المصرّح. استخدم إعدادات التطبيق لكل عنصر، أو راجع إعدادات التصحيح التي يدعمها التلفاز. "+error.getMessage(),error);}
    }
    String apply(List<String> selected)throws IOException{
        requireReady();if(selected.isEmpty())return "لم تُحدّد تطبيقات؛ لم يتغير شيء.";
        Set<String> installed=list("pm list packages"),disabled=list("pm list packages -d");
        if(!installed.contains("android"))throw new IOException("لم يكتمل جرد الجهاز؛ لم يُفترض أن القائمة صحيحة.");
        List<Row> validated=new ArrayList<>();
        for(String name:selected){if(!allowed(name))throw new IOException("اسم تطبيق خارج القائمة المسموحة.");Row found=null;for(Row row:rows())if(row.name.equals(name))found=row;
            if(found==null||!installed.contains(name))throw new IOException("تعذر التحقق من التطبيق المثبت: "+name);
            if(!found.selectable()||disabled.contains(name))continue;validated.add(found);}
        int changed=0;
        for(Row row:validated){
            if(DeviceSetupActivity.isPrayerActive())throw new IOException("بدأ وضع الصلاة؛ توقف التنفيذ قبل العنصر التالي، وسجل الاستعادة محفوظ.");
            mutationInFlight=true;
            try{
            try{if(!journal.has(row.name)){JSONObject prior=new JSONObject();prior.put("before",row.setting);prior.put("recordedAt",System.currentTimeMillis());journal.put(row.name,prior);}saveJournal();}
            catch(Exception error){throw new IOException("تعذر حفظ سجل الاستعادة؛ لم يُرسل أمر تعطيل هذا العنصر.",error);}
            AdbLocal.Reply answer=command("pm disable-user --user 0 "+row.name);
            if(answer.code!=0||!list("pm list packages -d").contains(row.name)||packages.getApplicationEnabledSetting(row.name)!=PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER)throw new IOException("لم يُؤكَّد تعطيل "+row.title+". راجع الحالة المعروضة؛ سجل الاستعادة محفوظ.");
            changed++;
            }finally{mutationInFlight=false;}
        }
        return "أكد الجهاز تعطيل "+changed+" من التطبيقات المحددة. لم تُحذف تطبيقات أو بيانات، ولم تتغير واجهة المصنع.";
    }
    String restore()throws IOException{
        requireReady();List<String> names=new ArrayList<>();Iterator<String> iterator=journal.keys();while(iterator.hasNext())names.add(iterator.next());int restored=0;
        for(String name:names){
            if(DeviceSetupActivity.isPrayerActive())throw new IOException("بدأ وضع الصلاة؛ توقف التنفيذ قبل العنصر التالي، وسجل الاستعادة محفوظ.");
            if(!allowed(name))throw new IOException("عنصر استعادة غير مسموح.");
            mutationInFlight=true;
            try{
                int before=journal.getJSONObject(name).getInt("before");
                AdbLocal.Reply answer=command((before==0?"pm default-state --user 0 ":"pm enable --user 0 ")+name);
                if(answer.code!=0||list("pm list packages -d").contains(name)||packages.getApplicationEnabledSetting(name)!=before)throw new IOException("لم تُؤكَّد الاستعادة الأصلية لـ "+name+"؛ بقي سجله محفوظًا.");
                journal.remove(name);saveJournal();restored++;
            }catch(IOException error){throw error;}catch(Exception error){throw new IOException("تعذر إكمال الاستعادة؛ لم يُحذف سجل العنصر المتبقي.",error);}finally{mutationInFlight=false;}
        }
        return "أكد الجهاز استعادة "+restored+" عنصرًا إلى حالته الأصلية المسجلة. لم تُفعّل عناصر كانت معطّلة قبل استخدام الأداة.";
    }
    private void requireReady()throws IOException{if(DeviceSetupActivity.isPrayerActive())throw new IOException("تجهيز الجهاز متوقف أثناء وضع الصلاة.");if(journalProblem!=null)throw journalProblem;if(adb==null)throw new IOException("اتصل بـ ADB المحلي أولًا، أو استخدم إعدادات التطبيقات يدويًا.");android.os.UserManager users=context.getSystemService(android.os.UserManager.class);if(users==null||!users.isSystemUser())throw new IOException("التعطيل الآلي مخصص لحساب الجهاز الرئيسي فقط؛ استخدم إعدادات التطبيقات للحساب الحالي.");}
    private AdbLocal.Reply command(String command)throws IOException{try{return adb.run(command);}catch(IOException|RuntimeException error){disconnect();throw new IOException("انقطع تأكيد الجهاز؛ أعد الاتصال وراجع الحالة. سجل الاستعادة محفوظ.",error);}}
    private Set<String> list(String command)throws IOException{AdbLocal.Reply result=command(command);if(result.code!=0)throw new IOException("تعذر قراءة حالة التطبيقات من الجهاز.");Set<String> names=new HashSet<>();for(String line:result.output.split("\n"))if(line.startsWith("package:")){String name=line.substring(8).trim();if(name.matches("[A-Za-z0-9_.]+"))names.add(name);}return names;}
    private void saveJournal()throws Exception{
        JSONObject object=new JSONObject();object.put("version",1);object.put("packages",journal);byte[] data=object.toString().getBytes(StandardCharsets.UTF_8);
        FileOutputStream output=null;try{output=journalFile.startWrite();output.write(data);journalFile.finishWrite(output);}catch(IOException error){if(output!=null)journalFile.failWrite(output);throw error;}
    }
    private KeyPair keyPair()throws IOException{
        AtomicFile file=new AtomicFile(new File(context.getFilesDir(),"local-adb-private.pk8"));
        try{
            KeyFactory factory=KeyFactory.getInstance("RSA");
            if(file.getBaseFile().exists())try(InputStream input=file.openRead()){
                RSAPrivateCrtKey key=(RSAPrivateCrtKey)factory.generatePrivate(new PKCS8EncodedKeySpec(read(input,8192)));
                return new KeyPair(factory.generatePublic(new RSAPublicKeySpec(key.getModulus(),key.getPublicExponent())),key);
            }
            KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA");generator.initialize(2048);KeyPair pair=generator.generateKeyPair();
            FileOutputStream output=null;try{output=file.startWrite();output.write(pair.getPrivate().getEncoded());file.finishWrite(output);}catch(IOException error){if(output!=null)file.failWrite(output);throw error;}
            return pair;
        }catch(Exception error){throw new IOException("تعذر إنشاء مفتاح ADB الخاص داخل بيانات التطبيق.",error);}
    }
    static String systemInfo(Context context){
        ActivityManager.MemoryInfo memory=new ActivityManager.MemoryInfo();((ActivityManager)context.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
        StatFs storage=new StatFs(Environment.getDataDirectory().getAbsolutePath());PackageManager packages=context.getPackageManager();
        return "ملف الجهاز: شاشة الجامع\n"+android.os.Build.MANUFACTURER+" · "+android.os.Build.MODEL+" · Android "+android.os.Build.VERSION.RELEASE
                +"\nالذاكرة المتاحة الآن: "+size(memory.availMem)+" من "+size(memory.totalMem)+" — التخزين المتاح: "+size(storage.getAvailableBytes())
                +"\nWi-Fi: "+(packages.hasSystemFeature(PackageManager.FEATURE_WIFI)?"مدعوم":"غير معلن")+" · Bluetooth: "+(packages.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH)?"مدعوم":"غير معلن")
                +"\nهذه قراءة حالية وليست وعدًا بزيادة السرعة أو الذاكرة.";
    }
    private static String size(long bytes){return String.format(Locale.US,"%.1f GB",bytes/1073741824.0);}
    private static byte[] read(InputStream input,int maximum)throws IOException{ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[2048];int count;while((count=input.read(buffer))!=-1){if(bytes.size()+count>maximum)throw new IOException("الملف أكبر من الحد المسموح.");bytes.write(buffer,0,count);}return bytes.toByteArray();}
    void disconnect(){AdbLocal current=adb;adb=null;if(current!=null)try{current.close();}catch(IOException ignored){}}
    void pauseForPrayer(){if(!mutationInFlight)disconnect();}
}
