// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.webkit.CookieManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Map;

/**
 * Plays a voice call's reply on the CALL line instead of the music line.
 *
 * Theirs, Oct 27 2026: with Aerie in the background and the call dock floating
 * over their home screen, every reply played about a second over their car's
 * Bluetooth and stopped. Off screen a call keeps their microphone open between
 * turns (mic-hold.ts: a hidden page that asks for a fresh mic gets one that
 * carries nothing), and an open mic holds a Bluetooth head unit in phone-call
 * mode, where anything sent to it as music is shut off. The WebView's audio
 * element can only play as music. This player marks the reply as voice
 * communication, which is the audio a head unit in call mode is waiting for,
 * so the car hears us the way it hears the other end of a phone call.
 *
 * One segment per play(): it resolves when the segment ends, and rejects on
 * an error or when stop() cuts it short, so the page keeps its own ordering,
 * drain timing and interruption rules exactly as they are for the element.
 */
@CapacitorPlugin(name = "CallVoice")
public class CallVoicePlugin extends Plugin {
    private static final String TAG = "AerieCallVoice";
    private MediaPlayer player;
    private PluginCall pending;

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No url to play");
            return;
        }
        finish(null, "Replaced by the next segment");
        MediaPlayer next = new MediaPlayer();
        next.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build());
        player = next;
        pending = call;
        try {
            // The voice routes sit behind the login. The WebView already holds
            // the session cookie for this host, so hand the same one over.
            Map<String, String> headers = new HashMap<>();
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) headers.put("Cookie", cookie);
            next.setDataSource(getContext(), Uri.parse(url), headers);
        } catch (Exception error) {
            Log.w(TAG, "Could not open the voice audio", error);
            finish(null, "Could not open the voice audio: " + error.getMessage());
            return;
        }
        next.setOnPreparedListener(mp -> {
            if (mp == player) mp.start();
        });
        next.setOnCompletionListener(mp -> {
            if (mp != player) return;
            JSObject result = new JSObject();
            result.put("ended", true);
            finish(result, null);
        });
        next.setOnErrorListener((mp, what, extra) -> {
            if (mp == player) finish(null, "Android could not play the voice audio (" + what + ", " + extra + ")");
            return true;
        });
        next.prepareAsync();
    }

    /**
     * Whether the phone is in a call over a Bluetooth head unit right now. Only
     * then is the call line the right road: on the phone's own speaker a voice
     * call plays out of the earpiece, which is exactly what the owner does not want.
     */
    @PluginMethod
    public void getRoute(PluginCall call) {
        boolean bluetoothCall = false;
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (audio != null && audio.getMode() == AudioManager.MODE_IN_COMMUNICATION) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                AudioDeviceInfo device = audio.getCommunicationDevice();
                if (device != null) {
                    int type = device.getType();
                    bluetoothCall = type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLE_HEADSET;
                }
            } else {
                bluetoothCall = audio.isBluetoothScoOn();
            }
        }
        JSObject result = new JSObject();
        result.put("bluetoothCall", bluetoothCall);
        result.put("mode", audio != null ? audio.getMode() : -1);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        finish(null, "Stopped");
        call.resolve();
    }

    /** Ends the current segment: resolves it with result, or rejects it with error. */
    private void finish(JSObject result, String error) {
        PluginCall waiting = pending;
        MediaPlayer current = player;
        pending = null;
        player = null;
        if (current != null) {
            try {
                current.reset();
            } catch (Exception ignored) {
                // A player already in its error state can refuse a reset; release still frees it.
            }
            current.release();
        }
        if (waiting == null) return;
        if (error != null) waiting.reject(error);
        else waiting.resolve(result != null ? result : new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        finish(null, "The app closed");
    }
}
