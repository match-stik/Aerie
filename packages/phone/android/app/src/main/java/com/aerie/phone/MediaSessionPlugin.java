// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
package com.aerie.phone;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Reads what the owner's phone is currently playing, so the Screening Room clock can
 * follow an episode instead of the owner having to drive it.
 *
 * THIS IS AN INSTRUMENT BEFORE IT IS A FEATURE, and that is deliberate. Nothing
 * on this box can find out whether the owner's streaming app publishes a playback
 * POSITION — some players do, some refuse, and the only way to know is to ask
 * the phone in their hand. So read() reports exactly what Android hands over,
 * including the honest answer "this player does not say", rather than quietly
 * substituting a guess.
 *
 * WHAT IT DOES NOT DO: it never reads a notification, never stores anything,
 * and never sends anything anywhere. It answers one question — what is playing
 * and where is it up to — and only when something on the JavaScript side asks.
 */
@CapacitorPlugin(name = "MediaSession")
public class MediaSessionPlugin extends Plugin {
    private static final String TAG = "AerieMediaSession";

    /** PlaybackState uses -1 for "I am not telling you where I am". */
    private static final long POSITION_UNKNOWN = PlaybackState.PLAYBACK_POSITION_UNKNOWN;

    /** No single media reading should be more than a few minutes stale while playing. */
    private static final long MAX_DRIFT_MS = 10 * 60 * 1000;

    private ComponentName listener() {
        return new ComponentName(getContext(), AerieNotificationListener.class);
    }

    /**
     * Whether the notification-listener grant is in place. Android stores the
     * enabled listeners as one flat colon-separated string in Secure settings;
     * there is no API that answers this directly.
     */
    private boolean granted() {
        String enabled = Settings.Secure.getString(
                getContext().getContentResolver(), "enabled_notification_listeners");
        if (enabled == null || enabled.isEmpty()) return false;
        String me = listener().flattenToString();
        String meShort = listener().flattenToShortString();
        for (String part : enabled.split(":")) {
            if (part.equals(me) || part.equals(meShort)) return true;
        }
        return false;
    }

    @PluginMethod
    public void hasAccess(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", granted());
        call.resolve(out);
    }

    /**
     * Android will not show this as a dialog — the grant is only reachable from
     * its own settings screen, the same as always-on location. So say what it
     * buys and open the page rather than pretending to ask.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open notification access settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        JSObject out = new JSObject();
        if (!granted()) {
            out.put("granted", false);
            out.put("sessions", new JSArray());
            call.resolve(out);
            return;
        }
        out.put("granted", true);
        JSArray sessions = new JSArray();
        try {
            MediaSessionManager manager =
                    (MediaSessionManager) getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<MediaController> controllers = manager.getActiveSessions(listener());
            // SystemClock.elapsedRealtime(), NOT currentTimeMillis(): PlaybackState
            // stamps its reading on the since-boot clock, and subtracting a
            // since-boot number from an epoch number yields the age of the epoch.
            long now = SystemClock.elapsedRealtime();
            for (MediaController c : controllers) {
                sessions.put(describe(c, now));
            }
        } catch (SecurityException e) {
            // The grant can be revoked between the check and the call.
            Log.w(TAG, "refused by the system: " + e.getMessage());
            out.put("granted", false);
        } catch (Exception e) {
            call.reject("Could not read the media sessions: " + e.getMessage());
            return;
        }
        out.put("sessions", sessions);
        call.resolve(out);
    }

    private JSObject describe(MediaController c, long now) {
        JSObject s = new JSObject();
        s.put("package", c.getPackageName());

        MediaMetadata md = c.getMetadata();
        if (md != null) {
            s.put("title", md.getString(MediaMetadata.METADATA_KEY_TITLE));
            s.put("displayTitle", md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE));
            s.put("subtitle", md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE));
            s.put("artist", md.getString(MediaMetadata.METADATA_KEY_ARTIST));
            s.put("album", md.getString(MediaMetadata.METADATA_KEY_ALBUM));
            long duration = md.getLong(MediaMetadata.METADATA_KEY_DURATION);
            s.put("durationMs", duration > 0 ? duration : null);
        }

        PlaybackState ps = c.getPlaybackState();
        if (ps == null) {
            s.put("state", "none");
            s.put("reportsPosition", false);
            return s;
        }
        s.put("state", stateName(ps.getState()));
        long raw = ps.getPosition();
        boolean reports = raw != POSITION_UNKNOWN && raw >= 0;
        s.put("reportsPosition", reports);
        if (reports) {
            s.put("positionMs", raw);
            // The reported position is a reading taken at lastPositionUpdateTime,
            // not a live number — exactly the same arithmetic our own clock uses.
            // Extrapolate it forward while it is actually playing.
            long updatedAt = ps.getLastPositionUpdateTime();
            float speed = ps.getPlaybackSpeed();
            if (ps.getState() == PlaybackState.STATE_PLAYING && updatedAt > 0) {
                long drift = (long) ((now - updatedAt) * (speed == 0f ? 1f : speed));
                // A reading that is somehow hours stale is not a reading, it is a
                // clock disagreement. Hand back the raw number rather than a
                // computed one: a stale truth beats a confident invention.
                if (drift < 0 || drift > MAX_DRIFT_MS) {
                    s.put("livePositionMs", raw);
                    s.put("driftRejected", true);
                } else {
                    s.put("livePositionMs", Math.max(0, raw + drift));
                }
            } else {
                s.put("livePositionMs", raw);
            }
            s.put("speed", speed);
            s.put("positionReadAt", updatedAt);
        }
        return s;
    }

    private String stateName(int state) {
        switch (state) {
            case PlaybackState.STATE_PLAYING: return "playing";
            case PlaybackState.STATE_PAUSED: return "paused";
            case PlaybackState.STATE_BUFFERING: return "buffering";
            case PlaybackState.STATE_STOPPED: return "stopped";
            case PlaybackState.STATE_NONE: return "none";
            default: return "other:" + state;
        }
    }
}
