package com.alderaeney;

import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Starts, updates and stops DownloadForegroundService, which keeps downloads going
 * with the app in the background and shows their progress in a notification.
 *
 * update() must be called first while the app is in the foreground: Android 12+ doesn't
 * let apps start foreground services from the background. Later updates only replace
 * the notification.
 */
@CapacitorPlugin(name = "DownloadKeepAlive")
public class DownloadKeepAlivePlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, DownloadForegroundService.class)
            .putExtra(DownloadForegroundService.EXTRA_TITLE, call.getString("title", ""))
            .putExtra(DownloadForegroundService.EXTRA_BODY, call.getString("body", ""))
            .putExtra(DownloadForegroundService.EXTRA_DONE, call.getInt("done", 0))
            .putExtra(DownloadForegroundService.EXTRA_TOTAL, call.getInt("total", 0))
            .putExtra(DownloadForegroundService.EXTRA_CHANNEL_NAME, call.getString("channelName", "Downloads"));
        if (DownloadForegroundService.isRunning()) {
            DownloadForegroundService.update(context, intent);
            call.resolve();
            return;
        }
        try {
            ContextCompat.startForegroundService(context, intent);
            call.resolve();
        } catch (Exception e) {
            // e.g. ForegroundServiceStartNotAllowedException when the app is in the background.
            call.reject("Could not start the download service", "NOT_ALLOWED", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        context.stopService(new Intent(context, DownloadForegroundService.class));
        call.resolve();
    }
}
