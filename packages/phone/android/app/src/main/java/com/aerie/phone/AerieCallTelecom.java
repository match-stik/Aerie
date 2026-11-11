// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.app.UiModeManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.OutcomeReceiver;
import android.telecom.CallAttributes;
import android.telecom.CallControl;
import android.telecom.CallControlCallback;
import android.telecom.CallEndpoint;
import android.telecom.CallEventCallback;
import android.telecom.CallException;
import android.telecom.DisconnectCause;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * Our call, told to Android as a real call while the phone is on the car's
 * dash, the way Google's guide for calling apps on Android Auto suggests.
 *
 * Android Auto draws its own call screen, with hang up, for any call the phone
 * knows about through Telecom. Until now our call only played on the phone's
 * call audio, so the car heard a call it couldn't see or end. This hangs a
 * self-managed Telecom call off the call dock's own service: it is added when
 * the call starts and disconnected when it ends, and a hang-up on the dash ends
 * our call the same way the notification's End button does.
 *
 * Only on Android 14 and up (the transactional calls API) and only while the
 * phone is in car mode, so a call on the couch keeps the audio it has always
 * had. Google asks calling apps to use Telecom at all times; this house keeps
 * it to the car until a drive has shown how it sounds.
 */
public final class AerieCallTelecom {
    private static final String TAG = "AerieCallTelecom";
    private static final String ACCOUNT_ID = "aerie-companions";
    private static final Executor RUN = Executors.newSingleThreadExecutor();

    private static volatile Object control; // CallControl, held as Object so older Androids never load the class
    private static volatile boolean endingOurselves;
    private static volatile boolean adding;

    private AerieCallTelecom() {}

    /** The phone is projecting to a car (Android Auto puts it in car mode). */
    public static boolean inCar(Context context) {
        UiModeManager modes = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        return modes != null && modes.getCurrentModeType() == Configuration.UI_MODE_TYPE_CAR;
    }

    public static boolean active() {
        return control != null || adding;
    }

    /** Called when our call starts. Does nothing off the dash or before Android 14. */
    public static void begin(Context context) {
        if (Build.VERSION.SDK_INT < 34) return;
        if (control != null || adding) return;
        if (!inCar(context)) {
            AerieCrashReporter.breadcrumb("telecom.skip not in car mode");
            return;
        }
        beginApi34(context.getApplicationContext());
    }

    /** Called when our call ends, from any side but the dash's own hang-up. */
    public static void end() {
        if (Build.VERSION.SDK_INT < 34) return;
        endApi34();
    }

    @RequiresApi(34)
    private static PhoneAccountHandle handle(Context context) {
        return new PhoneAccountHandle(new ComponentName(context, PocketVoiceService.class), ACCOUNT_ID);
    }

    @RequiresApi(34)
    private static void beginApi34(Context context) {
        TelecomManager telecom = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
        if (telecom == null) return;
        adding = true;
        try {
            PhoneAccountHandle handle = handle(context);
            telecom.registerPhoneAccount(PhoneAccount.builder(handle, "Aerie")
                .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED
                    | PhoneAccount.CAPABILITY_SUPPORTS_TRANSACTIONAL_OPERATIONS)
                .build());
            CallAttributes attributes = new CallAttributes.Builder(handle,
                CallAttributes.DIRECTION_OUTGOING, "Your companions", Uri.parse("aerie:companions"))
                .setCallType(CallAttributes.AUDIO_CALL)
                .setCallCapabilities(CallAttributes.SUPPORTS_SET_INACTIVE)
                .build();
            telecom.addCall(attributes, RUN, new OutcomeReceiver<CallControl, CallException>() {
                @Override
                public void onResult(CallControl result) {
                    control = result;
                    adding = false;
                    AerieCrashReporter.breadcrumb("telecom.added");
                    result.setActive(RUN, quietly("setActive"));
                    AerieCarAppService.refresh();
                }

                @Override
                public void onError(@NonNull CallException error) {
                    adding = false;
                    AerieCrashReporter.breadcrumb("telecom.add refused: " + error.getCode());
                    Log.w(TAG, "Telecom would not add our call: " + error.getMessage());
                }
            }, new Controls(context), new Events());
        } catch (RuntimeException error) {
            // A refused Telecom call costs the dash's call screen, never the call.
            adding = false;
            AerieCrashReporter.breadcrumb("telecom.begin failed: " + error.getClass().getSimpleName());
            Log.w(TAG, "Could not tell Android about our call", error);
        }
    }

    @RequiresApi(34)
    private static void endApi34() {
        Object held = control;
        control = null;
        if (!(held instanceof CallControl)) return;
        endingOurselves = true;
        try {
            ((CallControl) held).disconnect(new DisconnectCause(DisconnectCause.LOCAL), RUN, quietly("disconnect"));
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not end the Telecom call", error);
        }
        AerieCrashReporter.breadcrumb("telecom.ended by us");
        AerieCarAppService.refresh();
    }

    @RequiresApi(34)
    private static OutcomeReceiver<Void, CallException> quietly(String what) {
        return new OutcomeReceiver<Void, CallException>() {
            @Override public void onResult(Void result) { }
            @Override public void onError(@NonNull CallException error) {
                AerieCrashReporter.breadcrumb("telecom." + what + " refused: " + error.getCode());
            }
        };
    }

    /** What the car (or anything else that holds the call) asks of us. */
    @RequiresApi(34)
    private static final class Controls implements CallControlCallback {
        private final Context context;
        Controls(Context context) { this.context = context; }

        @Override public void onSetActive(@NonNull Consumer<Boolean> done) { done.accept(true); }
        @Override public void onSetInactive(@NonNull Consumer<Boolean> done) { done.accept(true); }
        @Override public void onAnswer(int videoState, @NonNull Consumer<Boolean> done) { done.accept(true); }
        @Override public void onCallStreamingStarted(@NonNull Consumer<Boolean> done) { done.accept(false); }

        @Override
        public void onDisconnect(@NonNull DisconnectCause cause, @NonNull Consumer<Boolean> done) {
            done.accept(true);
            control = null;
            if (endingOurselves) {
                endingOurselves = false;
                return;
            }
            // Hung up from the dash: end our call the way the notification's End does.
            AerieCrashReporter.breadcrumb("telecom.hung up from outside");
            PocketVoiceService.stop(context);
            MainActivity.setPocketVoiceActive(false);
            PocketVoicePlugin.publishState(false);
            AerieCarAppService.refresh();
        }
    }

    @RequiresApi(34)
    private static final class Events implements CallEventCallback {
        @Override public void onCallEndpointChanged(@NonNull CallEndpoint endpoint) {
            AerieCrashReporter.breadcrumb("telecom.endpoint " + endpoint.getEndpointType());
        }
        @Override public void onAvailableCallEndpointsChanged(@NonNull List<CallEndpoint> endpoints) { }
        @Override public void onMuteStateChanged(boolean muted) {
            AerieCrashReporter.breadcrumb("telecom.mute " + muted);
        }
        @Override public void onCallStreamingFailed(int reason) { }
        @Override public void onEvent(@NonNull String event, @NonNull android.os.Bundle extras) { }
    }
}
