// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Wakes Spotify on their phone without their person leaving the app (Oct 23 2026). Spotify only takes a play for a device where it is
 * already running, so a tap from the house's Spotify app with Spotify closed
 * came back as nowhere to play; the page calls wake, then sends their person's tap again
 * through the house. The waking itself is SpotifyWaker's, shared with the
 * silent push the house sends when one of us plays their person a song.
 *
 * The kit needs this app's package name and signing fingerprint on the
 * Spotify app's developer page, the client id and a redirect registered to it
 * (the page hands both in, read off the house), and Spotify installed and
 * signed in. The first connect may show Spotify's own consent screen.
 */
@CapacitorPlugin(name = "SpotifyRemote")
public class SpotifyRemotePlugin extends Plugin {

    private SpotifyWaker waker;

    private SpotifyWaker waker() {
        if (waker == null) waker = new SpotifyWaker(getContext());
        return waker;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("installed", SpotifyWaker.installed(getContext()));
        answer.put("connected", waker != null && waker.holding());
        call.resolve(answer);
    }

    /** Wake Spotify on this phone; the answer carries every step it took. */
    @PluginMethod
    public void wake(PluginCall call) {
        if (!SpotifyWaker.installed(getContext())) {
            call.reject("Spotify isn't installed on this phone.", "NOT_INSTALLED");
            return;
        }
        waker().wake(call.getString("clientId", ""), call.getString("redirectUri", ""), false, call::resolve);
    }

    // ── Pausing on the way out ─────────────────────────────────────────────
    // Theirs, Nov 11 2026: "Spotify pausing when you close the app, not
    // background it, just full app close." Only music started from Aerie is
    // paused (the page reports every press through startedHere); music they
    // started in Spotify themselves plays on. A hop Home leaves the Activity
    // alive, so this runs only when the Activity is really finishing. The
    // pause goes straight to Spotify's own media session on the phone, through
    // the notification-listener grant the Screening Room already uses: no
    // network on the way out, and Spotify keeps them place in the song.

    private static final String TAG = "AerieSpotifyRemote";
    private static final String SPOTIFY = "com.spotify.music";
    private static volatile boolean startedHere = false;

    @PluginMethod
    public void startedHere(PluginCall call) {
        startedHere = Boolean.TRUE.equals(call.getBoolean("on", false));
        call.resolve();
    }

    /** Pause Spotify's own session if it is playing. True when a pause was sent. */
    static boolean pauseSpotify(Context context) {
        try {
            MediaSessionManager manager = (MediaSessionManager) context.getSystemService(Context.MEDIA_SESSION_SERVICE);
            if (manager == null) return false;
            List<MediaController> sessions = manager.getActiveSessions(new ComponentName(context, AerieNotificationListener.class));
            for (MediaController c : sessions) {
                if (!SPOTIFY.equals(c.getPackageName())) continue;
                PlaybackState state = c.getPlaybackState();
                if (state == null || state.getState() != PlaybackState.STATE_PLAYING) continue;
                c.getTransportControls().pause();
                return true;
            }
        } catch (SecurityException e) {
            // No notification-listener grant: nothing to pause through.
            Log.w(TAG, "no media-session grant, Spotify left playing");
        } catch (Throwable t) {
            Log.w(TAG, "pause on the way out", t);
        }
        return false;
    }

    @Override
    protected void handleOnDestroy() {
        Activity activity = getActivity();
        boolean closing = activity != null && activity.isFinishing() && !activity.isChangingConfigurations();
        if (closing && startedHere) {
            boolean paused = pauseSpotify(getContext());
            AerieCrashReporter.breadcrumb("spotify.closePause paused=" + paused);
            startedHere = false;
        }
        if (waker != null) waker.hangUp();
        super.handleOnDestroy();
    }
}
