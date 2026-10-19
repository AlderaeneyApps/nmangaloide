package com.alderaeney;

import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Hands downloads over to DownloadForegroundService, which downloads them natively so
 * they continue with the app in the background, the screen off, or the app closed.
 * Progress comes back as `progress` events: `{ id, done, total, status }`, status being
 * `queued`, `downloading`, `failed` or `finished` (the CBZ is in the download folder).
 *
 * enqueue() must be called with the app in the foreground when the service isn't running:
 * Android 12+ doesn't let apps start foreground services from the background. It then
 * rejects with code NOT_ALLOWED; the job stays queued and starts on the next enqueue().
 */
@CapacitorPlugin(name = "BackgroundDownloads")
public class BackgroundDownloadsPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private final DownloadQueue.Listener listener = (job) -> {
        JSObject event = toJs(job);
        main.post(() -> notifyListeners("progress", event));
    };

    @Override
    public void load() {
        DownloadQueue.setListener(listener);
    }

    @Override
    protected void handleOnDestroy() {
        // The downloads go on; the next instance (when the app is opened again) listens instead.
        DownloadQueue.clearListener(listener);
        super.handleOnDestroy();
    }

    /**
     * Queues a comic: `{ id, title, folderUri, detailsJson, comicInfoXml, delayMs,
     * pages: [{ number, url, fileName }] }`. Resolves with its state; a comic already
     * queued or downloading is updated and keeps its progress.
     */
    @PluginMethod
    public void enqueue(PluginCall call) {
        DownloadQueue.Job job;
        try {
            job = parseJob(call);
        } catch (JSONException | IllegalArgumentException e) {
            call.reject("Invalid download: " + e.getMessage(), "INVALID", e);
            return;
        }
        boolean[] workerActive = new boolean[1];
        DownloadQueue.Job queued = DownloadQueue.add(job, workerActive);
        if (workerActive[0]) {
            DownloadForegroundService.refresh();
            call.resolve(toJs(queued));
            return;
        }
        try {
            DownloadForegroundService.start(getContext());
            call.resolve(toJs(queued));
        } catch (Exception e) {
            // e.g. ForegroundServiceStartNotAllowedException when the app is in the background.
            call.reject("Could not start the download service", "NOT_ALLOWED", e);
        }
    }

    /** Stops a download (after the page it's on) and deletes its files. */
    @PluginMethod
    public void cancel(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) {
            call.reject("An id is required", "INVALID");
            return;
        }
        DownloadQueue.cancel(id);
        DownloadForegroundService.refresh();
        call.resolve();
    }

    /** The comics handed over and their state (finished ones are no longer listed). */
    @PluginMethod
    public void list(PluginCall call) {
        JSArray jobs = new JSArray();
        for (DownloadQueue.Job job : DownloadQueue.snapshot()) {
            jobs.put(toJs(job));
        }
        JSObject ret = new JSObject();
        ret.put("jobs", jobs);
        call.resolve(ret);
    }

    /** The notification's texts in the app's language, with `{count}`, `{done}`, `{total}` and `{title}`. */
    @PluginMethod
    public void setLabels(PluginCall call) {
        DownloadQueue.Labels fallback = DownloadQueue.DEFAULT_LABELS;
        DownloadQueue.setLabels(
            new DownloadQueue.Labels(
                call.getString("titleOne", fallback.titleOne),
                call.getString("titleOther", fallback.titleOther),
                call.getString("body", fallback.body),
                call.getString("channel", fallback.channel)
            )
        );
        DownloadForegroundService.refresh();
        call.resolve();
    }

    private static DownloadQueue.Job parseJob(PluginCall call) throws JSONException {
        Integer id = call.getInt("id");
        String folderUri = call.getString("folderUri");
        JSONArray pages = call.getArray("pages", new JSArray());
        if (id == null || folderUri == null || folderUri.isEmpty()) {
            throw new IllegalArgumentException("id and folderUri are required");
        }
        List<DownloadQueue.Page> list = new ArrayList<>();
        for (int i = 0; i < pages.length(); i++) {
            JSONObject page = pages.getJSONObject(i);
            String fileName = page.getString("fileName");
            if (fileName.isEmpty() || fileName.contains("/") || fileName.contains("\\") || fileName.startsWith(".")) {
                throw new IllegalArgumentException("Invalid page file name " + fileName);
            }
            list.add(new DownloadQueue.Page(page.getInt("number"), page.getString("url"), fileName));
        }
        DownloadQueue.Job job = new DownloadQueue.Job(id);
        job.title = call.getString("title", "");
        job.folderUri = folderUri;
        job.detailsJson = call.getString("detailsJson", "{}");
        job.comicInfoXml = call.getString("comicInfoXml", "");
        job.pages = list;
        // getLong() only accepts values too large for an int.
        Integer delay = call.getInt("delayMs");
        job.delayMs = delay != null ? Math.max(0, delay) : 1000;
        return job;
    }

    private static JSObject toJs(DownloadQueue.Job job) {
        JSObject ret = new JSObject();
        ret.put("id", job.id);
        ret.put("done", job.done);
        ret.put("total", job.total());
        ret.put("status", job.status.name().toLowerCase(Locale.ROOT));
        return ret;
    }
}
