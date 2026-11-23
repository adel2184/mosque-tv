package sa.mosque.display;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ImageView;
import io.nayuki.qrcodegen.QrCode;

import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline TV container. The HTML retains its own absolute-time prayer scheduler. */
public final class MainActivity extends Activity {
    private static volatile boolean prayerActive;
    static boolean prayerActive() { return prayerActive; }
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/assets/index.html";
    private static final int OPEN_JSON = 4101;
    private static final int CREATE_JSON = 4102;
    private static final int CHOOSE_HOME = 4103;
    private static final int MAX_JSON_BYTES = 3 * 1024 * 1024;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService fileWriter = Executors.newSingleThreadExecutor();
    private WebView webView;
    private LinearLayout errorPanel;
    private AlertDialog operatorDialog;
    private AlertDialog phoneDialog;
    private long phoneDialogSession;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingExport;
    private boolean exportBusy;
    private boolean mainFrameFailed;
    private long lastRendererRecovery = -60_000L;
    private boolean recoverOnResume;
    private boolean menuDown;
    private boolean menuLongHandled;
    private boolean homeRolePending;
    private boolean settingsScreenPending;
    private volatile boolean praying;
    private PowerController power;
    private TvControls controls;
    private NetworkSpeedTest speed;
    private SetupTimetableFetcher setupFetcher;
    private UpdateManager updater;
    private volatile LocalPhoneServer phone;
    private TextView pairedSessionStatus;
    private Thread qrWorker;
    private volatile boolean foreground;
    private int wakingKey = -1;

    private String ui(String ar, String en) {
        return "en".equals(getSharedPreferences("mosque-tv-setup", 0).getString("language", "ar")) ? en : ar;
    }

