package sa.mosque.display;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;

/** Opens public system pages; never impersonates privileged Wi-Fi/Bluetooth toggles. */
final class TvControls {
    private final Activity activity;
    private static final String[] MIRRORS = {"com.tcl.miracast", "com.mediatek.wfd", "com.softwinner.miracastReceiver", "com.homwee.mmp.screenshare", "com.xiaomi.mitv.smartshare"};
    TvControls(Activity activity) { this.activity = activity; }
    private boolean resolves(Intent intent) { try { return intent != null && intent.resolveActivity(activity.getPackageManager()) != null; } catch (RuntimeException ignored) { return false; } }
    private Intent first(String... actions) {
        for (String action : actions) { Intent i = new Intent(action); if (resolves(i)) return i; }
        return null;
    }
    private Intent mirror() {
        PackageManager pm = activity.getPackageManager();
        for (String pkg : MIRRORS) {
            Intent intent = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (intent == null) intent = pm.getLaunchIntentForPackage(pkg);
            if (resolves(intent)) return intent;
        }
        return null;
    }
    private Intent intent(String key) {
        switch (key) {
            case "wifi": return first(Settings.ACTION_WIFI_SETTINGS, "android.settings.WIRELESS_SETTINGS");
            case "bluetooth": return first(Settings.ACTION_BLUETOOTH_SETTINGS, "com.google.android.intent.action.CONNECT_INPUT");
            case "sound": return first(Settings.ACTION_SOUND_SETTINGS);
            case "display": return first("android.settings.DREAM_SETTINGS", Settings.ACTION_DISPLAY_SETTINGS);
            case "power": return first("android.settings.POWER_USAGE_SUMMARY", Settings.ACTION_DISPLAY_SETTINGS);
            case "apps": return first(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS);
            case "app": return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.getPackageName()));
            case "mirror": return mirror();
            case "tv": return first(Settings.ACTION_SETTINGS);
            default: return null;
        }
    }
    boolean open(String key) {
        Intent requested = intent(key);
        if (!resolves(requested) && !"mirror".equals(key)) requested = first(Settings.ACTION_SETTINGS);
        if (requested == null) return false;
        try { activity.startActivity(requested); return true; } catch (RuntimeException ignored) {
            try { activity.startActivity(new Intent(Settings.ACTION_SETTINGS)); return true; } catch (RuntimeException ignoredAgain) { return false; }
        }
    }
    JSONObject status() {
        JSONObject result = new JSONObject();
        try {
            result.put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL).put("android", Build.VERSION.RELEASE).put("sdk", Build.VERSION.SDK_INT);
            JSONObject available = new JSONObject();
            for (String key : new String[]{"wifi", "bluetooth", "sound", "display", "power", "apps", "app", "tv", "mirror"}) available.put(key, resolves(intent(key)));
            available.put("phone", true); result.put("available", available);
            StatFs space = new StatFs(activity.getFilesDir().getAbsolutePath()); result.put("freeBytes", space.getAvailableBytes());
            result.put("message", "التحكم محلي. تفتح اختصارات الشبكة والملحقات صفحات النظام المتاحة على هذا التلفزيون.");
        } catch (Exception ignored) { }
        return result;
    }
}
