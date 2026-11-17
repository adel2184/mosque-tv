package sa.mosque.display;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/** Original Android-free request policy and bounded reader, exercised against loopback HTTP in tests. */
final class SetupFetchHttp {
    static final int RESPONSE_LIMIT=300*1024,TOTAL_LIMIT=3*1024*1024,PAYLOAD_LIMIT=900*1024;
    static final long OVERALL_NANOS=150_000_000_000L;
    private static final Set<String> ZONES=new HashSet<>(Arrays.asList(TimeZone.getAvailableIDs()));
    interface Cancellation { boolean cancelled(); }
    private SetupFetchHttp() { }
    static boolean coordinates(double latitude,double longitude) {
        return !Double.isNaN(latitude)&&!Double.isInfinite(latitude)&&latitude>=-89&&latitude<=89
                &&!Double.isNaN(longitude)&&!Double.isInfinite(longitude)&&longitude>=-180&&longitude<=180;
    }
    static boolean timezone(String zone) {
        return zone!=null&&zone.length()<=100&&zone.matches("(?:UTC|GMT|[A-Za-z_]+(?:/[A-Za-z0-9_+.\\-]+)+)")&&ZONES.contains(zone);
    }
    static boolean method(String method) { return Arrays.asList("UmmAlQura","MuslimWorldLeague","Egyptian","NorthAmerica","Karachi").contains(method); }
    static boolean year(int year) { return year>=2000&&year<=2075; }
    static String query(double latitude,double longitude,String zone,String method) throws IOException {
        if(!coordinates(latitude,longitude)||!timezone(zone)||!method(method))throw new IOException("invalid profile");
        return "lat="+Double.toString(latitude)+"&lng="+Double.toString(longitude)+"&timezone="+URLEncoder.encode(zone,"UTF-8")
                +"&method="+URLEncoder.encode(method,"UTF-8")+"&madhab=Shafi";
    }
    static String monthUrl(double latitude,double longitude,String zone,String method,int year,int month) throws IOException {
        if(year<2000||year>2076||month<1||month>12)throw new IOException("invalid month");
        return "https://ummahapi.com/api/prayer-times/month?"+query(latitude,longitude,zone,method)+"&year="+year+"&month="+month;
    }
    static String dayUrl(double latitude,double longitude,String zone,String method,String date) throws IOException {
        if(date==null||!date.matches("(?:1999|20[0-7][0-9])-(?:12-31|01-01)"))throw new IOException("invalid guard date");
        return "https://ummahapi.com/api/prayer-times?"+query(latitude,longitude,zone,method)+"&date="+date;
    }
    private static void check(long deadline,Cancellation cancel) throws InterruptedIOException {
        if(cancel.cancelled()||Thread.currentThread().isInterrupted())throw new InterruptedIOException("cancelled");
        if(System.nanoTime()>=deadline)throw new InterruptedIOException("deadline");
    }
    static byte[] read(HttpURLConnection connection,int remaining,long deadline,Cancellation cancel) throws IOException {
        int maximum=Math.min(RESPONSE_LIMIT,remaining);
        if(maximum<=0)throw new IOException("total size limit");
        try {
            check(deadline,cancel);
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(12000);
            connection.setRequestMethod("GET");connection.setUseCaches(false);
            connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Accept-Encoding","identity");
            connection.setRequestProperty("Cache-Control","no-store");connection.setRequestProperty("Cookie","");connection.setRequestProperty("Cookie2","");
            connection.setRequestProperty("User-Agent","MosqueDisplay-SetupTimetable/1");
            if(connection.getResponseCode()!=200)throw new IOException("HTTP status");
            String contentType=connection.getContentType();
            if(contentType==null||!"application/json".equals(contentType.split(";",2)[0].trim().toLowerCase(Locale.ROOT)))throw new IOException("not JSON");
            long declared=connection.getContentLengthLong();if(declared>maximum)throw new IOException("response size limit");
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int count;
                while(true){
                    check(deadline,cancel);long left=Math.max(1,(deadline-System.nanoTime())/1_000_000);
                    connection.setReadTimeout((int)Math.min(12000,left));
                    count=input.read(buffer);if(count<0)break;
                    if(output.size()+count>maximum)throw new IOException("response size limit");
                    output.write(buffer,0,count);
                }
                check(deadline,cancel);
                if(declared>=0&&declared!=output.size())throw new IOException("truncated response");
                return output.toByteArray();
            }
        } finally { connection.disconnect(); }
    }
    static String jsonText(byte[] bytes) throws IOException {
        String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString().trim();
        if(!text.startsWith("{")||!text.endsWith("}"))throw new IOException("not an object");
        int depth=0;boolean quoted=false,escape=false;
        for(int i=0;i<text.length();i++){
            char c=text.charAt(i);if(c==0)throw new IOException("zero character");
            if(quoted){if(escape)escape=false;else if(c=='\\')escape=true;else if(c=='"')quoted=false;continue;}
            if(c=='"')quoted=true;else if(c=='{'||c=='['){if(++depth>32)throw new IOException("JSON depth");}
            else if(c=='}'||c==']'){if(--depth<0)throw new IOException("JSON depth");}
        }
        if(quoted||depth!=0)throw new IOException("JSON structure");
        return text;
    }
}
