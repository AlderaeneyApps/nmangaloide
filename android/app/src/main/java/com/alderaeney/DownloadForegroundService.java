package com.alderaeney;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.database.Cursor;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Downloads the queued comics (DownloadQueue) natively, so downloads keep going with the
 * app in the background, the screen off, or the app closed from the recent apps list.
 * The app's web view can't do this itself: Android pauses it when it's not visible and
 * destroys it when the app is closed.
 *
 * Like the app did before, one comic at a time, one page at a time, waiting the given
 * delay between pages, with a few attempts per page. Pages go to the app's private
 * storage first (`files/downloading/<id>/`, the same folder the app uses, so an
 * interrupted download resumes where it stopped); then they're packed into
 * `<id>.cbz` in the download folder, written as `<id>.cbz.part` and renamed when complete.
 *
 * A "data sync" foreground service: its notification shows the progress. Android 15+
 * limits these to about 6 hours a day, after which onTimeout() stops it (the downloads
 * then continue when the app is next opened). The service stops itself when the queue is done.
 */
public class DownloadForegroundService extends Service {

    static final String CHANNEL_ID = "downloads";
    static final int NOTIFICATION_ID = 4210;
    /** Attempts per page before the comic's download fails (the same as the app). */
    private static final int PAGE_ATTEMPTS = 3;
    /** A safety net: the locks are released after this long even if the service is never stopped. */
    private static final long LOCK_TIMEOUT_MS = 6 * 60 * 60 * 1000L;
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 60_000;

    private static volatile DownloadForegroundService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object pause = new Object();
    private volatile boolean stopping = false;
    private int lastStartId = 0;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    /** Starts the service (and its worker) for the jobs in DownloadQueue. Throws if Android doesn't allow it now. */
    static void start(Context context) {
        androidx.core.content.ContextCompat.startForegroundService(context, new Intent(context, DownloadForegroundService.class));
    }

