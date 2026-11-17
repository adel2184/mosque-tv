package sa.mosque.display;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Real loopback HTTP only; the production wrapper still has one fixed HTTPS URL. */
public final class NetworkSpeedProbeTest {
    static int checks;
    static void check(boolean value, String name) { checks++; if (!value) throw new AssertionError(name); }
    static HttpURLConnection connection(String base, String path) throws Exception { return (HttpURLConnection)new URL(base+path).openConnection(); }
    static void reject(String base, String path, long deadline, NetworkSpeedProbe.Cancellation cancel) throws Exception {
        boolean failed=false;try{NetworkSpeedProbe.measure(connection(base,path),deadline,cancel);}catch(IOException expected){failed=true;}
        check(failed,"must reject "+path);
    }
    public static void main(String[] args) throws Exception {
        AtomicInteger redirected = new AtomicInteger(); AtomicBoolean cleanHeaders = new AtomicBoolean();
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        ExecutorService threads=Executors.newCachedThreadPool();server.setExecutor(threads);
        server.createContext("/good",exchange->{
            cleanHeaders.set((exchange.getRequestHeaders().getFirst("Cookie")==null||exchange.getRequestHeaders().getFirst("Cookie").isEmpty())&&exchange.getRequestHeaders().getFirst("Referer")==null);
            exchange.sendResponseHeaders(200,NetworkSpeedProbe.BYTES);
            try(OutputStream out=exchange.getResponseBody()){byte[] block=new byte[8192];int left=NetworkSpeedProbe.BYTES;while(left>0){int n=Math.min(left,block.length);out.write(block,0,n);left-=n;}}finally{exchange.close();}
        });
        server.createContext("/redirect",exchange->{exchange.getResponseHeaders().set("Location","/target");exchange.sendResponseHeaders(302,-1);exchange.close();});
        server.createContext("/target",exchange->{redirected.incrementAndGet();exchange.sendResponseHeaders(200,-1);exchange.close();});
        server.createContext("/short",exchange->{exchange.sendResponseHeaders(200,123);try(OutputStream out=exchange.getResponseBody()){out.write(new byte[123]);}finally{exchange.close();}});
        server.createContext("/truncated",exchange->{exchange.sendResponseHeaders(200,0);try(OutputStream out=exchange.getResponseBody()){out.write(new byte[100]);}finally{exchange.close();}});
        server.createContext("/large",exchange->{exchange.sendResponseHeaders(200,NetworkSpeedProbe.BYTES+1);exchange.close();});
        server.createContext("/error",exchange->{exchange.sendResponseHeaders(503,-1);exchange.close();});
        server.createContext("/slow",exchange->{exchange.sendResponseHeaders(200,0);try(OutputStream out=exchange.getResponseBody()){out.write(1);out.flush();try{Thread.sleep(500);}catch(InterruptedException ignored){}}finally{exchange.close();}});
        server.start();String base="http://127.0.0.1:"+server.getAddress().getPort();
        try {
            NetworkSpeedProbe.Result result=NetworkSpeedProbe.measure(connection(base,"/good"),System.nanoTime()+5_000_000_000L,()->false);
            check(result.bytes==5_000_000,"exact bound");check(result.mbps>0&&Double.isFinite(result.mbps),"finite Mbps");check(cleanHeaders.get(),"no cookies/referrer");
            reject(base,"/redirect",System.nanoTime()+2_000_000_000L,()->false);check(redirected.get()==0,"redirect was not followed");
            reject(base,"/short",System.nanoTime()+2_000_000_000L,()->false);
            reject(base,"/truncated",System.nanoTime()+2_000_000_000L,()->false);
            reject(base,"/large",System.nanoTime()+2_000_000_000L,()->false);
            reject(base,"/error",System.nanoTime()+2_000_000_000L,()->false);
            reject(base,"/good",System.nanoTime()+2_000_000_000L,()->true);
            long start=System.nanoTime();reject(base,"/slow",start+150_000_000L,()->false);check(System.nanoTime()-start<2_000_000_000L,"short overall deadline");
            check(NetworkSpeedProbe.ENDPOINT.equals("https://speed.cloudflare.com/__down?bytes=5000000"),"fixed HTTPS endpoint");
            check(new NetworkSpeedProbe.Result(5_000_000,1_000_000_000L).mbps==40.0,"Mbps units");
        } finally {server.stop(0);threads.shutdownNow();}
        System.out.println("PASS "+checks+" local network speed checks (no external requests)");
    }
}
