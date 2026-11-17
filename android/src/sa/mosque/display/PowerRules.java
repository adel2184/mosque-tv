package sa.mosque.display;

import java.util.Arrays;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;
import java.util.TimeZone;

/** Android-free 24-hour, end-exclusive local display schedule. */
final class PowerRules {
    private static final Set<String> ZONES = new HashSet<>(Arrays.asList(TimeZone.getAvailableIDs()));
    private PowerRules() { }
    static boolean timezone(String zone) {
        return zone != null && zone.length() <= 100
                && zone.matches("(?:UTC|GMT|[A-Za-z_]+(?:/[A-Za-z0-9_+.\\-]+)+)")
                && ZONES.contains(zone);
    }
    static int localMinute(long epochMillis, String zone) {
        if (!timezone(zone)) throw new IllegalArgumentException("Unsupported IANA time zone");
        Calendar clock = Calendar.getInstance(TimeZone.getTimeZone(zone));
        clock.setTimeInMillis(epochMillis);
        return clock.get(Calendar.HOUR_OF_DAY) * 60 + clock.get(Calendar.MINUTE);
    }
    static int minute(String value) {
        if (value == null || !value.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) return -1;
        return Integer.parseInt(value.substring(0,2))*60+Integer.parseInt(value.substring(3));
    }
    static boolean within(int minute, int start, int end) {
        if(minute<0||minute>=1440||start<0||start>=1440||end<0||end>=1440||start==end)return false;
        return start<end ? minute>=start&&minute<end : minute>=start||minute<end;
    }
}
