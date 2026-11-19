package sa.mosque.display;

/** Single-use enrollment for one phone. Its owner serializes access and supplies elapsed time. */
final class PhoneApproval {
    static final long SCAN_MS = 120_000L, CONFIRM_MS = 60_000L;
    final String code;
    private long deadline;
    private long commandWindow;
    private int commandCount;
    private String clientId, peerAddress;
    private boolean approved;

    PhoneApproval(long now, String code) {
        this.deadline = now + SCAN_MS;
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
