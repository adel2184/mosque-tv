package sa.mosque.display;

import java.io.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.concurrent.*;

/** Temporary, paired LAN remote. No cloud, arbitrary URLs, filesystem routes or shell commands. */
final class LocalPhoneServer {
    interface Host {
        void key(String key);
        void text(String value);
        void confirmPhone(long session, String code);
        void pairingExpired(long session);
        void settings(long session, String requestId, boolean apply);
        void settingsSaved(long session);
    }
    interface Platform {
        long now();
        void post(Runnable action);
        default void clearPending() { }
        InputStream openPage() throws IOException;
        String base64(byte[] digest);
        String command(String json, String field) throws IOException;
        boolean validSettings(String json);
        int responseStatus(String json);
    }
    static final int SETTINGS_BYTES = 128 * 1024;
    private static final long REQUEST_MS = 15_000L;
    private final Platform platform;
    private final Host host;
    private ServerSocket server;
    private ThreadPoolExecutor clients;
    private PhoneApproval approval;
    private volatile long expires;
    private String token = "", authority = "", address = "";
    private volatile boolean running;
    private volatile long sessionGeneration;
    private final java.util.Set<Socket> sockets = java.util.concurrent.ConcurrentHashMap.newKeySet();
    // At most one active WebView transaction across all workers, scoped to the approved session.
    private static final class SettingsRequest {
        final String id = java.util.UUID.randomUUID().toString();
        final long session, deadline;
        final String payload;
        final CompletableFuture<String> result = new CompletableFuture<>();
        boolean claimed;
        SettingsRequest(long session, long deadline, String payload) {
            this.session = session; this.deadline = deadline; this.payload = payload;
        }
    }
    private SettingsRequest inFlight;
    private int pendingCommands;
    LocalPhoneServer(Platform platform, Host host) { this.platform = platform; this.host = host; }
    synchronized long reserve() { stop(); return sessionGeneration; }
    String start(String ip) throws IOException { return startReserved(reserve(), ip); }

