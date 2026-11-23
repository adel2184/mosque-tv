package sa.mosque.display;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.json.JSONObject;

/** A local display schedule. Black display is deliberately never described as TV power-off. */
final class PowerController {
    interface Host { void changed(JSONObject status); }
    private final Activity activity;
    private final Host host;
    private final SharedPreferences preferences;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final TextView curtain;
    private volatile long operatorUntil;
    private volatile long sleepAt;
    private volatile boolean manualBlack;
    private boolean closed;
    private boolean foreground;
    private volatile boolean prayer;
    private String lastState = "";
    private final Runnable timer = this::apply;

    PowerController(Activity activity, FrameLayout frame, Host host) {
        this.activity = activity; this.host = host;
        preferences = activity.getSharedPreferences("mosque-tv-power", 0);
        curtain = new TextView(activity);
        curtain.setBackgroundColor(Color.BLACK); curtain.setTextColor(Color.rgb(94, 101, 96));
        curtain.setTextSize(17); curtain.setGravity(Gravity.CENTER);
        curtain.setText("خارج ساعات العرض\nاضغط اختيار أو MENU لفتح أدوات الشاشة");
        curtain.setVisibility(View.GONE); curtain.setFocusable(false); curtain.setClickable(false);
        frame.addView(curtain, new FrameLayout.LayoutParams(-1, -1));
    }
    static int minute(String value) {
        return PowerRules.minute(value);
    }
    static boolean within(int minute, int start, int end) {
        return PowerRules.within(minute, start, end);
    }
    private String timezone() {
        String zone = preferences.getString("timezone", "Asia/Riyadh");
        return PowerRules.timezone(zone) ? zone : "Asia/Riyadh";
    }
    void timezone(String zone) {
        if (!PowerRules.timezone(zone) || zone.equals(preferences.getString("timezone", null))) return;
        if (!preferences.edit().putString("timezone", zone).commit()) {
            JSONObject result = status();
            try { result.put("error", true).put("message", "لم تُحفظ المنطقة الزمنية لساعات العرض؛ بقي التوقيت السابق."); } catch (org.json.JSONException ignored) { }
            host.changed(result);
            return;
        }
        apply();
    }
    private boolean scheduledNow() {
        int now = PowerRules.localMinute(System.currentTimeMillis(), timezone());
        return within(now, minute(preferences.getString("start", "04:00")), minute(preferences.getString("end", "23:00")));
    }
    JSONObject status() {
        JSONObject result = new JSONObject();
        String mode = preferences.getString("mode", "always"), zone = timezone();
        boolean outsideSchedule = "scheduled".equals(mode) && !scheduledNow();
        boolean active = !manualBlack && !outsideSchedule;
        try {
            result.put("mode", mode).put("start", preferences.getString("start", "04:00"))
                    .put("end", preferences.getString("end", "23:00")).put("timezone", zone).put("active", active)
                    .put("screenBlack", PowerRules.curtainVisible(prayer, manualBlack, outsideSchedule, SystemClock.elapsedRealtime(), operatorUntil))
                    .put("sleepMinutes", sleepAt == 0 ? 0 : Math.max(1, (sleepAt - SystemClock.elapsedRealtime() + 59_999L) / 60_000L))
                    .put("message", "system".equals(mode) ? "السكون حسب إعدادات التلفزيون."
                            : "scheduled".equals(mode) ? "ساعات العرض وفق المنطقة الزمنية " + zone + "؛ خارجها عرض أسود مع بقاء التلفزيون مستيقظًا. هذا لا يطفئ لوحة الشاشة."
                            : "تشغيل مستمر: منع السكون وشاشة التوقف أثناء ظهور تطبيق الجامع. مؤقت إطفاء TCL مستقل.");
        } catch (org.json.JSONException ignored) { }
        return result;
    }
    void save(String text) {
        try {
            if (text == null || text.length() > 256) throw new IllegalArgumentException();
            JSONObject input = new JSONObject(text);
            String mode = input.getString("mode"), start = input.optString("start", "04:00"), end = input.optString("end", "23:00");
            if (!("always".equals(mode) || "system".equals(mode) || "scheduled".equals(mode))
                    || minute(start) < 0 || minute(end) < 0 || ("scheduled".equals(mode) && start.equals(end))) throw new IllegalArgumentException();
            if (!preferences.edit().putString("mode", mode).putString("start", start).putString("end", end).commit()) throw new IllegalStateException();
            operatorUntil = SystemClock.elapsedRealtime() + 5 * 60_000L;
            apply();
            JSONObject result = status();
            result.put("saved", true);
            host.changed(result);
        } catch (Exception error) {
            JSONObject result = status();
            try { result.put("error", true).put("message", "لم تُحفظ إعدادات الطاقة. اختر وضعًا صحيحًا ووقتي بداية ونهاية مختلفين بصيغة 24 ساعة."); } catch (org.json.JSONException ignored) { }
            host.changed(result);
        }
    }
    boolean isBlack() { return curtain.getVisibility() == View.VISIBLE; }
    void prayer(boolean active) { prayer = active; apply(); }
    void operator() {
        if (!manualBlack && !"scheduled".equals(preferences.getString("mode", "always"))) return;
        if (manualBlack) { manualBlack = false; sleepAt = 0; }
        operatorUntil = SystemClock.elapsedRealtime() + 5 * 60_000L;
        apply();
    }
    void sleep(int minutes) {
        if (minutes != 0 && minutes != 15 && minutes != 30 && minutes != 60 && minutes != 90) return;
        manualBlack = false; sleepAt = minutes == 0 ? 0 : SystemClock.elapsedRealtime() + minutes * 60_000L;
        apply(); host.changed(status());
    }
    void displayOff() { sleepAt = 0; manualBlack = true; operatorUntil = 0; apply(); }
    void resume() { foreground = true; apply(); }
    void pause() {
        foreground = false;
        handler.removeCallbacks(timer);
        setKeepScreenOn(false);
    }
    private void setKeepScreenOn(boolean keepOn) {
        int flag = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
        if (keepOn == ((activity.getWindow().getAttributes().flags & flag) != 0)) return;
        if (keepOn) activity.getWindow().addFlags(flag);
        else activity.getWindow().clearFlags(flag);
    }
    private void apply() {
        if (closed || !foreground || activity.isFinishing() || activity.isDestroyed()) return;
        handler.removeCallbacks(timer);
        String mode = preferences.getString("mode", "always");
        setKeepScreenOn(!"system".equals(mode));
        long elapsed = SystemClock.elapsedRealtime();
        if (sleepAt > 0 && elapsed >= sleepAt) { sleepAt = 0; manualBlack = true; operatorUntil = 0; }
        boolean scheduled = "scheduled".equals(mode);
        boolean black = PowerRules.curtainVisible(prayer, manualBlack, scheduled && !scheduledNow(), elapsed, operatorUntil);
        String label = manualBlack ? "العرض متوقف مؤقتًا\nاضغط أي سهم لاستئنافه، أو اختيار لفتح مركز التحكم" : "خارج ساعات العرض\nاضغط اختيار أو MENU لفتح مركز التحكم";
        if (!label.contentEquals(curtain.getText())) curtain.setText(label);
        if (black != isBlack()) curtain.setVisibility(black ? View.VISIBLE : View.GONE);
        JSONObject state = status(); String signature = state.toString();
        if (!signature.equals(lastState)) { lastState = signature; host.changed(state); }
        long delay = PowerRules.nextCheckDelay(scheduled, System.currentTimeMillis(), elapsed, operatorUntil, sleepAt);
        if (delay != Long.MAX_VALUE) handler.postDelayed(timer, delay);
    }
    void destroy() { closed = true; pause(); }
}
