package sa.mosque.display;

public final class UpdateRulesTest {
    private static int count;
    private static void check(boolean value, String name) { count++; if (!value) throw new AssertionError(name); }
    public static void main(String[] args) {
        String base = "https://github.com/mosque-owner/mosque-display/releases/download/v2.1/";
        check(UpdateRules.validRepository("mosque-owner", "mosque-display"), "repository");
        check(!UpdateRules.validRepository("owner/evil", "repo"), "path owner");
        check(!UpdateRules.validRepository("owner", ".."), "dot repo");
        check(UpdateRules.repoAsset(base+"app.apk", "mosque-owner", "mosque-display", "v2.1", "app.apk"), "bound asset");
        check(!UpdateRules.repoAsset(base+"app.apk", "another", "mosque-display", "v2.1", "app.apk"), "wrong owner");
        check(!UpdateRules.repoAsset(base+"app.apk", "mosque-owner", "other", "v2.1", "app.apk"), "wrong repo");
        check(!UpdateRules.repoAsset(base+"app.apk", "mosque-owner", "mosque-display", "v3", "app.apk"), "wrong release");
        check(!UpdateRules.repoAsset(base+"app.apk?x=1", "mosque-owner", "mosque-display", "v2.1", "app.apk"), "query");
        check(!UpdateRules.allowedTransport("http://github.com/a"), "no http");
        check(!UpdateRules.allowedTransport("https://github.com.attacker.example/a"), "suffix trick");
        check(!UpdateRules.allowedTransport("https://evil@github.com/a"), "credentials");
        check(!UpdateRules.allowedTransport("https://github.com:8443/a"), "port");
        check(!UpdateRules.allowedTransport("https://github.com/a#part"), "fragment");
        check(UpdateRules.allowedRedirect(base+"app.apk", "https://release-assets.githubusercontent.com/a?sig=x"), "official CDN");
        check(!UpdateRules.allowedRedirect(base+"app.apk", "https://github.com/other/repo/releases/download/v2.1/app.apk"), "cross repo redirect");
        check(!UpdateRules.allowedRedirect(base+"app.apk", "https://example.com/app.apk"), "other redirect");
        check(UpdateRules.eligible(3,4,24,35,100,UpdateRules.HARD_MAX_APK), "eligible");
        check(!UpdateRules.eligible(3,3,24,35,100,UpdateRules.HARD_MAX_APK), "same code");
        check(!UpdateRules.eligible(3,2,24,35,100,UpdateRules.HARD_MAX_APK), "downgrade");
        check(!UpdateRules.eligible(3,4,36,35,100,UpdateRules.HARD_MAX_APK), "SDK");
        check(!UpdateRules.eligible(3,4,24,35,0,UpdateRules.HARD_MAX_APK), "empty");
        check(!UpdateRules.eligible(3,4,24,35,UpdateRules.HARD_MAX_APK+1,UpdateRules.HARD_MAX_APK), "oversize");
        check(!UpdateRules.eligible(3,4,24,35,100,UpdateRules.HARD_MAX_APK+1), "oversize configured limit");
        check(UpdateRules.sameSigners(new byte[][]{{1,2}},new byte[][]{{1,2}}), "same cert");
        check(!UpdateRules.sameSigners(new byte[][]{{1,2}},new byte[][]{{2,3}}), "foreign cert");
        check(!UpdateRules.sameSigners(new byte[0][],new byte[0][]), "empty cert");
        check(UpdateRules.sameSigners(new byte[][]{{1},{2}},new byte[][]{{2},{1}}), "signer order");
        check(!UpdateRules.safeAssetName("../evil.apk"), "asset traversal");
        check(UpdateRules.sha256("a".repeat(64)), "hash format");
        check(!UpdateRules.sha256("a".repeat(63)), "short hash");
        System.out.println("PASS " + count + " updater policy checks");
    }
}
