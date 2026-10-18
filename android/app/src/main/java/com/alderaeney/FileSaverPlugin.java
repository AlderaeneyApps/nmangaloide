package com.alderaeney;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Saves a file wherever the user chooses, through Android's "Save as" picker
 * (Storage Access Framework): internal storage folders, SD cards, or any installed
 * storage provider. No storage permission is needed.
 *
 * The file's contents are not passed through the plugin call: Capacitor stores the
 * call's options in the activity's saved state while the picker is open, and a large
 * backup there makes Android kill the app (TransactionTooLargeException). Instead the
 * app writes the file to its cache first and passes its URI; it's copied from there.
 */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    @PluginMethod
    public void saveAs(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || cacheFile(call.getString("sourceUri")) == null) {
            call.reject("fileName and a sourceUri in the app's cache are required", "INVALID");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "onDocumentCreated");
    }

    @ActivityCallback
    private void onDocumentCreated(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent intent = result.getData();
        Uri target = intent != null ? intent.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || target == null) {
            call.reject("Save cancelled", "CANCELLED");
            return;
        }
        File source = cacheFile(call.getString("sourceUri"));
        if (source == null) {
            call.reject("The file to save is gone", "WRITE_FAILED");
            return;
        }
        try (
            InputStream in = new FileInputStream(source);
            OutputStream out = getContext().getContentResolver().openOutputStream(target, "wt")
        ) {
            if (out == null) {
                throw new IOException("Could not open the chosen file");
            }
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            JSObject ret = new JSObject();
            ret.put("uri", target.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not save the file", "WRITE_FAILED", e);
        }
    }

    /** The file behind `sourceUri`, only if it's a file inside the app's cache folder. */
    private File cacheFile(String sourceUri) {
        if (sourceUri == null) {
            return null;
        }
        String path = Uri.parse(sourceUri).getPath();
        if (path == null) {
            return null;
        }
        try {
            File file = new File(path).getCanonicalFile();
            File cache = getContext().getCacheDir().getCanonicalFile();
            boolean insideCache = file.getPath().startsWith(cache.getPath() + File.separator);
            return insideCache && file.isFile() ? file : null;
        } catch (IOException e) {
            return null;
        }
    }
}