    private final Runnable menuLongPress = new Runnable() {
        @Override public void run() {
            if (menuDown && !menuLongHandled) {
                menuLongHandled = true;
                injectShortcut(true);
            }
        }
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        createErrorPanel(frame);
        setContentView(frame);
        configureWebView();
        controls = new TvControls(this);
        android.content.SharedPreferences setupPreferences = getSharedPreferences("mosque-tv-setup", 0);
        if (!setupPreferences.contains("state")) {
            boolean upgrade = false;
            try { android.content.pm.PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0); upgrade = info.firstInstallTime < info.lastUpdateTime; } catch (Exception ignored) { }
            setupPreferences.edit().putString("state", upgrade ? "legacy" : "required").commit();
        }
        setupFetcher = new SetupTimetableFetcher(this, new SetupTimetableFetcher.Host() {
            @Override public boolean permitted() { return operatorAllowed(); }
            @Override public void onResult(JSONObject result) { publishNative("mosque-native-setup-result", result); }
        });
        speed = new NetworkSpeedTest(this, new NetworkSpeedTest.Host() {
            @Override public boolean permitted() { return operatorAllowed(); }
            @Override public void onResult(JSONObject value) { publishNative("mosque-native-control-result", value); }
        });
        power = new PowerController(this, frame, value -> publishNative("mosque-native-power-result", value));
        updater = new UpdateManager(this, new UpdateManager.Host() {
            @Override public boolean canStartUpdate() { return foreground && !praying && !isFinishing() && !isDestroyed(); }
            @Override public void onUpdateState(JSONObject state) { publishNative("mosque-native-update-result", state); }
        });
        applyImmersive();
        webView.loadUrl(HOME);
        webView.requestFocus();
    }

    private LocalPhoneServer createPhoneServer() {
        return new LocalPhoneServer(new AndroidPhonePlatform(this), new LocalPhoneServer.Host() {
            @Override public void key(String key) { runOnUiThread(() -> phoneKey(key)); }
            @Override public void text(String text) { runOnUiThread(() -> phoneText(text)); }
            @Override public void confirmPhone(long session, String code) { confirmPhonePairing(session, code); }
            @Override public void settings(long session, String id, boolean apply) { evaluatePhoneSettings(session, id, apply); }
            @Override public void settingsSaved(long session) {
                if (session == phoneDialogSession && pairedSessionStatus != null) {
                    pairedSessionStatus.setText(ui("حُفظت إعدادات الجامع من الجوال", "Mosque settings saved from phone"));
                }
            }
            @Override public void pairingExpired(long session) {
                if (phoneDialogSession == session && phoneDialog != null && phoneDialog.isShowing()) {
                    phoneDialog.dismiss();
                    publishNotice(ui("انتهت مهلة الاقتران. افتح اقتران الجوال للمحاولة مجددًا.", "Pairing timed out. Open phone pairing to try again."));
                }
            }
        });
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        // SAF grants only the chosen document. Ordinary content:// requests are blocked below.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= 29) settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.setBackgroundColor(Color.BLACK);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.addJavascriptInterface(new NativeBridge(), "MosqueAndroid");
        webView.setWebViewClient(new LocalClient());
        webView.setWebChromeClient(new LocalChrome());
        webView.setDownloadListener((url, userAgent, disposition, mime, length) ->
                publishNotice(ui("استخدم زر تصدير الإعدادات أو جدول المواقيت داخل الشاشة.", "Use the screen's settings or timetable export button.")));
    }

    private static boolean localOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                && HOST.equals(uri.getEncodedAuthority()) && uri.getPort() == -1;
    }

    private static boolean localIndex(String url) {
        if (url == null) return false;
        try {
            Uri uri = Uri.parse(url);
            return localOrigin(uri) && "/assets/index.html".equals(uri.getPath())
                    && uri.getQuery() == null;
        } catch (RuntimeException ignored) { return false; }
    }

    private WebResourceResponse serve(Uri uri, String method) {
        // WebView also intercepts data: URLs. Let its local decoder read only
        // the two embedded asset formats used by our font and geometric motif.
        // These cannot initiate a network request; external HTTP(S) stays blocked.
        if ("GET".equals(method) && uri != null) {
            String embedded = uri.toString();
            if (embedded.startsWith("data:font/woff2;base64,")
                    || embedded.startsWith("data:image/svg+xml,")) return null;
        }
        if (!"GET".equals(method) || !localOrigin(uri)) return response(403, "Forbidden", "Blocked");
        String path = uri.getPath(); // Android Uri decodes escapes once; AssetManager does not decode again.
        if (path == null || !path.startsWith("/assets/") || path.contains("..")
                || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) {
            return response(403, "Forbidden", "Blocked path");
        }
        String asset = path.substring("/assets/".length());
        if (asset.isEmpty() || asset.endsWith("/")) return response(404, "Not Found", "Missing asset");
        try {
            InputStream stream = getAssets().open("web/" + asset, AssetManager.ACCESS_STREAMING);
            String mime = mimeType(asset);
            return new WebResourceResponse(mime, isText(mime) ? "UTF-8" : null,
                    200, "OK", securityHeaders(), stream);
        } catch (IOException | RuntimeException ignored) {
            return response(404, "Not Found", "Missing asset");
        }
    }

    private static Map<String, String> securityHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; "
                + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
                + "connect-src 'none'; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
        return headers;
    }

    private static WebResourceResponse response(int status, String reason, String text) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, securityHeaders(),
                new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")
                || mime.equals("image/svg+xml");
    }

    private static String mimeType(String asset) {
        String lower = asset.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    private final class LocalClient extends WebViewClient {
        @Override public boolean onRenderProcessGone(WebView lost, android.webkit.RenderProcessGoneDetail detail) {
            if (lost != webView) return true;
            FrameLayout frame = (FrameLayout) lost.getParent();
            frame.removeView(lost);
            webView = null;
            lost.destroy();
            fileCallback = null; // The renderer that owned this callback has exited.
            dismissOperatorDialog();
            closePhonePairing();
            long now = android.os.SystemClock.elapsedRealtime();
            if (now - lastRendererRecovery >= 60_000L) {
                if (foreground) restoreDisplay(frame);
                else recoverOnResume = true;
            } else {
                showLoadError();
                errorPanel.getChildAt(1).requestFocus();
            }
            return true;
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return serve(request.getUrl(), request.getMethod());
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            try { return serve(Uri.parse(url), "GET"); }
            catch (RuntimeException ignored) { return response(403, "Forbidden", "Blocked"); }
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !request.isForMainFrame() || !localIndex(request.getUrl().toString());
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !localIndex(url); }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if (view != webView) return;
            if (phoneDialog != null) closePhonePairing();
            mainFrameFailed = false;
            if (!localIndex(url)) { view.stopLoading(); showLoadError(); }
        }
        @Override public void onPageFinished(WebView view, String url) {
            if (view == webView && !mainFrameFailed && localIndex(url)) {
                errorPanel.setVisibility(View.GONE);
                applyImmersive();
                dispatchResume();
            }
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (view == webView && request.isForMainFrame()) showLoadError();
        }
        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse error) {
            if (view == webView && request.isForMainFrame() && error.getStatusCode() >= 400) showLoadError();
        }
    }

    private final class LocalChrome extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (!operatorAllowed() || view != webView
                    || params.getMode() != FileChooserParams.MODE_OPEN) {
                callback.onReceiveValue(null);
                publishNotice(ui("أكمل العملية الحالية أولًا، ثم اختر ملف JSON واحدًا.", "Finish the current operation first, then select one JSON file."));
                return true;
            }
            fileCallback = callback;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/json", "text/plain", "application/octet-stream"});
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivityForResult(intent, OPEN_JSON); }
            catch (ActivityNotFoundException | SecurityException error) {
                fileCallback = null;
                callback.onReceiveValue(null);
                publishNotice(ui("منتقي الملفات غير متاح على هذا الجهاز. جرّب مدير مستندات يدعم اختيار ملفات JSON.", "The file picker is unavailable on this device. Try a document manager that supports selecting JSON files."));
            }
            return true;
        }
        @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            // Pending JsResult suspends ALL JavaScript, including the prayer clock. Never leave it pending.
            result.cancel();
            if (localIndex(url) && message != null && (message.startsWith("استعادة الإعدادات")
                    || "Reset the draft? Changes will apply only after saving.".equals(message))) {
                showDefaultsConfirmation(message);
            }
            return true;
        }
        @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            result.confirm();
            if (localIndex(url)) publishNotice(message == null ? "" : message);
            return true;
        }
        @Override public boolean onJsPrompt(WebView view, String url, String message, String value, JsPromptResult result) {
            result.cancel(); return true;
        }
        @Override public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
            result.confirm(); return true;
        }
    }

    public final class NativeBridge {
        @JavascriptInterface public String setupStatus() {
            JSONObject result = new JSONObject();
            String state = getSharedPreferences("mosque-tv-setup", 0).getString("state", "required");
            try { result.put("required", "required".equals(state)).put("legacyUpgrade", !"required".equals(state)); } catch (Exception ignored) { }
            return result.toString();
        }
        @JavascriptInterface public void markSetupCompleted(String language) { runOnUiThread(() -> {
            if (operatorAllowed() && ("ar".equals(language) || "en".equals(language))) getSharedPreferences("mosque-tv-setup", 0).edit().putString("state", "complete").putString("language", language).commit();
        }); }
        @JavascriptInterface public void startSetupFetch(String request) { runOnUiThread(() -> { if (operatorAllowed() && setupFetcher != null) setupFetcher.start(request); }); }
        @JavascriptInterface public void cancelSetupFetch() { runOnUiThread(() -> { if (setupFetcher != null) setupFetcher.cancel(); }); }
        @JavascriptInterface public void showKeyboard() { runOnUiThread(() -> {
            if (!operatorAllowed()) return;
            webView.requestFocus();
            android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.showSoftInput(webView, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
        }); }
        @JavascriptInterface public void setProfileTimezone(String zone) { runOnUiThread(() -> { if (operatorAllowed() && power != null) power.timezone(zone); }); }
        @JavascriptInterface public String deviceStatus() { return controls == null ? "{}" : controls.status().toString(); }
        @JavascriptInterface public String speedStatus() { return speed == null ? "{}" : speed.status().toString(); }
        @JavascriptInterface public void startSpeedTest() { runOnUiThread(() -> { if (operatorAllowed() && speed != null) speed.start(); }); }
        @JavascriptInterface public void cancelSpeedTest() { runOnUiThread(() -> { if (speed != null) speed.cancel(); }); }
        @JavascriptInterface public void sleepMenu() { runOnUiThread(() -> {
            if (!operatorAllowed() || power == null) return;
            final int[] minutes = {15, 30, 60, 90, 0};
            int remaining = power.status().optInt("sleepMinutes", 0);
            showOperatorDialog(new AlertDialog.Builder(MainActivity.this).setTitle(ui("مؤقت إيقاف العرض", "Display sleep timer")
                    + (remaining > 0 ? ui(" — متبقٍ نحو " + remaining + " دقيقة", " — about " + remaining + " minutes remaining") : ""))
                .setItems(new String[]{ui("بعد 15 دقيقة", "After 15 minutes"), ui("بعد 30 دقيقة", "After 30 minutes"),
                        ui("بعد ساعة", "After 1 hour"), ui("بعد ساعة ونصف", "After 1 hour 30 minutes"), ui("إلغاء المؤقت", "Cancel timer")}, (dialog, which) -> {
                    if (operatorAllowed()) power.sleep(minutes[which]);
                }).setNegativeButton(ui("رجوع", "Back"), null).create());
        }); }
        @JavascriptInterface public void displayOff() { runOnUiThread(() -> {
            if (!operatorAllowed() || power == null) return;
            evaluate("if(window.MosqueControl)window.MosqueControl.close({restoreFocus:false});");
            power.displayOff();
        }); }
        @JavascriptInterface public String powerStatus() { return power == null ? "{}" : power.status().toString(); }
        @JavascriptInterface public void savePower(String value) { runOnUiThread(() -> { if (operatorAllowed() && power != null) power.save(value); }); }
        @JavascriptInterface public String updateStatus() { return updater == null ? "{}" : updater.status().toString(); }
        @JavascriptInterface public void checkUpdate() { runOnUiThread(() -> { if (operatorAllowed() && updater != null) updater.check(); }); }
        @JavascriptInterface public void installUpdate() { runOnUiThread(() -> { if (operatorAllowed() && updater != null) updater.install(); }); }
        @JavascriptInterface public void cancelUpdate() { runOnUiThread(() -> { if (updater != null) updater.cancel(); }); }
        @JavascriptInterface public void openControl(String key) { runOnUiThread(() -> {
            if (!operatorAllowed()) return;
            if ("phone".equals(key)) { showPhonePairing(); return; }
            if (!controls.open(key)) publishNotice(ui("هذا الاختصار غير متاح على التلفزيون. افتح إعدادات النظام للتحقق.", "This shortcut is unavailable on this TV. Check the system settings."));
        }); }
        @JavascriptInterface public void deviceSetup() { runOnUiThread(() -> {
            if (operatorAllowed()) { if (power != null) power.operator(); startActivity(new Intent(MainActivity.this, DeviceSetupActivity.class)); }
        }); }
        @JavascriptInterface public String homeStatus() { return homeStatusJson().toString(); }
        @JavascriptInterface public void requestHomeRole() {
            runOnUiThread(() -> requestOptionalHomeRole());
        }
        @JavascriptInterface public void openHomeSettings() {
            runOnUiThread(() -> launchHomeSettings());
        }
        @JavascriptInterface public void openSystemSettings() {
            runOnUiThread(() -> launchSystemSettings());
        }
        @JavascriptInterface public boolean phoneSettingsActive(String id) {
            LocalPhoneServer active = phone;
            return foreground && !praying && active != null && active.activeRequest(id);
        }
        @JavascriptInterface public String takePhoneSettingsRequest(String id) {
            LocalPhoneServer active = phone;
            return foreground && !praying && active != null ? active.claimRequest(id) : null;
        }
        @JavascriptInterface public void finishPhoneSettingsRequest(String id, String result) {
            LocalPhoneServer active = phone;
            if (active != null) active.finishRequest(id, result);
        }
        @JavascriptInterface public void prayerState(boolean active) {
            praying = active; prayerActive = active;
            runOnUiThread(() -> {
                if (power != null) power.prayer(active);
                DeviceSetupActivity.setPrayerActive(active);
                FeedbackActivity.setPrayerActive(active);
                if (active) {
                    closePhonePairing();
                    dismissOperatorDialog();
                }
                if (active && speed != null) speed.cancel();
                if (active && setupFetcher != null) setupFetcher.cancel();
            });
        }
        @JavascriptInterface public void exportJson(String filename, String json) {
            if (json == null || json.length() > MAX_JSON_BYTES
                    || json.getBytes(StandardCharsets.UTF_8).length > MAX_JSON_BYTES) {
                runOnUiThread(() -> publishExportResult(false, false, ui("ملف التصدير أكبر من الحد المسموح (3 ميغابايت).", "The export exceeds the 3 MB limit.")));
                return;
            }
            final String safeName = safeFilename(filename);
            runOnUiThread(() -> {
                if (!foreground || mainFrameFailed || isFinishing() || isDestroyed() || webView == null || !localIndex(webView.getUrl())) return;
                if (exportBusy || fileCallback != null) {
                    publishExportResult(false, false, ui("توجد عملية ملفات قيد التنفيذ؛ أكملها أولًا.", "Finish the current file operation first."));
                    return;
                }
                if (praying) return;
                exportBusy = true;
                pendingExport = json;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, safeName);
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                try { startActivityForResult(intent, CREATE_JSON); }
                catch (ActivityNotFoundException | SecurityException error) {
                    pendingExport = null; exportBusy = false;
                    publishExportResult(false, false, ui("تعذر فتح نافذة حفظ الملف على هذا الجهاز.", "The save-file dialog could not be opened on this device."));
                }
            });
        }
    }

    private static String safeFilename(String name) {
        String safe = name == null || name.length() > 80 ? "mosque-export.json" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        safe = safe.replaceFirst("^\\.+", "");
        if (safe.isEmpty() || safe.length() > 80) safe = "mosque-export.json";
        if (!safe.toLowerCase(Locale.ROOT).endsWith(".json")) safe += ".json";
        return safe;
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (updater != null) updater.onActivityResult(request, result, data);
        if (request == CHOOSE_HOME) {
            homeRolePending = false;
            publishHomeResult();
            publishNotice(homeStatusJson().optString("message",
                    ui("راجع اختيار واجهة البدء في إعدادات التلفزيون.", "Check the default home app in the TV settings.")));
        } else if (request == OPEN_JSON) {
            ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            // Never return file:// or arbitrary app-private paths supplied by another activity.
            if (uri != null && !"content".equals(uri.getScheme())) uri = null;
            if (callback != null) callback.onReceiveValue(uri == null ? null : new Uri[]{uri});
        } else if (request == CREATE_JSON) {
            final String json = pendingExport;
            pendingExport = null;
            final Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            if (result != RESULT_OK || uri == null) {
                exportBusy = false;
                publishExportResult(false, true, ui("أُلغي التصدير؛ لم يتغير ملف الإعدادات داخل التطبيق.", "Export cancelled. The app's saved settings were unchanged."));
            } else if (json == null || !"content".equals(uri.getScheme())) {
                exportBusy = false;
                publishExportResult(false, false, ui("تعذر إكمال التصدير؛ افتح الإعدادات وأعد المحاولة.", "Export could not be completed. Open settings and try again."));
            } else {
                fileWriter.execute(() -> {
                    boolean saved = false;
                    try {
                        // Replacing a longer backup must discard its previous JSON tail.
                        OutputStream output = getContentResolver().openOutputStream(uri, "wt");
                        if (output == null) throw new IOException("No document stream");
                        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8))) {
                            writer.write(json); writer.flush();
                        }
                        saved = true;
                    } catch (IOException | RuntimeException providerFailure) {
                        // A provider may reject the mode or fail remotely. Release the export UI in either case.
                    }
                    final boolean success = saved;
                    runOnUiThread(() -> {
                        exportBusy = false;
                        publishExportResult(success, false, success ? ui("حُفظ ملف JSON في المكان الذي اخترته.", "The JSON file was saved to the selected location.")
                                : ui("تعذر حفظ الملف. اختر وجهة قابلة للكتابة وأعد المحاولة.", "The file could not be saved. Select a writable location and try again."));
                    });
                });
            }
        }
        applyImmersive();
    }

    private void publishExportResult(boolean success, boolean cancelled, String message) {
        if (webView == null || isFinishing() || isDestroyed()) return;
        try {
            JSONObject detail = new JSONObject();
            detail.put("success", success); detail.put("cancelled", cancelled); detail.put("message", message);
            evaluate("(function(){var d=" + detail.toString() + ";"
                    + "if(!document.body.classList.contains('praying')){var n=document.getElementById('settingsMessage');if(n)n.textContent=d.message;}"
                    + "window.dispatchEvent(new CustomEvent('mosque-native-export-result',{detail:d}));})()");
        } catch (org.json.JSONException ignored) { }
    }

    private boolean operatorAllowed() {
        return foreground && !praying && !isFinishing() && !isDestroyed() && webView != null
                && !mainFrameFailed && localIndex(webView.getUrl()) && !exportBusy && fileCallback == null && !homeRolePending;
    }
    private void publishNative(String event, JSONObject value) {
        if (webView == null || isFinishing() || isDestroyed()) return;
        evaluate("window.dispatchEvent(new CustomEvent(" + JSONObject.quote(event) + ",{detail:" + value.toString() + "}));");
    }
    private void showPhonePairing() {
        if (!operatorAllowed()) return;
        closePhonePairing();
        final LocalPhoneServer owner = createPhoneServer();
        phone = owner;
        final long session = owner.reserve();
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL); view.setGravity(Gravity.CENTER); view.setPadding(24, 16, 24, 16);
        ImageView qr = new ImageView(this);
        qr.setContentDescription(ui("رمز اقتران مؤقت بالجوال", "Temporary phone pairing code"));
        int dimension = (int)(260 * getResources().getDisplayMetrics().density);
        view.addView(qr, new LinearLayout.LayoutParams(dimension, dimension));
        TextView description = new TextView(this);
        description.setGravity(Gravity.CENTER); description.setTextSize(17);
        description.setText(ui("جارٍ فتح الاقتران…", "Opening pairing…"));
        view.addView(description);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(ui("التحكم من الجوال", "Phone controls")).setView(view)
                .setOnCancelListener(unused -> owner.stop(session))
                .setNegativeButton(ui("إيقاف الاقتران", "Stop pairing"), (unused, which) -> owner.stop(session)).create();
        showPhoneDialog(session, dialog);
        if (!dialog.isShowing()) { closePhonePairing(); return; }
        // The dialog already owns this generation. A close while looking up the LAN
        // address invalidates it before a listener can be created by the worker.
        qrWorker = new Thread(() -> {
            try {
                String link = owner.startReserved(session, LocalPhoneServer.localAddress());
                if (!owner.current(session)) return;
                Bitmap bitmap = phoneQrBitmap(link);
                runOnUiThread(() -> {
                    if (phoneDialog != dialog || !owner.current(session)) return;
                    qr.setImageBitmap(bitmap);
                    description.setText(ui("امسح الرمز خلال دقيقتين على شبكة المشرفين الخاصة، وطابق الرقم على الجهازين ثم وافق بريموت التلفزيون. الاتصال محلي غير مشفّر. تنتهي الجلسة بعد 15 دقيقة.\n",
                            "Scan on the private staff network within two minutes, match the numbers, then approve on the TV. The local connection is unencrypted. Pairing ends after 15 minutes.\n")
                            + link.substring(0, link.indexOf('#')));
                    qrWorker = null;
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (phoneDialog != dialog || phoneDialogSession != session) return;
                    closePhonePairing();
                    publishNotice(ui("تعذر بدء الاقتران. صِل التلفزيون والجوال بشبكة محلية واحدة.", "Pairing could not start. Connect the TV and phone to the same local network."));
                });
            }
        }, "mosque-pairing-qr");
        qrWorker.setDaemon(true);
        qrWorker.start();
    }

    private static Bitmap phoneQrBitmap(String link) {
        QrCode code = QrCode.encodeText(link, QrCode.Ecc.MEDIUM);
        int scale = 7, border = 4, side = (code.size + border * 2) * scale;
        int[] pixels = new int[side * side];
        for (int y = 0; y < side; y++) {
            if (Thread.currentThread().isInterrupted()) throw new java.util.concurrent.CancellationException();
            for (int x = 0; x < side; x++) pixels[y * side + x] = code.getModule(x / scale - border, y / scale - border) ? Color.BLACK : Color.WHITE;
        }
        Bitmap bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888);
        bitmap.setPixels(pixels, 0, side, 0, 0, side, side);
        return bitmap;
    }
    private void showPhoneDialog(long session, AlertDialog dialog) {
        // Detach the old step before dismissing it; its OnDismiss may be delivered later.
        AlertDialog previous = phoneDialog;
        phoneDialog = null;
        if (previous != null) previous.dismiss();
        dismissOperatorDialog();
        phoneDialogSession = session;
        phoneDialog = dialog;
        // The QR and confirmation code belong on the operator's physical display.
        if (dialog.getWindow() != null) dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        showOperatorDialog(dialog);
    }

    private void closePhonePairing() {
        LocalPhoneServer owner = phone;
        phone = null;
        phoneDialogSession = 0;
        if (owner != null) owner.stop();
        if (qrWorker != null) { qrWorker.interrupt(); qrWorker = null; }
        AlertDialog previous = phoneDialog;
        phoneDialog = null;
        pairedSessionStatus = null;
        if (operatorDialog == previous) operatorDialog = null;
        if (previous != null) previous.dismiss();
    }

    private void showPairedSession(long session) {
        // Keep a visible, dismissible session for its entire lifetime without taking focus
        // from the display. Physical Back (or touching the chip) stops the server.
        AlertDialog previous = phoneDialog;
        phoneDialog = null;
        if (operatorDialog == previous) operatorDialog = null;
        if (previous != null) previous.dismiss();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(16, 6, 16, 6);
        TextView status = new TextView(this);
        status.setText(ui("جوال المشرف متصل", "Operator phone paired"));
        TextView help = new TextView(this);
        help.setText(ui("إيقاف الاقتران: رجوع بريموت التلفزيون", "TV remote Back to stop pairing"));
        panel.addView(status); panel.addView(help);
        AlertDialog connected = new AlertDialog.Builder(this).setView(panel).create();
        connected.setCanceledOnTouchOutside(false);
        connected.setOnDismissListener(unused -> {
            if (phoneDialog == connected) closePhonePairing();
        });
        android.view.Window window = connected.getWindow();
        if (window != null) {
            window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
            window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setGravity(Gravity.BOTTOM | Gravity.END);
        }
        phoneDialogSession = session;
        phoneDialog = connected;
        pairedSessionStatus = status;
        panel.setOnClickListener(unused -> connected.dismiss());
        connected.show();
        if (window != null) window.setLayout(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);
    }

    private void evaluatePhoneSettings(long session, String id, boolean apply) {
        LocalPhoneServer owner = phone;
        if (owner == null || owner.session() != session) return;
        if (session != phoneDialogSession || pairedSessionStatus == null || !operatorAllowed() || mainFrameFailed) {
            owner.finishRequest(id, "{\"ok\":false,\"error\":\"unavailable\"}");
            return;
        }
        // Only a native UUID is inserted in program text. The JSON is pulled once as data
        // on the renderer's bridge thread, alongside a revocation check at application time.
        String action = apply ? "api.apply(JSON.parse(raw),active)" : "api.state(raw==='export')";
        String script = "(function(id){var bridge=window.MosqueAndroid;"
                + "function active(){return bridge.phoneSettingsActive(id)}"
                + "function done(v){bridge.finishPhoneSettingsRequest(id,JSON.stringify(v))}"
                + "function failed(){done({ok:false,error:'unavailable'})}"
                + "try{var raw=bridge.takePhoneSettingsRequest(id);if(raw==null)return;"
                + "var api=window.MosquePhoneSettings;if(!api){failed();return;}"
                + "Promise.resolve(" + action + ").then(done,failed)}catch(e){failed()}})(" + JSONObject.quote(id) + ")";
        webView.evaluateJavascript(script, null);
    }

    private void confirmPhonePairing(long session, String code) {
        final LocalPhoneServer owner = phone;
        if (owner == null || !owner.waiting(session)) return;
        if (!operatorAllowed() || operatorDialog == null || operatorDialog != phoneDialog || phoneDialogSession != session) {
            owner.stop(session);
            return;
        }
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(ui("تأكيد الجوال", "Confirm phone"))
                .setMessage(ui("طابق هذا الرقم مع الرقم على جوال المشرف قبل السماح بالتحكم:", "Check this number against the operator's phone before allowing control:") + "\n\n" + code)
                .setOnCancelListener(unused -> owner.stop(session))
                .setNegativeButton(ui("رفض", "Reject"), (unused, which) -> owner.stop(session))
                .setPositiveButton(ui("الرقم مطابق", "Numbers match"), (unused, which) -> {
                    if (operatorAllowed() && owner.approve(session)) {
                        showPairedSession(session);
                        publishNotice(ui("تم اقتران جوال المشرف.", "Operator phone paired."));
                    } else owner.stop(session);
                }).create();
        showPhoneDialog(session, dialog);
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus();
    }
    private void phoneKey(String key) {
        if (!foreground || praying || webView == null) return;
        if (power != null && power.isBlack()) { power.operator(); if ("menu".equals(key) || "ok".equals(key)) openControls(); return; }
        dismissOperatorDialog(); if (power != null) power.operator();
        if ("back".equals(key)) { displayBack(); return; }
        if ("menu".equals(key)) { injectShortcut(false); return; }
        String name;
        switch (key) { case "up": name = "ArrowUp"; break; case "down": name = "ArrowDown"; break;
            case "left": name = "ArrowLeft"; break; case "right": name = "ArrowRight"; break; case "ok": name = "Enter"; break; default: return; }
        evaluate("(function(){var n=document.activeElement||document;var e=new KeyboardEvent('keydown',{key:" + JSONObject.quote(name) + ",bubbles:true,cancelable:true});n.dispatchEvent(e);"
                + ("Enter".equals(name) ? "if(!e.defaultPrevented&&n&&n.tagName==='BUTTON')n.click();" : "") + "})()");
    }
    private void phoneText(String text) {
        if (!operatorAllowed()) return;
        evaluate("(function(){if(window.MosqueSetup&&window.MosqueSetup.isOpen()&&window.MosqueSetup.acceptText(" + JSONObject.quote(text) + "))return;var d=document.getElementById('settingsDialog'),n=document.activeElement;"
                + "if(!d||!d.open||!n||!d.contains(n)||!((n.tagName==='INPUT'&&['text','search','url','tel'].indexOf(n.type)>=0)||n.tagName==='TEXTAREA'))return;"
                + "n.value=" + JSONObject.quote(text) + ";if(n.maxLength>0)n.value=n.value.slice(0,n.maxLength);n.dispatchEvent(new Event('input',{bubbles:true}));})()");
    }
    private void publishNotice(String message) {
        if (message == null) return;
        final String bounded = message.substring(0, Math.min(message.length(), 1500));
        evaluate("(function(){if(document.body&&document.body.classList.contains('praying'))return;"
                + "var text=" + JSONObject.quote(bounded) + ";var n=document.getElementById('settingsMessage');if(n)n.textContent=text;"
                + "window.dispatchEvent(new CustomEvent('mosque-native-notice',{detail:{message:text}}));})()");
    }

    private RoleManager homeRoleManager() {
        if (Build.VERSION.SDK_INT < 29) return null;
        try {
            RoleManager manager = getSystemService(RoleManager.class);
            return manager != null && manager.isRoleAvailable(RoleManager.ROLE_HOME) ? manager : null;
        } catch (RuntimeException ignored) { return null; }
    }

    private boolean canResolveSettings(String action) {
        try { return new Intent(action).resolveActivity(getPackageManager()) != null; }
        catch (RuntimeException ignored) { return false; }
    }

    private boolean hasHomeRole() {
        try {
            RoleManager manager = homeRoleManager();
            return manager != null && manager.isRoleHeld(RoleManager.ROLE_HOME);
        } catch (RuntimeException ignored) { return false; }
    }

    private String effectiveHomePackage() {
        try {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            ResolveInfo resolved = getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
            String name = resolved == null || resolved.activityInfo == null
                    ? null : resolved.activityInfo.packageName;
            return name != null && name.length() <= 240 ? name : "";
        } catch (RuntimeException ignored) { return ""; }
    }

    private boolean isDefaultHome() {
        // Some TV builds retain ROLE_HOME while resolving HOME to another launcher.
        return getPackageName().equals(effectiveHomePackage());
    }

    private JSONObject homeStatusJson() {
        JSONObject status = new JSONObject();
        try {
            String effectivePackage = effectiveHomePackage();
            boolean effectiveDefault = getPackageName().equals(effectivePackage);
            boolean roleHeld = hasHomeRole();
            status.put("isDefaultHome", effectiveDefault);
            status.put("roleHeld", roleHeld);
            status.put("effectiveHomePackage", effectivePackage);
            status.put("canRequestHomeRole", !roleHeld && homeRoleManager() != null);
            status.put("canOpenHomeSettings", canResolveSettings(Settings.ACTION_HOME_SETTINGS)
                    || canResolveSettings(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
                    || canResolveSettings(Settings.ACTION_SETTINGS));
            String message;
            if (effectiveDefault) {
                message = ui("النظام يختار شاشة الجامع لواجهة البدء. اختبر زر Home وإعادة تشغيل التلفزيون والاستيقاظ من السكون.", "The system selects Mosque Display as the home app. Test the Home button, TV restart and wake from standby.");
            } else if (roleHeld && !effectivePackage.isEmpty()) {
                message = ui("تم اختيار تطبيق الجامع، لكن التلفزيون ما زال يفتح واجهة أخرى عند الضغط على Home. راجع إعدادات واجهة البدء في التلفزيون.", "Mosque Display was selected, but the TV still opens another launcher when Home is pressed. Check the TV's default home app settings.");
            } else if (effectivePackage.isEmpty()) {
                message = ui("تعذر تحديد واجهة البدء الفعلية. افتح إعدادات التلفزيون للتحقق؛ التشغيل التلقائي غير مؤكّد.", "The active home app could not be determined. Check the TV settings; automatic startup is unconfirmed.");
            } else {
                message = ui("التطبيق ليس واجهة البدء الافتراضية. اختره في نافذة النظام إن أتاحها التلفزيون.", "This app is not the default home app. Select it in the system dialog if your TV offers that choice.");
            }
            status.put("message", message);
        } catch (org.json.JSONException ignored) { }
        return status;
    }

    private void publishHomeResult() {
        evaluate("window.dispatchEvent(new CustomEvent('mosque-native-home-result',{detail:"
                + homeStatusJson().toString() + "}));");
    }

    private boolean homeOperatorActionAllowed() {
        return foreground && webView != null && !isFinishing() && !isDestroyed() && !praying
                && localIndex(webView.getUrl()) && fileCallback == null && !exportBusy
                && !homeRolePending && !settingsScreenPending;
    }

    private void requestOptionalHomeRole() {
        if (!homeOperatorActionAllowed()) return;
        if (isDefaultHome()) { publishHomeResult(); return; }
        if (hasHomeRole()) {
            // Re-requesting an already held role may return without a chooser.
            publishNotice(homeStatusJson().optString("message", ui("راجع إعدادات واجهة البدء في التلفزيون.", "Check the TV's default home app settings.")));
            launchHomeSettings();
            return;
        }
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager manager = homeRoleManager();
            if (manager != null) {
                try {
                    // No silent default change or background launch: Android asks the operator.
                    homeRolePending = true;
                    startActivityForResult(manager.createRequestRoleIntent(RoleManager.ROLE_HOME), CHOOSE_HOME);
                    return;
                } catch (RuntimeException ignored) { homeRolePending = false; }
            }
        }
        launchHomeSettings();
    }

    private boolean launchSettingsAction(String action) {
        try {
            startActivity(new Intent(action));
            settingsScreenPending = true;
            return true;
        } catch (RuntimeException ignored) { return false; }
    }

    private void launchHomeSettings() {
        if (!homeOperatorActionAllowed()) return;
        if (launchSettingsAction(Settings.ACTION_HOME_SETTINGS)
                || launchSettingsAction(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
                || launchSettingsAction(Settings.ACTION_SETTINGS)) return;
        publishNotice(ui("لم يعرض هذا التلفزيون صفحة إعدادات واجهة البدء. راجع إعدادات الجهاز من الريموت.", "This TV did not provide a home app settings page. Open the device settings with the remote."));
        publishHomeResult();
    }

    private void launchSystemSettings() {
        if (!homeOperatorActionAllowed()) return;
        if (!launchSettingsAction(Settings.ACTION_SETTINGS)) {
            publishNotice(ui("تعذر فتح إعدادات التلفزيون من التطبيق. استخدم زر إعدادات الجهاز في الريموت.", "The TV settings could not be opened from the app. Use the remote's device settings button."));
        }
    }

    private void evaluate(String script) {
        if (webView != null && !isFinishing() && !isDestroyed()) webView.evaluateJavascript(script, null);
    }

    private void showDefaultsConfirmation(String message) {
        if (praying || webView == null) return;
        webView.evaluateJavascript("!!(document.body&&!document.body.classList.contains('praying')&&document.getElementById('settingsDialog').open)", ready -> {
            if (!"true".equals(ready) || praying || isFinishing() || isDestroyed()) return;
            dismissOperatorDialog();
            AlertDialog dialog = new AlertDialog.Builder(this).setTitle(ui("استعادة الإعدادات الأصلية", "Restore default settings"))
                    .setMessage(message).setNegativeButton(ui("إلغاء", "Cancel"), null)
                    .setPositiveButton(ui("استعادة", "Restore"), (unused, which) -> {
                        // Replay only the known local defaults action; imported strings are never executed.
                        evaluate("(function(){if(document.body.classList.contains('praying'))return;"
                                + "var d=document.getElementById('settingsDialog'),b=document.getElementById('defaultsButton');"
                                + "if(!d||!d.open||!b)return;var c=window.confirm;window.confirm=function(){return true;};"
                                + "try{b.click();}finally{window.confirm=c;}})()");
                    }).create();
            showOperatorDialog(dialog);
        });
    }

    private void showOperatorDialog(AlertDialog dialog) {
        if (praying || isFinishing() || isDestroyed()) return;
        operatorDialog = dialog;
        dialog.setOnDismissListener(unused -> {
            if (operatorDialog == dialog) operatorDialog = null;
            if (phoneDialog == dialog) closePhonePairing();
        });
        dialog.show();
        if (dialog.getWindow() != null) dialog.getWindow().getDecorView().setLayoutDirection(
                "en".equals(getSharedPreferences("mosque-tv-setup", 0).getString("language", "ar"))
                        ? View.LAYOUT_DIRECTION_LTR : View.LAYOUT_DIRECTION_RTL);
    }

    private void dismissOperatorDialog() {
        if (operatorDialog != null) { operatorDialog.dismiss(); operatorDialog = null; }
    }

    @Override public void onBackPressed() {
        if (phoneDialog != null) { closePhonePairing(); return; }
        displayBack();
    }

    private void displayBack() {
        if (webView == null) { super.onBackPressed(); return; }
        if (praying) return;
        webView.evaluateJavascript("(function(){if(document.body&&document.body.classList.contains('praying'))return 'prayer';"
                + "if(window.MosqueSetup&&window.MosqueSetup.isOpen()&&window.MosqueSetup.handleBack())return 'setup';"
                + "if(window.MosqueControl&&window.MosqueControl.handleBack())return 'control';"
                + "if(window.MosqueTV&&window.MosqueTV.handleBack&&window.MosqueTV.handleBack())return 'dialog';"
                + "var d=document.getElementById('settingsDialog');if(d&&d.open){var b=document.getElementById('cancelButton');"
                + "if(b)b.click();else d.close();return 'dialog';}return 'exit';})()", state -> {
            if (praying || !"\"exit\"".equals(state)) return;
            dismissOperatorDialog();
            if (isDefaultHome()) {
                // Finishing a default HOME activity can relaunch it immediately; always leave a recovery path.
                showOperatorDialog(new AlertDialog.Builder(this).setTitle(ui("خيارات واجهة البدء", "Home app options"))
                        .setMessage(ui("شاشة الجامع هي واجهة البدء الافتراضية. يمكنك تغييرها أو فتح إعدادات التلفزيون.", "Mosque Display is the default home app. You can change it or open the TV settings."))
                        .setPositiveButton(ui("تغيير واجهة البدء", "Change home app"), (dialog, which) -> launchHomeSettings())
                        .setNeutralButton(ui("إعدادات التلفزيون", "TV settings"), (dialog, which) -> launchSystemSettings())
                        .setNegativeButton(ui("إلغاء", "Cancel"), null).create());
                return;
            }
            showOperatorDialog(new AlertDialog.Builder(this).setTitle(ui("الخروج من شاشة الجامع؟", "Exit Mosque Display?"))
                    .setMessage(ui("ستبقى الإعدادات المحفوظة متاحة عند فتح التطبيق مجددًا.", "Your saved settings will be available when you open the app again."))
                    .setNegativeButton(ui("البقاء", "Stay"), null).setPositiveButton(ui("خروج", "Exit"), (dialog, which) -> finish()).create());
        });
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int key = event.getKeyCode();
        if (key == KeyEvent.KEYCODE_BACK && pairedSessionStatus != null) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) closePhonePairing();
            return true;
        }
        if (wakingKey == key) {
            if (event.getAction() == KeyEvent.ACTION_UP) wakingKey = -1;
            return true;
        }
        // Intercept before WebView can consume the D-pad beneath the black schedule layer.
        if (event.getAction() == KeyEvent.ACTION_DOWN && power != null && power.isBlack() && !praying
                && (key == KeyEvent.KEYCODE_DPAD_CENTER || key == KeyEvent.KEYCODE_ENTER || key == KeyEvent.KEYCODE_MENU
                || key == KeyEvent.KEYCODE_BACK || key == KeyEvent.KEYCODE_DPAD_UP || key == KeyEvent.KEYCODE_DPAD_DOWN
                || key == KeyEvent.KEYCODE_DPAD_LEFT || key == KeyEvent.KEYCODE_DPAD_RIGHT)) {
            wakingKey = key; power.operator();
            if (key == KeyEvent.KEYCODE_DPAD_CENTER || key == KeyEvent.KEYCODE_ENTER || key == KeyEvent.KEYCODE_MENU) openControls();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            if (event.getRepeatCount() == 0) {
                menuDown = true; menuLongHandled = false; event.startTracking();
                handler.postDelayed(menuLongPress, ViewConfiguration.getLongPressTimeout() + 200L);
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
    @Override public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            if (!menuLongHandled) { menuLongHandled = true; injectShortcut(true); }
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }
    @Override public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            menuDown = false; handler.removeCallbacks(menuLongPress);
            if (!menuLongHandled && !event.isCanceled()) injectShortcut(false);
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }
    private void injectShortcut(boolean maintenance) {
        evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + (maintenance ? "m" : ",")
                + "',code:'" + (maintenance ? "KeyM" : "Comma") + "',ctrlKey:true,altKey:"
                + maintenance + ",bubbles:true,cancelable:true}))");
    }
    private void openControls() {
        evaluate("(function(){if(window.MosqueTV&&window.MosqueTV.isOpen())return;"
                + "if(window.MosqueControl)window.MosqueControl.open();})()");
    }

    private void restoreDisplay(FrameLayout frame) {
        if (isFinishing() || isDestroyed()) return;
        if (webView == null) {
            lastRendererRecovery = android.os.SystemClock.elapsedRealtime();
            webView = new WebView(this);
            frame.addView(webView, 0, new FrameLayout.LayoutParams(-1, -1));
            configureWebView();
        }
        webView.loadUrl(HOME);
        webView.requestFocus();
    }
    private void createErrorPanel(FrameLayout frame) {
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL); errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(48, 48, 48, 48); errorPanel.setBackgroundColor(Color.BLACK);
        errorPanel.setLayoutDirection(View.LAYOUT_DIRECTION_RTL); errorPanel.setVisibility(View.GONE);
        TextView text = new TextView(this);
        text.setText("تعذر فتح شاشة الجامع المحلية.\nأعد المحاولة، أو أعد تثبيت ملف التطبيق الكامل مع الاحتفاظ بنسخة الإعدادات.");
        text.setTextColor(Color.rgb(190, 198, 190)); text.setTextSize(24); text.setGravity(Gravity.CENTER);
        Button retry = new Button(this); retry.setText("إعادة المحاولة");
        retry.setOnClickListener(view -> { errorPanel.setVisibility(View.GONE); restoreDisplay(frame); });
        errorPanel.addView(text); errorPanel.addView(retry);
        frame.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
    }
    private void showLoadError() {
        mainFrameFailed = true;
        runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) errorPanel.setVisibility(View.VISIBLE); });
    }
    private void applyImmersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
    }
    private void dispatchResume() {
        evaluate("window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));");
    }
    @Override protected void onResume() {
        super.onResume(); foreground = true; applyImmersive(); settingsScreenPending = false;
        if (recoverOnResume) {
            recoverOnResume = false;
            restoreDisplay((FrameLayout) errorPanel.getParent());
        }
        if (power != null) power.resume();
        if (updater != null) updater.onResume();
        if (webView != null) { webView.onResume(); dispatchResume(); publishHomeResult(); }
    }
    @Override protected void onPause() {
        foreground = false;
        closePhonePairing();
        wakingKey = -1;
        menuDown = false; handler.removeCallbacks(menuLongPress); dismissOperatorDialog();
        if (speed != null) speed.cancel();
        if (setupFetcher != null) setupFetcher.cancel();
        if (power != null) power.pause();
        if (webView != null) webView.onPause();
        super.onPause();
    }
    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus); if (hasFocus) applyImmersive();
    }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration); applyImmersive(); evaluate("window.dispatchEvent(new Event('resize'));");
    }
    @Override protected void onDestroy() {
        foreground = false;
        if (power != null) power.destroy();
        if (speed != null) speed.destroy();
        if (setupFetcher != null) setupFetcher.destroy();
        if (updater != null) updater.destroy();
        closePhonePairing();
        handler.removeCallbacks(menuLongPress); dismissOperatorDialog();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (webView != null) {
            webView.removeJavascriptInterface("MosqueAndroid"); webView.stopLoading();
            ((android.view.ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy(); webView = null;
        }
        fileWriter.shutdown(); super.onDestroy();
    }
}
