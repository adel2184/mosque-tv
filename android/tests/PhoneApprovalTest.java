package sa.mosque.display;

public final class PhoneApprovalTest {
    private static int checks;
    private static void check(boolean ok) {
        checks++;
        if (!ok) throw new AssertionError("Phone approval check " + checks);
    }
    public static void main(String[] args) {
        String operator = "0123456789abcdef0123456789abcdef";
        String other = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        PhoneApproval session = new PhoneApproval(0, "012345");
        check(!session.approve(1));
        check(!session.request("short", "first", 1));
        check(!session.request("0123456789ABCDEF0123456789ABCDEF", "first", 1));
        check(session.request(operator, "first", 2));
        check(session.waiting() && session.matches(operator, "first"));
        check(!session.request(other, "second", 3));
        check(!session.authorized(operator, "first") && !session.takeCommand(3));
        check(session.approve(4) && !session.waiting());
        check(!session.approve(5));
        check(session.authorized(operator, "first"));
        check(!session.authorized(other, "first") && !session.authorized(operator, "second"));
        for (int i = 0; i < 12; i++) check(session.takeCommand(10));
        check(!session.takeCommand(11));
        check(session.takeCommand(1_010));
        check(!session.expired(1_000_000)); // The server separately enforces the full session limit.

        PhoneApproval timeout = new PhoneApproval(100, "654321");
        check(timeout.request(operator, "first", 100 + PhoneApproval.SCAN_MS - 1));
        long deadline = 100 + PhoneApproval.SCAN_MS - 1 + PhoneApproval.CONFIRM_MS;
        check(!timeout.expired(deadline - 1));
        check(timeout.expired(deadline) && !timeout.approve(deadline));
        check(!timeout.request(other, "second", deadline));
        PhoneApproval unopened = new PhoneApproval(100, "654321");
        check(!unopened.request(operator, "first", 100 + PhoneApproval.SCAN_MS));
        PhoneApproval budget = new PhoneApproval(500, "123456");
        for (int i = 0; i < PhoneApproval.FAILURE_LIMIT; i++) {
            check(budget.authenticationAllowed("first", 501));
            budget.authenticationFailed("first", 501);
        }
        check(!budget.authenticationAllowed("first", 502));
        check(budget.authenticationAllowed("second", 502));
        check(!budget.authenticationAllowed("first", 499 + PhoneApproval.FAILURE_WINDOW_MS));
        check(budget.authenticationAllowed("first", 500 + PhoneApproval.FAILURE_WINDOW_MS));
        for (int i = 0; i < PhoneApproval.MAX_FAILURE_PEERS; i++) budget.authenticationFailed("peer-" + i, 31_000L);
        for (int i = 0; i < PhoneApproval.FAILURE_LIMIT; i++) budget.authenticationFailed("additional-" + i, 31_001L);
        check(!budget.authenticationAllowed("unknown", 31_002L));
        check(budget.authenticationAllowed("peer-1", 31_002L));
        System.out.println("PASS " + checks + " phone enrollment and command budget checks");
    }
}