    synchronized String startReserved(long sessionId, String ip) throws IOException {
        if (sessionId != sessionGeneration || running) throw new IOException("closed session");
        if (ip.isEmpty()) throw new IOException("لا توجد شبكة محلية. صِل التلفاز والجوال بشبكة واحدة؛ لا يلزم اتصال الإنترنت.");
        SecureRandom source = new SecureRandom();
        byte[] random = new byte[24]; source.nextBytes(random);
        StringBuilder secret = new StringBuilder(); for (byte b : random) secret.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        token = secret.toString();
        long now = platform.now();
        expires = now + 15 * 60_000L;
        approval = new PhoneApproval(now, String.format(java.util.Locale.ROOT, "%06d", source.nextInt(1_000_000)));
        server = new ServerSocket(); server.setReuseAddress(true); server.bind(new InetSocketAddress(InetAddress.getByName(ip), 0), 4); server.setSoTimeout(1000);
        authority = ip + ":" + server.getLocalPort(); address = "http://" + authority + "/#" + token;
        clients = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<Runnable>(4), task -> {
            Thread worker = new Thread(task, "mosque-local-client"); worker.setDaemon(true); return worker;
        });
        running = true;
        final ServerSocket listening = server;
        final long session = sessionGeneration;
        final ThreadPoolExecutor pool = clients;
        Thread acceptor = new Thread(() -> {
            while (current(session)) {
                try {
                    Socket socket = listening.accept();
                    synchronized (LocalPhoneServer.this) {
                        InetAddress peer = socket.getInetAddress();
                        boolean localPeer = peer.isSiteLocalAddress() || (socket.getLocalAddress().isLoopbackAddress() && peer.isLoopbackAddress());
                        if (!localPeer || !current(session)) { socket.close(); continue; }
                        sockets.add(socket);
                    }
                    try { pool.execute(() -> serve(socket, session)); } catch (RejectedExecutionException error) { sockets.remove(socket); socket.close(); }
                } catch (SocketTimeoutException ignored) { } catch (IOException error) { break; }
            }
            try { listening.close(); } catch (IOException ignored) { }
            synchronized (LocalPhoneServer.this) {
                if (session == sessionGeneration) {
                    stop();
                    platform.post(() -> host.pairingExpired(session));
                }
            }
        }, "mosque-local-remote"); acceptor.setDaemon(true); acceptor.start();
        return address;
    }
    long session() { return sessionGeneration; }
    synchronized boolean current(long session) {
        long now = platform.now();
        return running && session == sessionGeneration && now < expires && !approval.expired(now);
    }
    synchronized void stop(long session) { if (session == sessionGeneration) stop(); }
    synchronized boolean waiting(long session) { return current(session) && approval.waiting(); }
    synchronized boolean approve(long session) {
        return current(session) && approval.approve(platform.now());
    }
    private synchronized boolean authorized(long session, String clientId, String peer) {
        return current(session) && approval.authorized(clientId, peer);
    }
    private synchronized String phoneStatus(long session, String clientId, String peer) {
        if (!current(session)) return null;
        if (approval.request(clientId, peer, platform.now())) {
            String code = approval.code;
            platform.post(() -> { if (waiting(session)) host.confirmPhone(session, code); });
        }
        if (!approval.matches(clientId, peer)) return null;
        return approval.waiting() ? approval.code : "";
    }
    static String localAddress() {
        try {
            for (NetworkInterface net : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!net.isUp() || net.isLoopback()) continue;
                for (InetAddress ip : Collections.list(net.getInetAddresses())) if (ip instanceof Inet4Address && ip.isSiteLocalAddress()) return ip.getHostAddress();
            }
        } catch (Exception ignored) { }
        return "";
    }
    private String line(InputStream in, long deadline) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int i = 0; i < 4096; i++) { if (platform.now() > deadline) throw new IOException("deadline"); int b = in.read(); if (b == -1) throw new EOFException(); if (b == 10) return new String(bytes.toByteArray(), StandardCharsets.US_ASCII).trim(); bytes.write(b); }
        throw new IOException("line too long");
    }
    private void serve(Socket socket, long session) {
        try (Socket client = socket) {
            client.setSoTimeout(3000);
            InputStream in = new BufferedInputStream(client.getInputStream()); OutputStream out = client.getOutputStream();
            long deadline = platform.now() + 10000;
            String[] first = line(in, deadline).split(" ");
            if (first.length != 3 || !"HTTP/1.1".equals(first[2])) { reply(out, 400, "text/plain", "طلب غير صالح".getBytes(StandardCharsets.UTF_8)); return; }
            String auth = "", clientId = "", origin = "", hostname = "", contentType = ""; int size = 0, total = 0;
            boolean headersComplete = false;
            java.util.HashSet<String> seen = new java.util.HashSet<>();
            for (int i = 0; i < 40; i++) {
                String value = line(in, deadline); total += value.length(); if (total > 8192) throw new IOException("headers too large");
                if (value.isEmpty()) { headersComplete = true; break; }
                int colon = value.indexOf(':'); if (colon < 1) throw new IOException("header");
                String key = value.substring(0, colon).toLowerCase(java.util.Locale.ROOT), content = value.substring(colon + 1).trim();
                if (!seen.add(key)) { replyError(out, 400, "invalid"); return; }
                if (key.equals("host")) hostname = content;
                else if (key.equals("origin")) origin = content;
                else if (key.equals("x-mosque-token")) auth = content;
                else if (key.equals("x-mosque-client")) clientId = content;
                else if (key.equals("content-length")) size = Integer.parseInt(content);
                else if (key.equals("content-type")) contentType = content;
                else if (key.equals("transfer-encoding")) throw new IOException("no chunked requests");
            }
            if (!headersComplete || !current(session) || !authority.equals(hostname) || (!origin.isEmpty() && !("http://" + authority).equals(origin))) { reply(out, 403, "text/plain", new byte[0]); return; }
            String route = first[1];
            if ("GET".equals(first[0]) && "/".equals(route)) {
                servePage(out);
                return;
            }
            if (!MessageDigest.isEqual(token.getBytes(StandardCharsets.US_ASCII), auth.getBytes(StandardCharsets.US_ASCII))) { reply(out, 403, "application/json", "{\"error\":\"انتهت جلسة الاقتران أو الرمز غير صحيح\"}".getBytes(StandardCharsets.UTF_8)); return; }
            String peer = client.getInetAddress().getHostAddress();
            if ("GET".equals(first[0]) && "/api/status".equals(route)) {
                String challenge = phoneStatus(session, clientId, peer);
                if (challenge == null) { reply(out, 403, "application/json", new byte[0]); return; }
                boolean connected = challenge.isEmpty();
                String body = connected ? "{\"connected\":true}" : "{\"pending\":true,\"code\":\"" + challenge + "\"}";
                reply(out, connected ? 200 : 202, "application/json", body.getBytes(StandardCharsets.UTF_8));
                return;
            }
            if (!authorized(session, clientId, peer)) { reply(out, 403, "application/json", new byte[0]); return; }
            boolean apply = "/api/pairing/apply-settings".equals(route);
            boolean state = "/api/pairing/state".equals(route);
            String field = "/api/key".equals(route) ? "key" : "/api/text".equals(route) ? "text" : null;
            if (!state && !apply && field == null) { replyError(out, 404, "route"); return; }
            if (!(state ? "GET" : "POST").equals(first[0])) { replyError(out, 405, "method"); return; }
            if (state && size != 0) { replyError(out, 400, "invalid"); return; }
            if (!state && size > (apply ? SETTINGS_BYTES : 12000)) { replyError(out, 413, "size"); return; }
            if (!state && (size < 2 || !"application/json".equalsIgnoreCase(contentType.split(";", 2)[0].trim()))) {
                replyError(out, 400, "invalid"); return;
            }
            if (!allowCommand(session)) { replyError(out, 429, "busy"); return; }
            if (state) { exchangeSettings(session, null, out); return; }
            byte[] payload = new byte[size]; int read = 0;
            while (read < size) {
                if (platform.now() > deadline) throw new IOException("deadline");
                int n = in.read(payload, read, size - read); if (n == -1) throw new EOFException(); read += n;
            }
            String json;
            try { json = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(payload)).toString(); }
            catch (java.nio.charset.CharacterCodingException malformed) { replyError(out, 400, "invalid"); return; }
            if (!authorized(session, clientId, peer)) { replyError(out, 403, "expired"); return; }
            if (apply) {
                if (!platform.validSettings(json)) { replyError(out, 400, "invalid"); return; }
                exchangeSettings(session, json, out); return;
            }
            String value;
            try { value = platform.command(json, field); }
            catch (IOException | RuntimeException malformed) { replyError(out, 400, "invalid"); return; }
            if ("/api/key".equals(route)) { String key = value; if (!key.matches("up|down|left|right|ok|back|menu")) throw new IOException("key"); dispatch(session, () -> host.key(key)); }
            else if ("/api/text".equals(route)) { String text = value; if (!validQuickText(text)) { replyError(out, 400, "invalid"); return; } dispatch(session, () -> host.text(text)); }
            else { reply(out, 404, "application/json", new byte[0]); return; }
            reply(out, 200, "application/json", "{\"ok\":true}".getBytes(StandardCharsets.US_ASCII));
        } catch (Exception ignored) { } finally { sockets.remove(socket); }
    }
    private void servePage(OutputStream out) throws IOException {
        byte[] bytes;
        try (InputStream page = platform.openPage()) {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = page.read(buffer)) >= 0) {
                if (body.size() + count > 64 * 1024) throw new IOException("page");
                body.write(buffer, 0, count);
            }
            bytes = body.toByteArray();
        }
        // HTML's input stream normalizes CRLF and CR before the browser checks an inline digest.
        String html = new String(bytes, StandardCharsets.UTF_8).replace("\r\n", "\n").replace('\r', '\n');
        String policy = "default-src 'none'; script-src " + blockHash(html, "script")
                + "; style-src " + blockHash(html, "style")
                + "; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
        reply(out, 200, "text/html; charset=utf-8", bytes, policy);
    }

    private String blockHash(String html, String tag) throws IOException {
        String open = "<" + tag + ">", close = "</" + tag + ">";
        int start = html.indexOf(open), end = html.indexOf(close);
        if (start < 0 || end <= start || html.indexOf(open, start + open.length()) >= 0) throw new IOException("asset");
        try {
            byte[] source = html.substring(start + open.length(), end).getBytes(StandardCharsets.UTF_8);
            return "'sha256-" + platform.base64(MessageDigest.getInstance("SHA-256").digest(source)) + "'";
        } catch (java.security.NoSuchAlgorithmException unavailable) { throw new IOException("SHA-256", unavailable); }
    }

    private static boolean validQuickText(String value) {
        if (value.length() > 2000) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isISOControl(c) && c != '\n' && c != '\r' && c != '\t') return false;
        }
        return true;
    }

    private static void replyError(OutputStream out, int status, String error) throws IOException {
        reply(out, status, "application/json", ("{\"ok\":false,\"error\":\"" + error + "\"}").getBytes(StandardCharsets.US_ASCII));
    }

    private void exchangeSettings(long session, String payload, OutputStream out) throws IOException {
        SettingsRequest request;
        synchronized (this) {
            if (current(session) && inFlight == null) {
                request = new SettingsRequest(session, platform.now() + REQUEST_MS, payload);
                inFlight = request;
                platform.post(() -> { if (activeRequest(request.id)) host.settings(session, request.id, payload != null); });
            } else request = null;
        }
        if (request == null) { replyError(out, 503, "busy"); return; }
        try {
            // Only this socket worker waits. D-pad commands can proceed on another worker.
            String result = request.result.get(REQUEST_MS, TimeUnit.MILLISECONDS);
            if (!current(session)) { replyError(out, 403, "expired"); return; }
            byte[] bytes = result.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > SETTINGS_BYTES * 2) { replyError(out, 503, "size"); return; }
            int status = platform.responseStatus(result);
            if (payload != null && status == 200) {
                platform.post(() -> { if (current(session)) host.settingsSaved(session); });
            }
            reply(out, status, "application/json; charset=utf-8", bytes);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } catch (ExecutionException | TimeoutException | CancellationException interrupted) {
            replyError(out, 503, "unavailable");
        } finally {
            synchronized (this) { if (request == inFlight) inFlight = null; }
        }
    }

    synchronized boolean activeRequest(String id) {
        return inFlight != null && inFlight.id.equals(id) && !inFlight.result.isDone()
                && platform.now() < inFlight.deadline && current(inFlight.session);
    }
    synchronized String claimRequest(String id) {
        if (!activeRequest(id) || inFlight.claimed) return null;
        inFlight.claimed = true;
        return inFlight.payload == null ? "" : inFlight.payload;
    }
    synchronized void finishRequest(String id, String json) {
        if (activeRequest(id)) {
            inFlight.result.complete(json == null || json.length() > SETTINGS_BYTES * 2
                    ? "{\"ok\":false,\"error\":\"unavailable\"}" : json);
        }
    }
    private synchronized boolean allowCommand(long session) {
        return current(session) && approval.takeCommand(platform.now());
    }
    private synchronized void dispatch(long session, Runnable command) throws IOException {
        if (!current(session) || pendingCommands >= 32) throw new IOException("command queue unavailable");
        pendingCommands++;
        platform.post(() -> {
            synchronized (LocalPhoneServer.this) {
                if (session != sessionGeneration) return;
                pendingCommands--;
                if (current(session)) command.run();
            }
        });
    }
    private static void reply(OutputStream out, int status, String type, byte[] body) throws IOException {
        reply(out, status, type, body, "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    }
    private static void reply(OutputStream out, int status, String type, byte[] body, String policy) throws IOException {
        String header = "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : status == 202 ? "Accepted" : "Error") + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length
                + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: " + policy + "\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.US_ASCII)); out.write(body); out.flush();
    }
    synchronized void stop() {
        running = false; sessionGeneration++; expires = 0; token = ""; address = ""; approval = null;
        platform.clearPending(); pendingCommands = 0;
        if (server != null) try { server.close(); } catch (IOException ignored) { }
        if (inFlight != null) { inFlight.result.cancel(false); inFlight = null; }
        if (clients != null) clients.shutdownNow();
        server = null; clients = null; authority = "";
        for (Socket socket : sockets) try { socket.close(); } catch (IOException ignored) { }
        sockets.clear();
    }
}
