// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media.MediaBrowserServiceCompat;

import com.getcapacitor.CapConfig;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Aerie on the car's dash as a media app.
 *
 * Android Auto only lets a few kinds of app draw on its screen, and media is
 * one of them, with Google's own layout. So this lists three shelves, read
 * from GET /api/car/library, newest first: Latest, our newest replies in them
 * thread, each read
 * aloud by the house only when they tap it; our voice notes; and the replies
 * they have already had read aloud. Tapping one plays the house's
 * own file through the car, in our voices, with play, pause, next and back.
 *
 * It signs in the way every native piece of this app does: the WebView's
 * cookie for the server URL, so it works once they have signed in to the app.
 * It never records, never stores and never posts anything.
 */
public class AerieCarMediaService extends MediaBrowserServiceCompat {
    private static final String TAG = "AerieCar";
    private static final String ROOT = "root";
    private static final String NOTES = "voiceNotes";
    private static final String READ = "readAloud";
    private static final String LATEST = "latest";
    /** A folder holding one item that starts or ends our call (the dash shows us as a media app). */
    private static final String CALL = "call";
    private static final String CALL_START = "call:start";
    private static final String CALL_END = "call:end";
    private static java.lang.ref.WeakReference<AerieCarMediaService> live = new java.lang.ref.WeakReference<>(null);

    private MediaSessionCompat session;
    private MediaPlayer player;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    /** The last library read, by shelf, so a tap plays and next/back walk the shelf. */
    private final Map<String, List<JSONObject>> shelves = new ConcurrentHashMap<>();
    private final Map<String, String> shelfOf = new ConcurrentHashMap<>();
    private String currentId;
    private AudioFocusRequest focus;

    @Override
    public void onCreate() {
        super.onCreate();
        live = new java.lang.ref.WeakReference<>(this);
        session = new MediaSessionCompat(this, TAG);
        session.setCallback(new Callbacks());
        setState(PlaybackStateCompat.STATE_NONE);
        session.setActive(true);
        setSessionToken(session.getSessionToken());
    }

