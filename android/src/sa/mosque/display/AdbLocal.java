package sa.mosque.display;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.Signature;

/** Original, bounded classic ADB transport. Protocol: AOSP adb/protocol.txt.
 * Only loopback is reachable; no discovery, remote hosts, TLS pairing, or shell UI. */
final class AdbLocal implements Closeable {
    static final int CNXN=0x4e584e43, AUTH=0x48545541, OPEN=0x4e45504f,
            OKAY=0x59414b4f, WRTE=0x45545257, CLSE=0x45534c43, STLS=0x534c5453;
    private static final int LIMIT=512*1024;
    private final Socket socket;
    private final InputStream input;
    private final OutputStream output;
    private int sequence=1;
    interface Progress { void update(String message); default void opened(AdbLocal transport){} }
    static final class Reply {
        final String output; final int code;
        Reply(String output,int code){this.output=output;this.code=code;}
    }
    static final class Frame {
        final int kind,a,b; final byte[] bytes;
        Frame(int kind,int a,int b,byte[] bytes){this.kind=kind;this.a=a;this.b=b;this.bytes=bytes;}
    }
    private AdbLocal(Socket socket) throws IOException {
        this.socket=socket; input=socket.getInputStream();output=socket.getOutputStream();
    }
    static AdbLocal connect(KeyPair key,Progress progress) throws IOException {
        Socket socket=new Socket();
        try {
            socket.connect(new InetSocketAddress("127.0.0.1",5555),3000);
            socket.setTcpNoDelay(true);socket.setSoTimeout(12000);
            AdbLocal client=new AdbLocal(socket);
            if(progress!=null)progress.opened(client);
            client.send(CNXN,0x01000000,4096,"host::mosque-local\0".getBytes(StandardCharsets.UTF_8));
            boolean signed=false,presented=false;
            for(int count=0;count<8;count++) {
                Frame frame=readFrame(client.input);
                if(frame.kind==CNXN){socket.setSoTimeout(20000);return client;}
                if(frame.kind==STLS)throw new IOException("هذا المنفذ يطلب اقتران ADB مشفّرًا لا يدعمه الاتصال المحلي الحالي.");
                if(frame.kind!=AUTH||frame.a!=1)throw new IOException("رد ADB غير متوافق.");
                if(!signed){client.send(AUTH,2,0,signToken(key.getPrivate(),frame.bytes));signed=true;}
                else if(!presented){
                    client.send(AUTH,3,0,(base64(publicKeyBytes((RSAPublicKey)key.getPublic()))+" mosque-display@local\0").getBytes(StandardCharsets.US_ASCII));
                    presented=true;socket.setSoTimeout(90000);
                    if(progress!=null)progress.update("إذا ظهر طلب «السماح بتصحيح USB» على التلفاز، راجع الطلب واقبله لإكمال الاتصال المحلي.");
                } else throw new IOException("لم يعتمد التلفاز مفتاح الاتصال المحلي؛ راجع طلب التصحيح ثم حاول مجددًا.");
            }
            throw new IOException("لم تكتمل مصادقة ADB.");
        } catch(IOException|RuntimeException error){try{socket.close();}catch(IOException ignored){}throw error;}
    }
    synchronized Reply run(String fixedCommand) throws IOException {
        final String marker="__MOSQUE_RC__=";
        int id=sequence++,remote=0;
        send(OPEN,id,0,("shell:"+fixedCommand+"; echo "+marker+"$?\0").getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream data=new ByteArrayOutputStream();
        long deadline=System.nanoTime()+45_000_000_000L;
        while(System.nanoTime()<deadline){
            Frame frame=readFrame(input);
            if(frame.b!=id&&frame.kind!=CLSE)throw new IOException("اختلطت قنوات ADB؛ أعد الاتصال.");
            if(frame.kind==OKAY){remote=frame.a;continue;}
            if(frame.kind==WRTE){
                remote=frame.a;if(data.size()+frame.bytes.length>LIMIT)throw new IOException("تجاوز رد الجهاز الحد المسموح.");
                data.write(frame.bytes);send(OKAY,id,remote,new byte[0]);continue;
            }
            if(frame.kind==CLSE){
                if(remote!=0)send(CLSE,id,remote,new byte[0]);
                String text=new String(data.toByteArray(),StandardCharsets.UTF_8).replace("\r","");
                int at=text.lastIndexOf(marker);
                if(at<0)throw new IOException("لم يؤكد الجهاز اكتمال الأمر؛ لم يُفترض نجاحه.");
                String code=text.substring(at+marker.length()).trim();
                if(!code.matches("[0-9]{1,3}"))throw new IOException("نتيجة أمر الجهاز غير مقروءة.");
                return new Reply(text.substring(0,at),Integer.parseInt(code));
            }
            throw new IOException("تعذر إكمال أمر ADB.");
        }
        throw new IOException("انتهت مهلة استجابة الجهاز.");
    }
    private void send(int kind,int a,int b,byte[] data)throws IOException{output.write(packet(kind,a,b,data));output.flush();}
    static byte[] packet(int kind,int a,int b,byte[] data){
        int sum=0;for(byte value:data)sum+=value&255;
        ByteBuffer bytes=ByteBuffer.allocate(24+data.length).order(ByteOrder.LITTLE_ENDIAN);
        bytes.putInt(kind).putInt(a).putInt(b).putInt(data.length).putInt(sum).putInt(kind^0xffffffff).put(data);
        return bytes.array();
    }
    static Frame readFrame(InputStream source)throws IOException{
        DataInputStream stream=new DataInputStream(source);byte[] header=new byte[24];stream.readFully(header);
        ByteBuffer words=ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);
        int kind=words.getInt(),a=words.getInt(),b=words.getInt(),length=words.getInt(),sum=words.getInt(),magic=words.getInt();
        if(magic!=(kind^0xffffffff)||length<0||length>1024*1024)throw new IOException("حزمة ADB غير صالحة.");
        byte[] data=new byte[length];stream.readFully(data);int actual=0;for(byte value:data)actual+=value&255;
        if(sum!=0&&sum!=actual)throw new IOException("تلفت حزمة ADB.");
        return new Frame(kind,a,b,data);
    }
    static byte[] signToken(PrivateKey key,byte[] token)throws IOException{
        if(token.length!=20)throw new IOException("تحدي مصادقة ADB غير متوافق.");
        byte[] prefix={0x30,0x21,0x30,0x09,0x06,0x05,0x2b,0x0e,0x03,0x02,0x1a,0x05,0x00,0x04,0x14};
        try {
            // Classic ADB supplies the SHA-1 digest. Sign its DigestInfo directly.
            Signature signature = Signature.getInstance("NONEwithRSA");
            signature.initSign(key);
            signature.update(prefix);
            signature.update(token);
            return signature.sign();
        }
        catch(GeneralSecurityException error){throw new IOException("تعذر توقيع مصادقة ADB.",error);}
    }
    static byte[] publicKeyBytes(RSAPublicKey key){
        BigInteger n=key.getModulus(),word=BigInteger.ONE.shiftLeft(32);
        ByteBuffer result=ByteBuffer.allocate(524).order(ByteOrder.LITTLE_ENDIAN);
        result.putInt(64).putInt(word.subtract(n.mod(word).modInverse(word)).intValue());
        result.put(little(n,256)).put(little(BigInteger.ONE.shiftLeft(4096).mod(n),256)).putInt(key.getPublicExponent().intValue());
        return result.array();
    }
    private static byte[] little(BigInteger number,int size){byte[] big=number.toByteArray(),small=new byte[size];for(int i=0;i<size&&i<big.length;i++)small[i]=big[big.length-1-i];return small;}
    static String base64(byte[] data){
        String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";StringBuilder result=new StringBuilder();
        for(int i=0;i<data.length;i+=3){int a=data[i]&255,b=i+1<data.length?data[i+1]&255:0,c=i+2<data.length?data[i+2]&255:0;
            result.append(alphabet.charAt(a>>>2)).append(alphabet.charAt(((a&3)<<4)|(b>>>4)));
            result.append(i+1<data.length?alphabet.charAt(((b&15)<<2)|(c>>>6)):'=');result.append(i+2<data.length?alphabet.charAt(c&63):'=');}
        return result.toString();
    }
    @Override public void close()throws IOException{socket.close();}
}
