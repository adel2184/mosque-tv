package sa.mosque.display;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import java.lang.ref.WeakReference;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.HttpsURLConnection;

/** One explicit five-megabyte HTTPS sample. Never starts on construction/resume or in WebView. */
final class NetworkSpeedTest {
    interface Host { boolean permitted(); void onResult(JSONObject status); }
    private final WeakReference<Activity> activity;
    private Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicInteger generation = new AtomicInteger();
    private static final ThreadFactory THREADS = runnable -> { Thread t = new Thread(runnable, "mosque-speed"); t.setDaemon(true); return t; };
    private final ExecutorService worker = Executors.newSingleThreadExecutor(THREADS);
    private final ScheduledExecutorService cleanup = Executors.newScheduledThreadPool(2, THREADS);
    private volatile HttpsURLConnection active;
    private volatile int activeToken;
    private volatile boolean destroyed;
    private Future<?> work;
    private ScheduledFuture<?> expiry;
    private String state = "idle", message = "اضغط للقياس؛ يحتاج إنترنت وينزّل حتى 5 ميجابايت.";
    private double mbps;
    private long bytes, elapsedMs;

    NetworkSpeedTest(Activity activity, Host host) { this.activity = new WeakReference<>(activity); this.host = host; }
    synchronized JSONObject status() {
        JSONObject out = new JSONObject();
        try {
            out.put("type", "speed").put("supported", true).put("state", state).put("message", message)
                    .put("running", "running".equals(state)).put("downloadMbps", mbps).put("mbps", mbps)
                    .put("bytes", bytes).put("maxBytes", NetworkSpeedProbe.BYTES).put("elapsedMs", elapsedMs)
                    .put("progress", "complete".equals(state) ? 100 : -1);
        } catch (Exception ignored) { }
        return out;
    }
    private boolean permitted() {
        Activity live = activity.get();
        return !destroyed && live != null && !live.isFinishing() && !live.isDestroyed() && host != null && host.permitted();
    }
    private void publish() {
        final JSONObject value = status();
        main.post(() -> { if (permitted()) host.onResult(value); });
    }
    private synchronized void state(String next, String text) { state = next; message = text; publish(); }
    void start() {
        main.post(() -> {
            if (!permitted()) return;
            synchronized (this) { if ("running".equals(state)) { publish(); return; } mbps = 0; bytes = 0; elapsedMs = 0; }
            final int token = generation.incrementAndGet();
            state("running", "جارٍ قياس تنزيل عينة حتى 5 ميجابايت…");
            final long deadline = System.nanoTime() + NetworkSpeedProbe.OVERALL_NANOS;
            expiry = cleanup.schedule(() -> {
                main.post(() -> { if (generation.compareAndSet(token, token + 1) && !destroyed) state("error", "انتهت مهلة القياس. تحقق من الاتصال وحاول مجددًا."); });
                HttpsURLConnection conn = active; if (conn != null && activeToken == token) conn.disconnect();
            }, 30, TimeUnit.SECONDS);
            work = worker.submit(() -> run(token, deadline));
        });
    }
    private boolean workerPermitted(int token) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1); final boolean[] allowed = {false};
        main.post(() -> { try { allowed[0] = generation.get() == token && permitted(); } finally { done.countDown(); } });
        return done.await(2, TimeUnit.SECONDS) && allowed[0] && generation.get() == token && !destroyed;
    }
    private void run(int token, long deadline) {
        HttpsURLConnection connection = null;
        try {
            if (!workerPermitted(token)) { finish(token, "cancelled", "أُلغي القياس.", null); return; }
            connection = (HttpsURLConnection) new URL(NetworkSpeedProbe.ENDPOINT).openConnection();
            if (generation.get() != token || destroyed) return;
            activeToken = token; active = connection;
            NetworkSpeedProbe.Result result = NetworkSpeedProbe.measure(connection, deadline,
                    () -> destroyed || generation.get() != token);
            finish(token, "complete", String.format(Locale.ROOT, "تنزيل تقريبي: %.1f ميجابت/ث — عينة 5 ميجابايت.", result.mbps), result);
        } catch (Exception error) {
            finish(token, "error", "تعذر قياس السرعة. يحتاج الاختبار اتصالًا بالإنترنت؛ عرض الجامع مستمر.", null);
        } finally {
            if (connection != null) connection.disconnect();
            if (active == connection) active = null;
        }
    }
    private void finish(int token, String next, String text, NetworkSpeedProbe.Result result) {
        main.post(() -> {
            if (destroyed || !generation.compareAndSet(token, token + 1)) return;
            if (expiry != null) expiry.cancel(false);
            synchronized (this) {
                if (result != null) { mbps = result.mbps; bytes = result.bytes; elapsedMs = result.elapsedNanos / 1_000_000; }
                state = next; message = text;
            }
            publish();
        });
    }
    /** Call on panel close, Activity pause and prayer entry; it never opens an error dialog. */
    void cancel() {
        if (Looper.myLooper() == Looper.getMainLooper()) cancelNow(); else main.post(this::cancelNow);
    }
    private void cancelNow() {
        generation.incrementAndGet();
        if (expiry != null) expiry.cancel(false);
        if (work != null) work.cancel(true);
        HttpsURLConnection connection = active;
        if (connection != null && !cleanup.isShutdown()) cleanup.execute(connection::disconnect);
        synchronized (this) { if ("running".equals(state)) { state = "cancelled"; message = "أُلغي قياس السرعة."; } }
        publish();
    }
    void destroy() {
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post(this::destroy); return; }
        if (destroyed) return;
        destroyed = true; cancelNow(); host = null; activity.clear();
        main.removeCallbacksAndMessages(null); worker.shutdownNow(); cleanup.shutdown();
    }
}
