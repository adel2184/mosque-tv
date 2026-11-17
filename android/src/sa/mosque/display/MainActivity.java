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
    private ValueCallback<Uri[]> fileCallback;
    private String pendingExport;
    private boolean exportBusy;
    private boolean mainFrameFailed;
    private boolean menuDown;
    private boolean menuLongHandled;
    private boolean homeRolePending;
    private boolean settingsScreenPending;
    private volatile boolean praying;
    private PowerController power;
    private TvControls controls;
    private UpdateManager updater;
    private LocalPhoneServer phone;
    private volatile boolean foreground;
    private int wakingKey = -1;

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
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        createErrorPanel(frame);
        setContentView(frame);
        configureWebView();
        controls = new TvControls(this);
        power = new PowerController(this, frame, value -> publishNative("mosque-native-power-result", value));
        updater = new UpdateManager(this, new UpdateManager.Host() {
            @Override public boolean canStartUpdate() { return foreground && !praying && !isFinishing() && !isDestroyed(); }
            @Override public void onUpdateState(JSONObject state) { publishNative("mosque-native-update-result", state); }
        });
        phone = new LocalPhoneServer(this, new LocalPhoneServer.Host() {
            @Override public void key(String key) { runOnUiThread(() -> phoneKey(key)); }
            @Override public void text(String text) { runOnUiThread(() -> phoneText(text)); }
        });
        applyImmersive();
        webView.loadUrl(HOME);
        webView.requestFocus();
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
                publishNotice("استخدم زر تصدير الإعدادات أو جدول المواقيت داخل الشاشة."));
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
                + "connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
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
            mainFrameFailed = false;
            if (!localIndex(url)) { view.stopLoading(); showLoadError(); }
        }
        @Override public void onPageFinished(WebView view, String url) {
            if (!mainFrameFailed && localIndex(url)) {
                errorPanel.setVisibility(View.GONE);
                applyImmersive();
                dispatchResume();
            }
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showLoadError();
        }
        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse error) {
            if (request.isForMainFrame() && error.getStatusCode() >= 400) showLoadError();
        }
    }

    private final class LocalChrome extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (praying || !localIndex(view.getUrl()) || fileCallback != null || exportBusy
                    || params.getMode() != FileChooserParams.MODE_OPEN) {
                callback.onReceiveValue(null);
                publishNotice("أكمل العملية الحالية أولًا، ثم اختر ملف JSON واحدًا.");
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
                publishNotice("منتقي الملفات غير متاح على هذا الجهاز. جرّب مدير مستندات يدعم اختيار ملفات JSON.");
            }
            return true;
        }
        @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            // Pending JsResult suspends ALL JavaScript, including the prayer clock. Never leave it pending.
            result.cancel();
            if (localIndex(url) && message != null && message.startsWith("استعادة الإعدادات")) {
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
        @JavascriptInterface public String deviceStatus() { return controls == null ? "{}" : controls.status().toString(); }
        @JavascriptInterface public String powerStatus() { return power == null ? "{}" : power.status().toString(); }
        @JavascriptInterface public void savePower(String value) { runOnUiThread(() -> { if (operatorAllowed() && power != null) power.save(value); }); }
        @JavascriptInterface public String updateStatus() { return updater == null ? "{}" : updater.status().toString(); }
        @JavascriptInterface public void checkUpdate() { runOnUiThread(() -> { if (operatorAllowed() && updater != null) updater.check(); }); }
        @JavascriptInterface public void installUpdate() { runOnUiThread(() -> { if (operatorAllowed() && updater != null) updater.install(); }); }
        @JavascriptInterface public void cancelUpdate() { runOnUiThread(() -> { if (updater != null) updater.cancel(); }); }
        @JavascriptInterface public void openControl(String key) { runOnUiThread(() -> {
            if (!operatorAllowed()) return;
            if ("phone".equals(key)) { showPhonePairing(); return; }
            if (!controls.open(key)) publishNotice("هذا الاختصار غير متاح على التلفزيون. افتح إعدادات النظام للتحقق.");
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
        @JavascriptInterface public void prayerState(boolean active) {
            praying = active; prayerActive = active;
            runOnUiThread(() -> {
                if (power != null) power.prayer(active);
                DeviceSetupActivity.setPrayerActive(active);
                if (active) dismissOperatorDialog();
            });
        }
        @JavascriptInterface public void exportJson(String filename, String json) {
            if (json == null || json.length() > MAX_JSON_BYTES
                    || json.getBytes(StandardCharsets.UTF_8).length > MAX_JSON_BYTES) {
                runOnUiThread(() -> publishExportResult(false, false, "ملف التصدير أكبر من الحد المسموح (3 ميغابايت)."));
                return;
            }
            final String safeName = safeFilename(filename);
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed() || !localIndex(webView.getUrl())) return;
                if (exportBusy || fileCallback != null) {
                    publishExportResult(false, false, "توجد عملية ملفات قيد التنفيذ؛ أكملها أولًا.");
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
                    publishExportResult(false, false, "تعذر فتح نافذة حفظ الملف على هذا الجهاز.");
                }
            });
        }
    }

    private static String safeFilename(String name) {
        String safe = name == null ? "mosque-export.json" : name.replaceAll("[^A-Za-z0-9._-]", "_");
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
                    "راجع اختيار واجهة البدء في إعدادات التلفزيون."));
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
                publishExportResult(false, true, "أُلغي التصدير؛ لم يتغير ملف الإعدادات داخل التطبيق.");
            } else if (json == null || !"content".equals(uri.getScheme())) {
                exportBusy = false;
                publishExportResult(false, false, "تعذر إكمال التصدير؛ افتح الإعدادات وأعد المحاولة.");
            } else {
                fileWriter.execute(() -> {
                    boolean saved = false;
                    try {
                        OutputStream output = getContentResolver().openOutputStream(uri, "w");
                        if (output == null) throw new IOException("No document stream");
                        try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8))) {
                            writer.write(json); writer.flush();
                        }
                        saved = true;
                    } catch (IOException | SecurityException ignored) { }
                    final boolean success = saved;
                    runOnUiThread(() -> {
                        exportBusy = false;
                        publishExportResult(success, false, success ? "حُفظ ملف JSON في المكان الذي اخترته."
                                : "تعذر حفظ الملف. اختر وجهة قابلة للكتابة وأعد المحاولة.");
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
                && localIndex(webView.getUrl()) && !exportBusy && fileCallback == null && !homeRolePending;
    }
    private void publishNative(String event, JSONObject value) {
        if (webView == null || isFinishing() || isDestroyed()) return;
        evaluate("window.dispatchEvent(new CustomEvent(" + JSONObject.quote(event) + ",{detail:" + value.toString() + "}));");
    }
    private void showPhonePairing() {
        if (!operatorAllowed()) return;
        try {
            String link = phone.start();
            QrCode code = QrCode.encodeText(link, QrCode.Ecc.MEDIUM);
            int scale = 7, border = 4, side = (code.size + border * 2) * scale;
            Bitmap bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888);
            int[] pixels = new int[side * side];
            for (int y = 0; y < side; y++) for (int x = 0; x < side; x++) pixels[y * side + x] = code.getModule(x / scale - border, y / scale - border) ? Color.BLACK : Color.WHITE;
            bitmap.setPixels(pixels, 0, side, 0, 0, side, side);
            LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); view.setGravity(Gravity.CENTER); view.setPadding(24, 16, 24, 16);
            ImageView qr = new ImageView(this); qr.setImageBitmap(bitmap); qr.setContentDescription("رمز اقتران مؤقت بريموت الجوال");
            int dimension = (int)(260 * getResources().getDisplayMetrics().density);
            view.addView(qr, new LinearLayout.LayoutParams(dimension, dimension));
            TextView description = new TextView(this); description.setGravity(Gravity.CENTER); description.setTextSize(17);
            description.setText("صِل الجوال والتلفاز بالشبكة المحلية نفسها ثم امسح الرمز.\nلا يحتاج إنترنت. الجلسة 15 دقيقة؛ الرمز خاص بالمشرف.\n" + link.substring(0, link.indexOf('#')));
            view.addView(description);
            showOperatorDialog(new AlertDialog.Builder(this).setTitle("التحكم من الجوال").setView(view)
                    .setPositiveButton("متابعة العرض", null).setNegativeButton("إيقاف الاقتران", (dialog, which) -> phone.stop()).create());
        } catch (Exception error) { publishNotice("تعذر بدء اقتران الجوال. صِل الجهازين بشبكة محلية واحدة؛ لا يلزم إنترنت."); }
    }
    private void phoneKey(String key) {
        if (!foreground || praying || webView == null) return;
        dismissOperatorDialog(); if (power != null) power.operator();
        if ("back".equals(key)) { onBackPressed(); return; }
        if ("menu".equals(key)) { injectShortcut(false); return; }
        String name;
        switch (key) { case "up": name = "ArrowUp"; break; case "down": name = "ArrowDown"; break;
            case "left": name = "ArrowLeft"; break; case "right": name = "ArrowRight"; break; case "ok": name = "Enter"; break; default: return; }
        evaluate("(function(){var n=document.activeElement||document;var e=new KeyboardEvent('keydown',{key:" + JSONObject.quote(name) + ",bubbles:true,cancelable:true});n.dispatchEvent(e);"
                + ("Enter".equals(name) ? "if(!e.defaultPrevented&&n&&n.tagName==='BUTTON')n.click();" : "") + "})()");
    }
    private void phoneText(String text) {
        if (!operatorAllowed()) return;
        evaluate("(function(){var d=document.getElementById('settingsDialog'),n=document.activeElement;"
                + "if(!d||!d.open||!n||!d.contains(n)||!((n.tagName==='INPUT'&&['text','search','url','tel'].indexOf(n.type)>=0)||n.tagName==='TEXTAREA'))return;"
                + "n.value=" + JSONObject.quote(text) + ";if(n.maxLength>0)n.value=n.value.slice(0,n.maxLength);n.dispatchEvent(new Event('input',{bubbles:true}));})()");
    }
    private void publishNotice(String message) {
        if (message == null) return;
        final String bounded = message.substring(0, Math.min(message.length(), 1500));
        evaluate("(function(){if(document.body&&document.body.classList.contains('praying'))return;"
                + "var n=document.getElementById('settingsMessage');if(n)n.textContent=" + JSONObject.quote(bounded) + ";})()");
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
                message = "النظام يختار شاشة الجامع لواجهة البدء. اختبر زر Home وإعادة تشغيل التلفزيون والاستيقاظ من السكون.";
            } else if (roleHeld && !effectivePackage.isEmpty()) {
                message = "تم اختيار تطبيق الجامع، لكن التلفزيون ما زال يفتح واجهة أخرى عند الضغط على Home. راجع إعدادات واجهة البدء في التلفزيون.";
            } else if (effectivePackage.isEmpty()) {
                message = "تعذر تحديد واجهة البدء الفعلية. افتح إعدادات التلفزيون للتحقق؛ التشغيل التلقائي غير مؤكّد.";
            } else {
                message = "التطبيق ليس واجهة البدء الافتراضية. اختره في نافذة النظام إن أتاحها التلفزيون.";
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
        return webView != null && !isFinishing() && !isDestroyed() && !praying
                && localIndex(webView.getUrl()) && fileCallback == null && !exportBusy
                && !homeRolePending && !settingsScreenPending;
    }

    private void requestOptionalHomeRole() {
        if (!homeOperatorActionAllowed()) return;
        if (isDefaultHome()) { publishHomeResult(); return; }
        if (hasHomeRole()) {
            // Re-requesting an already held role may return without a chooser.
            publishNotice(homeStatusJson().optString("message", "راجع إعدادات واجهة البدء في التلفزيون."));
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
        publishNotice("لم يعرض هذا التلفزيون صفحة إعدادات واجهة البدء. راجع إعدادات الجهاز من الريموت.");
        publishHomeResult();
    }

    private void launchSystemSettings() {
        if (!homeOperatorActionAllowed()) return;
        if (!launchSettingsAction(Settings.ACTION_SETTINGS)) {
            publishNotice("تعذر فتح إعدادات التلفزيون من التطبيق. استخدم زر إعدادات الجهاز في الريموت.");
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
            AlertDialog dialog = new AlertDialog.Builder(this).setTitle("استعادة الإعدادات الأصلية")
                    .setMessage(message).setNegativeButton("إلغاء", null)
                    .setPositiveButton("استعادة", (unused, which) -> {
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
        dialog.setOnDismissListener(unused -> { if (operatorDialog == dialog) operatorDialog = null; });
        dialog.show();
        if (dialog.getWindow() != null) dialog.getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
    }

    private void dismissOperatorDialog() {
        if (operatorDialog != null) { operatorDialog.dismiss(); operatorDialog = null; }
    }

    @Override public void onBackPressed() {
        if (praying) return;
        webView.evaluateJavascript("(function(){if(document.body&&document.body.classList.contains('praying'))return 'prayer';"
                + "if(window.MosqueTV&&window.MosqueTV.handleBack&&window.MosqueTV.handleBack())return 'dialog';"
                + "var d=document.getElementById('settingsDialog');if(d&&d.open){var b=document.getElementById('cancelButton');"
                + "if(b)b.click();else d.close();return 'dialog';}return 'exit';})()", state -> {
            if (praying || !"\"exit\"".equals(state)) return;
            dismissOperatorDialog();
            if (isDefaultHome()) {
                // Finishing a default HOME activity can relaunch it immediately; always leave a recovery path.
                showOperatorDialog(new AlertDialog.Builder(this).setTitle("خيارات واجهة البدء")
                        .setMessage("شاشة الجامع هي واجهة البدء الافتراضية. يمكنك تغييرها أو فتح إعدادات التلفزيون.")
                        .setPositiveButton("تغيير واجهة البدء", (dialog, which) -> launchHomeSettings())
                        .setNeutralButton("إعدادات التلفزيون", (dialog, which) -> launchSystemSettings())
                        .setNegativeButton("إلغاء", null).create());
                return;
            }
            showOperatorDialog(new AlertDialog.Builder(this).setTitle("الخروج من شاشة الجامع؟")
                    .setMessage("ستبقى الإعدادات المحفوظة متاحة عند فتح التطبيق مجددًا.")
                    .setNegativeButton("البقاء", null).setPositiveButton("خروج", (dialog, which) -> finish()).create());
        });
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int key = event.getKeyCode();
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
            if (key == KeyEvent.KEYCODE_DPAD_CENTER || key == KeyEvent.KEYCODE_ENTER || key == KeyEvent.KEYCODE_MENU) injectShortcut(false);
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

    private void createErrorPanel(FrameLayout frame) {
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL); errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(48, 48, 48, 48); errorPanel.setBackgroundColor(Color.BLACK);
        errorPanel.setLayoutDirection(View.LAYOUT_DIRECTION_RTL); errorPanel.setVisibility(View.GONE);
        TextView text = new TextView(this);
        text.setText("تعذر فتح شاشة الجامع المحلية.\nأعد المحاولة، أو أعد تثبيت ملف التطبيق الكامل مع الاحتفاظ بنسخة الإعدادات.");
        text.setTextColor(Color.rgb(190, 198, 190)); text.setTextSize(24); text.setGravity(Gravity.CENTER);
        Button retry = new Button(this); retry.setText("إعادة المحاولة");
        retry.setOnClickListener(view -> { errorPanel.setVisibility(View.GONE); webView.loadUrl(HOME); });
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
        if (power != null) power.resume();
        if (updater != null) updater.onResume();
        if (webView != null) { webView.onResume(); dispatchResume(); publishHomeResult(); }
    }
    @Override protected void onPause() {
        foreground = false;
        wakingKey = -1;
        menuDown = false; handler.removeCallbacks(menuLongPress); dismissOperatorDialog();
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
        if (updater != null) updater.destroy();
        if (phone != null) phone.stop();
        handler.removeCallbacks(menuLongPress); dismissOperatorDialog();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (webView != null) {
            webView.removeJavascriptInterface("MosqueAndroid"); webView.stopLoading();
            webView.destroy(); webView = null;
        }
        fileWriter.shutdown(); super.onDestroy();
    }
}
