package sa.mosque.display;

/** Android-free 24-hour, end-exclusive local display schedule. */
final class PowerRules {
    private PowerRules() { }
    static int minute(String value) {
        if (value == null || !value.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) return -1;
        return Integer.parseInt(value.substring(0,2))*60+Integer.parseInt(value.substring(3));
    }
    static boolean within(int minute, int start, int end) {
        if(minute<0||minute>=1440||start<0||start>=1440||end<0||end>=1440||start==end)return false;
        return start<end ? minute>=start&&minute<end : minute>=start||minute<end;
    }
}
