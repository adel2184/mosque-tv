package sa.mosque.display;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Exercises the shipped listener over loopback; supplies the main thread, clock and WebView result. */
public final class PhoneServerTest {
    private static final String CLIENT = "0123456789abcdef0123456789abcdef";
    private static final String STATE = "/api/pairing/state", APPLY = "/api/pairing/apply-settings";
    private final AtomicLong time = new AtomicLong(1000);
    private final ThreadPoolExecutor main = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>());
    private final AtomicInteger applied = new AtomicInteger(), saved = new AtomicInteger(), texts = new AtomicInteger();
    private final BlockingQueue<String> pending = new LinkedBlockingQueue<>();
    private volatile boolean hold;
    private volatile String lastCommand = "", captured = "";
    private String token, host;
    private int port;
    private final LocalPhoneServer server;
    private static final String SAMPLE = "{\"revision\":1,\"name\":\"مسجد اختباري\"}";

    private PhoneServerTest() {
        LocalPhoneServer.Platform platform = new LocalPhoneServer.Platform() {
            public long now() { return time.get(); }
            public void post(Runnable action) { main.execute(action); }
            public void clearPending() { main.getQueue().clear(); }
            public InputStream openPage() throws IOException {
                return java.nio.file.Files.newInputStream(java.nio.file.Paths.get("android", "phone.html"));
            }
            public String base64(byte[] digest) { return java.util.Base64.getEncoder().encodeToString(digest); }
            public String command(String json, String field) {
                if ("key".equals(field) && "{\"key\":\"up\"}".equals(json)) return "up";
                if ("text".equals(field) && "{\"text\":\"hello\"}".equals(json)) return "hello";
                throw new IllegalArgumentException("fixture");
            }
            public boolean validSettings(String json) { return json.startsWith("{") && json.endsWith("}"); }
            public int responseStatus(String json) {
                if (json.contains("\"error\":\"conflict\"")) return 409;
                if (json.contains("\"error\":\"invalid\"")) return 400;
                return json.startsWith("{\"ok\":true") ? 200 : 503;
            }
        };
        server = new LocalPhoneServer(platform, new LocalPhoneServer.Host() {
            public void key(String key) { lastCommand = key; }
            public void text(String text) { if (text.equals("hello")) texts.incrementAndGet(); }
            public void confirmPhone(long session, String code) { require(code.matches("[0-9]{6}")); }
            public void pairingExpired(long session) { }
            public void settingsSaved(long session) { saved.incrementAndGet(); }
            public void settings(long session, String id, boolean apply) {
                require(server.activeRequest(id));
                String payload = server.claimRequest(id);
                require(payload != null && server.claimRequest(id) == null);
                if (hold) { pending.add(id); return; }
                if (!apply) server.finishRequest(id, payload.equals("export")
                        ? "{\"ok\":true,\"revision\":1,\"backup\":{}}" : "{\"ok\":true,\"revision\":1}");
                else if (SAMPLE.equals(payload) && applied.get() == 0) {
                    captured = payload; applied.incrementAndGet();
                    server.finishRequest(id, "{\"ok\":true,\"revision\":2}");
                } else server.finishRequest(id, "{\"ok\":false,\"error\":\"conflict\"}");
            }
        });
    }

    private void start() throws Exception {
        URI uri = URI.create(server.start("127.0.0.1")); token = uri.getFragment(); host = uri.getAuthority(); port = uri.getPort();
        require(token.length() == 48);
    }

    private String request(String method, String target, String auth, String id, String body) throws IOException {
        time.addAndGet(10);
        byte[] bytes = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        try (Socket socket = new Socket(InetAddress.getLoopbackAddress(), port)) {
            socket.setSoTimeout(4000);
            String headers = method + " " + target + " HTTP/1.1\r\nHost: " + host
                    + "\r\nX-Mosque-Token: " + auth + "\r\nX-Mosque-Client: " + id
                    + "\r\nConnection: close\r\n" + (body == null ? "" : "Content-Type: application/json\r\nContent-Length: " + bytes.length + "\r\n") + "\r\n";
            OutputStream out = socket.getOutputStream(); out.write(headers.getBytes(StandardCharsets.US_ASCII)); out.write(bytes); out.flush();
            ByteArrayOutputStream response = new ByteArrayOutputStream(); byte[] buf = new byte[2048]; int count;
            while ((count = socket.getInputStream().read(buf)) >= 0) response.write(buf, 0, count);
            return response.toString("UTF-8");
        }
    }
    private String expect(int status, String method, String target, String auth, String id, String body) throws IOException {
        String result = request(method, target, auth, id, body);
        if (!result.startsWith("HTTP/1.1 " + status + " ")) throw new AssertionError(target + " expected " + status + " got " + result);
        return result;
    }
    private void pair() throws IOException {
        require(expect(202, "GET", "/api/status", token, CLIENT, null).contains("\"pending\":true"));
        require(server.approve(server.session()));
        require(expect(200, "GET", "/api/status", token, CLIENT, null).contains("\"connected\":true"));
    }
    private void run() throws Exception {
        require(serverThreads() == 0);
        long closedDialog = server.reserve();
        server.stop(closedDialog);
        try {
            server.startReserved(closedDialog, "127.0.0.1");
            throw new AssertionError("closed dialog reopened its listener");
        } catch (IOException expectedClose) { require(serverThreads() == 0); }
        start();
        String page = expect(200, "GET", "/", "", "", null);
        String[] sections = page.split("\r\n\r\n", 2);
        require(sections.length == 2 && sections[0].contains("default-src 'none'") && !sections[0].contains("unsafe-inline"));
        String html = sections[1].replace("\r\n", "\n").replace('\r', '\n');
        for (String tag : new String[]{"script", "style"}) {
            java.util.regex.Matcher block = java.util.regex.Pattern.compile("<" + tag + ">([\\s\\S]*?)</" + tag + ">").matcher(html);
            require(block.find());
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(block.group(1).getBytes(StandardCharsets.UTF_8));
            require(sections[0].contains(tag + "-src 'sha256-" + java.util.Base64.getEncoder().encodeToString(digest) + "'"));
        }
        expect(403, "GET", STATE, "", CLIENT, null);
        expect(403, "POST", APPLY, token, CLIENT, SAMPLE);
        require(expect(202, "GET", "/api/status", token, CLIENT, null).contains("\"code\":"));
        expect(403, "GET", STATE, token, CLIENT, null);
        pair();
        expect(403, "GET", STATE, token, "a123456789abcdef0123456789abcdef", null);
        expect(404, "GET", "/other", token, CLIENT, null);
        expect(405, "POST", STATE, token, CLIENT, "{}");
        expect(405, "GET", APPLY, token, CLIENT, null);
        expect(400, "POST", APPLY, token, CLIENT, "[]");
        expect(413, "POST", APPLY, token, CLIENT, "x".repeat(LocalPhoneServer.SETTINGS_BYTES + 1));
        String editor = expect(200, "GET", STATE, token, CLIENT, null);
        require(editor.contains("\"revision\":1") && !editor.contains("\"backup\""));
        require(expect(200, "POST", APPLY, token, CLIENT, SAMPLE).contains("\"revision\":2"));
        expect(409, "POST", APPLY, token, CLIENT, SAMPLE);
        expect(200, "POST", "/api/key", token, CLIENT, "{\"key\":\"up\"}");
        expect(200, "POST", "/api/text", token, CLIENT, "{\"text\":\"hello\"}");
        main.submit(() -> {}).get();
        require(SAMPLE.equals(captured) && applied.get() == 1 && saved.get() == 1 && lastCommand.equals("up") && texts.get() == 1);
        time.addAndGet(1200);
        require(expect(200, "GET", STATE + "?export=1", token, CLIENT, null).contains("\"backup\""));

        // Closing a visible session while the WebView is busy releases its worker and rejects late completions.
        hold = true;
        ExecutorService phone = Executors.newSingleThreadExecutor();
        try {
            Future<?> open = phone.submit(() -> { try { request("POST", APPLY, token, CLIENT, SAMPLE); } catch (IOException expectedClose) { } });
            String nonce = pending.poll(3, TimeUnit.SECONDS);
            require(nonce != null && server.activeRequest(nonce));
            expect(503, "GET", STATE, token, CLIENT, null);
            long previous = server.session();
            server.stop(previous);
            open.get(3, TimeUnit.SECONDS);
            require(!server.activeRequest(nonce));
            server.finishRequest(nonce, "{\"ok\":true}");
            String oldToken = token;
            start(); require(!oldToken.equals(token));
            server.stop(previous);
            expect(403, "GET", STATE, oldToken, CLIENT, null);
            pair();
            time.addAndGet(15 * 60000L + 1);
            waitStopped();
            require(!server.activeRequest(nonce));
        } finally { phone.shutdownNow(); }

        for (int i = 0; i < 8; i++) { start(); server.stop(); }
        waitStopped();
    }
    private static int serverThreads() {
        return (int) Thread.getAllStackTraces().keySet().stream().filter(t -> t.isAlive() && t.getName().startsWith("mosque-local-")).count();
    }
    private static void waitStopped() throws Exception {
        long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
        while (serverThreads() != 0 && System.nanoTime() < until) Thread.sleep(10);
        require(serverThreads() == 0);
    }
    private static void require(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) throws Exception {
        PhoneServerTest test = new PhoneServerTest();
        try { test.run(); System.out.println("Paired HTTP state/apply, approval, bounds, stale write, concurrency, timeout and shutdown passed."); }
        finally { test.server.stop(); test.main.shutdownNow(); }
    }
}
