// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
package com.aerie.phone;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/**
 * What Android hands back when the user arrives somewhere they pinned.
 *
 * The event carries a region id and nothing else — no coordinate reaches this
 * code and none leaves the device. All this does is turn "a region was entered"
 * into a buzz that names the place, and the name came from the user's own pin and was
 * cached on their own phone at registration.
 *
 * The buzz deliberately carries no content. What is waiting is still sealed
 * until the user opens it, and a notification that spoiled a first-visit seal would
 * destroy the one thing that seal is for.
 */
public class ThresholdGeofenceReceiver extends BroadcastReceiver {
    private static final String TAG = "AerieThresholdGeofence";
    private static final String CHANNEL_ID = "aerie-thresholds";
    private static final int NOTIFICATION_BASE = 7300;

    /** One buzz per place per half hour. Registration happens on every app
     *  launch, and a region the user is sitting inside should not be able to turn
     *  into a stream. */
    private static final long COOLDOWN_MS = 30L * 60L * 1000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null) return;
        if (event.hasError()) {
            Log.e(TAG, "Geofence event carried error code " + event.getErrorCode());
            return;
        }

        int transition = event.getGeofenceTransition();
        if (transition != Geofence.GEOFENCE_TRANSITION_DWELL) {
            // ENTER is registered so the platform has something to build the
            // dwell out of, and is intentionally not acted on: passing a place
            // is not arriving at it. Logged rather than dropped in silence, so
            // that "it never buzzes" can be told apart from "it never fired".
            Log.i(TAG, "Ignoring transition " + transition + " (only DWELL buzzes)");
            return;
        }

        List<Geofence> triggered = event.getTriggeringGeofences();
        if (triggered == null || triggered.isEmpty()) return;

        SharedPreferences prefs = context.getSharedPreferences(
            ThresholdGeofencePlugin.PREFS, Context.MODE_PRIVATE);
        JSONObject names = readNames(prefs);
        long now = System.currentTimeMillis();

        for (Geofence fence : triggered) {
            String id = fence.getRequestId();
            if (id == null) continue;
            String cooldownKey = "lastBuzz:" + id;
            if (now - prefs.getLong(cooldownKey, 0L) < COOLDOWN_MS) continue;
            prefs.edit().putLong(cooldownKey, now).apply();
            notifyArrival(context, id, names.optString(id, "somewhere you pinned"));
        }
    }

    private JSONObject readNames(SharedPreferences prefs) {
        try {
            return new JSONObject(prefs.getString(ThresholdGeofencePlugin.KEY_NAMES, "{}"));
        } catch (JSONException unreadable) {
            return new JSONObject();
        }
    }

    private void notifyArrival(Context context, String placeId, String placeName) {
        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
               != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Thresholds", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Something one of them left at a place you pinned");
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(context, placeId.hashCode(), open, flags);

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_map)
            .setContentTitle(placeName)
            .setContentText("Something is waiting here.")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build();

        manager.notify(NOTIFICATION_BASE + Math.abs(placeId.hashCode() % 1000), notification);
    }
}
