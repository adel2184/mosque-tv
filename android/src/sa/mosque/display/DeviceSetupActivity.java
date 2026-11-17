package sa.mosque.display;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Deliberate operator preparation screen; no automatic package changes on launch. */
public final class DeviceSetupActivity extends Activity {
    private static volatile boolean prayerActive;
    private static WeakReference<DeviceSetupActivity> active=new WeakReference<>(null);
    private DeviceSetup setup;
    private TextView information,status;
    private LinearLayout rows;
    private Button connect,apply,restore,refresh,disconnect;
    private boolean busy;
    private volatile boolean released;
    private boolean closingForPrayer;
    private AlertDialog confirmation;
    private final Set<String> selected=new HashSet<>();
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    interface Operation { String run()throws Exception; }
    static boolean isPrayerActive(){return prayerActive;}
    public static void setPrayerActive(boolean value){prayerActive=value;if(value)closeForPrayer();}
    public static void closeForPrayer(){
        prayerActive=true;DeviceSetupActivity activity=active.get();if(activity==null)return;
        activity.runOnUiThread(()->{activity.closingForPrayer=true;if(activity.confirmation!=null)activity.confirmation.dismiss();if(activity.setup!=null)activity.setup.pauseForPrayer();activity.finish();activity.overridePendingTransition(0,0);});
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);if(prayerActive){finish();return;}active=new WeakReference<>(this);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);setup=new DeviceSetup(this);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(Color.rgb(8,15,20));
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(48,30,48,40);layout.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);scroll.addView(layout);setContentView(scroll);
        TextView heading=text("تجهيز الجهاز · شاشة الجامع",30);layout.addView(heading);information=text("",19);layout.addView(information);
        layout.addView(text("اختر العناصر التي لا تحتاجها فقط. التعطيل قابل للاستعادة ولا يحذف بياناتها. تُحمى الشبكة والريموت والبلوتوث وWebView والمداخل والتحديثات وواجهة المصنع. لا يمكن إزالة كل إعلانات النظام بهذه القائمة، ولا تُفترض زيادة محددة في السرعة.",19));
        layout.addView(text("التعطيل المباشر يحتاج ADB محليًا على 127.0.0.1:5555 وموافقة التلفاز. قد لا يتيحه طرازك حتى مع تفعيل التصحيح. عند تعذّره استخدم «إعدادات التطبيق» لكل عنصر؛ فتح الإعدادات لا يعني أن التطبيق عُطّل. لا يلزم اتصال بالإنترنت.",18));
        LinearLayout actions=new LinearLayout(this);actions.setOrientation(LinearLayout.HORIZONTAL);layout.addView(actions);
        connect=button("اتصال ADB المحلي",()->operate(()->{setup.connect(message->runOnUiThread(()->show(message,false)));return "اتصال محلي مصرح متاح. لم تُغيّر أي تطبيقات بعد.";}));actions.addView(connect,new LinearLayout.LayoutParams(0,-2,1));
        disconnect=button("إنهاء الاتصال",()->{setup.disconnect();show("أُنهي اتصال ADB المحلي. تبقى التطبيقات وحالاتها كما هي.",false);draw();});actions.addView(disconnect,new LinearLayout.LayoutParams(0,-2,1));
        refresh=button("تحديث الحالة",this::draw);actions.addView(refresh,new LinearLayout.LayoutParams(0,-2,1));
        LinearLayout changes=new LinearLayout(this);changes.setOrientation(LinearLayout.HORIZONTAL);layout.addView(changes);
        apply=button("تعطيل المحدد",()->confirmApply());changes.addView(apply,new LinearLayout.LayoutParams(0,-2,1));
        restore=button("استعادة تغييراتنا",()->{if(prayerActive)return;confirmation=new AlertDialog.Builder(this).setTitle("استعادة الحالات المسجلة؟").setMessage("ستُستعاد فقط العناصر الموجودة في سجل هذه الأداة إلى حالتها السابقة. لن تُفعّل تطبيقات كانت معطّلة قبل استخدامها.").setNegativeButton("إلغاء",null).setPositiveButton("استعادة",(dialog,which)->operate(()->setup.restore())).show();});changes.addView(restore,new LinearLayout.LayoutParams(0,-2,1));
        status=text("لم تُنفذ تغييرات. استخدم الاتصال أو إعدادات التطبيق للخطوات اليدوية.",19);status.setPadding(0,18,0,18);layout.addView(status);
        rows=new LinearLayout(this);rows.setOrientation(LinearLayout.VERTICAL);layout.addView(rows);
        Button back=button("الرجوع إلى شاشة الجامع",this::finish);layout.addView(back);draw();connect.requestFocus();
    }
    private TextView text(String value,int size){TextView node=new TextView(this);node.setText(value);node.setTextSize(size);node.setTextColor(Color.rgb(227,230,218));node.setPadding(0,8,0,8);return node;}
    private Button button(String title,Runnable action){Button button=new Button(this);button.setText(title);button.setTextSize(16);button.setOnClickListener(view->action.run());return button;}
    private void draw(){
        if(isFinishing()||isDestroyed()||rows==null)return;information.setText(DeviceSetup.systemInfo(this));rows.removeAllViews();List<DeviceSetup.Row> candidates=setup.rows();
        if(candidates.isEmpty())rows.addView(text("لم تظهر تطبيقات من قائمة المقترحات على هذا الجهاز. لن تُضاف أسماء أو أوامر مخصصة. يمكنك مراجعة التطبيقات من إعدادات التلفزيون.",20));
        for(DeviceSetup.Row candidate:candidates){
            LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.HORIZONTAL);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(0,10,0,10);
            CheckBox choice=new CheckBox(this);choice.setTextColor(Color.rgb(230,234,220));choice.setTextSize(18);
            String state=candidate.enabled?"مفعّل":"معطّل بالفعل";choice.setText(candidate.title+" — "+state+"\n"+candidate.name+"\n"+candidate.reason+(candidate.protectedReason.isEmpty()?"":"\nمحمي: "+candidate.protectedReason));
            choice.setChecked(selected.contains(candidate.name));choice.setEnabled(!busy&&candidate.selectable());choice.setOnCheckedChangeListener((button,checked)->{if(checked)selected.add(candidate.name);else selected.remove(candidate.name);});
            row.addView(choice,new LinearLayout.LayoutParams(0,-2,1));Button settings=button("إعدادات التطبيق",()->openAppSettings(candidate.name));settings.setEnabled(!busy);row.addView(settings);rows.addView(row);
        }
        connect.setEnabled(!busy&&!setup.connected());disconnect.setEnabled(!busy&&setup.connected());refresh.setEnabled(!busy);
        apply.setEnabled(!busy&&setup.connected()&&setup.journalWarning().isEmpty());restore.setEnabled(!busy&&setup.connected()&&setup.journalCount()>0&&setup.journalWarning().isEmpty());
        if(!setup.journalWarning().isEmpty())show(setup.journalWarning(),true);
    }
    private void confirmApply(){
        if(busy||prayerActive)return;List<String> choice=new ArrayList<>(selected);
        if(choice.isEmpty()){show("حدّد التطبيقات المطلوبة أولًا؛ لم يتغير شيء.",false);return;}
        confirmation=new AlertDialog.Builder(this).setTitle("تعطيل التطبيقات المحددة؟").setMessage("عدد العناصر: "+choice.size()+". سيُحفظ سجل الاستعادة أولًا، ثم يُطلب تعطيلها للمستخدم الحالي فقط، وتُقرأ النتيجة من الجهاز.")
                .setNegativeButton("إلغاء",null).setPositiveButton("تعطيل المحدد",(dialog,which)->operate(()->setup.apply(choice))).show();
    }
    private void operate(Operation action){
        if(busy||prayerActive)return;busy=true;draw();show("جارٍ تنفيذ العملية المحلية؛ انتظر التأكيد من الجهاز…",false);
        worker.execute(()->{String result;boolean failed=false;try{result=action.run();}catch(Exception error){failed=true;result=error.getMessage()==null?"تعذر إكمال العملية. راجع الحالة؛ لم يُفترض نجاحها.":error.getMessage();}final String message=result;final boolean failure=failed;
            if(released||isFinishing()){setup.disconnect();worker.shutdown();return;}
            runOnUiThread(()->{if(isFinishing()||isDestroyed()){setup.disconnect();worker.shutdown();return;}busy=false;show(message,failure);draw();});});
    }
    private void show(String message,boolean error){if(status!=null&&!isFinishing()&&!isDestroyed()){status.setText(message);status.setTextColor(error?Color.rgb(239,171,151):Color.rgb(166,212,188));}}
    private void openAppSettings(String name){
        if(prayerActive||!DeviceSetup.allowed(name))return;
        try{startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+name)));show("فُتحت إعدادات التطبيق فقط. عُد وحدّث الحالة للتحقق من أي تغيير تجريه هناك.",false);}
        catch(ActivityNotFoundException|SecurityException error){show("تعذر فتح إعدادات هذا التطبيق. راجعه من إعدادات التطبيقات في التلفزيون.",true);}
    }
    @Override protected void onResume(){super.onResume();if(setup!=null&&!busy)draw();}
    @Override protected void onDestroy(){released=true;if(confirmation!=null)confirmation.dismiss();if(active.get()==this)active.clear();if(setup!=null&&(!closingForPrayer||!busy))setup.disconnect();if(closingForPrayer&&busy)worker.shutdown();else worker.shutdownNow();super.onDestroy();}
}
