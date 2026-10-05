// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
package com.aerie.phone;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The other half of Thresholds.
 *
 * Until now a threshold only opened if the owner opened Aerie, went to Thresholds and
 * tapped "find where I am" while standing in the place — a one-shot reading,
 * taken on their tap. Which means something left at a shop is only ever found by
 * somebody who happens to think of it, with a phone out, in the right car park.
 *
 * This registers the owner's own pinned places with the operating system so the phone
 * watches them with Aerie shut. The privacy shape is the point and it survives
 * intact: Android does the watching locally, tells us only "a region was
 * entered", and nothing in this file ever sends a coordinate anywhere. The
 * server is asked which places are worth watching and is never told the answer.
 */
@CapacitorPlugin(name = "ThresholdGeofence")
public class ThresholdGeofencePlugin extends Plugin {
    private static final String TAG = "AerieThresholdGeofence";

    /** Android refuses more than a hundred registered regions per app. The
     *  server already narrows the list to places that have something waiting;
     *  this is the backstop that keeps a long list from failing the whole call
     *  rather than the tail of it. */
    private static final int MAX_REGIONS = 100;

    /** The owner has to stay put this long before a region counts as arrived at.
     *  Driving past a pinned shop at forty is not arriving, and a buzz they did
     *  not earn teaches them to ignore the next one — which might be the one
     *  that matters. */
    private static final int DWELL_MS = 90_000;

    static final String PREFS = "aerie.thresholds.geofence";
    static final String KEY_NAMES = "placeNames";

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    /**
     * Replace every registered region with the ones named here. Wholesale rather
     * than incremental on purpose: the server's answer is the whole truth about
     * what is worth watching, so anything not in it should stop being watched.
     */
    @PluginMethod
    public void sync(PluginCall call) {
        Context context = getContext();
        JSObject result = statusObject();
        if (!servicesAvailable(context)) {
            result.put("registered", 0);
            result.put("reason", "play-services-unavailable");
            call.resolve(result);
            return;
        }
        if (!hasBackgroundLocation(context)) {
            // Registering without the always-on grant either throws or silently
            // never fires. Say so rather than reporting a success nobody has.
            result.put("registered", 0);
            result.put("reason", "background-location-not-granted");
            call.resolve(result);
            return;
        }

        JSArray places = call.getArray("places");
        List<Geofence> fences = new ArrayList<>();
        JSONObject names = new JSONObject();
        if (places != null) {
            for (int i = 0; i < places.length() && fences.size() < MAX_REGIONS; i++) {
                try {
                    JSONObject place = places.getJSONObject(i);
                    String id = place.optString("id", null);
                    if (id == null || id.isEmpty()) continue;
                    double lat = place.getDouble("lat");
                    double lng = place.getDouble("lng");
                    float radius = (float) place.optDouble("radius_m", 100);
                    if (radius <= 0) radius = 100;
                    fences.add(new Geofence.Builder()
                        .setRequestId(id)
                        .setCircularRegion(lat, lng, radius)
                        .setExpirationDuration(Geofence.NEVER_EXPIRE)
                        .setLoiteringDelay(DWELL_MS)
                        // Left at the 0 default until Sep 13 2026, which tells the
                        // framework to report a transition as fast as it possibly
                        // can and is the one knob here that costs power. We are
                        // already not fast: nothing fires until the owner has loitered
                        // ninety seconds. So give the system the same slack it
                        // already has rather than a number picked out of the air —
                        // matched to DWELL_MS, it may batch with every other app's
                        // fences and the buzz is no later than it already was.
                        .setNotificationResponsiveness(DWELL_MS)
                        .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_DWELL)
                        .build());
                    names.put(id, place.optString("name", "somewhere"));
                } catch (JSONException malformed) {
                    Log.e(TAG, "Skipping a malformed place", malformed);
                }
            }
        }

        // The receiver has to be able to name the place in the buzz, and it may
        // run with no Activity and no session cookie. The owner's own pin names live
        // here, on their own device, and go no further.
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_NAMES, names.toString()).apply();

        GeofencingClient client = LocationServices.getGeofencingClient(context);
        PendingIntent pending = transitionIntent(context);
        try {
            client.removeGeofences(pending);
            if (fences.isEmpty()) {
                result.put("registered", 0);
                call.resolve(result);
                return;
            }
            GeofencingRequest request = new GeofencingRequest.Builder()
                // Deliberately no initial trigger. Registration happens every
                // time Aerie opens, and firing on registration would buzz the owner
                // at home every launch for something already waiting
                // there. This feature is for ARRIVING; standing somewhere with
                // the app open is what the in-app button is for.
                .setInitialTrigger(0)
                .addGeofences(fences)
                .build();
            final int count = fences.size();
            client.addGeofences(request, pending)
                .addOnSuccessListener(ignored -> {
                    JSObject ok = statusObject();
                    ok.put("registered", count);
                    call.resolve(ok);
                })
                .addOnFailureListener(error -> {
                    Log.e(TAG, "Could not register regions", error);
                    JSObject failed = statusObject();
                    failed.put("registered", 0);
                    failed.put("reason", "register-failed: " + error.getMessage());
                    call.resolve(failed);
                });
        } catch (SecurityException refused) {
            Log.e(TAG, "Location permission refused at registration", refused);
            result.put("registered", 0);
            result.put("reason", "security-exception");
            call.resolve(result);
        }
    }

    /** Stop watching everything. The owner's switch, not ours. */
    @PluginMethod
    public void clear(PluginCall call) {
        Context context = getContext();
        try {
            LocationServices.getGeofencingClient(context).removeGeofences(transitionIntent(context));
        } catch (RuntimeException refused) {
            Log.e(TAG, "Could not clear regions", refused);
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_NAMES).apply();
        JSObject result = statusObject();
        result.put("registered", 0);
        call.resolve(result);
    }

    /**
     * "Allow all the time" cannot be asked for in a dialog on Android 11 and
     * later — the platform requires the owner to go and set it themselves. So the
     * honest thing an app can do is open the exact page and get out of the way.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Activity activity = getActivity();
        JSObject result = new JSObject();
        if (activity == null) {
            result.put("opened", false);
            call.resolve(result);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", activity.getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            result.put("opened", true);
        } catch (RuntimeException refused) {
            Log.e(TAG, "Could not open app settings", refused);
            result.put("opened", false);
        }
        call.resolve(result);
    }

    private JSObject statusObject() {
        Context context = getContext();
        JSObject status = new JSObject();
        status.put("supported", servicesAvailable(context));
        status.put("fineLocation", hasFineLocation(context));
        status.put("backgroundLocation", hasBackgroundLocation(context));
        // On Android 10 and later the always-on grant is a separate trip to
        // Settings; below that, fine location already covers it.
        status.put("needsSettingsTrip", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        return status;
    }

    private boolean hasFineLocation(Context context) {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundLocation(Context context) {
        if (!hasFineLocation(context)) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean servicesAvailable(Context context) {
        try {
            return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
                == ConnectionResult.SUCCESS;
        } catch (RuntimeException unavailable) {
            return false;
        }
    }

    private static PendingIntent transitionIntent(Context context) {
        Intent intent = new Intent(context, ThresholdGeofenceReceiver.class);
        // Geofencing hands the transition back inside this intent, so it has to
        // be mutable. Immutable compiles and then never carries the event.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        return PendingIntent.getBroadcast(context, 0, intent, flags);
    }
}
