package sa.mosque.display;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.CRC32;

/** Android-free, fixed animation settings only. The host supplies authorized shell and atomic storage. */
final class DeviceOptimization {
    interface Shell { Reply run(String command) throws IOException; }
    interface Journal { byte[] read() throws IOException; void write(byte[] bytes) throws IOException; }
    interface Gate { void check() throws IOException; }
    static final class Reply {
        final String output;
        final int code;
        Reply(String output, int code) { this.output = output; this.code = code; }
    }
    private static final String[] KEYS = {
            "window_animation_scale", "transition_animation_scale", "animator_duration_scale"
    };
    private static final String TARGET = "0.5";
    private static final int MAGIC = 0x4d4f5054, VERSION = 1, MAX_JOURNAL = 2048, MAX_OUTPUT = 512 * 1024;
    private final Shell shell;
    private final Journal journal;
    private final Gate gate;
    private volatile Map<String, Original> pending = Collections.emptyMap();
    private final String journalWarning;

    private static final class Original {
        final boolean present;
        final String raw;
        Original(boolean present, String raw) { this.present = present; this.raw = raw; }
    }

    DeviceOptimization(Shell shell, Journal journal, Gate gate) {
        if (shell == null || journal == null || gate == null) throw new IllegalArgumentException("Missing optimization dependency.");
        this.shell = shell; this.journal = journal; this.gate = gate;
        String problem = "";
        try {
            byte[] saved = journal.read();
            if (saved != null) pending = immutable(decode(saved));
        } catch (IOException | RuntimeException error) {
            problem = "تعذر قراءة سجل الحركات؛ لن يُنفذ ضبط أو استعادة آلية حتى مراجعة السجل.";
        }
        journalWarning = problem;
    }

    int pendingCount() { return pending.size(); }
    String warning() { return journalWarning; }

    /** A local snapshot only: safe for UI drawing while a shell operation is blocked. */
    String summary() {
        Map<String, Original> snapshot = pending;
        if (!journalWarning.isEmpty()) return journalWarning;
        StringBuilder text = new StringBuilder();
        for (String key : KEYS) {
            Original before = snapshot.get(key);
            if (before == null) continue;
            if (text.length() != 0) text.append('\n');
            text.append(key).append(": original=").append(before.present ? before.raw : "<absent>");
        }
        return text.length() == 0 ? "لا توجد قيم حركات مسجلة للاستعادة." : text.toString();
    }

    synchronized String applyAnimations() throws IOException {
        requireReady();
        Map<String, String> current = readSnapshot();
        int changed = 0;
        for (String key : KEYS) {
            gate.check();
            String raw = current.get(key);
            if (raw != null && Double.compare(Double.parseDouble(raw), 0.5d) == 0) continue;
            if (!pending.containsKey(key)) {
                Map<String, Original> next = new LinkedHashMap<>(pending);
                next.put(key, new Original(raw != null, raw));
                persist(next); // Never send the mutation unless its original value is durable.
            }
            gate.check();
            mutate("settings put global " + key + " '" + TARGET + "'");
            // Finish checking an in-flight change even if the next operation is prayer-blocked.
            current = readSnapshot();
            if (!TARGET.equals(current.get(key))) throw new IOException("لم تتطابق قراءة إعداد الحركات بعد ضبطه؛ بقي سجل الاستعادة محفوظًا.");
            changed++;
        }
        return "أكد الجهاز ضبط " + changed + " من إعدادات الحركات على 0.5. القيم الأصلية المسجلة متاحة للاستعادة.";
    }

    synchronized String restoreAnimations() throws IOException {
        requireReady();
        if (pending.isEmpty()) return "لا توجد تغييرات حركات مسجلة للاستعادة.";
        Map<String, String> current = readSnapshot();
        int restored = 0;
        for (String key : KEYS) {
            Original before = pending.get(key);
            if (before == null) continue;
            gate.check();
            if (!matches(current, key, before)) {
                gate.check();
                mutate(before.present ? "settings put global " + key + " '" + before.raw + "'"
                        : "settings delete global " + key);
                current = readSnapshot();
                if (!matches(current, key, before)) throw new IOException("لم تتأكد استعادة قيمة الحركات الأصلية؛ بقي سجل العنصر محفوظًا.");
            }
            Map<String, Original> next = new LinkedHashMap<>(pending);
            next.remove(key);
            persist(next); // A failed journal clear retains the entry for a verified retry.
            restored++;
        }
        return "أكد الجهاز استعادة " + restored + " من إعدادات الحركات إلى قيمها الأصلية المسجلة.";
    }

    static boolean lowStorage(long total, long available) {
        if (total <= 0 || available < 0 || available > total) throw new IllegalArgumentException("Invalid storage sizes.");
        // available * 10 could overflow. Preserve the strict <10% comparison, including a remainder.
        return available < 1073741824L || available < total / 10
                || (available == total / 10 && total % 10 != 0);
    }

    private void requireReady() throws IOException {
        if (!journalWarning.isEmpty()) throw new IOException(journalWarning);
        gate.check();
    }

