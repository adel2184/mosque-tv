package sa.mosque.display;

import android.content.Context;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Bundled MIT data only; never executes commands or downloads model lists. */
final class DeviceProfileCatalog {
    private static volatile DeviceProfileCatalog cached;
    final List<DeviceProfiles.Profile> profiles;
    final Set<String> allPackages;
    final String problem;
    private DeviceProfileCatalog(Context context){
        List<DeviceProfiles.Profile> rows=new ArrayList<>();Set<String> packages=new HashSet<>();String failure="";
        try(InputStream input=context.getAssets().open("device-profiles.json")){
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(bytes.size()+count>512*1024)throw new Exception("Size");bytes.write(buffer,0,count);}
            JSONObject data=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
            if(data.getInt("schemaVersion")!=1||!"3cd274f866b71ec15e4f7d8c796514b0baa8033c".equals(data.getJSONObject("source").getString("commit")))throw new Exception("Source");
            JSONArray source=data.getJSONArray("profiles");if(source.length()>1000)throw new Exception("Count");
            for(int i=0;i<source.length();i++){JSONObject row=source.getJSONObject(i);List<String> names=new ArrayList<>();JSONArray list=row.getJSONArray("packages");if(list.length()>1000)throw new Exception("Packages");
                for(int j=0;j<list.length();j++){String name=list.getString(j);if(!name.matches("[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)+")||name.length()>200)throw new Exception("Name");names.add(name);packages.add(name);}
                Integer os=row.isNull("osMajor")?null:row.getInt("osMajor");rows.add(new DeviceProfiles.Profile(row.getString("id"),row.getString("brand"),row.getString("modelSlug"),os,names));
            }
        }catch(Exception error){rows.clear();packages.clear();failure="MODEL_CATALOG_UNAVAILABLE";}
        profiles=Collections.unmodifiableList(rows);allPackages=Collections.unmodifiableSet(packages);problem=failure;
    }
    static DeviceProfileCatalog get(Context context){DeviceProfileCatalog value=cached;if(value==null)synchronized(DeviceProfileCatalog.class){value=cached;if(value==null)cached=value=new DeviceProfileCatalog(context.getApplicationContext());}return value;}
    DeviceProfiles.Match match(){int major=0;try{major=Integer.parseInt(Build.VERSION.RELEASE.split("\\.")[0]);}catch(Exception ignored){}return DeviceProfiles.select(profiles,Build.MANUFACTURER,Build.BRAND,Build.MODEL,major);}
    String summary(){DeviceProfiles.Match match=match();return match.profile==null?"COMMUNITY_PROFILE: "+(problem.isEmpty()?match.reason:problem):"COMMUNITY_PROFILE: "+match.profile.id+" · EXACT_MODEL_AND_VERSION";}
}