    /** Refreshes the notification if the service is running (e.g. after a job was cancelled). */
    static void refresh() {
        DownloadForegroundService service = instance;
        if (service != null) {
            service.main.post(service::updateNotification);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power != null) {
            // Without it the CPU sleeps with the screen off, pausing the downloads.
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nMangaloide:downloads");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(LOCK_TIMEOUT_MS);
        }
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            // Keeps Wi-Fi from dropping into its power saving mode with the screen off.
            int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wifi.createWifiLock(mode, "nMangaloide:downloads");
            wifiLock.setReferenceCounted(false);
            try {
                wifiLock.acquire();
            } catch (RuntimeException e) {
                wifiLock = null;
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        lastStartId = startId;
        // Every start must go to the foreground right away, or Android stops the app.
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        if (!stopping && DownloadQueue.claimWorker()) {
            Thread worker = new Thread(this::work, "nMangaloide downloads");
            worker.setPriority(Thread.NORM_PRIORITY - 1);
            worker.start();
        }
        // Not restarted by the system if killed: the app hands the queue over again when opened.
        return START_NOT_STICKY;
    }

    /** Android 15+: the daily time allowed for data sync services is used up. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopNow();
    }

    @Override
    public void onDestroy() {
        stopping = true;
        wake();
        if (instance == this) {
            instance = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopNow() {
        stopping = true;
        wake();
        stopSelf();
    }

    // --- Worker ---

    private void work() {
        try {
            DownloadQueue.Job job;
            while (!stopping && (job = DownloadQueue.next()) != null) {
                download(job);
            }
        } finally {
            if (stopping) {
                DownloadQueue.releaseWorker();
            }
            // On the main thread, so it can't interleave with onStartCommand: if a job was added
            // meanwhile, a new worker is running (or the newer start keeps the service going).
            main.post(() -> {
                if (!DownloadQueue.isWorkerActive()) {
                    stopSelfResult(lastStartId);
                }
            });
        }
    }

    private void download(DownloadQueue.Job job) {
        File dir = stagingDir(job.id);
        try {
            List<DownloadQueue.Page> pages = new ArrayList<>(job.pages);
            Collections.sort(pages, (a, b) -> Integer.compare(a.number, b.number));
            if (!dir.isDirectory() && !dir.mkdirs()) {
                throw new IOException("Could not create " + dir);
            }
            int done = 0;
            for (DownloadQueue.Page page : pages) {
                if (new File(dir, page.fileName).isFile()) {
                    done++;
                }
            }
            job.done = done;
            changed(job);

            boolean first = true;
            for (DownloadQueue.Page page : pages) {
                if (job.cancelled || stopping) {
                    break;
                }
                File file = new File(dir, page.fileName);
                if (file.isFile()) {
                    continue;
                }
                if (!first) {
                    sleep(job.delayMs);
                }
                first = false;
                if (job.cancelled || stopping) {
                    break;
                }
                fetchPage(page.url, file, job);
                if (job.cancelled) {
                    break;
                }
                job.done = ++done;
                changed(job);
            }
            if (job.cancelled) {
                deleteFiles(job);
                return;
            }
            if (stopping) {
                return; // releaseWorker() puts it back in the queue
            }

            writeCbz(job, dir, pages);
            if (job.cancelled) {
                deleteFiles(job);
                return;
            }
            deleteRecursively(dir);
            DownloadQueue.finish(job);
            changed(job);
        } catch (Exception e) {
            if (job.cancelled) {
                deleteFiles(job);
            } else if (!stopping) {
                job.status = DownloadQueue.Status.FAILED;
                changed(job);
            }
        }
    }

    /** One page into `file`, with a few attempts, waiting longer after each failure (a rate limit eases off). */
    private void fetchPage(String url, File file, DownloadQueue.Job job) throws IOException {
        IOException last = null;
        for (int attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
            try {
                fetch(url, file);
                return;
            } catch (IOException e) {
                last = e;
                if (attempt < PAGE_ATTEMPTS && !job.cancelled && !stopping) {
                    sleep(job.delayMs * attempt);
                }
                if (job.cancelled || stopping) {
                    throw e;
                }
            }
        }
        throw last;
    }

    /** Downloads to a temporary file, renamed when complete, so a partial page is never taken for a saved one. */
    private void fetch(String url, File file) throws IOException {
        File temp = new File(file.getParentFile(), file.getName() + ".tmp");
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException("HTTP " + code + " for " + url);
            }
            long size = 0;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    size += read;
                }
            }
            if (size == 0) {
                throw new IOException("Empty page " + url);
            }
            if (!temp.renameTo(file)) {
                throw new IOException("Could not save " + file);
            }
        } finally {
            connection.disconnect();
            if (temp.exists()) {
                //noinspection ResultOfMethodCallIgnored
                temp.delete();
            }
        }
    }

    /**
     * Packs the pages into `<id>.cbz` in the download folder: gallery.json, ComicInfo.xml
     * and the pages, stored uncompressed (the images already are), like the app's ZipWriter.
     */
    private void writeCbz(DownloadQueue.Job job, File dir, List<DownloadQueue.Page> pages) throws IOException {
        ContentResolver resolver = getContentResolver();
        Uri tree = Uri.parse(job.folderUri);
        String folder = DocumentsContract.getTreeDocumentId(tree);
        String partName = job.id + ".cbz.part";
        String cbzName = job.id + ".cbz";

        // Replaces a part left over from an interrupted attempt.
        deleteChild(tree, folder, partName);
        Uri part = DocumentsContract.createDocument(
            resolver,
            DocumentsContract.buildDocumentUriUsingTree(tree, folder),
            "application/octet-stream",
            partName
        );
        if (part == null) {
            throw new IOException("Could not create " + partName);
        }
        try (OutputStream raw = resolver.openOutputStream(part, "wt")) {
            if (raw == null) {
                throw new IOException("Could not open " + partName);
            }
            ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(raw, 256 * 1024), StandardCharsets.UTF_8);
            long now = System.currentTimeMillis();
            putStored(zip, "gallery.json", text(job.detailsJson), now);
            putStored(zip, "ComicInfo.xml", text(job.comicInfoXml), now);
            for (DownloadQueue.Page page : pages) {
                if (job.cancelled) {
                    zip.close();
                    return;
                }
                putStored(zip, page.fileName, readFile(new File(dir, page.fileName)), now);
            }
            zip.finish();
            zip.flush();
        }
        if (job.cancelled) {
            return;
        }
        deleteChild(tree, folder, cbzName);
        String partId = DocumentsContract.getDocumentId(part);
        Uri renamed = DocumentsContract.renameDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, partId), cbzName);
        if (renamed == null) {
            throw new IOException("Could not rename " + partName);
        }
    }

    private static void putStored(ZipOutputStream zip, String name, byte[] data, long time) throws IOException {
        ZipEntry entry = new ZipEntry(name);
        CRC32 crc = new CRC32();
        crc.update(data);
        entry.setMethod(ZipEntry.STORED);
        entry.setSize(data.length);
        entry.setCompressedSize(data.length);
        entry.setCrc(crc.getValue());
        entry.setTime(time);
        zip.putNextEntry(entry);
        zip.write(data);
        zip.closeEntry();
    }

    private static byte[] text(String value) {
        return (value != null ? value : "").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] readFile(File file) throws IOException {
        long length = file.length();
        if (length > Integer.MAX_VALUE) {
            throw new IOException("Page too large: " + file);
        }
        byte[] data = new byte[(int) length];
        try (InputStream in = new FileInputStream(file)) {
            int offset = 0;
            while (offset < data.length) {
                int read = in.read(data, offset, data.length - offset);
                if (read < 0) {
                    throw new IOException("Unexpected end of " + file);
                }
                offset += read;
            }
        }
        return data;
    }

    /** The staged pages and any part file of a cancelled download (the app deletes them too). */
    private void deleteFiles(DownloadQueue.Job job) {
        deleteRecursively(stagingDir(job.id));
        try {
            Uri tree = Uri.parse(job.folderUri);
            deleteChild(tree, DocumentsContract.getTreeDocumentId(tree), job.id + ".cbz.part");
        } catch (Exception ignored) {
            // No folder access: nothing was written there.
        }
    }

    private void deleteChild(Uri tree, String folder, String name) throws IOException {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, folder);
        String[] columns = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME };
        String id = null;
        try (Cursor cursor = getContentResolver().query(children, columns, null, null, null)) {
            if (cursor == null) {
                throw new IOException("The download folder can't be read");
            }
            while (cursor.moveToNext()) {
                if (name.equals(cursor.getString(1))) {
                    id = cursor.getString(0);
                    break;
                }
            }
        }
        if (id != null) {
            DocumentsContract.deleteDocument(getContentResolver(), DocumentsContract.buildDocumentUriUsingTree(tree, id));
        }
    }

    /** The folder the app's Filesystem `LibraryNoCloud` + `downloading/<id>` points to on Android. */
    private File stagingDir(int id) {
        return new File(new File(getFilesDir(), "downloading"), String.valueOf(id));
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private void sleep(long ms) {
        if (ms <= 0) {
            return;
        }
        long until = System.currentTimeMillis() + ms;
        synchronized (pause) {
            long left;
            while (!stopping && (left = until - System.currentTimeMillis()) > 0) {
                try {
                    pause.wait(left);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    private void wake() {
        synchronized (pause) {
            pause.notifyAll();
        }
    }

    private void changed(DownloadQueue.Job job) {
        DownloadQueue.changed(job);
        main.post(this::updateNotification);
    }

    // --- Notification ---

    private void updateNotification() {
        if (stopping || DownloadQueue.activeCount() == 0) {
            return; // the service is about to stop, taking the notification with it
        }
        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification());
        } catch (SecurityException e) {
            // Notifications not allowed: the downloads go on without a visible notification.
        }
    }

    /** "Downloading 2 comics", "12 / 40 pages · title", with a progress bar for the current comic. */
    private Notification buildNotification() {
        DownloadQueue.Labels labels = DownloadQueue.labels();
        ensureChannel(this, labels.channel);
        int count = DownloadQueue.activeCount();
        DownloadQueue.Job current = DownloadQueue.current();
        int done = current != null ? current.done : 0;
        int total = current != null ? current.total() : 0;

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent open = launch == null
            ? null
            : PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(labels.title(Math.max(count, 1)))
            .setContentText(current != null ? labels.body(done, total, current.title) : null)
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
