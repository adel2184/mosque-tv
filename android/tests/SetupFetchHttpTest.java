package sa.mosque.display;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

public final class SetupFetchHttpTest {
    static int checks;
    static void check(boolean value,String name){checks++;if(!value)throw new AssertionError(name);}
    static HttpURLConnection connection(String base,String route)throws Exception{return(HttpURLConnection)new URL(base+route).openConnection();}
    static void reject(String base,String route,int budget,long deadline,SetupFetchHttp.Cancellation cancel)throws Exception{
        boolean failed=false;try{SetupFetchHttp.read(connection(base,route),budget,deadline,cancel);}catch(IOException expected){failed=true;}check(failed,"reject "+route);
    }
    static void jsonReject(byte[] bytes,String name)throws Exception{boolean failed=false;try{SetupFetchHttp.jsonText(bytes);}catch(IOException expected){failed=true;}check(failed,name);}
    public static void main(String[] args)throws Exception{
        AtomicInteger targetCalls=new AtomicInteger(),requests=new AtomicInteger();AtomicBoolean noHeaders=new AtomicBoolean();
        byte[] good="{\"success\":true,\"data\":{\"name\":\"الدمام\"}}".getBytes(StandardCharsets.UTF_8);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);ExecutorService pool=Executors.newCachedThreadPool();server.setExecutor(pool);
        server.createContext("/good",exchange->{requests.incrementAndGet();noHeaders.set((exchange.getRequestHeaders().getFirst("Cookie")==null||exchange.getRequestHeaders().getFirst("Cookie").isEmpty())&&exchange.getRequestHeaders().getFirst("Referer")==null);exchange.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");exchange.sendResponseHeaders(200,good.length);try(OutputStream out=exchange.getResponseBody()){out.write(good);}finally{exchange.close();}});
        server.createContext("/redirect",exchange->{exchange.getResponseHeaders().set("Location","/target");exchange.sendResponseHeaders(302,-1);exchange.close();});
        server.createContext("/target",exchange->{targetCalls.incrementAndGet();exchange.sendResponseHeaders(200,-1);exchange.close();});
        server.createContext("/html",exchange->{exchange.getResponseHeaders().set("Content-Type","text/html");exchange.sendResponseHeaders(200,2);try(OutputStream out=exchange.getResponseBody()){out.write("{}".getBytes());}finally{exchange.close();}});
        server.createContext("/large",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,SetupFetchHttp.RESPONSE_LIMIT+1);exchange.close();});
        server.createContext("/chunked",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,0);try(OutputStream out=exchange.getResponseBody()){out.write(new byte[2000]);}finally{exchange.close();}});
        server.createContext("/short",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,200);try(OutputStream out=exchange.getResponseBody()){out.write(new byte[10]);}catch(IOException ignored){}finally{exchange.close();}});
        server.createContext("/429",exchange->{exchange.sendResponseHeaders(429,-1);exchange.close();});
        server.createContext("/slow",exchange->{exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,0);try(OutputStream out=exchange.getResponseBody()){out.write(123);out.flush();try{Thread.sleep(500);}catch(InterruptedException ignored){}}finally{exchange.close();}});
        server.start();String base="http://127.0.0.1:"+server.getAddress().getPort();
        try{
            byte[] result=SetupFetchHttp.read(connection(base,"/good"),SetupFetchHttp.TOTAL_LIMIT,System.nanoTime()+3_000_000_000L,()->false);
            check(java.util.Arrays.equals(result,good),"exact Unicode response");check(noHeaders.get(),"no cookies/referrer");check(SetupFetchHttp.jsonText(result).contains("الدمام"),"UTF8 JSON preserved");
            reject(base,"/redirect",SetupFetchHttp.TOTAL_LIMIT,System.nanoTime()+2_000_000_000L,()->false);check(targetCalls.get()==0,"no redirect request");
            reject(base,"/html",SetupFetchHttp.TOTAL_LIMIT,System.nanoTime()+2_000_000_000L,()->false);
            reject(base,"/large",SetupFetchHttp.TOTAL_LIMIT,System.nanoTime()+2_000_000_000L,()->false);
            reject(base,"/chunked",1000,System.nanoTime()+2_000_000_000L,()->false);
            reject(base,"/short",SetupFetchHttp.TOTAL_LIMIT,System.nanoTime()+2_000_000_000L,()->false);
            reject(base,"/429",SetupFetchHttp.TOTAL_LIMIT,System.nanoTime()+2_000_000_000L,()->false);
            int before=requests.get();reject(base,"/good",SetupFetchHttp.TOTAL_LIMIT,System.nanoTime()+2_000_000_000L,()->true);check(requests.get()==before,"cancel before network");
            reject(base,"/good",10,System.nanoTime()+2_000_000_000L,()->false);
            long started=System.nanoTime();reject(base,"/slow",SetupFetchHttp.TOTAL_LIMIT,started+120_000_000L,()->false);check(System.nanoTime()-started<2_000_000_000L,"bounded deadline");
            jsonReject("<html>bad</html>".getBytes(),"no HTML objects");jsonReject("[]".getBytes(),"no root arrays");
            jsonReject(new byte[]{123,34,120,34,58,34,(byte)0xc3,40,34,125},"malformed UTF8");
            jsonReject("{\"x\":\"\u0000\"}".getBytes(StandardCharsets.UTF_8),"no NUL");
            jsonReject(("{\"x\":"+"[".repeat(33)+"0"+"]".repeat(33)+"}").getBytes(),"bounded depth");
            check(SetupFetchHttp.coordinates(0,0)&&SetupFetchHttp.coordinates(-89,180),"valid coordinates");
            check(!SetupFetchHttp.coordinates(Double.NaN,0)&&!SetupFetchHttp.coordinates(90,0)&&!SetupFetchHttp.coordinates(0,181),"invalid coordinates");
            check(SetupFetchHttp.timezone("Asia/Riyadh")&&SetupFetchHttp.timezone("America/New_York")&&SetupFetchHttp.timezone("UTC"),"IANA zones");
            check(!SetupFetchHttp.timezone("Invented/City")&&!SetupFetchHttp.timezone("GMT+03:00")&&!SetupFetchHttp.timezone("EST"),"no timezone fallback");
            check(SetupFetchHttp.method("UmmAlQura")&&SetupFetchHttp.method("Karachi")&&!SetupFetchHttp.method("ISNA")&&!SetupFetchHttp.method("Egypt"),"strict five methods");
            check(SetupFetchHttp.year(2000)&&SetupFetchHttp.year(2075)&&!SetupFetchHttp.year(1999)&&!SetupFetchHttp.year(2076),"year boundaries");
            String month=SetupFetchHttp.monthUrl(26.4207,50.0888,"Asia/Riyadh","UmmAlQura",2026,11);
            check(month.startsWith("https://ummahapi.com/api/prayer-times/month?")&&month.contains("timezone=Asia%2FRiyadh")&&month.contains("madhab=Shafi"),"fixed encoded month URL");
            check(SetupFetchHttp.dayUrl(0,0,"UTC","Karachi","1999-12-31").contains("date=1999-12-31"),"first year guard");
            check(SetupFetchHttp.dayUrl(0,0,"UTC","Karachi","2077-01-01").contains("date=2077-01-01"),"last year guard");
        }finally{server.stop(0);pool.shutdownNow();}
        System.out.println("PASS "+checks+" setup download policy/local HTTP checks (no external requests)");
    }
}
