package sa.mosque.display;
public final class PowerRulesTest {
    public static void main(String[] args) {
        int checks=0;
        String[] valid={"00:00","04:00","23:59"};int[] values={0,240,1439};
        for(int i=0;i<valid.length;i++){if(PowerRules.minute(valid[i])!=values[i])throw new AssertionError(valid[i]);checks++;}
        for(String bad:new String[]{null,"24:00","23:60","4:00","04:0"," 04:00","٠٤:٠٠","-1:00"}){if(PowerRules.minute(bad)!=-1)throw new AssertionError("accepted "+bad);checks++;}
        int[][] ranges={{240,1380},{1380,240},{0,1},{1439,0},{0,1439}};
        for(int[] range:ranges)for(int now=0;now<1440;now++){
            int duration=(range[1]-range[0]+1440)%1440,offset=(now-range[0]+1440)%1440;
            if(PowerRules.within(now,range[0],range[1])!=(offset<duration))throw new AssertionError("boundary "+now);
            checks++;
        }
        if(PowerRules.within(0,0,0)||PowerRules.within(-1,0,5)||PowerRules.within(2,-1,5)||PowerRules.within(2,0,1440))throw new AssertionError("invalid bounds");checks+=4;
        System.out.println("PASS "+checks+" display schedule checks");
    }
}
