package sa.mosque.display;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/** Pure exact matching of community records. Package safety remains a runtime policy. */
final class DeviceProfiles {
    static final class Profile {
        final String id, brand, modelSlug;
        final Integer osMajor;
        final List<String> packages;
        Profile(String id, String brand, String modelSlug, Integer osMajor, List<String> packages) {
            this.id=id;this.brand=brand;this.modelSlug=modelSlug;this.osMajor=osMajor;
            this.packages=packages==null?Collections.emptyList():Collections.unmodifiableList(new ArrayList<>(packages));
        }
    }
    static final class Match {
        final Profile profile;
        final String reason;
        Match(Profile profile,String reason){this.profile=profile;this.reason=reason;}
    }

    static Match select(List<Profile> profiles,String manufacturer,String brand,String model,int androidMajor) {
        if(profiles==null||profiles.isEmpty())return no("NO_PROFILES");
        if(androidMajor<1||androidMajor>99)return no("MISSING_ANDROID_VERSION");
        String maker=normalize(manufacturer),productBrand=normalize(brand),actualModel=normalize(model);
        if(maker.isEmpty()&&productBrand.isEmpty())return no("MISSING_OEM");
        // Different nonempty OEM values must be reviewed, not guessed between.
        if(!maker.isEmpty()&&!productBrand.isEmpty()&&!maker.equals(productBrand))return no("OEM_CONFLICT");
        String oem=maker.isEmpty()?productBrand:maker;
        if(actualModel.isEmpty())return no("MISSING_MODEL");
        List<Profile> sameModel=new ArrayList<>();
        for(Profile row:profiles){
            if(valid(row)&&oem.equals(normalize(row.brand))&&actualModel.equals(normalize(row.modelSlug)))sameModel.add(row);
        }
        if(sameModel.isEmpty())return no("NO_EXACT_MODEL");
        // A bare/base model is not enough to choose a region/platform variant.
        for(Profile base:sameModel)for(Profile other:profiles){
            if(valid(other)&&oem.equals(normalize(other.brand))&&!other.id.equals(base.id)
                    &&other.id.startsWith(base.id+"-"))return no("AMBIGUOUS_VARIANT");
        }
        Profile selected=null;boolean missingVersion=false;
        for(Profile row:sameModel){
            if(row.osMajor==null){missingVersion=true;continue;}
            if(row.osMajor!=androidMajor)continue;
            if(selected!=null)return no("AMBIGUOUS_MODEL");
            selected=row;
        }
        if(selected==null)return no(missingVersion?"MISSING_PROFILE_ANDROID_VERSION":"ANDROID_VERSION_MISMATCH");
        return new Match(selected,"EXACT_MODEL_AND_VERSION");
    }

    private static Match no(String reason){return new Match(null,reason);}
    private static boolean valid(Profile value){
        return value!=null&&value.id!=null&&value.id.matches("[a-z0-9][a-z0-9-]{0,127}")
                &&!normalize(value.brand).isEmpty()&&value.modelSlug!=null
                &&value.modelSlug.matches("[a-z0-9-]{0,127}")
                &&(value.osMajor==null||(value.osMajor>=1&&value.osMajor<=99));
    }
    static String normalize(String value){
        if(value==null||value.length()>256)return "";
        String normalized=Normalizer.normalize(value,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        StringBuilder result=new StringBuilder();
        for(int offset=0;offset<normalized.length();){
            int point=normalized.codePointAt(offset);offset+=Character.charCount(point);
            if(Character.isLetterOrDigit(point))result.appendCodePoint(point);
        }
        return result.toString();
    }
}
