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
import java.util.Calendar;
import java.util.TimeZone;
import org.json.JSONObject;

/** A local display schedule. Black display is deliberately never described as TV power-off. */
final class PowerController {
    interface Host { void changed(JSONObject status); }
    private final Activity activity;
    private final Host host;
    private final SharedPreferences preferences;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final TextView curtain;
    private long operatorUntil;
    private boolean closed;
    private boolean prayer;
    private String lastState = "";
    private final Runnable timer = new Runnable() {
        @Override public void run() { if (!closed) { apply(); handler.postDelayed(this, 1000); } }
    };

    PowerController(Activity activity, FrameLayout frame, Host host) {
        this.activity = activity; this.host = host;
        preferences = activity.getSharedPreferences("mosque-tv-power", 0);
        curtain = new TextView(activity);
        curtain.setBackgroundColor(Color.BLACK); curtain.setTextColor(Color.rgb(94, 101, 96));
        curtain.setTextSize(17); curtain.setGravity(Gravity.CENTER);
        curtain.setText("خارج ساعات العرض\nاضغط اختيار أو MENU لفتح أدوات الشاشة");
        curtain.setVisibility(View.GONE); curtain.setFocusable(false); curtain.setClickable(false);
        frame.addView(curtain, new FrameLayout.LayoutParams(-1, -1));
        handler.post(timer);
    }
    static int minute(String value) {
        return PowerRules.minute(value);
    }
    static boolean within(int minute, int start, int end) {
        return PowerRules.within(minute, start, end);
    }
    private boolean scheduledNow() {
        Calendar clock = Calendar.getInstance(TimeZone.getTimeZone("Asia/Riyadh"));
        int now = clock.get(Calendar.HOUR_OF_DAY) * 60 + clock.get(Calendar.MINUTE);
        return within(now, minute(preferences.getString("start", "04:00")), minute(preferences.getString("end", "23:00")));
    }
    JSONObject status() {
        JSONObject result = new JSONObject();
        String mode = preferences.getString("mode", "always");
        boolean active = !"scheduled".equals(mode) || scheduledNow();
        try {
            result.put("mode", mode).put("start", preferences.getString("start", "04:00"))
                    .put("end", preferences.getString("end", "23:00")).put("active", active)
                    .put("screenBlack", !prayer && !active && SystemClock.elapsedRealtime() >= operatorUntil)
                    .put("message", "system".equals(mode) ? "السكون حسب إعدادات التلفزيون."
                            : "scheduled".equals(mode) ? "ساعات العرض بتوقيت السعودية؛ خارجها عرض أسود مع بقاء التلفزيون مستيقظًا. هذا لا يطفئ لوحة الشاشة."
                            : "تشغيل مستمر: منع السكون وشاشة التوقف أثناء ظهور تطبيق الجامع. مؤقت إطفاء TCL مستقل.");
        } catch (org.json.JSONException ignored) { }
        return result;
    }
    void save(String text) {
        try {
            JSONObject input = new JSONObject(text == null ? "" : text);
            String mode = input.getString("mode"), start = input.optString("start", "04:00"), end = input.optString("end", "23:00");
            if (!("always".equals(mode) || "system".equals(mode) || "scheduled".equals(mode))
                    || minute(start) < 0 || minute(end) < 0 || ("scheduled".equals(mode) && start.equals(end))) throw new IllegalArgumentException();
            if (!preferences.edit().putString("mode", mode).putString("start", start).putString("end", end).commit()) throw new IllegalStateException();
            operatorUntil = SystemClock.elapsedRealtime() + 5 * 60_000L;
            apply(); host.changed(status());
        } catch (Exception error) {
            JSONObject result = status();
            try { result.put("error", true).put("message", "لم تُحفظ إعدادات الطاقة. اختر وضعًا صحيحًا ووقتي بداية ونهاية مختلفين بصيغة 24 ساعة."); } catch (org.json.JSONException ignored) { }
            host.changed(result);
        }
    }
    boolean isBlack() { return curtain.getVisibility() == View.VISIBLE; }
    void prayer(boolean active) { prayer = active; apply(); }
    void operator() { operatorUntil = SystemClock.elapsedRealtime() + 5 * 60_000L; apply(); }
    void resume() { apply(); }
    private void apply() {
        if (closed || activity.isFinishing() || activity.isDestroyed()) return;
        String mode = preferences.getString("mode", "always");
        if ("system".equals(mode)) activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        boolean black = !prayer && "scheduled".equals(mode) && !scheduledNow() && SystemClock.elapsedRealtime() >= operatorUntil;
        curtain.setVisibility(black ? View.VISIBLE : View.GONE);
        JSONObject state = status(); String signature = state.toString();
        if (!signature.equals(lastState)) { lastState = signature; host.changed(state); }
    }
    void destroy() { closed = true; handler.removeCallbacks(timer); }
}
