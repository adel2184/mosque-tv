package sa.mosque.display;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
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
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Explicit native TV preparation. Opening, changing pages, and refreshing never mutate the device. */
public final class DeviceSetupActivity extends Activity {
    private static final int BG=Color.rgb(8,19,17), PANEL=Color.rgb(17,42,31), EDGE=Color.rgb(61,86,65);
    private static final int TEXT=Color.rgb(235,237,221), MUTED=Color.rgb(173,196,177), GOLD=Color.rgb(219,192,125), INK=Color.rgb(19,43,28);
    private static final String[] TABS={"apps","animations","storage","restore"};
    private static volatile boolean prayerActive;
    private static WeakReference<DeviceSetupActivity> active=new WeakReference<>(null);
    private final Set<String> selected=new HashSet<>();
    private final Map<String,Integer> scrollPositions=new HashMap<>();
    private final Map<String,String> pageFocus=new HashMap<>();
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private DeviceSetup setup;
    private LinearLayout root,content;
    private ScrollView scroll;
    private TextView status,connection;
    private Button connect,disconnect,refresh,feedback;
    private final Map<String,Button> tabs=new HashMap<>();
    private String page="apps",renderedPage="",operationFocus="connect",lastStatus="";
    private boolean english,busy;
    private volatile boolean released;
    private volatile boolean foreground;
    private AlertDialog confirmation;
    interface Operation { String run()throws Exception; }

