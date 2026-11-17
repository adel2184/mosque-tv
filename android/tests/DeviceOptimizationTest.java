package sa.mosque.display;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;

/** Actual policy/executor with fake atomic journal and shell. No Android, socket, or TV commands. */
public final class DeviceOptimizationTest {
    private static int count;
    private static final String W="window_animation_scale",T="transition_animation_scale",A="animator_duration_scale";
    private interface Action { void run() throws Exception; }
    private static void check(boolean value,String label){count++;if(!value)throw new AssertionError(label);}
    private static void io(Action action,String label)throws Exception{try{action.run();throw new AssertionError(label+" was accepted");}catch(IOException expected){count++;}}
    private static void badSize(long total,long available){try{DeviceOptimization.lowStorage(total,available);throw new AssertionError("Invalid storage sizes accepted");}catch(IllegalArgumentException expected){count++;}}
    private static final class Gate implements DeviceOptimization.Gate { boolean blocked;public void check()throws IOException{if(blocked)throw new IOException("Prayer or authorization gate blocked");} }
    private static final class Journal implements DeviceOptimization.Journal {
        byte[] saved;int reads,writes,attempts,failAt=-1;boolean readFailure;final List<String> events;
        Journal(List<String> events){this.events=events;}
        public byte[] read()throws IOException{reads++;if(readFailure)throw new IOException("Read denied");return saved==null?null:saved.clone();}
        public void write(byte[] value)throws IOException{attempts++;events.add("journal");if(attempts==failAt)throw new IOException("Atomic write failure");saved=value.clone();writes++;}
    }
    private static final class Shell implements DeviceOptimization.Shell {
        final Map<String,String> values=new LinkedHashMap<>();final List<String> commands=new ArrayList<>(),events;Gate gate;int mutations,throwBefore=-1,throwAfter=-1,failCodeAt=-1,blockAfter=-1;boolean badRead,duplicate,mismatch;String readOverride;
        Shell(List<String> events){this.events=events;}
        public DeviceOptimization.Reply run(String command)throws IOException{
            commands.add(command);events.add(command);
            if(command.equals("settings list global")){
                StringBuilder text=new StringBuilder("device_provisioned=1\nunrelated_setting=untouched\n");for(Map.Entry<String,String> item:values.entrySet())text.append(item.getKey()).append('=').append(item.getValue()).append('\n');if(duplicate)text.append(W).append("=1\n");return new DeviceOptimization.Reply(readOverride==null?text.toString():readOverride,badRead?1:0);
            }
            mutations++;if(mutations==throwBefore)throw new IOException("Command not sent");if(mutations==failCodeAt)return new DeviceOptimization.Reply("permission denied",1);
            if(command.startsWith("settings put global ")){String[] parts=command.split(" ",5);String raw=parts[4];if(raw.length()<2||raw.charAt(0)!='\''||raw.charAt(raw.length()-1)!='\'')throw new AssertionError("Expected safely quoted numeric value");values.put(parts[3],mismatch?"0.7":raw.substring(1,raw.length()-1));}
            else if(command.startsWith("settings delete global "))values.remove(command.substring("settings delete global ".length()));
            else throw new AssertionError("Unexpected command "+command);
            if(mutations==blockAfter)gate.blocked=true;if(mutations==throwAfter)throw new IOException("Confirmation lost after mutation");return new DeviceOptimization.Reply("",0);
        }
    }
    private static final class Fixture {
        final List<String> events=new ArrayList<>();final Gate gate=new Gate();final Journal journal=new Journal(events);final Shell shell=new Shell(events);DeviceOptimization engine;
        Fixture(){shell.gate=gate;shell.values.put(W,"1.00");shell.values.put(T,"0");shell.values.put(A,"2.0");restart();}
        void restart(){engine=new DeviceOptimization(shell,journal,gate);}
    }
    private static byte[] binary(int version,String[] keys,int[] present,String[] values,boolean extra)throws Exception{
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(bytes);out.writeInt(0x4d4f5054);out.writeInt(version);out.writeInt(keys.length);for(int i=0;i<keys.length;i++){out.writeUTF(keys[i]);out.writeByte(present[i]);if(present[i]==1)out.writeUTF(values[i]);}if(extra)out.writeByte(7);out.flush();CRC32 crc=new CRC32();crc.update(bytes.toByteArray());out.writeInt((int)crc.getValue());out.flush();return bytes.toByteArray();
    }
    public static void main(String[] args)throws Exception{
        Fixture normal=new Fixture();int reads=normal.journal.reads;normal.engine.summary();normal.engine.warning();normal.engine.pendingCount();check(normal.shell.commands.isEmpty(),"Summary performs no shell request");check(normal.journal.reads==reads,"Summary performs no journal I/O");normal.engine.applyAnimations();check(normal.engine.pendingCount()==3,"All changed originals recorded");for(String key:new String[]{W,T,A})check("0.5".equals(normal.shell.values.get(key)),"Target applied "+key);check(normal.events.indexOf("journal")<normal.events.indexOf("settings put global "+W+" '0.5'"),"Original durable before first mutation");check(normal.engine.summary().contains("original=1.00"),"Raw original representation preserved");int writes=normal.journal.writes,mutations=normal.shell.mutations;normal.engine.applyAnimations();check(normal.journal.writes==writes&&normal.shell.mutations==mutations,"Repeated apply is idempotent");normal.shell.values.put(W,"3");normal.engine.applyAnimations();check(normal.engine.summary().contains("original=1.00"),"Reapply never overwrites the first original");normal.restart();check(normal.engine.pendingCount()==3,"Restart reloads originals");normal.engine.restoreAnimations();check("1.00".equals(normal.shell.values.get(W))&&"0".equals(normal.shell.values.get(T))&&"2.0".equals(normal.shell.values.get(A)),"Exact original values restored");check(normal.engine.pendingCount()==0,"Verified entries removed");normal.restart();check(normal.engine.pendingCount()==0,"Empty journal survives restart");

        Fixture absent=new Fixture();absent.shell.values.remove(T);absent.engine.applyAnimations();check(absent.engine.summary().contains(T+": original=<absent>"),"Absence is distinct from a default numeric value");absent.restart();absent.engine.restoreAnimations();check(!absent.shell.values.containsKey(T),"Absent original restored by deleting the key");check(absent.shell.commands.contains("settings delete global "+T),"Fixed delete command used");
        Fixture already=new Fixture();already.shell.values.put(W,"0.50");already.shell.values.put(T,".5");already.shell.values.put(A,"5e-1");already.engine.applyAnimations();check(already.engine.pendingCount()==0&&already.shell.mutations==0,"Numerically unchanged scales create no false changes");check(already.journal.writes==0,"No journal write for an unchanged device");

        Fixture journalFailure=new Fixture();journalFailure.journal.failAt=1;io(()->journalFailure.engine.applyAnimations(),"Failed initial journal");check(journalFailure.shell.mutations==0&&journalFailure.engine.pendingCount()==0,"Failed journal blocks all mutation");
        Fixture lost=new Fixture();lost.shell.throwAfter=1;io(()->lost.engine.applyAnimations(),"Lost command confirmation");check(lost.engine.pendingCount()==1&&"0.5".equals(lost.shell.values.get(W)),"Unconfirmed mutation keeps its original");lost.restart();lost.shell.throwAfter=-1;lost.engine.restoreAnimations();check("1.00".equals(lost.shell.values.get(W))&&lost.engine.pendingCount()==0,"Restart recovers after confirmation loss");
        Fixture notSent=new Fixture();notSent.shell.throwBefore=1;io(()->notSent.engine.applyAnimations(),"Command failure before send");check(notSent.engine.pendingCount()==1&&"1.00".equals(notSent.shell.values.get(W)),"Pending original retained even when delivery is unknown");notSent.shell.throwBefore=-1;int sent=notSent.shell.mutations;notSent.engine.restoreAnimations();check(notSent.shell.mutations==sent&&notSent.engine.pendingCount()==0,"Already original state is verified and cleared without an unnecessary mutation");
        Fixture denied=new Fixture();denied.shell.failCodeAt=1;io(()->denied.engine.applyAnimations(),"Nonzero shell result");check(denied.engine.pendingCount()==1&&denied.shell.mutations==1,"Nonzero result is never called success");

        Fixture wrong=new Fixture();wrong.shell.mismatch=true;io(()->wrong.engine.applyAnimations(),"Wrong apply readback");check(wrong.engine.pendingCount()==1,"Apply mismatch retains journal");io(()->wrong.engine.restoreAnimations(),"Wrong restore readback");check(wrong.engine.pendingCount()==1,"Restore mismatch retains journal");wrong.shell.mismatch=false;wrong.engine.restoreAnimations();check(wrong.engine.pendingCount()==0&&"1.00".equals(wrong.shell.values.get(W)),"Restore can be retried successfully");
        Fixture removeFailure=new Fixture();removeFailure.engine.applyAnimations();removeFailure.journal.failAt=removeFailure.journal.attempts+1;io(()->removeFailure.engine.restoreAnimations(),"Failed journal clear");check(removeFailure.engine.pendingCount()==3,"Failed journal clear retains the in-memory entry");removeFailure.restart();removeFailure.journal.failAt=-1;removeFailure.engine.restoreAnimations();check(removeFailure.engine.pendingCount()==0&&"1.00".equals(removeFailure.shell.values.get(W)),"Restart retries a partially completed restore");

        Fixture prayer=new Fixture();prayer.shell.blockAfter=1;io(()->prayer.engine.applyAnimations(),"Prayer between keys");check(prayer.shell.mutations==1&&prayer.engine.pendingCount()==1,"Prayer prevents the next mutation and retains the original");check("0".equals(prayer.shell.values.get(T)),"Next key remains unchanged");prayer.gate.blocked=false;prayer.shell.blockAfter=-1;prayer.engine.restoreAnimations();check(prayer.engine.pendingCount()==0,"Pending first mutation restores after prayer");
        Fixture blocked=new Fixture();blocked.gate.blocked=true;io(()->blocked.engine.applyAnimations(),"Initial authorization gate");io(()->blocked.engine.restoreAnimations(),"Restore authorization gate");check(blocked.shell.commands.isEmpty()&&blocked.journal.writes==0,"Closed gate sends no command");

        for(String bad:new String[]{"NaN","Infinity","-1","10.1","1;reboot","1'","null"," 1","1 ","1e309"}){Fixture invalid=new Fixture();invalid.shell.values.put(W,bad);io(()->invalid.engine.applyAnimations(),"Invalid scale "+bad);check(invalid.shell.mutations==0&&invalid.journal.writes==0,"Invalid scale cannot enter a command or journal");}
        Fixture duplicate=new Fixture();duplicate.shell.duplicate=true;io(()->duplicate.engine.applyAnimations(),"Duplicate target key");check(duplicate.shell.mutations==0,"Duplicate snapshot fails before mutation");Fixture readDenied=new Fixture();readDenied.shell.badRead=true;io(()->readDenied.engine.applyAnimations(),"Failed snapshot read");check(readDenied.shell.mutations==0,"Read failure never means missing keys");
        for(String malformed:new String[]{"","\n","NoPermission","Error: permission denied","other=1\n",W+"=1\n", "device_provisioned=2\n", "device_provisioned=1\ndevice_provisioned=1\n", "device_provisioned=1\nNoPermission\n", "device_provisioned=1\n"+W+"=1\n"+W+"=1\n", "device_provisioned=1\n "+W+"=1\n"}){Fixture bad=new Fixture();bad.shell.readOverride=malformed;io(()->bad.engine.applyAnimations(),"Incomplete or malformed success output");check(bad.shell.mutations==0&&bad.journal.writes==0,"Incomplete snapshot cannot imply absent originals or send writes");}
        Fixture allAbsent=new Fixture();allAbsent.shell.values.clear();allAbsent.engine.applyAnimations();check(allAbsent.engine.pendingCount()==3&&allAbsent.shell.mutations==3,"A valid full marker allows all three originals to be absent");allAbsent.engine.restoreAnimations();check(allAbsent.shell.values.isEmpty()&&allAbsent.engine.pendingCount()==0,"All three genuinely absent originals restore by deletion");

        byte[] valid=normal.journal.saved.clone();valid[0]^=1;
        List<byte[]> corrupt=new ArrayList<>();corrupt.add(valid);corrupt.add(new byte[0]);corrupt.add(new byte[]{1});corrupt.add(new byte[2049]);corrupt.add(binary(2,new String[0],new int[0],new String[0],false));corrupt.add(binary(1,new String[]{"other_setting"},new int[]{1},new String[]{"1"},false));corrupt.add(binary(1,new String[]{W,W},new int[]{1,1},new String[]{"1","1"},false));corrupt.add(binary(1,new String[]{W},new int[]{2},new String[]{null},false));corrupt.add(binary(1,new String[]{W},new int[]{1},new String[]{"1;reboot"},false));corrupt.add(binary(1,new String[0],new int[0],new String[0],true));corrupt.add(binary(1,new String[]{W,T,A,W},new int[]{1,1,1,1},new String[]{"1","1","1","1"},false));
        for(byte[] bytes:corrupt){Fixture bad=new Fixture();bad.journal.saved=bytes;bad.restart();check(!bad.engine.warning().isEmpty(),"Corrupt journal exposes warning");io(()->bad.engine.applyAnimations(),"Corrupt journal apply");io(()->bad.engine.restoreAnimations(),"Corrupt journal restore");check(bad.shell.commands.isEmpty(),"Corrupt journal fails closed without shell");}
        Fixture unreadable=new Fixture();unreadable.journal.readFailure=true;unreadable.restart();check(!unreadable.engine.warning().isEmpty(),"Read denial exposes warning");io(()->unreadable.engine.applyAnimations(),"Unreadable journal");

        long gib=1073741824L;check(DeviceOptimization.lowStorage(20*gib,gib-1),"Below absolute 1GiB");check(!DeviceOptimization.lowStorage(10*gib,gib),"Exact 1GiB and 10 percent is not below either threshold");check(DeviceOptimization.lowStorage(11*gib,gib),"Below relative 10 percent");check(!DeviceOptimization.lowStorage(5*gib,2*gib),"Enough free space");check(DeviceOptimization.lowStorage(Long.MAX_VALUE,Long.MAX_VALUE/10),"Long-max fractional threshold without multiplication overflow");check(!DeviceOptimization.lowStorage(Long.MAX_VALUE,Long.MAX_VALUE/10+1),"Above long-max 10-percent threshold");check(!DeviceOptimization.lowStorage(Long.MAX_VALUE,Long.MAX_VALUE),"Full free space near long max");check(DeviceOptimization.lowStorage(1,0),"Zero available is low");badSize(0,0);badSize(-1,0);badSize(gib,-1);badSize(gib,gib+1);
        System.out.println("{\"passed\":"+count+",\"failed\":0,\"method\":\"Actual pure Java animation executor with atomic-journal/shell/gate fakes; no Android, socket, ADB daemon or TV settings changed\"}");
    }
}