    private static boolean allowed(String key) {
        for (String candidate : KEYS) if (candidate.equals(key)) return true;
        return false;
    }

    private static boolean numeric(String raw) {
        if (raw == null || raw.length() == 0 || raw.length() > 32
                || !raw.matches("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?")) return false;
        try { double value = Double.parseDouble(raw); return Double.isFinite(value) && value >= 0 && value <= 10; }
        catch (NumberFormatException error) { return false; }
    }

    private Map<String, String> readSnapshot() throws IOException {
        Reply reply = shell.run("settings list global");
        if (reply == null || reply.code != 0 || reply.output == null || reply.output.length() > MAX_OUTPUT)
            throw new IOException("تعذر قراءة إعدادات الحركات كاملة؛ لم يُفترض نجاح الأمر.");
        Map<String, String> values = new LinkedHashMap<>();
        boolean provisioned = false;
        for (String line : reply.output.split("\n", -1)) {
            if (line.endsWith("\r")) line = line.substring(0, line.length() - 1);
            if (line.isEmpty()) continue;
            int at = line.indexOf('=');
            if (at <= 0 || !line.substring(0, at).matches("[A-Za-z0-9_.-]+"))
                throw new IOException("إخراج إعدادات الجهاز غير مكتمل أو غير مقروء؛ لم يُفترض غياب القيم.");
            String key = line.substring(0, at);
            String value = line.substring(at + 1);
            if (key.equals("device_provisioned")) {
                if (provisioned || !(value.equals("0") || value.equals("1")))
                    throw new IOException("تعذر تأكيد اكتمال قراءة إعدادات الجهاز.");
                provisioned = true;
                continue;
            }
            if (!allowed(key)) continue;
            if (values.containsKey(key) || !numeric(value)) throw new IOException("قراءة إعدادات الحركات مكررة أو خارج المجال المسموح.");
            values.put(key, value);
        }
        if (!provisioned) throw new IOException("لم تظهر علامة اكتمال قراءة إعدادات الجهاز؛ لم يُفترض غياب قيم الحركات.");
        return values;
    }

    private void mutate(String command) throws IOException {
        Reply reply = shell.run(command);
        if (reply == null || reply.code != 0) throw new IOException("لم يؤكد الجهاز أمر الحركات؛ بقي سجل الاستعادة محفوظًا.");
    }

    private static boolean matches(Map<String, String> values, String key, Original before) {
        return before.present ? before.raw.equals(values.get(key)) : !values.containsKey(key);
    }

    private void persist(Map<String, Original> values) throws IOException {
        journal.write(encode(values));
        pending = immutable(values);
    }

    private static Map<String, Original> immutable(Map<String, Original> values) {
        return Collections.unmodifiableMap(new LinkedHashMap<>(values));
    }

    private static byte[] encode(Map<String, Original> values) throws IOException {
        if (values.size() > KEYS.length) throw new IOException("Too many animation entries.");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeInt(MAGIC); out.writeInt(VERSION); out.writeInt(values.size());
        for (String key : KEYS) {
            Original before = values.get(key);
            if (before == null) continue;
            if (before.present && !numeric(before.raw)) throw new IOException("Invalid saved animation value.");
            out.writeUTF(key); out.writeByte(before.present ? 1 : 0);
            if (before.present) out.writeUTF(before.raw);
        }
        out.flush(); byte[] payload = bytes.toByteArray();
        CRC32 crc = new CRC32(); crc.update(payload); out.writeInt((int)crc.getValue()); out.flush();
        byte[] encoded = bytes.toByteArray();
        if (encoded.length > MAX_JOURNAL) throw new IOException("Animation journal exceeds limit.");
        return encoded;
    }

    private static Map<String, Original> decode(byte[] bytes) throws IOException {
        if (bytes.length < 16 || bytes.length > MAX_JOURNAL) throw new IOException("Invalid animation journal size.");
        int payloadSize = bytes.length - 4;
        CRC32 crc = new CRC32(); crc.update(bytes, 0, payloadSize);
        DataInputStream checksum = new DataInputStream(new ByteArrayInputStream(bytes, payloadSize, 4));
        if ((int)crc.getValue() != checksum.readInt()) throw new IOException("Animation journal checksum mismatch.");
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(bytes, 0, payloadSize));
        if (in.readInt() != MAGIC || in.readInt() != VERSION) throw new IOException("Unsupported animation journal.");
        int count = in.readInt(); if (count < 0 || count > KEYS.length) throw new IOException("Invalid animation entry count.");
        Map<String, Original> result = new LinkedHashMap<>();
        for (int i = 0; i < count; i++) {
            String key = in.readUTF(); int presence = in.readUnsignedByte();
            if (!allowed(key) || result.containsKey(key) || presence > 1) throw new IOException("Unknown or duplicate animation entry.");
            String raw = presence == 1 ? in.readUTF() : null;
            if (presence == 1 && !numeric(raw)) throw new IOException("Invalid original animation scale.");
            result.put(key, new Original(presence == 1, raw));
        }
        if (in.read() != -1) throw new IOException("Trailing animation journal data.");
        return result;
    }
}
