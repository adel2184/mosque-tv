package sa.mosque.display;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.JsonReader;
import android.util.JsonToken;
import org.json.JSONObject;
import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.util.HashSet;

/** Android adapters for the limited LAN server. All JSON inspection runs on its socket worker. */
final class AndroidPhonePlatform implements LocalPhoneServer.Platform {
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());

    AndroidPhonePlatform(Context context) { this.context = context.getApplicationContext(); }
    public long now() { return SystemClock.elapsedRealtime(); }
    public void post(Runnable action) { main.post(action); }
    public void clearPending() { main.removeCallbacksAndMessages(null); }
    public InputStream openPage() throws IOException { return context.getAssets().open("phone.html"); }

    public String base64(byte[] digest) { return android.util.Base64.encodeToString(digest, android.util.Base64.NO_WRAP); }

    public String command(String json, String field) throws IOException {
        try (JsonReader reader = new JsonReader(new StringReader(json))) {
            reader.beginObject();
            if (!field.equals(reader.nextName()) || reader.peek() != JsonToken.STRING) throw new IOException("command");
            String value = reader.nextString();
            reader.endObject();
            if (reader.peek() != JsonToken.END_DOCUMENT) throw new IOException("trailing JSON");
            return value;
        }
    }

    public boolean validSettings(String json) {
        try (JsonReader reader = new JsonReader(new StringReader(json))) {
            if (reader.peek() != JsonToken.BEGIN_OBJECT) return false;
            readValue(reader, 0);
            return reader.peek() == JsonToken.END_DOCUMENT;
        } catch (IOException | RuntimeException invalid) { return false; }
    }

    // The phone sends one bounded JSON object. Reject ambiguous keys, malformed JSON and
    // excessive nesting before forwarding anything to the WebView's settings schema.
    private void readValue(JsonReader reader, int depth) throws IOException {
        if (depth > 16) throw new IOException("depth");
        switch (reader.peek()) {
            case BEGIN_OBJECT:
                HashSet<String> keys = new HashSet<>();
                reader.beginObject();
                while (reader.hasNext()) {
                    String key = reader.nextName();
                    if (key.length() > 96 || !keys.add(key)) throw new IOException("key");
                    readValue(reader, depth + 1);
                }
                reader.endObject(); break;
            case BEGIN_ARRAY:
                reader.beginArray();
                while (reader.hasNext()) readValue(reader, depth + 1);
                reader.endArray(); break;
            case STRING: case NUMBER: case BOOLEAN: case NULL:
                reader.skipValue(); break;
            default: throw new IOException("value");
        }
    }

    public int responseStatus(String json) {
        try {
            JSONObject result = new JSONObject(json);
            if (Boolean.TRUE.equals(result.opt("ok"))) return 200;
            switch (result.optString("error")) {
                case "conflict": case "stale": return 409;
                case "invalid": case "schedule": return 400;
                case "expired": return 403;
                default: return 503;
            }
        } catch (org.json.JSONException ignored) { return 503; }
    }
}
