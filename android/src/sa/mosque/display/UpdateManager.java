package sa.mosque.display;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.HttpsURLConnection;

/** Explicit, operator-started updates. The display and its assets never depend on this network path. */
public final class UpdateManager {
    public interface Host {
        boolean canStartUpdate();
        void onUpdateState(JSONObject status);
    }
    static final String PREFS = "mosque-updater-v1";
    private static final int INSTALL_PERMISSION = 4810;
    private static WeakReference<UpdateManager> current = new WeakReference<>(null);
    private final Activity activity;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger generation = new AtomicInteger();
    private final SharedPreferences prefs;
    private final File directory, readyFile, partialFile;
    private final PackageManager packages;
    private final String installedVersion;
    private final long installedCode;
    private String owner = "", repository = "", metadataAsset = "update.json";
    private long maxApkBytes = UpdateRules.HARD_MAX_APK;
    private boolean configured;
    private volatile boolean destroyed;
    private volatile HttpsURLConnection connection;
    private Future<?> task;
    private JSONObject candidate;
    private Intent pendingConfirmation;
    private String state = "idle", message = "يمكن البحث عن تحديث عند الاتصال بالإنترنت.";
    private int progress = -1;

    @SuppressWarnings("deprecation")
    public UpdateManager(Activity activity, Host host) {
        this.activity = activity;
        this.host = host;
        packages = activity.getPackageManager();
        prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        directory = new File(activity.getCacheDir(), "verified-update");
        readyFile = new File(directory, "update.apk");
        partialFile = new File(directory, "update.partial.apk");
        long code = 0; String version = "";
        try {
            PackageInfo info = packages.getPackageInfo(activity.getPackageName(), 0);
            code = code(info); version = info.versionName == null ? "" : info.versionName;
        } catch (Exception ignored) { }
        installedCode = code; installedVersion = version;
        readConfig();
        restore();
        synchronized (UpdateManager.class) { current = new WeakReference<>(this); }
    }

    private void readConfig() {
        try (InputStream in = activity.getAssets().open("update-config.json")) {
            JSONObject config = new JSONObject(new String(readLocal(in, 8192), StandardCharsets.UTF_8));
            owner = config.getString("owner"); repository = config.getString("repository");
            metadataAsset = config.optString("metadataAsset", "update.json");
            maxApkBytes = config.optLong("maxApkBytes", UpdateRules.HARD_MAX_APK);
            configured = config.getInt("schemaVersion") == 1 && UpdateRules.validRepository(owner, repository)
                    && UpdateRules.safeAssetName(metadataAsset) && maxApkBytes > 0
                    && maxApkBytes <= UpdateRules.HARD_MAX_APK;
        } catch (Exception ignored) { configured = false; }
        if (!configured) {
            state = "unconfigured";
            message = "مصدر التحديث لم يُضبط بعد؛ العرض دون إنترنت يعمل كالمعتاد.";
        }
    }

    private void restore() {
        long expected = prefs.getLong("offeredCode", 0);
        if (expected > 0 && installedCode >= expected) {
            prefs.edit().clear().apply(); readyFile.delete(); partialFile.delete();
            state = "installed"; message = "تم تثبيت الإصدار " + installedVersion + "."; return;
        }
        if (!configured) return;
        try {
            JSONObject saved = new JSONObject(prefs.getString("candidate", "{}"));
            if (saved.optLong("versionCode") > installedCode && readyFile.isFile()
                    && readyFile.length() == saved.getJSONObject("apk").getLong("size")
                    && (owner + "/" + repository).equals(prefs.getString("repository", ""))) {
                candidate = saved;
                state = "ready"; message = "يوجد تحديث محفوظ. اختر تثبيت لإعادة التحقق والمتابعة.";
            }
        } catch (Exception ignored) { }
        String previous = prefs.getString("resultState", "");
        if (candidate != null && ("pending_confirmation".equals(previous) || "installing".equals(previous))) {
            state = "pending_confirmation";
            message = "التثبيت ينتظر المتابعة. اختر تثبيت لفتح تأكيد Android مجددًا.";
        } else if ("error".equals(previous)) {
            state = "error"; message = prefs.getString("resultMessage", "لم يكتمل التحديث؛ النسخة الحالية متاحة.");
        }
        partialFile.delete();
    }

