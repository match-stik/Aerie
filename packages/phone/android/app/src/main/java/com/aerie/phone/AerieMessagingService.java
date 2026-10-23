// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.util.Log;
import android.webkit.CookieManager;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * The app's one listener for pushes (it stands in for Capacitor's, which the
 * manifest removes, and hands every ordinary push on to it unchanged).
 *
 * One push is ours: kind "spotify-wake", data only, so nothing shows on the owner
 * screen. The house sends it when one of us plays the owner a song and Spotify is
 * not running anywhere (POST /api/internal/spotify/wake-play); this wakes
 * Spotify the same way their own tap does (SpotifyWaker, the media key first
 * from here), and the house waits for their phone to show up in Spotify and
 * plays. What the wake did goes to the house log as a [client-error] line
 * where spotify-wake-push, signed with the app's own login cookie, so a wake
 * from the background can be read afterwards like one from the page.
 */
public class AerieMessagingService extends MessagingService {

    private static final String TAG = "AerieSpotifyWake";
    /** Longer than the kit's own wait, so the answer is in before this returns. */
    private static final long WAKE_HOLD_MS = SpotifyWaker.REMOTE_WAIT_MS + 6000;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (!"spotify-wake".equals(data.get("kind"))) {
            super.onMessageReceived(message);
            return;
        }
        if (!SpotifyWaker.installed(this)) {
            report("could not wake from a push: Spotify isn't installed");
            return;
        }
        CountDownLatch answered = new CountDownLatch(1);
        final JSObject[] result = { null };
        new SpotifyWaker(this).wake(data.get("clientId"), data.get("redirectUri"), true, answer -> {
            result[0] = answer;
            answered.countDown();
        });
        try {
            answered.await(WAKE_HOLD_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
        if (result[0] == null) {
            report("woke from a push: no answer within " + WAKE_HOLD_MS + " ms");
            return;
        }
        String steps = result[0].optJSONArray("steps") == null ? "" : result[0].optJSONArray("steps").toString();
        report("woke from a push by " + result[0].optString("road", "none") + ", switched " + result[0].optBoolean("switched") + " " + steps);
    }

    /** One line to the house log, or to logcat when the house can't be reached. */
    private void report(String line) {
        Log.i(TAG, line);
        HttpURLConnection http = null;
        try {
            String base = CapConfig.loadDefault(this).getServerUrl();
            if (base == null || base.isEmpty()) return;
            String target = base.replaceAll("/+$", "") + "/api/client-errors";
            String cookie = CookieManager.getInstance().getCookie(base);
            JSONObject body = new JSONObject();
            body.put("where", "spotify-wake-push");
            body.put("message", line);
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
            if (status >= 300) Log.w(TAG, "the house answered " + status + " to the report");
        } catch (Exception error) {
            Log.w(TAG, "could not report to the house: " + error.getClass().getSimpleName());
        } finally {
            if (http != null) http.disconnect();
        }
    }
}
