import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/** Developer-only ZIP normalization for Windows aapt2 asset entry separators. */
public final class NormalizeApk {
    // ZIP stores local DOS time. Keep build time and host timezone out of the signed bytes.
    private static final LocalDateTime ZIP_TIMESTAMP = LocalDateTime.of(2000, 1, 1, 0, 0);

    public static void main(String[] args) throws Exception {
        Path source=Paths.get(args[0]), destination=Paths.get(args[1]);
        Set<String> names=new HashSet<String>();
        try(ZipFile input=new ZipFile(source.toFile()); ZipOutputStream output=new ZipOutputStream(Files.newOutputStream(destination))){
            Enumeration<? extends ZipEntry> entries=input.entries();
            byte[] buffer=new byte[16384];
            while(entries.hasMoreElements()){
                ZipEntry entry=entries.nextElement();
                String name=entry.getName().replace('\\','/');
                if(name.startsWith("/")||name.contains(":")||name.matches("(^|.*/)\\.\\.(/.*|$)")||!names.add(name))throw new IllegalArgumentException("Unsafe ZIP entry: "+name);
                ZipEntry target=new ZipEntry(name);target.setTimeLocal(ZIP_TIMESTAMP);
                if(name.equals("resources.arsc")){
                    target.setMethod(ZipEntry.STORED);target.setSize(entry.getSize());target.setCompressedSize(entry.getSize());target.setCrc(entry.getCrc());
                }
                output.putNextEntry(target);
                try(InputStream stream=input.getInputStream(entry)){int read;while((read=stream.read(buffer))!=-1)output.write(buffer,0,read);}
                output.closeEntry();
            }
        }
    }
}