    public synchronized JSONObject status() {
        JSONObject out = new JSONObject();
        try {
            out.put("supported", Build.VERSION.SDK_INT >= 24);
            out.put("configured", configured); out.put("state", state); out.put("message", message);
            out.put("installedVersion", installedVersion); out.put("installedCode", installedCode);
            out.put("availableVersion", candidate == null ? "" : candidate.optString("versionName", ""));
            out.put("availableCode", candidate == null ? 0 : candidate.optLong("versionCode", 0));
            out.put("progress", progress);
        } catch (Exception ignored) { }
        return out;
    }

    private boolean allowed() {
        return !destroyed && !activity.isFinishing() && !activity.isDestroyed() && host.canStartUpdate();
    }
    private void publish() {
        if (destroyed) return;
        JSONObject snapshot = status();
        main.post(() -> { if (!destroyed && !activity.isFinishing() && !activity.isDestroyed()) host.onUpdateState(snapshot); });
    }
    private synchronized void change(String next, String text, int percent) {
        state = next; message = text; progress = percent; publish();
    }
    private synchronized boolean busy() {
        return "checking".equals(state) || "downloading".equals(state) || "verifying".equals(state)
                || "installing".equals(state);
    }
    public void check() { main.post(this::startCheck); }
    private void startCheck() {
        if (!allowed()) { publish(); return; }
        if (!configured) { publish(); return; }
        if (busy() || "pending_confirmation".equals(state)) { publish(); return; }
        final int token = generation.incrementAndGet();
        abandonPreviousSession();
        synchronized (this) { candidate = null; }
        prefs.edit().remove("candidate").remove("offeredCode").remove("resultState").apply();
        change("checking", "جارٍ البحث عن تحديث…", -1);
        task = worker.submit(() -> {
            try {
                readyFile.delete(); partialFile.delete();
                String endpoint = "https://api.github.com/repos/" + owner + "/" + repository + "/releases/latest";
                JSONObject release = new JSONObject(new String(fetch(endpoint, 512 * 1024, token), StandardCharsets.UTF_8));
                ensure(token);
                if (release.optBoolean("draft") || release.optBoolean("prerelease")) throw new Rejected("لا يوجد إصدار مستقر صالح.");
                String tag = release.getString("tag_name");
                JSONArray assets = release.getJSONArray("assets");
                JSONObject metadata = findAsset(assets, metadataAsset);
                String feedUrl = metadata.getString("browser_download_url");
                if (!UpdateRules.repoAsset(feedUrl, owner, repository, tag, metadataAsset)) throw new Rejected("رابط بيانات التحديث خارج المستودع المحدد.");
                JSONObject offered = new JSONObject(new String(fetch(feedUrl, 64 * 1024, token), StandardCharsets.UTF_8));
                if (offered.getInt("schemaVersion") != 1 || !activity.getPackageName().equals(offered.getString("packageName")))
                    throw new Rejected("بيانات التحديث لا تخص هذا التطبيق.");
                long newCode = offered.getLong("versionCode");
                if (newCode <= installedCode) { changeIf(token, "current", "الإصدار المثبت هو الأحدث في المصدر المحدد.", -1); return; }
                JSONObject apk = offered.getJSONObject("apk");
                String name = apk.getString("name"), sha = apk.getString("sha256");
                long size = apk.getLong("size");
                if (!UpdateRules.safeAssetName(name) || !name.endsWith(".apk") || !UpdateRules.sha256(sha)
                        || !UpdateRules.eligible(installedCode, newCode, offered.getInt("minSdk"), Build.VERSION.SDK_INT, size, maxApkBytes))
                    throw new Rejected("التحديث غير متوافق مع هذا التلفاز أو يتجاوز حد الحجم.");
                if (offered.getString("versionName").length() > 64) throw new Rejected("اسم الإصدار غير صالح.");
                JSONObject artifact = findAsset(assets, name);
                String download = artifact.getString("browser_download_url");
                if (artifact.getLong("size") != size || !UpdateRules.repoAsset(download, owner, repository, tag, name))
                    throw new Rejected("ملف التحديث لا يطابق الإصدار المحدد.");
                offered.put("downloadUrl", download);
                synchronized (this) { ensure(token); candidate = offered; }
                changeIf(token, "downloading", "جارٍ تنزيل التحديث؛ تبقى الشاشة الحالية متاحة.", 0);
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("cache");
                download(download, size, sha, token);
                changeIf(token, "verifying", "جارٍ التحقق من هوية التطبيق وتوقيعه…", 100);
                verifyApk(offered, partialFile, token);
                ensure(token);
                if (!partialFile.renameTo(readyFile)) throw new IOException("rename");
                prefs.edit().putString("candidate", offered.toString()).putLong("offeredCode", newCode)
                        .putString("repository", owner + "/" + repository).putString("resultState", "ready").apply();
                changeIf(token, "ready", "التحديث جاهز. اختر تثبيت ثم وافق في شاشة Android.", 100);
            } catch (Exception error) { fail(token, error); }
            finally { partialFile.delete(); }
        });
    }

