package sa.mosque.display;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Explicit, non-exported PackageInstaller callback; it never opens an Activity itself. */
public final class UpdateInstallReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        UpdateManager.receiveInstallResult(context, intent);
    }
}
