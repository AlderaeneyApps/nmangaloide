package com.alderaeney;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The downloads the app handed over (BackgroundDownloadsPlugin), shared with the worker
 * thread of DownloadForegroundService, which downloads them one at a time.
 *
 * Kept in memory only: the app's database is the record of what's queued. If the process
 * dies, the app hands the queue over again the next time it's opened, and the pages
 * already saved are skipped.
 */
final class DownloadQueue {

    enum Status {
        QUEUED,
        DOWNLOADING,
        FAILED,
        FINISHED,
    }

    static final class Page {

        final int number;
        final String url;
        /** Its file name in the staging folder and in the CBZ (`001.webp`…). */
        final String fileName;

        Page(int number, String url, String fileName) {
            this.number = number;
            this.url = url;
            this.fileName = fileName;
        }
    }

    static final class Job {

        final int id;
        volatile String title;
        /** The download folder (a tree URI from DownloadFolderPlugin.pick()). */
        volatile String folderUri;
        /** Contents of gallery.json and ComicInfo.xml in the CBZ. */
        volatile String detailsJson;
        volatile String comicInfoXml;
        volatile List<Page> pages;
        volatile long delayMs;
        volatile Status status = Status.QUEUED;
        volatile int done;
        volatile boolean cancelled;

        Job(int id) {
            this.id = id;
        }

        int total() {
            List<Page> current = pages;
            return current != null ? current.size() : 0;
        }
    }

    /** Called (on the worker thread) when a job's status or progress changes. */
    interface Listener {
        void onChanged(Job job);
    }

    /** Notification texts in the app's language; `{count}`, `{done}`, `{total}` and `{title}` are filled in. */
    static final class Labels {

        final String titleOne;
        final String titleOther;
        final String body;
        final String channel;

        Labels(String titleOne, String titleOther, String body, String channel) {
            this.titleOne = titleOne;
            this.titleOther = titleOther;
            this.body = body;
            this.channel = channel;
        }

        String title(int count) {
            return (count == 1 ? titleOne : titleOther).replace("{count}", String.valueOf(count));
        }

        String body(int done, int total, String title) {
            return body
                .replace("{done}", String.valueOf(done))
                .replace("{total}", String.valueOf(total))
                .replace("{title}", title != null ? title : "");
        }
    }

    static final Labels DEFAULT_LABELS = new Labels(
        "Downloading 1 comic",
        "Downloading {count} comics",
        "{done} / {total} pages · {title}",
        "Downloads"
    );

    private static final Map<Integer, Job> jobs = new LinkedHashMap<>();
    private static boolean workerActive = false;
    private static volatile Listener listener;
    private static volatile Labels labels = DEFAULT_LABELS;

    private DownloadQueue() {}

    /**
     * Adds a job, or updates it if it's already waiting or downloading (its progress is
     * kept). A failed or finished job with the same id is replaced, so it starts again.
     * Returns the job in the queue, and in `workerActive[0]` whether a worker thread is
     * running and will get to it; if not, the service must be started.
     */
    static synchronized Job add(Job incoming, boolean[] workerActiveOut) {
        Job existing = jobs.get(incoming.id);
        Job result;
        if (existing != null && !existing.cancelled && (existing.status == Status.QUEUED || existing.status == Status.DOWNLOADING)) {
            existing.title = incoming.title;
            existing.folderUri = incoming.folderUri;
            existing.detailsJson = incoming.detailsJson;
            existing.comicInfoXml = incoming.comicInfoXml;
            existing.pages = incoming.pages;
            existing.delayMs = incoming.delayMs;
            result = existing;
        } else {
            jobs.remove(incoming.id);
            jobs.put(incoming.id, incoming);
            result = incoming;
        }
        workerActiveOut[0] = workerActive;
        return result;
    }

    /** Removes a job; a running one stops after the page it's on and deletes its files. */
    static synchronized void cancel(int id) {
        Job job = jobs.remove(id);
        if (job != null) {
            job.cancelled = true;
        }
    }

    /** Becomes the worker unless one is running already. */
    static synchronized boolean claimWorker() {
        if (workerActive) {
            return false;
        }
        workerActive = true;
        return true;
    }

    static synchronized boolean isWorkerActive() {
        return workerActive;
    }

    /** The next job to download, marked as downloading; null (and the worker is done) when there's none. */
    static synchronized Job next() {
        for (Job job : jobs.values()) {
            if (job.status == Status.QUEUED && !job.cancelled) {
                job.status = Status.DOWNLOADING;
                return job;
            }
        }
        workerActive = false;
        return null;
    }

    /** The worker stops early (the service was stopped): what it was on waits for the next start. */
    static synchronized void releaseWorker() {
        for (Job job : jobs.values()) {
            if (job.status == Status.DOWNLOADING) {
                job.status = Status.QUEUED;
            }
        }
        workerActive = false;
    }

    static synchronized void finish(Job job) {
        job.status = Status.FINISHED;
        if (jobs.get(job.id) == job) {
            jobs.remove(job.id);
        }
    }

    static synchronized List<Job> snapshot() {
        return new ArrayList<>(jobs.values());
    }

    /** Jobs waiting or downloading (failed ones aren't counted). */
    static synchronized int activeCount() {
        int count = 0;
        for (Job job : jobs.values()) {
            if (!job.cancelled && (job.status == Status.QUEUED || job.status == Status.DOWNLOADING)) {
                count++;
            }
        }
        return count;
    }

    /** The job being downloaded, or else the first one waiting; null if none. */
    static synchronized Job current() {
        Job first = null;
        for (Job job : jobs.values()) {
            if (job.cancelled) {
                continue;
            }
            if (job.status == Status.DOWNLOADING) {
                return job;
            }
            if (first == null && job.status == Status.QUEUED) {
                first = job;
            }
        }
        return first;
    }

    static synchronized void setListener(Listener value) {
        listener = value;
    }

    /** Clears the listener only if it's still `value` (a newer plugin instance may have replaced it). */
    static synchronized void clearListener(Listener value) {
        if (listener == value) {
            listener = null;
        }
    }

    static void changed(Job job) {
        Listener current = listener;
        if (current != null) {
            current.onChanged(job);
        }
    }

    static Labels labels() {
        return labels;
    }

    static void setLabels(Labels value) {
        labels = value != null ? value : DEFAULT_LABELS;
    }
}