    public void install() { main.post(this::startInstall); }
    private void startInstall() {
        if (!allowed()) { publish(); return; }
        if (!configured || busy() || candidate == null || !readyFile.isFile()) { publish(); return; }
        if (pendingConfirmation != null) {
            try {
                Intent confirm = pendingConfirmation; pendingConfirmation = null;
                activity.startActivity(confirm);
                change("installing", "أكمل تأكيد التحديث في شاشة Android، أو ارجع للإلغاء.", -1);
            } catch (RuntimeException error) {
                change("ready", "تعذر فتح تأكيد Android. اختر تثبيت للمحاولة مجددًا.", -1);
            }
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !packages.canRequestPackageInstalls()) {
            try {
                activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())), INSTALL_PERMISSION);
                change("permission", "اسمح لهذا التطبيق بتثبيت تحديثه، ثم ارجع واختر تثبيت.", -1);
            } catch (RuntimeException ignored) { change("error", "التلفاز لم يوفّر شاشة السماح بالتثبيت من هذا المصدر.", -1); }
            return;
        }
        final JSONObject offered;
        synchronized (this) { offered = candidate; }
        final int token = generation.incrementAndGet();
        change("verifying", "جارٍ إعادة التحقق من ملف التحديث قبل التثبيت…", -1);
        task = worker.submit(() -> {
            int sessionId = -1;
            try {
                verifyApk(offered, readyFile, token);
                ensure(token);
                // Authorization is checked on the UI thread after verification, immediately before creating a session.
                final boolean[] permitted = {false};
                final java.util.concurrent.CountDownLatch guard = new java.util.concurrent.CountDownLatch(1);
                main.post(() -> { try { permitted[0] = allowed(); } finally { guard.countDown(); } });
                if (!guard.await(5, java.util.concurrent.TimeUnit.SECONDS) || !permitted[0]) throw new Rejected("أُجّل التثبيت أثناء عرض الصلاة. حاول بعد انتهائها.");
                ensure(token);
                abandonPreviousSession();
                PackageInstaller installer = packages.getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(activity.getPackageName()); params.setSize(readyFile.length());
                if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
                sessionId = installer.createSession(params);
                // Commit off the UI thread before Android can replace/kill this process.
                if (!prefs.edit().putInt("sessionId", sessionId).putString("resultState", "installing").commit())
                    throw new IOException("session journal");
                try (PackageInstaller.Session session = installer.openSession(sessionId);
                     InputStream in = new FileInputStream(readyFile);
                     OutputStream out = session.openWrite("base.apk", 0, readyFile.length())) {
                    byte[] buffer = new byte[64 * 1024]; int count;
                    while ((count = in.read(buffer)) != -1) { ensure(token); out.write(buffer, 0, count); }
                    session.fsync(out);
                    ensure(token);
                }
                final int commitId = sessionId;
                final java.util.concurrent.CountDownLatch committed = new java.util.concurrent.CountDownLatch(1);
                final Exception[] commitError = {null};
                main.post(() -> {
                    try {
                        ensure(token);
                        if (!allowed()) throw new Rejected("أُجّل التثبيت أثناء عرض الصلاة. حاول بعد انتهائها.");
                        Intent callback = new Intent(activity, UpdateInstallReceiver.class)
                                .setAction(activity.getPackageName() + ".UPDATE_RESULT")
                                .putExtra("updateSessionId", commitId);
                        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
                        PendingIntent result = PendingIntent.getBroadcast(activity, commitId, callback, flags);
                        try (PackageInstaller.Session session = installer.openSession(commitId)) {
                            session.commit(result.getIntentSender());
                        }
                        change("installing", "ينتظر التحديث تأكيد Android…", -1);
                    } catch (Exception error) { commitError[0] = error; }
                    finally { committed.countDown(); }
                });
                if (!committed.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new IOException("commit timeout");
                if (commitError[0] != null) throw commitError[0];
                sessionId = -1; // A committed session belongs to PackageInstaller until the callback.
            } catch (Exception error) {
                if (sessionId >= 0) try { packages.getPackageInstaller().abandonSession(sessionId); } catch (RuntimeException ignored) { }
                fail(token, error);
            }
        });
    }

    private void abandonPreviousSession() {
        int previous = prefs.getInt("sessionId", -1);
        if (previous >= 0) try { packages.getPackageInstaller().abandonSession(previous); } catch (RuntimeException ignored) { }
        prefs.edit().remove("sessionId").apply();
    }
    public void cancel() {
        main.post(() -> {
            if (destroyed) return;
            generation.incrementAndGet();
            if (task != null) task.cancel(true);
            HttpsURLConnection active = connection; if (active != null) active.disconnect();
            pendingConfirmation = null; abandonPreviousSession();
            prefs.edit().remove("candidate").remove("offeredCode").remove("resultState").apply();
            synchronized (this) { candidate = null; }
            worker.submit(() -> { partialFile.delete(); readyFile.delete(); });
            change(configured ? "cancelled" : "unconfigured", "أُلغي طلب التحديث؛ لم تُحذف النسخة المثبتة.", -1);
        });
    }
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == INSTALL_PERMISSION) onResume();
    }
    public void onResume() {
        main.post(() -> {
            if (destroyed) return;
            String result = prefs.getString("resultState", "");
            if ("error".equals(result)) change("error", prefs.getString("resultMessage", "لم يكتمل التثبيت."), -1);
            else if ("permission".equals(state)) {
                change("ready", Build.VERSION.SDK_INT < 26 || packages.canRequestPackageInstalls()
                        ? "تم السماح بالمصدر. اختر تثبيت للمتابعة." : "لم يُسمح بالتثبيت. يمكن متابعة العرض دون تحديث.", -1);
            } else publish();
        });
    }
    public void destroy() {
        destroyed = true; generation.incrementAndGet();
        if (task != null) task.cancel(true);
        HttpsURLConnection active = connection; if (active != null) active.disconnect();
        worker.shutdownNow(); main.removeCallbacksAndMessages(null);
        synchronized (UpdateManager.class) { if (current.get() == this) current.clear(); }
    }

    static void receiveInstallResult(Context context, Intent intent) {
        if (intent == null || !(context.getPackageName() + ".UPDATE_RESULT").equals(intent.getAction())) return;
        SharedPreferences saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int session = intent.getIntExtra("updateSessionId", -2);
        if (session < 0 || session != saved.getInt("sessionId", -1)) return;
        int result = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String next, text; Intent confirmation = null;
        if (result == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            next = "pending_confirmation";
            text = "Android يطلب تأكيد التثبيت. اختر تثبيت لفتح شاشة التأكيد.";
        } else if (result == PackageInstaller.STATUS_SUCCESS) {
            next = "installed"; text = "اكتمل تثبيت التحديث.";
        } else {
            next = "error";
            text = result == PackageInstaller.STATUS_FAILURE_ABORTED
                    ? "أُلغي التثبيت. بقيت النسخة المثبتة والإعدادات متاحة."
                    : "لم يقبل Android التحديث. بقيت النسخة المثبتة والإعدادات متاحة.";
        }
        // A replacement can terminate the old process immediately after the callback.
        saved.edit().putString("resultState", next).putString("resultMessage", text).commit();
        UpdateManager live;
        synchronized (UpdateManager.class) { live = current.get(); }
        if (live != null && !live.destroyed) {
            final Intent pending = confirmation; final String newState = next, newText = text;
            live.main.post(() -> {
                if (live.destroyed) return;
                live.pendingConfirmation = pending;
                live.change(newState, newText, -1);
            });
        }
    }

    private JSONObject findAsset(JSONArray assets, String name) throws Exception {
        JSONObject found = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (name.equals(asset.optString("name"))) {
                if (found != null) throw new Rejected("اسم ملف التحديث مكرر.");
                found = asset;
            }
        }
        if (found == null) throw new Rejected("الإصدار المنشور لا يتضمن ملفات التحديث المطلوبة.");
        return found;
    }
    private HttpsURLConnection open(String original, int token) throws Exception {
        if (!UpdateRules.allowedTransport(original)) throw new Rejected("رابط تحديث غير مسموح.");
        String next = original;
        for (int redirects = 0; redirects <= 5; redirects++) {
            ensure(token);
            if (!UpdateRules.allowedRedirect(original, next)) throw new Rejected("إعادة توجيه خارج مصدر التحديث المسموح.");
            HttpsURLConnection conn = (HttpsURLConnection) new URL(next).openConnection();
            connection = conn; conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(12000); conn.setReadTimeout(20000);
            conn.setRequestProperty("Accept", "application/octet-stream, application/vnd.github+json");
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.setRequestProperty("User-Agent", "MosqueDisplay/" + installedVersion);
            int response = conn.getResponseCode();
            if (response == 301 || response == 302 || response == 303 || response == 307 || response == 308) {
                String location = conn.getHeaderField("Location");
                if (location == null) { conn.disconnect(); throw new IOException("redirect"); }
                next = new URL(new URL(next), location).toString(); conn.disconnect(); continue;
            }
            if (response != 200) { conn.disconnect(); throw new Rejected(response == 404
                    ? "لا يوجد إصدار منشور متاح في المستودع المحدد." : "تعذر الاتصال بمصدر التحديث؛ حاول لاحقًا."); }
            return conn;
        }
        throw new Rejected("تجاوز رابط التحديث عدد إعادة التوجيه المسموح.");
    }
    private byte[] fetch(String url, int maximum, int token) throws Exception {
        HttpsURLConnection conn = open(url, token);
        try {
            long declared = conn.getContentLengthLong();
            if (declared > maximum) throw new Rejected("بيانات التحديث تتجاوز حد الحجم.");
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count; long deadline = android.os.SystemClock.elapsedRealtime() + 60000;
                while ((count = in.read(buffer)) != -1) {
                    ensure(token); if (android.os.SystemClock.elapsedRealtime() > deadline || out.size() + count > maximum) throw new IOException("limit");
                    out.write(buffer, 0, count);
                }
                if (declared >= 0 && declared != out.size()) throw new IOException("truncated");
                return out.toByteArray();
            }
        } finally { conn.disconnect(); connection = null; }
    }
    private void download(String url, long expectedSize, String expectedHash, int token) throws Exception {
        HttpsURLConnection conn = open(url, token);
        try {
            long declared = conn.getContentLengthLong();
            if (declared >= 0 && declared != expectedSize) throw new Rejected("حجم الملف القادم لا يطابق بيانات التحديث.");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long received = 0, deadline = android.os.SystemClock.elapsedRealtime() + 180000;
            int lastPercent = -1;
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(partialFile)) {
                byte[] buffer = new byte[64 * 1024]; int count;
                while ((count = in.read(buffer)) != -1) {
                    ensure(token); received += count;
                    if (received > expectedSize || received > maxApkBytes || android.os.SystemClock.elapsedRealtime() > deadline) throw new IOException("limit");
                    out.write(buffer, 0, count); digest.update(buffer, 0, count);
                    int percent = (int) (received * 100 / expectedSize);
                    if (percent != lastPercent) { changeIf(token, "downloading", "جارٍ تنزيل التحديث…", percent); lastPercent = percent; }
                }
                out.getFD().sync();
            }
            if (received != expectedSize || !expectedHash.equalsIgnoreCase(UpdateRules.hex(digest.digest())))
                throw new Rejected("فشل التحقق من اكتمال الملف أو بصمته؛ لم يُثبّت شيء.");
        } finally { conn.disconnect(); connection = null; }
    }

    @SuppressWarnings("deprecation")
    private void verifyApk(JSONObject offered, File file, int token) throws Exception {
        JSONObject expected = offered.getJSONObject("apk");
        if (!file.isFile() || file.length() != expected.getLong("size") || file.length() > maxApkBytes) throw new Rejected("ملف التحديث غير مكتمل.");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024]; int count;
            while ((count = in.read(buffer)) != -1) { ensure(token); digest.update(buffer, 0, count); }
        }
        if (!expected.getString("sha256").equalsIgnoreCase(UpdateRules.hex(digest.digest()))) throw new Rejected("بصمة ملف التحديث لا تطابق المصدر.");
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = packages.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        PackageInfo installed = packages.getPackageInfo(activity.getPackageName(), flags);
        if (archive == null || archive.applicationInfo == null || !activity.getPackageName().equals(archive.packageName)
                || code(archive) != offered.getLong("versionCode") || code(archive) <= code(installed)
                || archive.applicationInfo.minSdkVersion != offered.getInt("minSdk")
                || archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT
                || !offered.getString("versionName").equals(archive.versionName)) throw new Rejected("هوية ملف التطبيق أو إصداره أو توافقه غير صحيح.");
        if (!UpdateRules.sameSigners(signatures(installed), signatures(archive)))
            throw new Rejected("توقيع التحديث مختلف عن التطبيق المثبت؛ رُفض الملف.");
        ensure(token);
    }
    @SuppressWarnings("deprecation")
    private static byte[][] signatures(PackageInfo info) {
        Signature[] signers = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null
                ? info.signingInfo.getApkContentsSigners() : info.signatures;
        if (signers == null) return null;
        byte[][] bytes = new byte[signers.length][];
        for (int i = 0; i < signers.length; i++) bytes[i] = signers[i].toByteArray();
        return bytes;
    }
    @SuppressWarnings("deprecation")
    private static long code(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private static byte[] readLocal(InputStream in, int maximum) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
        while ((count = in.read(buffer)) != -1) { if (out.size() + count > maximum) throw new IOException("limit"); out.write(buffer, 0, count); }
        return out.toByteArray();
    }
    private void ensure(int token) throws InterruptedException {
        if (destroyed || generation.get() != token || Thread.currentThread().isInterrupted()) throw new InterruptedException();
    }
    private void changeIf(int token, String next, String text, int percent) throws InterruptedException {
        synchronized (this) { ensure(token); change(next, text, percent); }
    }
    private void fail(int token, Exception error) {
        if (destroyed || generation.get() != token || error instanceof InterruptedException) return;
        String text = error instanceof Rejected ? error.getMessage()
                : "تعذر إكمال التحديث. تحقق من الاتصال أو مساحة التخزين وحاول لاحقًا؛ العرض الحالي مستمر.";
        change("error", text, -1);
    }
    private static final class Rejected extends Exception { Rejected(String text) { super(text); } }
}
