// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.car.app.model.Action;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Template;
import androidx.car.app.validation.HostValidator;

import java.lang.ref.WeakReference;

/**
 * Our tile on the car's dash as a calling app (theirs, Nov 6 2026, from
 * Google's guide for calling apps on Android Auto). One screen: Call us when
 * there is no call, and the call's state with Hang up when there is one.
 * While a Telecom call is running Android Auto shows its own call screen over
 * this one (AerieCallTelecom.java); this is what is under it.
 *
 * Call us brings Aerie up on the phone and asks the page to start the call,
 * because the call's microphone and voices live in the page. Android may not
 * let a car tile raise the phone's app while it is in the background; if it
 * doesn't, the screen says to start the call once from the phone.
 */
public class AerieCarAppService extends CarAppService {
    public static final String ACTION_START_CALL = "com.aerie.phone.action.START_CALL_FROM_CAR";
    private static final String TAG = "AerieCarApp";
    private static WeakReference<CallScreen> screen = new WeakReference<>(null);
    private static volatile String note;

    @NonNull
    @Override
    public HostValidator createHostValidator() {
        // A debug build talks to any host, so a desktop head unit can test it.
        // Anything else answers only the Android Auto hosts in the car
        // library's own allowlist, checked by signing certificate.
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
        }
        return new HostValidator.Builder(getApplicationContext())
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build();
    }

    @NonNull
    @Override
    public Session onCreateSession() {
        return new Session() {
            @NonNull
            @Override
            public Screen onCreateScreen(@NonNull Intent intent) {
                CallScreen s = new CallScreen(getCarContext());
                screen = new WeakReference<>(s);
                return s;
            }
        };
    }

    /** Redraw the tile after the call starts or ends. Safe from any thread. */
    public static void refresh() {
        new Handler(Looper.getMainLooper()).post(() -> {
            CallScreen s = screen.get();
            if (s != null) s.invalidate();
        });
    }

    static final class CallScreen extends Screen {
        CallScreen(CarContext context) { super(context); }

        @NonNull
        @Override
        public Template onGetTemplate() {
            boolean onCall = MainActivity.isPocketVoiceActive();
            if (onCall) {
                return new MessageTemplate.Builder("We're on the line with you.")
                    .setTitle("Your companions")
                    .addAction(new Action.Builder()
                        .setTitle("Hang up")
                        .setOnClickListener(this::hangUp)
                        .build())
                    .build();
            }
            String message = note != null ? note : "Call us and we'll answer.";
            return new MessageTemplate.Builder(message)
                .setTitle("Your companions")
                .addAction(new Action.Builder()
                    .setTitle("Call us")
                    .setOnClickListener(this::callUs)
                    .build())
                .build();
        }

        private void callUs() {
            PocketVoicePlugin.requestCall();
            try {
                Intent open = new Intent(getCarContext(), MainActivity.class)
                    .setAction(ACTION_START_CALL)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                getCarContext().startActivity(open);
                note = "Calling. If nothing happens, start the call once from Aerie on your phone.";
            } catch (RuntimeException refused) {
                Log.w(TAG, "Android would not raise Aerie from the car", refused);
                note = "Start the call once from Aerie on your phone, and it shows up here.";
            }
            AerieCrashReporter.breadcrumb("car.call us pressed");
            invalidate();
        }

        private void hangUp() {
            AerieCrashReporter.breadcrumb("car.hang up pressed");
            AerieCallTelecom.end();
            PocketVoiceService.stop(getCarContext());
            MainActivity.setPocketVoiceActive(false);
            PocketVoicePlugin.publishState(false);
            note = null;
            invalidate();
        }
    }
}
