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
import java.util.Collections;
import java.util.LinkedHashMap;

/** Mosque profile: fixed, optional candidates only; no uninstall, custom commands, or launcher changes. */
final class DeviceSetup {
    static final String[][] CANDIDATES={
        {"com.tcl.bi","إحصاءات استخدام TCL","إحصاءات الاستخدام؛ قد يفيد تعطيله في تقليل نشاط الخلفية."},
        {"com.tcl.overseasappshow","عروض تطبيقات TCL","واجهة عرض التطبيقات المقترحة."},
        {"com.tcl.messagebox","رسائل TCL الترويجية","رسائل وعروض الشركة؛ راجع حاجتك إليها."},
        {"com.tcl.esticker","ملصقات العرض الترويجية","ملصقات وضع العرض الترويجي."},
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
    private final DeviceSetupActivity operator;
    private final PackageManager packages;
    private final AtomicFile journalFile;
    private JSONObject journal=new JSONObject();
    private IOException journalProblem;
    private volatile AdbLocal adb;
    private volatile boolean mutationInFlight;
    private final DeviceOptimization optimization;
    private final DeviceProfileCatalog profileCatalog;
    DeviceSetup(Context context){
        this.context=context.getApplicationContext();operator=context instanceof DeviceSetupActivity?(DeviceSetupActivity)context:null;packages=this.context.getPackageManager();
        profileCatalog=DeviceProfileCatalog.get(this.context);
        journalFile=new AtomicFile(new File(this.context.getFilesDir(),"device-setup-journal.json"));
        if(journalFile.getBaseFile().exists()||new File(journalFile.getBaseFile().getPath()+".bak").exists())try(InputStream input=journalFile.openRead()){
            JSONObject saved=new JSONObject(new String(read(input,65536),StandardCharsets.UTF_8));
            if(saved.getInt("version")!=1)throw new IOException("إصدار سجل الاستعادة غير مدعوم.");
            journal=saved.getJSONObject("packages");Iterator<String> names=journal.keys();
            while(names.hasNext())if(!canRestoreRecorded(names.next()))throw new IOException("سجل الاستعادة غير صالح.");
        }catch(Exception error){journalProblem=new IOException("تعذر قراءة سجل الاستعادة؛ لن يُنفذ أي تعطيل أو استعادة آلية.",error);}
        final AtomicFile animationFile=new AtomicFile(new File(this.context.getFilesDir(),"device-animation-journal.bin"));
        optimization=new DeviceOptimization(value->{AdbLocal.Reply reply=command(value);return new DeviceOptimization.Reply(reply.output,reply.code);},new DeviceOptimization.Journal(){
            public byte[] read()throws IOException{try(InputStream input=animationFile.openRead()){return DeviceSetup.read(input,4096);}catch(java.io.FileNotFoundException error){if(!animationFile.getBaseFile().exists()&&!new File(animationFile.getBaseFile().getPath()+".bak").exists())return null;throw error;}}
            public void write(byte[] data)throws IOException{FileOutputStream output=null;try{output=animationFile.startWrite();output.write(data);animationFile.finishWrite(output);}catch(IOException error){if(output!=null)animationFile.failWrite(output);throw error;}}
        },()->requireReady());
    }
    private static boolean builtin(String name){for(String[] entry:CANDIDATES)if(entry[0].equals(name))return true;return false;}
    boolean allowed(String name){
        return builtin(name)||profileCatalog.match().suggests(name);
    }
    private boolean canRestoreRecorded(String name){
        JSONObject entry=journal.optJSONObject(name);
        int before=entry==null?-1:entry.optInt("before",-1);
        return DeviceProfiles.permitsRecovery(name,before,builtin(name),profileCatalog.recoverablePackages);
    }
    List<String> recordedPackages(){
        List<String> result=new ArrayList<>();
        for(Iterator<String> names=journal.keys();names.hasNext();){
            String name=names.next();if(canRestoreRecorded(name))result.add(name);
        }
        Collections.sort(result);
        return result;
    }
    String recordedTitle(String name){
        for(String[] entry:CANDIDATES)if(entry[0].equals(name))return entry[1];
        try{
            ApplicationInfo info=packages.getApplicationInfo(name,PackageManager.MATCH_DISABLED_COMPONENTS);
            CharSequence label=info.loadLabel(packages);
            if(label!=null&&label.length()>0&&label.length()<=180)return label.toString();
        }catch(PackageManager.NameNotFoundException|RuntimeException ignored){}
        return name;
    }
    boolean connected(){return adb!=null;}
    int journalCount(){return journal.length();}
    String journalWarning(){return journalProblem==null?"":journalProblem.getMessage();}
    boolean recorded(String name){return journal.has(name);}
    int animationJournalCount(){return optimization.pendingCount();}
    String optimizationSummary(){return optimization.summary()+(optimization.warning().isEmpty()?"":"\n!! "+optimization.warning());}
    String optimizeAnimations()throws IOException{requireReady();mutationInFlight=true;try{return optimization.applyAnimations();}finally{mutationInFlight=false;}}
    String restoreAnimations()throws IOException{requireReady();mutationInFlight=true;try{return optimization.restoreAnimations();}finally{mutationInFlight=false;}}
    String restoreAll()throws IOException{String apps=restore();String animations=restoreAnimations();return apps+"\n"+animations;}
    private static StatFs storage(){return new StatFs(Environment.getDataDirectory().getAbsolutePath());}
    boolean storageLow(){StatFs disk=storage();return DeviceOptimization.lowStorage(disk.getTotalBytes(),disk.getAvailableBytes());}
    private boolean updateCachePresent(){File cache=new File(context.getCacheDir(),"verified-update");if(!cache.exists())return false;File[] files=cache.listFiles();return files==null||files.length>0;}
    boolean cacheCleanupEligible(){return storageLow()&&!updateCachePresent();}
    String storageSummary(){StatFs disk=storage();long total=disk.getTotalBytes(),available=disk.getAvailableBytes();return size(available)+" / "+size(total)+" · "+String.format(Locale.US,"%.1f%%",100.0*available/total)+"\n"+(DeviceOptimization.lowStorage(total,available)?"LOW_STORAGE":"SPACE_OK")+(updateCachePresent()?"\nUPDATE_CACHE_PRESENT":"");}
    String trimCaches()throws IOException{
        requireReady();StatFs disk=storage();long before=disk.getAvailableBytes(),total=disk.getTotalBytes();
        if(updateCachePresent())throw new IOException("!! يوجد ملف تحديث محفوظ؛ ثبته أو ألغِ مهمة التحديث قبل طلب تنظيف الكاش.");
        if(!DeviceOptimization.lowStorage(total,before))return "SPACE_OK — لم يُرسل أمر تنظيف؛ المساحة كافية.";
        long target=Math.max(1073741824L,total/10+(total%10==0?0:1));
        mutationInFlight=true;
        try{requireReady();AdbLocal.Reply reply=command("pm trim-caches "+target+" internal");if(reply.code!=0)throw new IOException("!! لم يؤكد Android طلب تنظيف الكاش. لا تُحذف بيانات التطبيقات أو إعداداتها بهذه الأداة.");
            long after=storage().getAvailableBytes();return "CACHE_REQUEST_CONFIRMED · "+size(before)+" → "+size(after)+"\nأكد Android الطلب؛ قد تعود ملفات الكاش لاحقًا. لا يمكن استعادة الكاش المحذوف.";
        }finally{mutationInFlight=false;}
    }
    List<Row> rows(){
        List<Row> result=new ArrayList<>();
        java.util.Map<String,String[]> candidates=new LinkedHashMap<>();for(String[] entry:CANDIDATES)candidates.put(entry[0],entry);
        DeviceProfiles.Match match=profileCatalog.match();if(match.profile!=null)for(String name:match.profile.packages)if(!candidates.containsKey(name))candidates.put(name,new String[]{name,name,"قائمة مجتمعية مطابقة للموديل؛ راجع وظيفة التطبيق قبل اختياره."});
        for(String[] entry:candidates.values())try{
            ApplicationInfo info=packages.getApplicationInfo(entry[0],PackageManager.MATCH_DISABLED_COMPONENTS);
            int state=packages.getApplicationEnabledSetting(entry[0]);
            String title=entry[1];if(!builtin(entry[0])){CharSequence label=info.loadLabel(packages);if(label!=null&&label.length()<=180)title=label.toString();}
            result.add(new Row(entry[0],title,entry[2],protect(entry[0],info),info.enabled,state));
        }catch(PackageManager.NameNotFoundException|RuntimeException ignored){}
        return result;
    }
    private String protect(String name,ApplicationInfo info){
        if(!allowed(name)||name.equals(context.getPackageName()))return "خارج قائمة شاشة الجامع المحددة.";
        if(info.uid%100000<10000)return "مكوّن يعمل بهوية نظام مشتركة؛ يُترك مفعّلًا.";
        if(!builtin(name)&&packages.checkSignatures(name,"android")==PackageManager.SIGNATURE_MATCH)return "مكوّن موقّع بمفتاح النظام؛ يُترك مفعّلًا خارج المقترحات المحددة.";
        String lower=name.toLowerCase(Locale.ROOT);
        if((lower.startsWith("com.android.")||lower.startsWith("android.")||lower.startsWith("com.google."))&&!builtin(name))return "مكوّن Android أو Google محمي؛ لا يُعطّل من قوائم المجتمع.";
        if(lower.startsWith("com.tcl.")&&!isTcl())return "قائمة TCL لا تُطبق على شركة مختلفة؛ استخدم إعدادات التطبيق يدويًا.";
        for(String token:new String[]{"bluetooth","webview","network","systemui","settings","remote","autopair","input","launcher","setupwraith","permissioncontroller","packageinstaller","documentsui","updater","update","firmware","accessibility","talkback","mediashell","airplay","miracast","chromecast","castreceiver","audio","sound","vending","playstore","security","protect","credential","keychain","certinstaller","keystore","drm","widevine","ota","tts","speech","voice","assistant","wifi","wlan","ethernet","connectivity","provider","hdmi","cec","usb","home","netflix","youtube","amazonvideo","primevideo"})
            if(lower.contains(token))return "مكوّن محمي لخدمات النظام أو التحكم أو الاتصال.";
        try{
            Intent home=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(name);
            if(!packages.queryIntentActivities(home,PackageManager.MATCH_DEFAULT_ONLY|PackageManager.MATCH_DISABLED_COMPONENTS).isEmpty())return "واجهة HOME محمية؛ لا يُعطّلها هذا الملف.";
            PackageInfo details=packages.getPackageInfo(name,PackageManager.GET_PERMISSIONS|PackageManager.GET_SERVICES|PackageManager.MATCH_DISABLED_COMPONENTS);
            if(details.requestedPermissions!=null)for(String permission:details.requestedPermissions)
                if(Arrays.asList("android.permission.TV_INPUT_HARDWARE","android.permission.BLUETOOTH_PRIVILEGED","android.permission.NETWORK_STACK","android.permission.INSTALL_PACKAGES","android.permission.DELETE_PACKAGES","android.permission.REBOOT","android.permission.RECOVERY","android.permission.MANAGE_USERS","android.permission.MANAGE_USB").contains(permission))return "يطلب صلاحية خدمة محمية؛ يُترك مفعّلًا.";
            if(details.services!=null)for(ServiceInfo service:details.services){
                String permission=service.permission==null?"":service.permission;
                if(permission.startsWith("android.permission.BIND_"))return "يقدّم خدمة نظام محمية؛ تُترك مفعّلة.";
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
            requireReady();
            if(DeviceSetupActivity.isPrayerActive())throw new IOException("بدأ وضع الصلاة؛ توقف التنفيذ قبل العنصر التالي، وسجل الاستعادة محفوظ.");
            mutationInFlight=true;
            try{
            try{if(!journal.has(row.name)){JSONObject prior=new JSONObject();prior.put("before",row.setting);prior.put("recordedAt",System.currentTimeMillis());journal.put(row.name,prior);}saveJournal();}
            catch(Exception error){throw new IOException("تعذر حفظ سجل الاستعادة؛ لم يُرسل أمر تعطيل هذا العنصر.",error);}
            requireReady();AdbLocal.Reply answer=command("pm disable-user --user 0 "+row.name);
            if(answer.code!=0||!list("pm list packages -d").contains(row.name)||packages.getApplicationEnabledSetting(row.name)!=PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER)throw new IOException("لم يُؤكَّد تعطيل "+row.title+". راجع الحالة المعروضة؛ سجل الاستعادة محفوظ.");
            changed++;
            }finally{mutationInFlight=false;}
        }
        return "أكد الجهاز تعطيل "+changed+" من التطبيقات المحددة. لم تُحذف تطبيقات أو بيانات، ولم تتغير واجهة المصنع.";
    }
    String restore()throws IOException{
        requireReady();List<String> names=new ArrayList<>();Iterator<String> iterator=journal.keys();while(iterator.hasNext())names.add(iterator.next());int restored=0;
        for(String name:names){
            requireReady();
            if(DeviceSetupActivity.isPrayerActive())throw new IOException("بدأ وضع الصلاة؛ توقف التنفيذ قبل العنصر التالي، وسجل الاستعادة محفوظ.");
            if(!canRestoreRecorded(name))throw new IOException("عنصر استعادة غير مسموح.");
            mutationInFlight=true;
            try{
                int before=journal.getJSONObject(name).getInt("before");
                requireReady();AdbLocal.Reply answer=command((before==0?"pm default-state --user 0 ":"pm enable --user 0 ")+name);
                if(answer.code!=0||list("pm list packages -d").contains(name)||packages.getApplicationEnabledSetting(name)!=before)throw new IOException("لم تُؤكَّد الاستعادة الأصلية لـ "+name+"؛ بقي سجله محفوظًا.");
                JSONObject original=journal.getJSONObject(name);journal.remove(name);try{saveJournal();}catch(Exception failure){journal.put(name,original);throw failure;}restored++;
            }catch(IOException error){throw error;}catch(Exception error){throw new IOException("تعذر إكمال الاستعادة؛ لم يُحذف سجل العنصر المتبقي.",error);}finally{mutationInFlight=false;}
        }
        return "أكد الجهاز استعادة "+restored+" عنصرًا إلى حالته الأصلية المسجلة. لم تُفعّل عناصر كانت معطّلة قبل استخدام الأداة.";
    }
    String restorePackage(String name)throws IOException{
        requireReady();if(!canRestoreRecorded(name))throw new IOException("لا يوجد سجل استعادة مسموح لهذا التطبيق.");
        mutationInFlight=true;
        try{JSONObject original=journal.getJSONObject(name);int before=original.getInt("before");
            requireReady();AdbLocal.Reply answer=command((before==0?"pm default-state --user 0 ":"pm enable --user 0 ")+name);
            if(answer.code!=0||list("pm list packages -d").contains(name)||packages.getApplicationEnabledSetting(name)!=before)throw new IOException("!! لم تتأكد الحالة الأصلية؛ بقي سجل الاستعادة محفوظًا.");
            journal.remove(name);try{saveJournal();}catch(Exception failure){journal.put(name,original);throw failure;}
            return "PACKAGE_RESTORED · "+name+" · "+before;
        }catch(IOException error){throw error;}catch(Exception error){throw new IOException("!! تعذرت الاستعادة؛ راجع الحالة والسجل.",error);}finally{mutationInFlight=false;}
    }
    private static boolean isTcl(){String maker=(android.os.Build.MANUFACTURER+" "+android.os.Build.BRAND).toLowerCase(Locale.ROOT);return maker.matches(".*(?:^|[^a-z])tcl(?:[^a-z]|$).*");}
    private void requireReady()throws IOException{if(operator==null||!operator.permitsChanges())throw new IOException("تهيئة الجهاز تتطلب بقاء صفحتها مفتوحة؛ راجع السجل عند العودة.");if(DeviceSetupActivity.isPrayerActive())throw new IOException("تجهيز الجهاز متوقف أثناء وضع الصلاة.");if(journalProblem!=null)throw journalProblem;if(adb==null)throw new IOException("اتصل بـ ADB المحلي أولًا، أو استخدم إعدادات التطبيقات يدويًا.");android.os.UserManager users=context.getSystemService(android.os.UserManager.class);if(users==null||!users.isSystemUser())throw new IOException("التعطيل الآلي مخصص لحساب الجهاز الرئيسي فقط؛ استخدم إعدادات التطبيقات للحساب الحالي.");}
    private AdbLocal.Reply command(String command)throws IOException{try{return adb.run(command);}catch(IOException|RuntimeException error){disconnect();throw new IOException("انقطع تأكيد الجهاز؛ أعد الاتصال وراجع الحالة. سجل الاستعادة محفوظ.",error);}}
    private Set<String> list(String command)throws IOException{AdbLocal.Reply result=command(command);if(result.code!=0)throw new IOException("تعذر قراءة حالة التطبيقات من الجهاز.");Set<String> names=new HashSet<>();for(String line:result.output.split("\n"))if(line.startsWith("package:")){String name=line.substring(8).trim();if(name.matches("[A-Za-z0-9_.]+"))names.add(name);}return names;}
    private void saveJournal()throws Exception{
        JSONObject object=new JSONObject();object.put("version",1);object.put("packages",journal);byte[] data=object.toString().getBytes(StandardCharsets.UTF_8);
        FileOutputStream output=null;try{output=journalFile.startWrite();output.write(data);journalFile.finishWrite(output);}catch(IOException error){if(output!=null)journalFile.failWrite(output);throw error;}
    }
    private KeyPair keyPair()throws IOException{
        AtomicFile file=new AtomicFile(new File(context.getFilesDir(),"local-adb-private.pk8"));
        try{
            // Keep the previously authorized identity on existing installations.
            if(file.getBaseFile().exists() || new File(file.getBaseFile().getPath()+".bak").exists())try(InputStream input=file.openRead()){
                KeyFactory factory=KeyFactory.getInstance("RSA");
                RSAPrivateCrtKey key=(RSAPrivateCrtKey)factory.generatePrivate(new PKCS8EncodedKeySpec(read(input,8192)));
                return new KeyPair(factory.generatePublic(new RSAPublicKeySpec(key.getModulus(),key.getPublicExponent())),key);
            }
            String alias = "mosque-display-local-adb";
            java.security.KeyStore store = java.security.KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (!store.containsAlias(alias)) {
                KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA", "AndroidKeyStore");
                generator.initialize(new android.security.keystore.KeyGenParameterSpec.Builder(alias,
                        android.security.keystore.KeyProperties.PURPOSE_SIGN)
                        .setKeySize(2048)
                        .setDigests(android.security.keystore.KeyProperties.DIGEST_NONE)
                        .setSignaturePaddings(android.security.keystore.KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                        .build());
                generator.generateKeyPair();
            }
            return new KeyPair(store.getCertificate(alias).getPublicKey(), (java.security.PrivateKey)store.getKey(alias, null));
        }catch(Exception error){throw new IOException("تعذر إنشاء مفتاح ADB الخاص داخل بيانات التطبيق.",error);}
    }
    static String systemInfo(Context context){
        ActivityManager.MemoryInfo memory=new ActivityManager.MemoryInfo();((ActivityManager)context.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
        StatFs storage=new StatFs(Environment.getDataDirectory().getAbsolutePath());PackageManager packages=context.getPackageManager();
        return "ملف الجهاز: شاشة الجامع\n"+android.os.Build.MANUFACTURER+" · "+android.os.Build.MODEL+" · Android "+android.os.Build.VERSION.RELEASE
                +"\n"+DeviceProfileCatalog.get(context).summary()
                +"\nالذاكرة المتاحة الآن: "+size(memory.availMem)+" من "+size(memory.totalMem)+" — التخزين المتاح: "+size(storage.getAvailableBytes())
                +"\nWi-Fi: "+(packages.hasSystemFeature(PackageManager.FEATURE_WIFI)?"مدعوم":"غير معلن")+" · Bluetooth: "+(packages.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH)?"مدعوم":"غير معلن")
                +"\nهذه قراءة حالية وليست وعدًا بزيادة السرعة أو الذاكرة.";
    }
    private static String size(long bytes){return String.format(Locale.US,"%.1f GB",bytes/1073741824.0);}
    private static byte[] read(InputStream input,int maximum)throws IOException{ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[2048];int count;while((count=input.read(buffer))!=-1){if(bytes.size()+count>maximum)throw new IOException("الملف أكبر من الحد المسموح.");bytes.write(buffer,0,count);}return bytes.toByteArray();}
    void disconnect(){AdbLocal current=adb;adb=null;if(current!=null)try{current.close();}catch(IOException ignored){}}
    void pauseForPrayer(){if(!mutationInFlight)disconnect();}
}
