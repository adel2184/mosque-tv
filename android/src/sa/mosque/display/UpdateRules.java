package sa.mosque.display;

import java.net.URI;
import java.security.MessageDigest;
import java.util.Arrays;

/** Small Android-free policy surface, also exercised by the host-JDK tests. */
public final class UpdateRules {
    public static final long HARD_MAX_APK = 32L * 1024 * 1024;
    private UpdateRules() { }
    public static boolean validRepository(String owner, String repo) {
        return owner != null && repo != null && owner.matches("[A-Za-z0-9][A-Za-z0-9-]{0,38}")
                && repo.matches("[A-Za-z0-9_.-]{1,100}") && !repo.equals(".") && !repo.equals("..");
    }
    public static boolean safeAssetName(String name) {
        return name != null && name.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,150}");
    }
    public static boolean allowedTransport(String value) {
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null
                    || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getRawFragment() != null) return false;
            String host = uri.getHost();
            return "api.github.com".equalsIgnoreCase(host) || "github.com".equalsIgnoreCase(host)
                    || "release-assets.githubusercontent.com".equalsIgnoreCase(host)
                    || "objects.githubusercontent.com".equalsIgnoreCase(host);
        } catch (Exception ignored) { return false; }
    }
    public static boolean repoAsset(String value, String owner, String repo, String tag, String asset) {
        if (!validRepository(owner, repo) || !safeAssetName(asset) || tag == null || tag.isEmpty()) return false;
        try {
            URI uri = new URI(value);
            String expected = "/" + owner + "/" + repo + "/releases/download/" + tag + "/" + asset;
            return allowedTransport(value) && "github.com".equalsIgnoreCase(uri.getHost())
                    && uri.getRawQuery() == null && expected.equals(uri.getPath());
        } catch (Exception ignored) { return false; }
    }
    public static boolean allowedRedirect(String original, String next) {
        if (!allowedTransport(next)) return false;
        try {
            String host = new URI(next).getHost();
            return host.equalsIgnoreCase("release-assets.githubusercontent.com")
                    || host.equalsIgnoreCase("objects.githubusercontent.com") || original.equals(next);
        } catch (Exception ignored) { return false; }
    }
    public static boolean eligible(long installed, long offered, int minSdk, int deviceSdk, long size, long max) {
        return installed > 0 && offered > installed && offered <= Integer.MAX_VALUE && minSdk >= 24
                && minSdk <= deviceSdk && size > 0 && size <= max && max > 0 && max <= HARD_MAX_APK;
    }
    public static String hex(byte[] data) {
        StringBuilder out = new StringBuilder(data.length * 2);
        for (byte b : data) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    public static boolean sha256(String value) { return value != null && value.matches("[a-fA-F0-9]{64}"); }
    public static boolean sameSigners(byte[][] current, byte[][] candidate) {
        if (current == null || candidate == null || current.length == 0 || current.length != candidate.length) return false;
        try {
            String[] a = new String[current.length], b = new String[candidate.length];
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            for (int i=0;i<a.length;i++) { a[i]=hex(hash.digest(current[i])); b[i]=hex(hash.digest(candidate[i])); }
            Arrays.sort(a); Arrays.sort(b); return Arrays.equals(a,b);
        } catch (Exception ignored) { return false; }
    }
}
