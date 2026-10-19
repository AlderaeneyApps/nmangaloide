package com.alderaeney;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Keeps the app running while downloads are in progress, so they continue with the
 * app in the background or the screen off. Its notification shows the download
 * progress and is updated for every page (see DownloadKeepAlivePlugin).
 *
 * A "data sync" foreground service: Android 15+ limits these to about 6 hours a day,
 * after which onTimeout() stops it (downloads then continue when the app is opened).
 */
public class DownloadForegroundService extends Service {

    static final String CHANNEL_ID = "downloads";
    static final int NOTIFICATION_ID = 4210;
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_DONE = "done";
    static final String EXTRA_TOTAL = "total";
    static final String EXTRA_CHANNEL_NAME = "channelName";
    /** A safety net: the wake lock is released after this long even if stop() never comes. */
    private static final long WAKE_LOCK_TIMEOUT_MS = 6 * 60 * 60 * 1000L;

    private static volatile boolean running = false;
    private PowerManager.WakeLock wakeLock;

    static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power != null) {
            // Without it the CPU can sleep with the screen off, pausing the downloads.
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nMangaloide:downloads");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = buildNotification(this, intent);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        // Not restarted by the system if killed: the app resumes the queue when opened.
        return START_NOT_STICKY;
    }

    /** Android 15+: the daily time allowed for data sync services is used up. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** Replaces the notification while the service runs (no need to restart the service). */
    static void update(Context context, Intent intent) {
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, buildNotification(context, intent));
        } catch (SecurityException e) {
            // Notifications not allowed: the service keeps running without a visible notification.
        }
    }

    static Notification buildNotification(Context context, Intent intent) {
        ensureChannel(context, intent != null ? intent.getStringExtra(EXTRA_CHANNEL_NAME) : null);
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String body = intent != null ? intent.getStringExtra(EXTRA_BODY) : null;
        int done = intent != null ? intent.getIntExtra(EXTRA_DONE, 0) : 0;
        int total = intent != null ? intent.getIntExtra(EXTRA_TOTAL, 0) : 0;

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent open = launch == null
            ? null
            : PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(title != null ? title : "nMangaloide")
            .setContentText(body)
            .setProgress(Math.max(total, 0), Math.min(Math.max(done, 0), Math.max(total, 0)), total <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(open)
            .build();
    }

    /** A quiet channel (no sound, no pop-up), named in the app's language. */
    private static void ensureChannel(Context context, String name) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }
        NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
        String label = name != null && !name.isEmpty() ? name : "Downloads";
        if (existing == null || !label.contentEquals(existing.getName())) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, label, NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
    }
}