    static boolean isPrayerActive(){return prayerActive;}
    boolean permitsChanges(){return foreground&&!released&&!prayerActive;}
    public static void setPrayerActive(boolean value){prayerActive=value;if(value)closeForPrayer();}
    public static void closeForPrayer(){
        prayerActive=true;DeviceSetupActivity activity=active.get();if(activity==null)return;
        activity.runOnUiThread(()->{if(activity.confirmation!=null)activity.confirmation.dismiss();if(activity.setup!=null)activity.setup.pauseForPrayer();activity.finish();activity.overridePendingTransition(0,0);});
    }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);if(prayerActive){finish();return;}
        active=new WeakReference<>(this);english="en".equals(getSharedPreferences("mosque-tv-setup",0).getString("language","ar"));
        setup=new DeviceSetup(this);
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(24),dp(12),dp(24),dp(12));root.setBackgroundColor(BG);root.setLayoutDirection(english?View.LAYOUT_DIRECTION_LTR:View.LAYOUT_DIRECTION_RTL);setContentView(root);
        LinearLayout header=horizontal();TextView title=text(tr("تهيئة التلفاز","TV preparation"),23,TEXT);title.setTypeface(Typeface.DEFAULT,Typeface.BOLD);header.addView(title,new LinearLayout.LayoutParams(0,-2,1));
        feedback=button(tr("الإبلاغ عن مشكلة","Report a problem"),"feedback",this::openFeedback);header.addView(feedback);root.addView(header);
        LinearLayout connections=horizontal();connections.setPadding(0,dp(5),0,dp(5));
        connection=text("",13,MUTED);connections.addView(connection,new LinearLayout.LayoutParams(0,-2,1));
        connect=button(tr("اتصال محلي","Connect locally"),"connect",()->operate(()->{setup.connect(message->runOnUiThread(()->show(message,false)));return tr("اتصال محلي مصرح متاح. لم تُغيّر أي تطبيقات بعد.","The local connection is authorized. No apps have changed.");}));connections.addView(connect);
        disconnect=button(tr("إنهاء الاتصال","Disconnect"),"disconnect",()->{if(busy||prayerActive)return;setup.disconnect();show(tr("أُنهي الاتصال؛ بقيت الحالات كما هي.","Disconnected. Device states are unchanged."),false);draw("connect");});connections.addView(disconnect);
        refresh=button(tr("تحديث الحالة","Refresh"),"refresh",()->draw("refresh"));connections.addView(refresh);root.addView(connections);
        LinearLayout navigation=horizontal();navigation.setPadding(0,0,0,dp(7));
        for(String id:TABS){Button tab=button(tabTitle(id),"tab:"+id,()->switchPage(id));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,-2,1);p.setMargins(dp(3),0,dp(3),0);navigation.addView(tab,p);tabs.put(id,tab);}root.addView(navigation);
        scroll=new ScrollView(this);scroll.setFillViewport(false);scroll.setClipToPadding(false);scroll.setPadding(dp(3),dp(3),dp(3),dp(3));
        content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        status=text("",14,MUTED);tag(status,"status");status.setFocusable(true);status.setPadding(dp(10),dp(6),dp(10),dp(6));status.setMaxLines(3);status.setEllipsize(TextUtils.TruncateAt.END);status.setBackground(focusBackground(PANEL));status.setTextColor(focusColors(MUTED));status.setOnClickListener(view->{if(!lastStatus.isEmpty()&&!prayerActive)confirmation=new AlertDialog.Builder(this).setTitle(tr("الحالة","Status")).setMessage(lastStatus).setPositiveButton(tr("تم","Done"),null).show();});root.addView(status);
        LinearLayout footer=horizontal();TextView help=text(tr("الأسهم: تنقّل · OK: اختيار · رجوع: إغلاق","Arrows: navigate · OK: select · Back: close"),12,MUTED);footer.addView(help,new LinearLayout.LayoutParams(0,-2,1));footer.addView(button(tr("الرجوع إلى شاشة الجامع","Back to mosque display"),"back",this::requestExit));root.addView(footer);
        show(tr("اختر قسمًا وراجع الخطة. لم تُنفذ تغييرات.","Choose a page and review the plan. No changes have been made."),false);draw("connect");
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private String tr(String ar,String en){return english?en:ar;}
    private String tabTitle(String id){if("animations".equals(id))return tr("الحركة","Animations");if("storage".equals(id))return tr("التخزين","Storage");if("restore".equals(id))return tr("الاستعادة","Restore");return tr("التطبيقات","Apps");}
    private LinearLayout horizontal(){LinearLayout line=new LinearLayout(this);line.setOrientation(LinearLayout.HORIZONTAL);line.setGravity(Gravity.CENTER_VERTICAL);return line;}
    private GradientDrawable shape(int color){GradientDrawable drawable=new GradientDrawable();drawable.setColor(color);drawable.setCornerRadius(dp(8));drawable.setStroke(dp(1),EDGE);return drawable;}
    private StateListDrawable focusBackground(int normal){StateListDrawable states=new StateListDrawable();states.addState(new int[]{android.R.attr.state_focused},shape(GOLD));states.addState(new int[]{android.R.attr.state_pressed},shape(GOLD));states.addState(new int[]{},shape(normal));return states;}
    private ColorStateList focusColors(int normal){return new ColorStateList(new int[][]{{android.R.attr.state_focused},{android.R.attr.state_pressed},{}},new int[]{INK,INK,normal});}
    private void tag(View view,String value){view.setId(View.generateViewId());view.setTag(value);}
    private TextView text(String value,int size,int color){TextView node=new TextView(this);node.setText(value);node.setTextSize(size);node.setTextColor(color);node.setPadding(0,dp(3),0,dp(3));return node;}
    private Button button(String title,String value,Runnable action){Button button=new Button(this);tag(button,value);button.setText(title);button.setTextSize(14);button.setAllCaps(false);button.setMinHeight(dp(38));button.setMinimumHeight(dp(38));button.setMinWidth(0);button.setMinimumWidth(0);button.setPadding(dp(12),dp(6),dp(12),dp(6));button.setBackground(focusBackground(PANEL));button.setTextColor(focusColors(TEXT));button.setOnClickListener(view->{if(!prayerActive)action.run();});return button;}
    private LinearLayout card(){LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(12),dp(9),dp(12),dp(9));box.setBackground(shape(PANEL));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,0,0,dp(8));content.addView(box,p);return box;}
    private void readable(String value,String valueTag){TextView node=text(value,15,MUTED);tag(node,valueTag);node.setFocusable(true);node.setPadding(dp(12),dp(10),dp(12),dp(10));node.setBackground(focusBackground(PANEL));node.setTextColor(focusColors(MUTED));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,0,0,dp(8));content.addView(node,p);}
    private void pageAction(Button button,boolean enabled){button.setEnabled(enabled&&!busy);button.setAlpha(button.isEnabled()?1f:.48f);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,0,0,dp(8));content.addView(button,p);}
    private String focusedTag(){View focused=getCurrentFocus();return focused!=null&&focused.getTag() instanceof String?(String)focused.getTag():"";}
    private void rememberPage(){if(scroll!=null)scrollPositions.put(page,scroll.getScrollY());String value=focusedTag();if(value.startsWith("app:")||value.startsWith("read:")||value.startsWith("action:"))pageFocus.put(page,value);}
    private void switchPage(String id){if(busy){busyNotice();return;}if(!page.equals(id)){rememberPage();page=id;draw(pageFocus.containsKey(id)?pageFocus.get(id):"read:"+id);}else draw("tab:"+id);}
    private void draw(String preferred){
        if(isFinishing()||isDestroyed()||content==null)return;
        String keep=preferred==null||preferred.isEmpty()?focusedTag():preferred;
        if(scroll!=null&&!renderedPage.isEmpty())scrollPositions.put(renderedPage,scroll.getScrollY());content.removeAllViews();renderedPage=page;
        connection.setText(setup.connected()?tr("ADB محلي: متصل","Local ADB: connected"):tr("تنفيذ مباشر: غير متصل","Direct actions: disconnected"));
        connect.setEnabled(!busy&&!setup.connected());disconnect.setEnabled(!busy&&setup.connected());refresh.setEnabled(!busy);feedback.setEnabled(!busy);
        for(String id:TABS){Button tab=tabs.get(id);tab.setEnabled(!busy);tab.setBackground(focusBackground(id.equals(page)?Color.rgb(47,77,52):PANEL));tab.setTextColor(focusColors(id.equals(page)?GOLD:TEXT));}
        if("animations".equals(page))drawAnimations();else if("storage".equals(page))drawStorage();else if("restore".equals(page))drawRestore();else drawApps();
        if(!setup.journalWarning().isEmpty())show(setup.journalWarning(),true);
        final String target=busy?"status":keep;final int saved=scrollPositions.containsKey(page)?scrollPositions.get(page):0;
        scroll.post(()->{if(released||isFinishing())return;scroll.scrollTo(0,saved);View node=target==null?null:root.findViewWithTag(target);if((node==null||!node.isEnabled()||!node.isFocusable())&&target!=null&&target.startsWith("app:")){int split=target.lastIndexOf(':');node=root.findViewWithTag(target.substring(0,split)+":settings");}if(node==null||!node.isEnabled()||!node.isFocusable())node=root.findViewWithTag("tab:"+page);if(node!=null&&node.isEnabled())node.requestFocus();});
    }
    private void drawApps(){
        readable(nativeCopy(DeviceSetup.systemInfo(this)),"read:apps");
        readable(tr("اختر التطبيقات غير المطلوبة فقط. تظل واجهة البدء والشبكة والريموت ومكونات النظام المحمية خارج الخطة. التنفيذ المباشر يحتاج اتصال ADB محليًا مصرحًا؛ يمكن فتح إعدادات كل تطبيق دون هذا الاتصال.","Select only apps you do not need. Home, network, remote, and protected system components stay outside the plan. Direct changes need authorized local ADB; each app's system settings can be opened without it."),"read:apps-help");
        List<DeviceSetup.Row> candidates=setup.rows();for(DeviceSetup.Row row:candidates)if(!row.selectable())selected.remove(row.name);
        pageAction(button(tr("مراجعة المحدد: ","Review selected: ")+selected.size(),"action:apply",this::confirmApply),setup.connected()&&!selected.isEmpty()&&setup.journalWarning().isEmpty());
        if(candidates.isEmpty())readable(tr("لا توجد تطبيقات من القائمة المحددة على هذا الجهاز. يمكنك مراجعة التطبيقات من إعدادات التلفاز.","No apps from the supported list were found. You can review apps in TV settings."),"read:apps-empty");
        for(DeviceSetup.Row candidate:candidates){
            LinearLayout box=card();String title=nativeCopy(candidate.title),state=setup.recorded(candidate.name)?tr("تغيير مسجل","Recorded change"):candidate.enabled?tr("مفعّل","Enabled"):tr("معطّل بالفعل","Already disabled");
            CheckBox choice=new CheckBox(this);tag(choice,"app:"+candidate.name+":check");choice.setText(title+" — "+state);choice.setTextSize(16);choice.setTextColor(focusColors(TEXT));choice.setButtonTintList(focusColors(GOLD));choice.setPadding(dp(8),dp(5),dp(8),dp(5));choice.setBackground(focusBackground(PANEL));choice.setChecked(selected.contains(candidate.name));choice.setEnabled(!busy&&candidate.selectable());
            String description=nativeCopy(candidate.reason)+(candidate.protectedReason.isEmpty()?"":"\n"+tr("محمي: ","Protected: ")+nativeCopy(candidate.protectedReason));choice.setContentDescription(title+". "+state+". "+description);choice.setOnCheckedChangeListener((view,checked)->{if(busy)return;if(checked)selected.add(candidate.name);else selected.remove(candidate.name);Button apply=root.findViewWithTag("action:apply");if(apply!=null){apply.setText(tr("مراجعة المحدد: ","Review selected: ")+selected.size());apply.setEnabled(!selected.isEmpty()&&setup.connected()&&setup.journalWarning().isEmpty());}});box.addView(choice);
            box.addView(text(description,13,MUTED));TextView name=text(candidate.name,12,MUTED);name.setTextDirection(View.TEXT_DIRECTION_LTR);box.addView(name);
            LinearLayout actions=horizontal();Button settings=button(tr("إعدادات التطبيق","App settings"),"app:"+candidate.name+":settings",()->openAppSettings(candidate.name));settings.setEnabled(!busy);actions.addView(settings);
            if(setup.recorded(candidate.name)){Button undo=button(tr("استعادة هذا التطبيق","Restore this app"),"app:"+candidate.name+":restore",()->confirmPackage(candidate.name,title));undo.setEnabled(!busy&&setup.connected()&&setup.journalWarning().isEmpty());actions.addView(undo);}box.addView(actions);
        }
    }
    private void drawAnimations(){
        readable(tr("حركة واجهات النظام","System animations")+"\n"+nativeCopy(setup.optimizationSummary()),"read:animations");
        readable(tr("تغيير اختياري إلى 0.5× للانتقالات المدعومة. تُحفظ القيم الأصلية أولًا وتُقرأ القيم بعد التطبيق. لا تبدأ تغييرات بمجرد فتح هذه الصفحة.","Optionally set supported system transitions to 0.5×. Original values are recorded first and the applied values are read back. Opening this page makes no changes."),"read:animations-help");
        pageAction(button(tr("ضبط الحركة على 0.5×","Set animations to 0.5×"),"action:animations",()->confirm(tr("تطبيق حركة 0.5×؟","Apply 0.5× animations?"),tr("ستُسجل القيم السابقة ثم يُطبق التغيير على إعدادات الحركة المدعومة ويُتحقق من النتيجة. يمكنك استعادة القيم المسجلة لاحقًا.","Previous values will be recorded, supported animation settings changed, and the result verified. You can restore the recorded values later."),tr("تطبيق","Apply"),()->setup.optimizeAnimations())),setup.connected()&&setup.journalWarning().isEmpty());
        pageAction(button(tr("استعادة الحركة الأصلية","Restore original animations"),"action:animations-restore",()->confirm(tr("استعادة الحركة الأصلية؟","Restore original animations?"),tr("ستُعاد القيم الأصلية المسجلة لهذه الأداة فقط، مع التحقق من قراءتها.","Only this tool's recorded original values will be restored and read back for verification."),tr("استعادة","Restore"),()->setup.restoreAnimations())),setup.connected()&&setup.animationJournalCount()>0&&setup.journalWarning().isEmpty());
    }
    private void drawStorage(){
        readable(nativeCopy(setup.storageSummary()),"read:storage");boolean low=setup.storageLow();
        readable(low?tr("المساحة المتاحة منخفضة. يمكن طلب إخلاء الملفات المؤقتة القابلة للإزالة فقط بعد التأكيد.","Available storage is low. You can explicitly request removal of eligible cached files after confirmation."):tr("المساحة ليست منخفضة؛ تنظيف الملفات المؤقتة غير مطلوب الآن.","Storage is not low. Cache cleanup is not needed now."),"read:storage-help");
        readable(tr("تنظيف المؤقت مستقل عن خطة التعطيل والاستعادة. لا يمكن استرجاع الملفات المؤقتة التي تُحذف بهذه العملية.","Cache cleanup is separate from the reversible app plan. Removed cached files cannot be restored by this tool."),"read:storage-scope");
        pageAction(button(tr("إخلاء مساحة مؤقتة","Free cached space"),"action:cache",()->{if(!setup.cacheCleanupEligible()){show(tr("راجع حالة المساحة وملف التحديث المحفوظ؛ لم يبدأ التنظيف.","Review free space and any cached update. Cleanup did not start."),false);draw("action:cache");return;}confirm(tr("إخلاء الملفات المؤقتة؟","Free cached space?"),tr("ستُطلب إزالة الملفات المؤقتة القابلة للإزالة بسبب انخفاض المساحة. هذه الخطوة غير قابلة للاستعادة ولا تمثل مسح بيانات الجامع أو إعادة ضبط المصنع.","Eligible cache removal will be requested because storage is low. This cannot be undone and is not a mosque-data reset or a factory reset."),tr("إخلاء المؤقت","Clear eligible cache"),()->setup.trimCaches());}),low&&setup.cacheCleanupEligible()&&setup.connected()&&setup.journalWarning().isEmpty());
    }
    private void drawRestore(){
        int packages=setup.journalCount(),animations=setup.animationJournalCount();
        readable(tr("تطبيقات مسجلة: ","Recorded apps: ")+packages+"\n"+tr("إعدادات حركة مسجلة: ","Recorded animation settings: ")+animations+"\n"+tr("تعود العناصر إلى حالتها الأصلية المسجلة، دون تغيير إعدادات واجهة البدء التي سبق ضبطها خارج هذه الأداة. تنظيف المؤقت ليس قابلًا للاستعادة.","Items return to their recorded original state. Home-app changes made outside this tool are preserved. Cache cleanup cannot be undone."),"read:restore");
        pageAction(button(tr("استعادة كل تغييرات هذه الأداة","Restore all of this tool's changes"),"action:restore-all",()->confirm(tr("استعادة تغييرات هذه الأداة؟","Restore this tool's changes?"),tr("ستُستعاد حالات التطبيقات وإعدادات الحركة الموجودة في سجل الأداة فقط إلى قيمها الأصلية المسجلة. لن تُفعّل واجهة بدء أو تطبيقًا كان معطّلًا قبل استخدام الأداة.","Only recorded app states and animation settings will return to their original values. A Home app or other app disabled before using this tool will not be enabled."),tr("استعادة الكل","Restore all"),()->setup.restoreAll())),setup.connected()&&packages+animations>0&&setup.journalWarning().isEmpty());
        if(animations>0)pageAction(button(tr("استعادة إعدادات الحركة فقط","Restore animations only"),"action:restore-animations",()->confirm(tr("استعادة الحركة؟","Restore animations?"),tr("ستُعاد قيم الحركة المسجلة فقط.","Only recorded animation values will be restored."),tr("استعادة","Restore"),()->setup.restoreAnimations())),setup.connected()&&setup.journalWarning().isEmpty());
        for(DeviceSetup.Row candidate:setup.rows())if(setup.recorded(candidate.name)){String title=nativeCopy(candidate.title);pageAction(button(tr("استعادة: ","Restore: ")+title,"app:"+candidate.name+":restore",()->confirmPackage(candidate.name,title)),setup.connected()&&setup.journalWarning().isEmpty());}
        if(packages+animations==0)readable(tr("لا توجد تغييرات مسجلة لاستعادتها.","There are no recorded changes to restore."),"read:restore-empty");
    }
    private void confirmApply(){
        if(busy||prayerActive)return;final List<String> choice=new ArrayList<>(selected);Collections.sort(choice);
        if(choice.isEmpty()){show(tr("حدّد التطبيقات المطلوبة أولًا؛ لم يتغير شيء.","Select apps first. Nothing has changed."),false);return;}
        StringBuilder names=new StringBuilder();for(DeviceSetup.Row row:setup.rows())if(choice.contains(row.name))names.append("\n• ").append(nativeCopy(row.title));
        confirm(tr("مراجعة تعطيل التطبيقات","Review app disabling"),tr("عدد العناصر: ","Selected apps: ")+choice.size()+names+"\n\n"+tr("يُحفظ سجل الحالة الأصلية أولًا، ثم يُطلب التعطيل وتُقرأ النتيجة من الجهاز. لا تُحذف بيانات التطبيقات.","The original state is recorded first, then disabling is requested and verified on the device. App data is retained."),tr("تعطيل المحدد","Disable selected"),()->setup.apply(choice));
    }
    private void confirmPackage(String name,String title){confirm(tr("استعادة التطبيق؟","Restore this app?"),title+"\n"+tr("سيُعاد هذا التطبيق إلى حالته الأصلية المسجلة فقط، مع التحقق من النتيجة.","Only this app's recorded original state will be restored and verified."),tr("استعادة","Restore"),()->setup.restorePackage(name));}
    private void confirm(String title,String message,String positive,Operation action){if(busy||prayerActive)return;confirmation=new AlertDialog.Builder(this).setTitle(title).setMessage(message).setNegativeButton(tr("إلغاء","Cancel"),null).setPositiveButton(positive,(dialog,which)->operate(action)).show();}
    private void operate(Operation action){
        if(busy||prayerActive)return;operationFocus=focusedTag();rememberPage();busy=true;draw("status");show(tr("جارٍ التنفيذ والتحقق من الجهاز؛ انتظر اكتمال التأكيد…","Working and verifying the device. Please wait for confirmation…"),false);
        worker.execute(()->{String result;boolean failed=false;try{result=action.run();}catch(Exception error){failed=true;result=error.getMessage()==null?tr("تعذر إكمال العملية؛ راجع الحالة المسجلة.","The operation could not finish. Check the recorded state."):error.getMessage();}final String message=result;final boolean failure=failed;
            if(released||isFinishing()){setup.disconnect();worker.shutdown();return;}
            runOnUiThread(()->{if(released||isFinishing()||isDestroyed()){setup.disconnect();worker.shutdown();return;}busy=false;show(message,failure);draw(operationFocus);});});
    }
    private void show(String message,boolean error){if(status==null||released||isFinishing()||isDestroyed())return;lastStatus=nativeCopy(message==null?"":message);if(english&&lastStatus.matches("(?s).*[\\u0600-\\u06ff].*"))lastStatus=(error?"The operation could not finish. Check the recorded state.\n":"Device result — review the updated state below.\n")+lastStatus;if(error&&!lastStatus.trim().startsWith("!!"))lastStatus="!! "+lastStatus;status.setText(lastStatus);status.setContentDescription(lastStatus);status.setTextColor(focusColors(error?Color.rgb(240,180,155):MUTED));}
    private void busyNotice(){show(tr("انتظر اكتمال التنفيذ والتحقق قبل الرجوع. سجل الاستعادة محفوظ.","Wait for the operation and verification before leaving. The recovery journal is retained."),false);}
    private void requestExit(){if(busy){busyNotice();return;}finish();}
    @Override public void onBackPressed(){if(busy){busyNotice();return;}super.onBackPressed();}
    private void openAppSettings(String name){
        if(busy||prayerActive||!DeviceSetup.allowed(name))return;
        try{startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+name)));show(tr("فُتحت إعدادات التطبيق. عُد وحدّث الحالة للتحقق من أي تغيير يدوي.","App settings opened. Return and refresh to verify any manual change."),false);}
        catch(ActivityNotFoundException|SecurityException error){show(tr("تعذر فتح إعدادات هذا التطبيق؛ راجعه من إعدادات التلفاز.","This app's settings could not open. Use the TV's app settings."),true);}
    }
    private void openFeedback(){if(busy||prayerActive)return;try{startActivity(new Intent().setClassName(this,getPackageName()+".FeedbackActivity"));}catch(ActivityNotFoundException|SecurityException error){show(tr("واجهة الإبلاغ غير متاحة في هذه النسخة.","Problem reporting is unavailable in this build."),true);}}
    private String nativeCopy(String value){
        if(value==null)return "";String out=value.replace("COMMUNITY_PROFILE: AMBIGUOUS_VARIANT",tr("قائمة الموديل: توجد نسخ مختلفة بهذا الاسم؛ لم تُطبّق قائمة مجتمعية.","Model list: this name has multiple variants. No community list was applied."))
                .replace("COMMUNITY_PROFILE: OEM_CONFLICT",tr("قائمة الموديل: تختلف بيانات الشركة؛ يلزم التحقق اليدوي.","Model list: manufacturer data conflicts. Manual review is required."))
                .replace("COMMUNITY_PROFILE: NO_EXACT_MODEL",tr("قائمة الموديل: لا توجد مطابقة تامة؛ المقترحات الأساسية فقط.","Model list: no exact match. Only the built-in suggestions are available."))
                .replace("COMMUNITY_PROFILE: ANDROID_VERSION_MISMATCH",tr("قائمة الموديل: يختلف إصدار Android؛ لم تُطبّق القائمة المجتمعية.","Model list: Android versions differ. No community list was applied."))
                .replace("COMMUNITY_PROFILE: ",tr("القائمة المجتمعية: ","Community model list: ")).replace("EXACT_MODEL_AND_VERSION",tr("تطابق الموديل وإصدار Android","Exact model and Android version"))
                .replace("UPDATE_CACHE_PRESENT",tr("ملف تحديث محفوظ: التنظيف متوقف لحمايته؛ ثبّت التحديث أو ألغِ مهمته أولًا.","A cached update is present. Cleanup is blocked to protect it; install or cancel the update first."))
                .replace("LOW_STORAGE",tr("المساحة منخفضة","Storage is low")).replace("SPACE_OK",tr("المساحة كافية","Enough free space")).replace("CACHE_REQUEST_CONFIRMED",tr("أكد Android طلب إخلاء المؤقت","Android confirmed the cache-cleanup request")).replace("PACKAGE_RESTORED",tr("استعيدت حالة التطبيق","App state restored"))
                .replace("window_animation_scale",tr("انتقال النوافذ","Window transitions")).replace("transition_animation_scale",tr("الانتقال بين الصفحات","Screen transitions")).replace("animator_duration_scale",tr("مدة الحركة","Animation duration")).replace(": original=",tr(": القيمة الأصلية=",": original=")).replace("<absent>",tr("<غير موجودة>","<absent>"));if(!english)return out;
        String[][] pairs={
            {"إحصاءات استخدام TCL","TCL usage statistics"},{"عروض تطبيقات TCL","TCL app promotions"},{"رسائل TCL الترويجية","TCL promotional messages"},{"ملصقات العرض الترويجية","Promotional stickers"},{"العرض التجريبي للمتجر","Store demo mode"},{"توصيات Android TV","Android TV recommendations"},{"ملاحظات Google","Google feedback"},{"ألعاب Google Play","Google Play Games"},
            {"إحصاءات الاستخدام؛ قد يفيد تعطيله في تقليل نشاط الخلفية.","Usage statistics; disabling may reduce background activity."},{"واجهة عرض التطبيقات المقترحة.","Suggested-app promotion interface."},{"رسائل وعروض الشركة؛ راجع حاجتك إليها.","Manufacturer messages and offers; review whether you need them."},{"ملصقات وضع العرض الترويجي.","Promotional display-mode stickers."},{"وضع العرض التجريبي؛ ليس مشغّل الشاشة الرئيسي.","Store demonstration mode; separate from the main launcher."},{"صفوف التوصيات؛ لا يعطّل واجهة المصنع نفسها.","Recommendation rows; the manufacturer launcher is retained."},{"أداة إرسال ملاحظات التشخيص.","Diagnostic feedback tool."},{"اختياري إذا لم تُستخدم الألعاب على شاشة الجامع.","Optional if games are not used on this display."},
            {"خارج قائمة شاشة الجامع المحددة.","Outside the supported app list."},{"مكوّن يعمل بهوية نظام مشتركة؛ يُترك مفعّلًا.","Uses a shared system identity; protected."},{"مكوّن محمي لخدمات النظام أو التحكم أو الاتصال.","Protected system, control, or connection component."},{"واجهة HOME محمية؛ لا يُعطّلها هذا الملف.","Protected Home app; excluded from this plan."},{"يطلب صلاحية خدمة محمية؛ يُترك مفعّلًا.","Requires a protected service permission; retained."},{"يقدّم خدمة إدخال أو وصول أو اتصال محمية.","Provides protected input, accessibility, or connection services."},{"يقدّم خدمة إدخال أو وصول محمية.","Provides protected input or accessibility services."},{"تعذر فحص خدماته؛ لن يُعطّل آليًا.","Its services could not be checked; automatic disabling is unavailable."},
            {"ملف الجهاز: شاشة الجامع","Device profile: Mosque TV"},{"الذاكرة المتاحة الآن: ","Available memory now: "},{" من "," of "},{" — التخزين المتاح: "," — Available storage: "},{"مدعوم","Supported"},{"غير معلن","Not declared"},{"هذه قراءة حالية وليست وعدًا بزيادة السرعة أو الذاكرة.","A current reading; no speed or memory increase is promised."},
            {"اتصل بـ ADB المحلي أولًا، أو استخدم إعدادات التطبيقات يدويًا.","Connect to local ADB first, or use app settings manually."},{"التعطيل الآلي مخصص لحساب الجهاز الرئيسي فقط؛ استخدم إعدادات التطبيقات للحساب الحالي.","Direct changes require the device's primary user. Use system app settings for this account."},{"تعذر قراءة سجل الاستعادة؛ لن يُنفذ أي تعطيل أو استعادة آلية.","The recovery journal could not be read. Automatic changes and restoration are blocked."},{"بدأ وضع الصلاة.","Prayer mode started."},{"تجهيز الجهاز متوقف أثناء وضع الصلاة.","Device preparation is paused during prayer mode."},
            {"قائمة TCL لا تُطبق على شركة مختلفة؛ استخدم إعدادات التطبيق يدويًا.","TCL-specific changes are unavailable on this manufacturer. Use system app settings."},{"لم يُرسل أمر تنظيف؛ المساحة كافية.","No cleanup command was sent; storage is sufficient."},{"أكد Android الطلب؛ قد تعود ملفات الكاش لاحقًا. لا يمكن استعادة الكاش المحذوف.","Android confirmed the request. Cached files may return later; removed cache cannot be restored."},{"لم يؤكد Android طلب تنظيف الكاش. لا تُحذف بيانات التطبيقات أو إعداداتها بهذه الأداة.","Android did not confirm cache cleanup. This tool does not delete app data or settings."},
            {"لا توجد قيم حركات مسجلة للاستعادة.","No original animation values are recorded for restoration."},{"لا توجد تغييرات حركات مسجلة للاستعادة.","There are no recorded animation changes to restore."},{"تعذر قراءة سجل الحركات؛ لن يُنفذ ضبط أو استعادة آلية حتى مراجعة السجل.","The animation recovery journal could not be read. Changes and restoration are blocked until the journal is reviewed."}
        };
        for(String[] pair:pairs)out=out.replace(pair[0],pair[1]);
        out=out.replaceAll("أكد الجهاز ضبط (\\d+) من إعدادات الحركات على 0\\.5\\. القيم الأصلية المسجلة متاحة للاستعادة\\.","The device verified $1 animation settings at 0.5×. Recorded original values are available for restoration.")
                .replaceAll("أكد الجهاز استعادة (\\d+) من إعدادات الحركات إلى قيمها الأصلية المسجلة\\.","The device verified restoration of $1 original animation settings.")
                .replaceAll("أكد الجهاز تعطيل (\\d+) من التطبيقات المحددة\\. لم تُحذف تطبيقات أو بيانات، ولم تتغير واجهة المصنع\\.","The device verified disabling $1 selected apps. Apps and data were retained; the manufacturer launcher was unchanged.")
                .replaceAll("أكد الجهاز استعادة (\\d+) عنصرًا إلى حالته الأصلية المسجلة\\. لم تُفعّل عناصر كانت معطّلة قبل استخدام الأداة\\.","The device verified restoration of $1 recorded items. Apps disabled before using this tool were not enabled.");
        return out;
    }
    @Override protected void onResume(){
        super.onResume();foreground=true;
        if(!isFinishing())getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(setup!=null&&content!=null&&!busy)draw(null);
    }
    @Override protected void onPause(){
        foreground=false;getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(setup!=null&&!busy)setup.disconnect();super.onPause();
    }
    @Override protected void onDestroy(){released=true;if(confirmation!=null)confirmation.dismiss();if(active.get()==this)active.clear();if(setup!=null&&!busy)setup.disconnect();if(busy)worker.shutdown();else worker.shutdownNow();super.onDestroy();}
}
