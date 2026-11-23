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
        System.out.println("PASS "+checks+" display schedule boundary checks");
        int zones=0;
        for(String zone:new String[]{"Asia/Riyadh","America/New_York","Asia/Kolkata","Asia/Kathmandu","Pacific/Kiritimati","Etc/GMT+3","UTC","GMT"}){
            if(!PowerRules.timezone(zone))throw new AssertionError("rejected time zone "+zone);zones++;
        }
        for(String zone:new String[]{null,"","GPS","Invented/City","GMT+03:00","UTC+03:00","EST","PST"," Asia/Riyadh","Asia/Riyadh ","../Asia/Riyadh","Asia/ريـاض"}){
            if(PowerRules.timezone(zone))throw new AssertionError("accepted time zone "+zone);zones++;
        }
        long midnight=java.time.Instant.parse("2026-11-17T00:00:00Z").toEpochMilli();
        String[] localZones={"UTC","Asia/Riyadh","Asia/Kolkata","Asia/Kathmandu","Pacific/Kiritimati","America/New_York","Etc/GMT+3"};
        int[] localMinutes={0,180,330,345,840,1140,1260};
        for(int i=0;i<localZones.length;i++){
            if(PowerRules.localMinute(midnight,localZones[i])!=localMinutes[i])throw new AssertionError("local minute "+localZones[i]);zones++;
        }
        // New York's spring gap and autumn repeat are evaluated from actual instants.
        String[] instants={"2026-03-08T06:59:00Z","2026-03-08T07:00:00Z","2026-11-01T05:30:00Z","2026-11-01T06:30:00Z"};
        int[] dstMinutes={119,180,90,90};
        for(int i=0;i<instants.length;i++){
            int now=PowerRules.localMinute(java.time.Instant.parse(instants[i]).toEpochMilli(),"America/New_York");
            if(now!=dstMinutes[i]||PowerRules.within(now,120,240)!=(i==1))throw new AssertionError("DST schedule "+instants[i]);zones++;
        }
        int ny=PowerRules.localMinute(midnight,"America/New_York"),riyadh=PowerRules.localMinute(midnight,"Asia/Riyadh");
        if(!PowerRules.within(ny,1080,1320)||PowerRules.within(riyadh,1080,1320))throw new AssertionError("profile time-zone changes schedule");zones++;
        try{PowerRules.localMinute(midnight,"GPS");throw new AssertionError("unknown zone silently fell back");}catch(IllegalArgumentException expected){zones++;}
        System.out.println("PASS "+zones+" time-zone validation, conversion and DST schedule checks");
        if (PowerRules.nextCheckDelay(false, 0, 1_000, 0, 0) != Long.MAX_VALUE
                || PowerRules.nextCheckDelay(true, 59_999, 1_000, 0, 0) != 1
                || PowerRules.nextCheckDelay(true, 60_000, 1_000, 1_080, 0) != 80
                || PowerRules.nextCheckDelay(false, 0, 1_000, 0, 61_100) != 100
                || PowerRules.nextCheckDelay(false, 0, 1_100, 0, 61_100) != 60_000
                || PowerRules.nextCheckDelay(false, 0, 61_099, 0, 61_100) != 1
                || PowerRules.nextCheckDelay(true, 60_000, 61_100, 0, 0) != 60_000) {
            throw new AssertionError("Display power callback deadline");
        }
        System.out.println("PASS 7 idle, schedule, operator and countdown callback checks");
        for (int minute = 0; minute < 30 * 1440; minute++) {
            int dayMinute = minute % 1440;
            boolean outside = !PowerRules.within(dayMinute, 240, 1380);
            long now = minute * 60_000L;
            // Each civil day opens 04:00–23:00. The prayer layer takes priority
            // over manual/scheduled blackout and restores it on the next state.
            if (PowerRules.curtainVisible(false, false, outside, now, 0) != (dayMinute < 240 || dayMinute >= 1380)
                    || !PowerRules.curtainVisible(false, true, outside, now, 0)
                    || PowerRules.curtainVisible(true, true, outside, now, 0)
                    || PowerRules.curtainVisible(true, false, outside, now, 0)
                    || PowerRules.curtainVisible(false, false, outside, now, now + 300_000L)) {
                throw new AssertionError("Manual/scheduled/prayer restoration at minute " + minute);
            }
        }
        System.out.println("PASS 43,200 simulated minutes of quiet hours, manual blackout, prayer and operator override");
    }
}
