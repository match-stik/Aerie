// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.CookieManager;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Updates the app without going through the Downloads folder (Danielle's idea,
 * 'not having to download updates').
 *
 * The old way handed the house's update link to the WebView's download
 * listener, which saved it into Downloads as aerie.apk, aerie-1.apk and on,
 * and the user installed it from the notification. Now the update is fetched into
 * this app's own storage (Android/data/com.aerie.phone/files/Download), and
 * when it lands the app opens Android's installer on it directly. Android asks
 * once whether Aerie may install updates; if that is not allowed yet, its
 * settings switch is opened instead, and the next tap finds the update already
 * fetched and goes straight to the installer. UpdateCleanup removes the file
 * once a newer version is running.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    static final String FILE = "aerie-update.apk";
    private static final String APK = "application/vnd.android.package-archive";

    static File updateFile(Context context) {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return dir == null ? null : new File(dir, FILE);
    }

    /** The version code inside a fetched installer, or -1 when it can't be read. */
    static long archiveCode(Context context, File file) {
        try {
            PackageInfo info = context.getPackageManager().getPackageArchiveInfo(file.getPath(), 0);
            if (info == null) return -1;
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (Exception unreadable) {
            return -1;
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        Context app = getContext().getApplicationContext();
        long want = call.getInt("versionCode", 0);
        File file = updateFile(app);
        if (file == null) {
            call.reject("This phone's app storage isn't available right now.", "NO_STORAGE");
            return;
        }
        // Already fetched this exact version (the user was sent to allow installs,
        // or left the app before it opened): straight to the installer.
        if (want > 0 && file.exists() && archiveCode(app, file) == want) {
            JSObject answer = new JSObject();
            answer.put("state", openInstaller(app, file));
            call.resolve(answer);
            return;
        }
        try {
            File dir = file.getParentFile();
            if (dir != null && !dir.exists()) dir.mkdirs();
            if (file.exists()) file.delete();
            String base = CapConfig.loadDefault(app).getServerUrl();
            if (base == null || base.isEmpty()) {
                call.reject("The app doesn't know the house's address.", "NO_SERVER");
                return;
            }
            String url = base.replaceAll("/+$", "") + "/api/app/download";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setMimeType(APK);
            request.setTitle("Aerie update");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setDestinationInExternalFilesDir(app, Environment.DIRECTORY_DOWNLOADS, FILE);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) request.addRequestHeader("Cookie", cookies);
            DownloadManager dm = (DownloadManager) app.getSystemService(Context.DOWNLOAD_SERVICE);
            long id = dm.enqueue(request);
            watch(app, dm, id, file);
            JSObject answer = new JSObject();
            answer.put("state", "downloading");
            call.resolve(answer);
        } catch (Exception error) {
            HouseLog.report(app, "app-update", "could not start the update download: " + error.getClass().getSimpleName() + ": " + error.getMessage());
            call.reject("The update couldn't start downloading.", "DOWNLOAD_FAILED");
        }
    }

    /** Opens the installer when the download lands; reports a failed one to the house. */
    private void watch(Context app, DownloadManager dm, long id, File file) {
        BroadcastReceiver done = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                try {
                    app.unregisterReceiver(this);
                } catch (IllegalArgumentException alreadyGone) {
                    // Nothing to undo.
                }
                int status = -1;
                try (Cursor row = dm.query(new DownloadManager.Query().setFilterById(id))) {
                    if (row != null && row.moveToFirst()) {
                        status = row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    }
                } catch (Exception unreadable) {
                    // Judged by the file below.
                }
                if (status != DownloadManager.STATUS_SUCCESSFUL || !file.exists()) {
                    HouseLog.report(app, "app-update", "the update download did not finish (status " + status + ")");
                    notifyListeners("updateState", stateOf("failed"));
                    return;
                }
                notifyListeners("updateState", stateOf(openInstaller(app, file)));
            }
        };
        ContextCompat.registerReceiver(app, done, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED);
    }

    private static JSObject stateOf(String state) {
        JSObject answer = new JSObject();
        answer.put("state", state);
        return answer;
    }

    /**
     * Android's installer on the fetched file, or the switch that allows Aerie
     * to install updates when it is not on yet. Answers which one it opened.
     */
    private static String openInstaller(Context app, File file) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !app.getPackageManager().canRequestPackageInstalls()) {
                Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.getPackageName()));
                allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                app.startActivity(allow);
                return "needs-permission";
            }
            Uri uri = FileProvider.getUriForFile(app, app.getPackageName() + ".fileprovider", file);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, APK);
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            app.startActivity(install);
            return "installer-open";
        } catch (Exception error) {
            HouseLog.report(app, "app-update", "could not open the installer: " + error.getClass().getSimpleName() + ": " + error.getMessage());
            return "failed";
        }
    }
}
