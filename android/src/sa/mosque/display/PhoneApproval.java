package sa.mosque.display;

/** Single-use enrollment for one phone. Its owner serializes access and supplies elapsed time. */
final class PhoneApproval {
    static final long SCAN_MS = 120_000L, CONFIRM_MS = 60_000L;
    static final long FAILURE_WINDOW_MS = 30_000L;
    static final int FAILURE_LIMIT = 8, MAX_FAILURE_PEERS = 32;
    final String code;
    private long deadline;
    private long commandWindow;
    private int commandCount;
    private String clientId, peerAddress;
    private boolean approved;
    private long failureWindow;
    private final java.util.HashMap<String,Integer> failedPeers = new java.util.HashMap<>();

    PhoneApproval(long now, String code) {
        this.deadline = now + SCAN_MS;
        this.failureWindow = now;
        this.code = code;
    }

    boolean expired(long now) { return !approved && now >= deadline; }
    boolean waiting() { return clientId != null && !approved; }

    boolean request(String id, String address, long now) {
        if (clientId != null || expired(now) || !validId(id)) return false;
        clientId = id;
        peerAddress = address;
        deadline = now + CONFIRM_MS;
        return true;
    }

    boolean approve(long now) {
        if (!waiting() || expired(now)) return false;
        approved = true;
        return true;
    }

    boolean matches(String id, String address) {
        return clientId != null && clientId.equals(id) && peerAddress.equals(address);
    }

    boolean authorized(String id, String address) {
        return approved && matches(id, address);
    }
    private String failureBucket(String address, long now) {
        if (now - failureWindow >= FAILURE_WINDOW_MS) {
            failedPeers.clear();
            failureWindow = now;
        }
        // Bound memory for the full session; additional addresses share one bucket.
        return failedPeers.size() < MAX_FAILURE_PEERS || failedPeers.containsKey(address) ? address : "";
    }
    boolean authenticationAllowed(String address, long now) {
        return failedPeers.getOrDefault(failureBucket(address, now), 0) < FAILURE_LIMIT;
    }
    void authenticationFailed(String address, long now) {
        String bucket = failureBucket(address, now);
        int failures = failedPeers.getOrDefault(bucket, 0);
        if (failures < FAILURE_LIMIT) failedPeers.put(bucket, failures + 1);
    }
    boolean takeCommand(long now) {
        if (!approved) return false;
        if (now - commandWindow >= 1000) {
            commandWindow = now;
            commandCount = 0;
        }
        if (commandCount >= 12) return false;
        commandCount++;
        return true;
    }

    private static boolean validId(String value) {
        if (value == null || value.length() != 32) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (!(c >= '0' && c <= '9' || c >= 'a' && c <= 'f')) return false;
        }
        return true;
    }
}
