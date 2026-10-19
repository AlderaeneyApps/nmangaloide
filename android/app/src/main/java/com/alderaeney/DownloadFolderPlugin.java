package com.alderaeney;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;

/**
 * The folder where downloads are saved, chosen by the user through Android's folder
 * picker (Storage Access Framework): any folder in internal storage, an SD card or a
 * storage provider. The app keeps access to it across restarts (a persisted URI
 * permission), and no storage permission is needed.
 *
 * Paths are lists of folder names below the chosen folder ("tree"); downloads are
 * CBZ files right in the chosen folder (path []). Files are listed with their document
 * URIs, which the web view can read through Capacitor.convertFileSrc(). A CBZ is
 * written in pieces (writeFile, then appendFile) under a temporary name, then renamed.
 */
@CapacitorPlugin(name = "DownloadFolder")
public class DownloadFolderPlugin extends Plugin {

    private static final int ACCESS_FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    /** One child of a folder, from a single query of the documents provider. */
    private static final class Child {

        final String id;
        final String name;
        final boolean directory;

        Child(String id, String name, String mimeType) {
            this.id = id;
            this.name = name;
            this.directory = Document.MIME_TYPE_DIR.equals(mimeType);
        }
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(ACCESS_FLAGS | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "onFolderPicked");
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        Uri tree = data != null ? data.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || tree == null) {
            call.reject("Folder picker cancelled", "CANCELLED");
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        try {
            resolver.takePersistableUriPermission(tree, ACCESS_FLAGS);
        } catch (SecurityException e) {
            call.reject("Could not keep access to the folder", "NO_ACCESS", e);
            return;
        }
        // Only one download folder at a time: let go of folders chosen before.
        for (UriPermission permission : resolver.getPersistedUriPermissions()) {
            Uri uri = permission.getUri();
            if (!uri.equals(tree) && DocumentsContract.isTreeUri(uri)) {
                try {
                    resolver.releasePersistableUriPermission(uri, ACCESS_FLAGS);
                } catch (SecurityException ignored) {
                    // Already gone.
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        ret.put("name", folderName(tree));
        call.resolve(ret);
    }

    /** Whether the app still has read and write access to the folder (the user can revoke it). */
    @PluginMethod
    public void hasAccess(PluginCall call) {
        Uri tree = treeUri(call);
        if (tree == null) {
            return;
        }
        boolean granted = false;
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(tree) && permission.isReadPermission() && permission.isWritePermission()) {
                granted = true;
                break;
            }
        }
        if (granted) {
            try {
                // The folder itself may have been deleted.
                children(tree, DocumentsContract.getTreeDocumentId(tree));
            } catch (Exception e) {
                granted = false;
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /** The files and folders in `path`; an empty list if the folder doesn't exist. */
    @PluginMethod
    public void list(PluginCall call) {
        Uri tree = treeUri(call);
        List<String> path = path(call);
        if (tree == null || path == null) {
            return;
        }
        try {
            String folder = find(tree, path, false);
            JSArray entries = new JSArray();
            if (folder != null) {
                for (Child child : children(tree, folder)) {
                    JSObject entry = new JSObject();
                    entry.put("name", child.name);
                    entry.put("type", child.directory ? "directory" : "file");
                    entry.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, child.id).toString());
                    entries.put(entry);
                }
            }
            JSObject ret = new JSObject();
            ret.put("entries", entries);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not list the folder", "READ_FAILED", e);
        }
    }

    /** Writes base64 `data` to `name` in `path`, creating the folders and replacing the file. */
    @PluginMethod
    public void writeFile(PluginCall call) {
        Uri tree = treeUri(call);
        List<String> path = path(call);
        String name = call.getString("name");
        String data = call.getString("data");
        if (tree == null || path == null) {
            return;
        }
        if (!isSafeName(name) || data == null) {
            call.reject("A file name and data are required", "INVALID");
            return;
        }
        try {
            String folder = find(tree, path, true);
            ContentResolver resolver = getContext().getContentResolver();
            Child existing = child(tree, folder, name);
            Uri file;
            if (existing != null && !existing.directory) {
                file = DocumentsContract.buildDocumentUriUsingTree(tree, existing.id);
            } else {
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, folder);
                file = DocumentsContract.createDocument(resolver, parent, call.getString("mimeType", "application/octet-stream"), name);
                if (file == null) {
                    throw new IOException("Could not create " + name);
                }
            }
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            try (OutputStream out = resolver.openOutputStream(file, "wt")) {
                if (out == null) {
                    throw new IOException("Could not open " + name);
                }
                out.write(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("uri", file.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not write the file", "WRITE_FAILED", e);
        }
    }

    /** Adds base64 `data` to the end of `name` in `path` (created if missing). */
    @PluginMethod
    public void appendFile(PluginCall call) {
        Uri tree = treeUri(call);
        List<String> path = path(call);
        String name = call.getString("name");
        String data = call.getString("data");
        if (tree == null || path == null) {
            return;
        }
        if (!isSafeName(name) || data == null) {
            call.reject("A file name and data are required", "INVALID");
            return;
        }
        try {
            String folder = find(tree, path, true);
            ContentResolver resolver = getContext().getContentResolver();
            Child existing = child(tree, folder, name);
            Uri file;
            if (existing != null && !existing.directory) {
                file = DocumentsContract.buildDocumentUriUsingTree(tree, existing.id);
            } else {
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, folder);
                file = DocumentsContract.createDocument(resolver, parent, "application/octet-stream", name);
                if (file == null) {
                    throw new IOException("Could not create " + name);
                }
            }
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            try (OutputStream out = resolver.openOutputStream(file, "wa")) {
                if (out == null) {
                    throw new IOException("Could not open " + name);
                }
                out.write(bytes);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not write the file", "WRITE_FAILED", e);
        }
    }

    /** Renames `from` to `to` in `path`, replacing an existing `to`. */
    @PluginMethod
    public void rename(PluginCall call) {
        Uri tree = treeUri(call);
        List<String> path = path(call);
        String from = call.getString("from");
        String to = call.getString("to");
        if (tree == null || path == null) {
            return;
        }
        if (!isSafeName(from) || !isSafeName(to)) {
            call.reject("Both names are required", "INVALID");
            return;
        }
        try {
            String folder = find(tree, path, false);
            Child source = folder != null ? child(tree, folder, from) : null;
            if (source == null) {
                call.reject("No such file", "NOT_FOUND");
                return;
            }
            ContentResolver resolver = getContext().getContentResolver();
            Child target = child(tree, folder, to);
            if (target != null) {
                DocumentsContract.deleteDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, target.id));
            }
            Uri renamed = DocumentsContract.renameDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, source.id), to);
            if (renamed == null) {
                throw new IOException("Could not rename " + from);
            }
            JSObject ret = new JSObject();
            ret.put("uri", renamed.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not rename the file", "WRITE_FAILED", e);
        }
    }

    /** A file's contents as base64. */
    @PluginMethod
    public void readFile(PluginCall call) {
        Uri tree = treeUri(call);
        List<String> path = path(call);
        String name = call.getString("name");
        if (tree == null || path == null) {
            return;
        }
        try {
            String folder = find(tree, path, false);
            Child file = folder != null && isSafeName(name) ? child(tree, folder, name) : null;
            if (file == null || file.directory) {
                call.reject("No such file", "NOT_FOUND");
                return;
            }
            Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, file.id);
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) {
                    throw new FileNotFoundException(name);
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                call.resolve(ret);
            }
        } catch (Exception e) {
            call.reject("Could not read the file", "READ_FAILED", e);
        }
    }

    /** Deletes the file or folder (with everything in it) at `path`. Nothing happens if it's not there. */
    @PluginMethod
    public void remove(PluginCall call) {
        Uri tree = treeUri(call);
        List<String> path = path(call);
        if (tree == null || path == null) {
            return;
        }
        if (path.isEmpty()) {
            call.reject("The download folder itself can't be removed", "INVALID");
            return;
        }
        try {
            String folder = find(tree, path.subList(0, path.size() - 1), false);
            Child target = folder != null ? child(tree, folder, path.get(path.size() - 1)) : null;
            if (target != null) {
                DocumentsContract.deleteDocument(getContext().getContentResolver(), DocumentsContract.buildDocumentUriUsingTree(tree, target.id));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not delete", "WRITE_FAILED", e);
        }
    }

    // --- Helpers ---

    private Uri treeUri(PluginCall call) {
        String value = call.getString("uri");
        Uri uri = value != null ? Uri.parse(value) : null;
        if (uri == null || !DocumentsContract.isTreeUri(uri)) {
            call.reject("A folder from pick() is required", "INVALID");
            return null;
        }
        return uri;
    }

    private List<String> path(PluginCall call) {
        List<String> segments = new ArrayList<>();
        JSONArray array = call.getArray("path", new JSArray());
        try {
            for (int i = 0; i < array.length(); i++) {
                String segment = array.getString(i);
                if (!isSafeName(segment)) {
                    call.reject("Invalid path", "INVALID");
                    return null;
                }
                segments.add(segment);
            }
        } catch (JSONException e) {
            call.reject("Invalid path", "INVALID");
            return null;
        }
        return segments;
    }

    /** A single file or folder name: no separators, no "." or "..". */
    private static boolean isSafeName(String name) {
        return name != null && !name.isEmpty() && !name.equals(".") && !name.equals("..") && !name.contains("/") && !name.contains("\\");
    }

    /** The document id of `path` below the tree's folder, creating missing folders if asked; null if missing. */
    private String find(Uri tree, List<String> path, boolean create) throws IOException {
        String current = DocumentsContract.getTreeDocumentId(tree);
        ContentResolver resolver = getContext().getContentResolver();
        for (String segment : path) {
            Child next = child(tree, current, segment);
            if (next != null && next.directory) {
                current = next.id;
                continue;
            }
            if (!create) {
                return null;
            }
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, current);
            Uri created = DocumentsContract.createDocument(resolver, parent, Document.MIME_TYPE_DIR, segment);
            if (created == null) {
                throw new IOException("Could not create the folder " + segment);
            }
            current = DocumentsContract.getDocumentId(created);
        }
        return current;
    }

    private Child child(Uri tree, String folder, String name) {
        for (Child child : children(tree, folder)) {
            if (child.name.equals(name)) {
                return child;
            }
        }
        return null;
    }

    private List<Child> children(Uri tree, String folder) {
        Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, folder);
        String[] columns = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE };
        List<Child> children = new ArrayList<>();
        try (Cursor cursor = getContext().getContentResolver().query(uri, columns, null, null, null)) {
            if (cursor == null) {
                throw new IllegalStateException("The folder can't be read");
            }
            while (cursor.moveToNext()) {
                String name = cursor.getString(1);
                if (name != null) {
                    children.add(new Child(cursor.getString(0), name, cursor.getString(2)));
                }
            }
        }
        return children;
    }

    private String folderName(Uri tree) {
        Uri folder = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cursor = getContext().getContentResolver().query(folder, new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && cursor.getString(0) != null) {
                return cursor.getString(0);
            }
        } catch (Exception ignored) {
            // Fall back to the id, e.g. "primary:Download/Comics".
        }
        String id = DocumentsContract.getTreeDocumentId(tree);
        int colon = id.lastIndexOf(':');
        return colon >= 0 && colon < id.length() - 1 ? id.substring(colon + 1) : id;
    }
}
