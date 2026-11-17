package sa.mosque.display;

import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;

/** Original bounded transfer engine. Android-free so real HTTP failure cases can be tested locally. */
final class NetworkSpeedProbe {
    static final int BYTES = 5_000_000, TIMEOUT_MS = 8000;
    static final long OVERALL_NANOS = 30_000_000_000L;
    static final String ENDPOINT = "https://speed.cloudflare.com/__down?bytes=5000000";
    interface Cancellation { boolean cancelled(); }
    static final class Result {
        final long bytes, elapsedNanos;
        final double mbps;
        Result(long bytes, long elapsedNanos) {
            this.bytes = bytes; this.elapsedNanos = Math.max(1, elapsedNanos);
            mbps = bytes * 8000.0 / this.elapsedNanos;
        }
    }
    private NetworkSpeedProbe() { }
    private static void check(long deadline, Cancellation cancellation) throws InterruptedIOException {
        if (cancellation.cancelled() || Thread.currentThread().isInterrupted()) throw new InterruptedIOException("cancelled");
        if (System.nanoTime() >= deadline) throw new InterruptedIOException("deadline");
    }
    static Result measure(HttpURLConnection connection, long deadline, Cancellation cancellation) throws IOException {
        try {
            check(deadline, cancellation);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(TIMEOUT_MS); connection.setReadTimeout(TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Cache-Control", "no-store");
            connection.setRequestProperty("Cookie", "");
            connection.setRequestProperty("Cookie2", "");
            connection.setRequestProperty("User-Agent", "MosqueDisplay-SpeedSample/1");
            if (connection.getResponseCode() != 200) throw new IOException("HTTP response");
            check(deadline, cancellation);
            long declared = connection.getContentLengthLong();
            if (declared >= 0 && declared != BYTES) throw new IOException("unexpected size");
            long received = 0, start = System.nanoTime();
            byte[] buffer = new byte[32 * 1024];
            try (InputStream input = connection.getInputStream()) {
                while (received < BYTES) {
                    check(deadline, cancellation);
                    long left = Math.max(1, (deadline - System.nanoTime()) / 1_000_000);
                    connection.setReadTimeout((int) Math.min(TIMEOUT_MS, left));
                    int count = input.read(buffer, 0, (int) Math.min(buffer.length, BYTES - received));
                    if (count < 0) throw new IOException("truncated transfer");
                    received += count;
                }
            }
            check(deadline, cancellation);
            return new Result(received, System.nanoTime() - start);
        } finally { connection.disconnect(); }
    }
}
