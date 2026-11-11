// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.content.Context;
import android.util.Log;
import android.webkit.CookieManager;

import com.getcapacitor.CapConfig;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * One line from the native side to the house's log, as a [client-error] line
 * tagged with where it came from, sent with the app's login cookie. Used for
 * things that happen after the page has already been answered, where nothing
 * on the web side is still listening. Off the main thread, best effort: when
 * the house can't be reached the line goes to logcat only.
 */
final class HouseLog {
    private static final String TAG = "AerieHouseLog";

    private HouseLog() {}

    static void report(Context context, String where, String line) {
        Context app = context.getApplicationContext();
        Log.i(TAG, where + ": " + line);
        new Thread(() -> send(app, where, line), "aerie-house-log").start();
    }

    private static String versionOf(Context app) {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
        } catch (Exception unknown) {
            return "?";
        }
    }

    private static void send(Context app, String where, String line) {
        HttpURLConnection http = null;
        try {
            String base = CapConfig.loadDefault(app).getServerUrl();
            if (base == null || base.isEmpty()) return;
            String target = base.replaceAll("/+$", "") + "/api/client-errors";
            String cookie = CookieManager.getInstance().getCookie(base);
            JSONObject body = new JSONObject();
            body.put("where", where);
            body.put("message", "[app " + versionOf(app) + "] " + line);
            body.put("stack", "");
            body.put("componentStack", "");
            http = (HttpURLConnection) new URL(target).openConnection();
            http.setRequestMethod("POST");
            http.setConnectTimeout(8000);
            http.setReadTimeout(8000);
            http.setDoOutput(true);
            http.setRequestProperty("Content-Type", "application/json");
            if (cookie != null) http.setRequestProperty("Cookie", cookie);
            try (OutputStream out = http.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = http.getResponseCode();
            if (status >= 300) Log.w(TAG, "the house answered " + status);
        } catch (Exception error) {
            Log.w(TAG, "could not report to the house: " + error.getClass().getSimpleName());
        } finally {
            if (http != null) http.disconnect();
        }
    }
}
