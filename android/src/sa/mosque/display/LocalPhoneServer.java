package sa.mosque.display;

import android.content.Context;
import android.os.SystemClock;
import java.io.*;
import java.net.*;
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
    }
    private final Context context;
    private final Host host;
    private ServerSocket server;
    private Thread acceptor;
    private ThreadPoolExecutor clients;
    private PhoneApproval approval;
    private volatile long expires;
    private String token = "", authority = "", address = "";
    private volatile boolean running;
    private volatile long sessionGeneration;
    private final java.util.Set<Socket> sockets = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private final java.util.concurrent.atomic.AtomicInteger pendingCommands = new java.util.concurrent.atomic.AtomicInteger();
    LocalPhoneServer(Context context, Host host) { this.context = context.getApplicationContext(); this.host = host; }
    synchronized String start() throws IOException {
        stop();
        String ip = localAddress();
        if (ip.isEmpty()) throw new IOException("لا توجد شبكة محلية. صِل التلفاز والجوال بشبكة واحدة؛ لا يلزم اتصال الإنترنت.");
        SecureRandom source = new SecureRandom();
        byte[] random = new byte[24]; source.nextBytes(random);
        StringBuilder secret = new StringBuilder(); for (byte b : random) secret.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        token = secret.toString();
        long now = SystemClock.elapsedRealtime();
        expires = now + 15 * 60_000L;
        approval = new PhoneApproval(now, String.format(java.util.Locale.ROOT, "%06d", source.nextInt(1_000_000)));
        server = new ServerSocket(); server.setReuseAddress(true); server.bind(new InetSocketAddress(InetAddress.getByName(ip), 0), 4); server.setSoTimeout(1000);
        authority = ip + ":" + server.getLocalPort(); address = "http://" + authority + "/#" + token;
        clients = new ThreadPoolExecutor(1, 2, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<Runnable>(4));
        running = true;
        final ServerSocket listening = server;
        final long session = sessionGeneration;
        final ThreadPoolExecutor pool = clients;
        acceptor = new Thread(() -> {
            while (current(session)) {
                try {
                    Socket socket = listening.accept();
                    if (!socket.getInetAddress().isSiteLocalAddress()) { socket.close(); continue; }
                    sockets.add(socket);
                    try { pool.execute(() -> serve(socket, session)); } catch (RejectedExecutionException error) { sockets.remove(socket); socket.close(); }
                } catch (SocketTimeoutException ignored) { } catch (IOException error) { break; }
            }
            try { listening.close(); } catch (IOException ignored) { }
            synchronized (LocalPhoneServer.this) {
                if (session == sessionGeneration) {
                    stop();
                    main.post(() -> host.pairingExpired(session));
                }
            }
        }, "mosque-local-remote"); acceptor.setDaemon(true); acceptor.start();
        return address;
    }
    long session() { return sessionGeneration; }
    private synchronized boolean current(long session) {
        long now = SystemClock.elapsedRealtime();
        return running && session == sessionGeneration && now < expires && !approval.expired(now);
    }
    synchronized void stop(long session) { if (session == sessionGeneration) stop(); }
    synchronized boolean waiting(long session) { return current(session) && approval.waiting(); }
    synchronized boolean approve(long session) {
        return current(session) && approval.approve(SystemClock.elapsedRealtime());
    }
    private synchronized boolean authorized(long session, String clientId, String peer) {
        return current(session) && approval.authorized(clientId, peer);
    }
    private synchronized String phoneStatus(long session, String clientId, String peer) {
        if (!current(session)) return null;
        if (approval.request(clientId, peer, SystemClock.elapsedRealtime())) {
            String code = approval.code;
            main.post(() -> { if (waiting(session)) host.confirmPhone(session, code); });
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
    private static String line(InputStream in, long deadline) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int i = 0; i < 4096; i++) { if (SystemClock.elapsedRealtime() > deadline) throw new IOException("deadline"); int b = in.read(); if (b == -1) throw new EOFException(); if (b == 10) return new String(bytes.toByteArray(), StandardCharsets.US_ASCII).trim(); bytes.write(b); }
        throw new IOException("line too long");
    }
    private void serve(Socket socket, long session) {
        try (Socket client = socket) {
            client.setSoTimeout(3000);
            InputStream in = new BufferedInputStream(client.getInputStream()); OutputStream out = client.getOutputStream();
            long deadline = SystemClock.elapsedRealtime() + 10000;
            String[] first = line(in, deadline).split(" ");
            if (first.length != 3 || !"HTTP/1.1".equals(first[2])) { reply(out, 400, "text/plain", "طلب غير صالح".getBytes(StandardCharsets.UTF_8)); return; }
            String auth = "", clientId = "", origin = "", hostname = "", contentType = ""; int size = 0, total = 0;
            boolean headersComplete = false;
            for (int i = 0; i < 40; i++) {
                String value = line(in, deadline); total += value.length(); if (total > 8192) throw new IOException("headers too large");
                if (value.isEmpty()) { headersComplete = true; break; }
                int colon = value.indexOf(':'); if (colon < 1) throw new IOException("header");
                String key = value.substring(0, colon).toLowerCase(java.util.Locale.ROOT), content = value.substring(colon + 1).trim();
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
                try (InputStream page = context.getAssets().open("phone.html")) { ByteArrayOutputStream body = new ByteArrayOutputStream(); byte[] b = new byte[4096]; int n; while ((n = page.read(b)) != -1) { body.write(b, 0, n); if (body.size() > 64 * 1024) throw new IOException("page"); } reply(out, 200, "text/html; charset=utf-8", body.toByteArray()); }
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
            if (!"POST".equals(first[0]) || size < 2 || size > 12000 || !contentType.startsWith("application/json")) { reply(out, 400, "application/json", new byte[0]); return; }
            byte[] payload = new byte[size]; int read = 0; while (read < size) { if(SystemClock.elapsedRealtime()>deadline)throw new IOException("deadline"); int n = in.read(payload, read, size - read); if (n == -1) throw new EOFException(); read += n; }
            if (!current(session)) { reply(out, 403, "application/json", new byte[0]); return; }
            String field = "/api/key".equals(route) ? "key" : "/api/text".equals(route) ? "text" : null;
            if (field == null) { reply(out, 404, "application/json", new byte[0]); return; }
            String value;
            try (android.util.JsonReader reader = new android.util.JsonReader(
                    new InputStreamReader(new ByteArrayInputStream(payload), StandardCharsets.UTF_8))) {
                reader.beginObject();
                if (!field.equals(reader.nextName()) || reader.peek() != android.util.JsonToken.STRING)
                    throw new IOException("Invalid command");
                value = reader.nextString();
                reader.endObject();
                if (reader.peek() != android.util.JsonToken.END_DOCUMENT) throw new IOException("Trailing command");
            }
            if (!allowCommand(session)) { reply(out, 429, "application/json", new byte[0]); return; }
            if ("/api/key".equals(route)) { String key = value; if (!key.matches("up|down|left|right|ok|back|menu")) throw new IOException("key"); dispatch(session, () -> host.key(key)); }
            else if ("/api/text".equals(route)) { String text = value; if (text.length() > 2000) throw new IOException("text"); dispatch(session, () -> host.text(text)); }
            else { reply(out, 404, "application/json", new byte[0]); return; }
            reply(out, 200, "application/json", "{\"ok\":true}".getBytes(StandardCharsets.US_ASCII));
        } catch (Exception ignored) { } finally { sockets.remove(socket); }
    }
    private synchronized boolean allowCommand(long session) {
        return current(session) && approval.takeCommand(SystemClock.elapsedRealtime());
    }
    private void dispatch(long session, Runnable command) throws IOException {
        if (pendingCommands.incrementAndGet() > 32) { pendingCommands.decrementAndGet(); throw new IOException("command queue full"); }
        main.post(() -> {
            try {
                synchronized (LocalPhoneServer.this) {
                    if (current(session)) command.run();
                }
            } finally { pendingCommands.decrementAndGet(); }
        });
    }
    private static void reply(OutputStream out, int status, String type, byte[] body) throws IOException {
        String header = "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : status == 202 ? "Accepted" : "Error") + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length
                + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.US_ASCII)); out.write(body); out.flush();
    }
    synchronized void stop() {
        running = false; sessionGeneration++; expires = 0; token = ""; address = ""; approval = null;
        if (server != null) try { server.close(); } catch (IOException ignored) { }
        if (clients != null) clients.shutdownNow();
        for (Socket socket : sockets) try { socket.close(); } catch (IOException ignored) { }
        sockets.clear();
    }
}
