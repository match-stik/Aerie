// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;

import java.util.Locale;

/**
 * Takes the app's own old update downloads back out of the Downloads folder.
 *
 * An update is an ordinary link the shell hands to DownloadManager, which
 * saves it as aerie.apk, then aerie-1.apk, aerie-2.apk and on, and nothing ever
 * removed one: about twenty old installers piled up in one house's Downloads
 * before this. On each start, every download of an
 * Aerie installer that finished before the version now running was installed
 * is removed through DownloadManager, which deletes the file with its entry. A
 * download newer than the install, one the user has fetched and not installed yet,
 * is left alone. DownloadManager only ever lists this app's own downloads, so
 * nothing anybody else saved there can be touched.
 */
final class UpdateCleanup {
    private static final String APK = "application/vnd.android.package-archive";

    private UpdateCleanup() {}

    static void sweepInBackground(Context context) {
        Context app = context.getApplicationContext();
        new Thread(() -> sweep(app), "aerie-update-cleanup").start();
    }

    private static void sweep(Context app) {
        int removed = 0;
        int kept = 0;
        try {
            long installedAt = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).lastUpdateTime;
            DownloadManager dm = (DownloadManager) app.getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) return;
            DownloadManager.Query query = new DownloadManager.Query()
                .setFilterByStatus(DownloadManager.STATUS_SUCCESSFUL | DownloadManager.STATUS_FAILED);
            try (Cursor rows = dm.query(query)) {
                if (rows == null) return;
                int idCol = rows.getColumnIndex(DownloadManager.COLUMN_ID);
                int titleCol = rows.getColumnIndex(DownloadManager.COLUMN_TITLE);
                int uriCol = rows.getColumnIndex(DownloadManager.COLUMN_URI);
                int typeCol = rows.getColumnIndex(DownloadManager.COLUMN_MEDIA_TYPE);
                int whenCol = rows.getColumnIndex(DownloadManager.COLUMN_LAST_MODIFIED_TIMESTAMP);
                while (rows.moveToNext()) {
                    String title = text(rows, titleCol);
                    String source = text(rows, uriCol);
                    String type = text(rows, typeCol);
                    boolean installer = APK.equals(type) || title.endsWith(".apk");
                    // Only the house's own update link; any other APK the user
                    // saved through the app is theirs and stays.
                    boolean ours = source.contains("/api/app/download") || title.startsWith("aerie");
                    if (!installer || !ours) continue;
                    long finished = whenCol >= 0 ? rows.getLong(whenCol) : Long.MAX_VALUE;
                    if (finished < installedAt) {
                        removed += dm.remove(rows.getLong(idCol));
                    } else {
                        kept++;
                    }
                }
            }
        } catch (Exception error) {
            HouseLog.report(app, "update-cleanup", "could not sweep old update downloads: " + error.getClass().getSimpleName());
            return;
        }
        // The in-app update (AppUpdaterPlugin) keeps its one file in this app's
        // own storage; once a newer version is running it has done its job.
        try {
            java.io.File fetched = AppUpdaterPlugin.updateFile(app);
            long installedAt = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).lastUpdateTime;
            if (fetched != null && fetched.exists() && fetched.lastModified() < installedAt && fetched.delete()) removed++;
        } catch (Exception ignored) {
            // A leftover file is harmless; the next start tries again.
        }
        if (removed > 0 || kept > 0) {
            HouseLog.report(app, "update-cleanup", "removed " + removed + " old update download(s), kept " + kept + " newer than this install");
        }
    }

    private static String text(Cursor rows, int col) {
        if (col < 0) return "";
        String value = rows.getString(col);
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
