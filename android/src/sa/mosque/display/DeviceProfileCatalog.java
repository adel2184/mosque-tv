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
import java.util.regex.Pattern;

/** Bundled MIT data only; never executes commands or downloads model lists. */
final class DeviceProfileCatalog {
    private static volatile DeviceProfileCatalog cached;
    private static final Pattern PACKAGE_NAME=Pattern.compile("[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+");
    private final DeviceProfiles.Match selected;
    final Set<String> recoverablePackages;
    final String problem;
    private DeviceProfileCatalog(Context context){
        List<DeviceProfiles.Profile> rows=new ArrayList<>();Set<String> packages=new HashSet<>();String failure="";
        try(InputStream input=context.getAssets().open("device-profiles.json")){
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(bytes.size()+count>512*1024)throw new Exception("Size");bytes.write(buffer,0,count);}
            JSONObject data=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
            JSONObject provenance=data.getJSONObject("source");
            if(data.getInt("schemaVersion")!=2||!"fe6cdcefa817da9f6facd3a17a3c5a086124f258".equals(provenance.getString("commit"))
                    ||!"3cd274f866b71ec15e4f7d8c796514b0baa8033c".equals(provenance.getString("baselineCommit")))throw new Exception("Source");
            JSONArray source=data.getJSONArray("profiles");if(source.length()!=508)throw new Exception("Count");
            for(int i=0;i<source.length();i++){JSONObject row=source.getJSONObject(i);List<String> names=new ArrayList<>();JSONArray list=row.getJSONArray("packages");if(list.length()>1000)throw new Exception("Packages");
                for(int j=0;j<list.length();j++){String name=packageName(list,j);names.add(name);packages.add(name);}
                Integer os=row.isNull("osMajor")?null:row.getInt("osMajor");rows.add(new DeviceProfiles.Profile(row.getString("id"),row.getString("brand"),row.getString("modelSlug"),os,names));
            }
            JSONArray legacy=data.getJSONArray("restoreOnly");
            if(legacy.length()>1000)throw new Exception("Recovery package count");
            for(int i=0;i<legacy.length();i++)if(!packages.add(packageName(legacy,i)))throw new Exception("Duplicate recovery package");
        }catch(Exception error){rows.clear();packages.clear();failure="MODEL_CATALOG_UNAVAILABLE";}
        recoverablePackages=Collections.unmodifiableSet(packages);problem=failure;
        int major=0;try{major=Integer.parseInt(Build.VERSION.RELEASE.split("\\.")[0]);}catch(NumberFormatException ignored){}
        selected=DeviceProfiles.select(rows,Build.MANUFACTURER,Build.BRAND,Build.MODEL,major);
    }
    private static String packageName(JSONArray list,int index)throws Exception{
        String name=list.getString(index);
        if(name.length()>255||!PACKAGE_NAME.matcher(name).matches())throw new Exception("Name");
        return name;
    }
    static DeviceProfileCatalog get(Context context){DeviceProfileCatalog value=cached;if(value==null)synchronized(DeviceProfileCatalog.class){value=cached;if(value==null)cached=value=new DeviceProfileCatalog(context.getApplicationContext());}return value;}
    DeviceProfiles.Match match(){return selected;}
    String summary(){return selected.profile==null?"COMMUNITY_PROFILE: "+(problem.isEmpty()?selected.reason:problem):"COMMUNITY_PROFILE: "+selected.profile.id+" · "+selected.reason;}
}
