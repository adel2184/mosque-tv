package sa.mosque.display;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;

/** Pure wire/crypto tests: no socket, ADB daemon, TV, package command, or Android API is executed. */
public final class AdbLocalTest {
    private static int passed;
    private static void check(boolean value,String name){if(!value)throw new AssertionError(name);passed++;}
    private static void invalid(byte[] bytes)throws Exception{try{AdbLocal.readFrame(new ByteArrayInputStream(bytes));throw new AssertionError("Malformed frame accepted");}catch(IOException expected){passed++;}}
    public static void main(String[] args)throws Exception{
        for(int length=0;length<70;length++){byte[] bytes=new byte[length];for(int index=0;index<length;index++)bytes[index]=(byte)(index*19);check(AdbLocal.base64(bytes).equals(Base64.getEncoder().encodeToString(bytes)),"Base64 vector "+length);}
        byte[] payload="اختبار محلي".getBytes("UTF-8");
        AdbLocal.Frame frame=AdbLocal.readFrame(new ByteArrayInputStream(AdbLocal.packet(AdbLocal.WRTE,5,8,payload)));
        check(frame.kind==AdbLocal.WRTE&&frame.a==5&&frame.b==8&&Arrays.equals(frame.bytes,payload),"Packet framing and UTF-8");
        byte[] broken=AdbLocal.packet(AdbLocal.WRTE,5,8,payload);broken[20]^=1;invalid(broken);
        broken=AdbLocal.packet(AdbLocal.WRTE,5,8,payload);broken[24]^=1;invalid(broken);
        broken=AdbLocal.packet(AdbLocal.WRTE,5,8,payload);ByteBuffer.wrap(broken).order(ByteOrder.LITTLE_ENDIAN).putInt(12,2*1024*1024);invalid(broken);
        KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA");generator.initialize(2048);KeyPair key=generator.generateKeyPair();
        byte[] encoded=AdbLocal.publicKeyBytes((RSAPublicKey)key.getPublic());ByteBuffer publicKey=ByteBuffer.wrap(encoded).order(ByteOrder.LITTLE_ENDIAN);
        check(encoded.length==524&&publicKey.getInt()==64,"ADB key size and word count");int inverse=publicKey.getInt();long low=publicKey.getInt()&0xffffffffL;
        check(((low*(inverse&0xffffffffL))+1&0xffffffffL)==0,"ADB Montgomery inverse");
        check(ByteBuffer.wrap(encoded).order(ByteOrder.LITTLE_ENDIAN).getInt(520)==65537,"ADB exponent");
        byte[] token=new byte[20];for(int i=0;i<20;i++)token[i]=(byte)(i+1);
        byte[] signed=AdbLocal.signToken(key.getPrivate(),token);Cipher verifier=Cipher.getInstance("RSA/ECB/PKCS1Padding");verifier.init(Cipher.DECRYPT_MODE,key.getPublic());byte[] digestInfo=verifier.doFinal(signed);
        check(digestInfo.length==35&&Arrays.equals(Arrays.copyOfRange(digestInfo,15,35),token),"ADB signs the supplied SHA-1 token without hashing it again");
        try{AdbLocal.signToken(key.getPrivate(),new byte[32]);throw new AssertionError("Unknown challenge accepted");}catch(IOException expected){passed++;}
        System.out.println("{\"passed\":"+passed+",\"failed\":0,\"method\":\"Pure JVM ADB framing/Base64/RSA tests only; no socket, TV or package changes executed\"}");
    }
}