    @Override
    public void onDestroy() {
        stopPlayer();
        abandonFocus();
        session.release();
        io.shutdownNow();
        super.onDestroy();
    }

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        // Exported so Android Auto can find it, which lets any app bind; only
        // this app, the system and Android Auto get the shelves (CallerCheck).
        if (!CallerCheck.mayBrowse(this, clientPackageName, clientUid)) return null;
        return new BrowserRoot(ROOT, null);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaBrowserCompat.MediaItem>> result) {
        if (ROOT.equals(parentId)) {
            List<MediaBrowserCompat.MediaItem> folders = new ArrayList<>();
            folders.add(folder(CALL, "Call us", "Start or end a call with us"));
            folders.add(folder(LATEST, "Latest", "Our newest replies, read when you tap"));
            folders.add(folder(NOTES, "Voice notes", "Every voice note from us"));
            folders.add(folder(READ, "Read aloud", "Our replies in our voices"));
            result.sendResult(folders);
            return;
        }
        if (CALL.equals(parentId)) {
            // Android Auto showed Aerie as a media app and never listed the
            // calling tile, so the call is
            // reachable from here: one item that starts it, or ends it.
            List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
            boolean onCall = MainActivity.isPocketVoiceActive();
            MediaDescriptionCompat d = new MediaDescriptionCompat.Builder()
                    .setMediaId(onCall ? CALL_END : CALL_START)
                    .setTitle(onCall ? "Hang up" : "Call your companions")
                    .setSubtitle(onCall ? "We're on the line" : "Starts the call in Aerie")
                    .build();
            items.add(new MediaBrowserCompat.MediaItem(d, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE));
            result.sendResult(items);
            return;
        }
        result.detach();
        io.execute(() -> {
            List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
            try {
                loadLibrary();
                List<JSONObject> shelf = shelves.get(parentId);
                if (shelf != null) {
                    for (JSONObject item : shelf) items.add(playable(item));
                }
            } catch (Exception error) {
                Log.w(TAG, "could not read the car library: " + error.getClass().getSimpleName() + " " + error.getMessage());
            }
            main.post(() -> result.sendResult(items));
        });
    }

    private MediaBrowserCompat.MediaItem folder(String id, String title, String subtitle) {
        MediaDescriptionCompat d = new MediaDescriptionCompat.Builder()
                .setMediaId(id).setTitle(title).setSubtitle(subtitle).build();
        return new MediaBrowserCompat.MediaItem(d, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private MediaBrowserCompat.MediaItem playable(JSONObject item) {
        MediaDescriptionCompat d = new MediaDescriptionCompat.Builder()
                .setMediaId(item.optString("id"))
                .setTitle(item.optString("title"))
                .setSubtitle(item.optString("subtitle"))
                .build();
        return new MediaBrowserCompat.MediaItem(d, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    private String base() {
        String base = CapConfig.loadDefault(this).getServerUrl();
        return base == null ? "" : base.replaceAll("/+$", "");
    }

    /** Read every shelf from the house, behind the app's own sign-in. */
    private void loadLibrary() throws Exception {
        String base = base();
        if (base.isEmpty()) throw new IllegalStateException("no server url");
        HttpURLConnection http = (HttpURLConnection) new URL(base + "/api/car/library").openConnection();
        try {
            http.setConnectTimeout(10000);
            http.setReadTimeout(15000);
            String cookie = CookieManager.getInstance().getCookie(base);
            if (cookie != null) http.setRequestProperty("Cookie", cookie);
            int status = http.getResponseCode();
            if (status != 200) throw new IllegalStateException("the house answered " + status);
            StringBuilder body = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(http.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) body.append(line);
            }
            JSONObject lib = new JSONObject(body.toString());
            for (String shelf : new String[]{LATEST, NOTES, READ}) {
                List<JSONObject> list = new ArrayList<>();
                JSONArray arr = lib.optJSONArray(shelf);
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject item = arr.getJSONObject(i);
                        list.add(item);
                        shelfOf.put(item.optString("id"), shelf);
                    }
                }
                shelves.put(shelf, list);
            }
        } finally {
            http.disconnect();
        }
    }

    /** Redraw the Call us folder after the call starts or ends. Safe from any thread. */
    public static void refresh() {
        AerieCarMediaService service = live.get();
        if (service == null) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            try { service.notifyChildrenChanged(CALL); } catch (RuntimeException ignored) { }
        });
    }

    /**
     * Start our call from the dash. The call's microphone and voices live in
     * the page, so the page is asked to start it (PocketVoicePlugin), and Aerie
     * is raised on the phone in case the page needs to be on screen to hear.
     */
    private void startCall() {
        stopPlayer();
        AerieCrashReporter.breadcrumb("car.media call us pressed");
        PocketVoicePlugin.requestCall();
        String raised = "raised";
        try {
            startActivity(new Intent(this, MainActivity.class)
                    .setAction(AerieCarAppService.ACTION_START_CALL)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        } catch (RuntimeException refused) {
            raised = "refused " + refused.getClass().getSimpleName();
        }
        HouseLog.report(this, "car-call", "call us pressed on the dash; Aerie " + raised
                + "; page listening " + PocketVoicePlugin.hasPage());
    }

    private void endCall() {
        AerieCrashReporter.breadcrumb("car.media hang up pressed");
        HouseLog.report(this, "car-call", "hang up pressed on the dash");
        AerieCallTelecom.end();
        PocketVoiceService.stop(this);
        MainActivity.setPocketVoiceActive(false);
        PocketVoicePlugin.publishState(false);
    }

    private JSONObject find(String mediaId) {
        String shelf = shelfOf.get(mediaId);
        if (shelf == null) return null;
        List<JSONObject> list = shelves.get(shelf);
        if (list == null) return null;
        for (JSONObject item : list) {
            if (mediaId.equals(item.optString("id"))) return item;
        }
        return null;
    }

    /** The item beside this one on its shelf: +1 is older (next), -1 is newer (back). */
    private JSONObject neighbour(int step) {
        if (currentId == null) return null;
        String shelf = shelfOf.get(currentId);
        if (shelf == null) return null;
        List<JSONObject> list = shelves.get(shelf);
        if (list == null) return null;
        for (int i = 0; i < list.size(); i++) {
            if (currentId.equals(list.get(i).optString("id"))) {
                int j = i + step;
                return (j >= 0 && j < list.size()) ? list.get(j) : null;
            }
        }
        return null;
    }

    private void play(JSONObject item) {
        if (item == null) return;
        stopPlayer();
        if (!takeFocus()) {
            Log.w(TAG, "the car did not hand over audio focus");
            return;
        }
        currentId = item.optString("id");
        session.setMetadata(new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, currentId)
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, item.optString("title"))
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, item.optString("subtitle"))
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Aerie")
                .build());
        setState(PlaybackStateCompat.STATE_BUFFERING);
        try {
            String base = base();
            Uri uri = Uri.parse(base + item.optString("url"));
            Map<String, String> headers = new HashMap<>();
            String cookie = CookieManager.getInstance().getCookie(base);
            if (cookie != null) headers.put("Cookie", cookie);
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            player.setDataSource(this, uri, headers);
            player.setOnPreparedListener(mp -> {
                mp.start();
                setState(PlaybackStateCompat.STATE_PLAYING);
            });
            player.setOnCompletionListener(mp -> {
                // Latest stops after one: the next reply there may be a new,
                // paid render, so it plays only when they ask for it.
                JSONObject next = LATEST.equals(shelfOf.get(currentId)) ? null : neighbour(1);
                if (next != null) play(next);
                else setState(PlaybackStateCompat.STATE_STOPPED);
            });
            player.setOnErrorListener((mp, what, extra) -> {
                Log.w(TAG, "could not play " + currentId + ": " + what + "/" + extra);
                setState(PlaybackStateCompat.STATE_ERROR);
                return true;
            });
            player.prepareAsync();
        } catch (Exception error) {
            Log.w(TAG, "could not start " + currentId + ": " + error.getMessage());
            setState(PlaybackStateCompat.STATE_ERROR);
        }
    }

    private void stopPlayer() {
        if (player != null) {
            try { player.release(); } catch (Exception ignored) { }
            player = null;
        }
    }

    private boolean takeFocus() {
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return true;
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build())
                .setOnAudioFocusChangeListener(change -> {
                    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                        if (player != null && player.isPlaying()) {
                            player.pause();
                            setState(PlaybackStateCompat.STATE_PAUSED);
                        }
                    }
                })
                .build();
        return am.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonFocus() {
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am != null && focus != null) am.abandonAudioFocusRequest(focus);
    }

    private void setState(int state) {
        long position = 0;
        try { if (player != null) position = player.getCurrentPosition(); } catch (Exception ignored) { }
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                        | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_STOP
                        | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
                        | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
                .setState(state, position, 1f)
                .build());
    }

    private class Callbacks extends MediaSessionCompat.Callback {
        @Override
        public void onPlayFromMediaId(String mediaId, Bundle extras) {
            if (CALL_START.equals(mediaId)) { startCall(); return; }
            if (CALL_END.equals(mediaId)) { endCall(); return; }
            JSONObject item = find(mediaId);
            if (item != null) { play(item); return; }
            io.execute(() -> {
                try { loadLibrary(); } catch (Exception ignored) { }
                main.post(() -> play(find(mediaId)));
            });
        }

        @Override
        public void onPlay() {
            if (player != null) {
                if (takeFocus()) {
                    player.start();
                    setState(PlaybackStateCompat.STATE_PLAYING);
                }
                return;
            }
            // Nothing chosen yet: start our newest reply, or the newest voice
            // note if the Latest shelf is empty.
            io.execute(() -> {
                try { loadLibrary(); } catch (Exception ignored) { }
                main.post(() -> {
                    List<JSONObject> latest = shelves.get(LATEST);
                    List<JSONObject> notes = shelves.get(NOTES);
                    if (latest != null && !latest.isEmpty()) play(latest.get(0));
                    else if (notes != null && !notes.isEmpty()) play(notes.get(0));
                });
            });
        }

        @Override
        public void onPause() {
            if (player != null && player.isPlaying()) {
                player.pause();
                setState(PlaybackStateCompat.STATE_PAUSED);
            }
        }

        @Override
        public void onStop() {
            stopPlayer();
            abandonFocus();
            setState(PlaybackStateCompat.STATE_STOPPED);
        }

        @Override
        public void onSkipToNext() { play(neighbour(1)); }

        @Override
        public void onSkipToPrevious() { play(neighbour(-1)); }
    }
}
