// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Process;
import android.util.Log;

import androidx.core.content.pm.PackageInfoCompat;

import java.util.Collections;

/**
 * Who may browse and drive the car media service.
 *
 * The service is exported, because Android Auto has to find it, and that
 * means any app on the phone can bind to it too. What it hands out is ours:
 * the newest replies, the voice notes, and an item that starts a call. So a
 * caller gets in only if it is this app, the system, an app signed with the
 * platform key (the system's own media controls), or one of the Android Auto
 * hosts in the car library's own allowlist, checked by signing certificate
 * and not just by name, because a name is something any app can claim when
 * the real one is not installed.
 */
final class CallerCheck {
    private static final String TAG = "AerieCaller";

    private CallerCheck() {}

    static boolean mayBrowse(Context context, String packageName, int uid) {
        if (uid == Process.myUid() || uid == Process.SYSTEM_UID) return true;
        PackageManager pm = context.getPackageManager();
        if (!belongsTo(pm, packageName, uid)) {
            Log.w(TAG, "refused " + packageName + ": not the calling app");
            return false;
        }
        if (pm.checkSignatures("android", packageName) == PackageManager.SIGNATURE_MATCH) return true;
        if (isAllowlistedHost(context, pm, packageName)) return true;
        Log.w(TAG, "refused " + packageName + ": not Android Auto or the system");
        return false;
    }

    private static boolean belongsTo(PackageManager pm, String packageName, int uid) {
        String[] packages = pm.getPackagesForUid(uid);
        if (packages == null) return false;
        for (String p : packages) if (p.equals(packageName)) return true;
        return false;
    }

    /** The car library's own list: "sha256 digest, package" per item. */
    private static boolean isAllowlistedHost(Context context, PackageManager pm, String packageName) {
        String[] entries = context.getResources().getStringArray(androidx.car.app.R.array.hosts_allowlist_sample);
        for (String entry : entries) {
            String[] parts = entry.split(",");
            if (parts.length != 2 || !parts[1].trim().equals(packageName)) continue;
            byte[] digest = hex(parts[0].trim());
            if (digest == null) continue;
            try {
                if (PackageInfoCompat.hasSignatures(pm, packageName,
                        Collections.singletonMap(digest, PackageManager.CERT_INPUT_SHA256), false)) {
                    return true;
                }
            } catch (PackageManager.NameNotFoundException gone) {
                return false;
            }
        }
        return false;
    }

    private static byte[] hex(String s) {
        if (s.length() % 2 != 0) return null;
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(s.charAt(2 * i), 16);
            int lo = Character.digit(s.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0) return null;
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }
}
