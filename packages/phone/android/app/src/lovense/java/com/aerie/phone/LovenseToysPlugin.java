// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Lovense: this file drives Lovense toys. Running Aerie needs your own Lovense
// developer account and token; carrying this code into another project needs
// that project's own agreement and approval from Lovense. See
// packages/phone/android/LOVENSE.md.
package com.aerie.phone;

import android.Manifest;
import android.app.Application;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import com.component.toymodule.command.control.bean.CommandType;
import com.component.toymodule.toy.bean.BaseError;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.lovense.sdklibrary.Lovense;
import com.lovense.sdklibrary.LovenseToy;
import com.lovense.sdklibrary.callBack.LovenseError;
import com.lovense.sdklibrary.callBack.OnCallBackBatteryV2Listener;
import com.lovense.sdklibrary.callBack.OnConnectListener;
import com.lovense.sdklibrary.callBack.OnErrorListener;
import com.lovense.sdklibrary.callBack.OnSearchToyListener;
import com.lovense.sdklibrary.callBack.OnSendCommandErrorListener;

import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The owner's toys, over Bluetooth from this phone, through Lovense's own
 * Android SDK.
 *
 * The usual alternative sends every toy command through Lovense's cloud,
 * which reaches a toy only through the Lovense Remote app holding the
 * connection. What this adds is a direct road. It talks to the toys straight
 * from the phone, so nothing sits between the owner and a toy, each motor
 * holds wherever it is set, and the owner's stop is on the same screen as
 * everything it stops.
 *
 * THE OWNER'S STOP COMES FIRST. stop() sends zero to every motion every
 * connected toy has, and then refuses every command for a few seconds, so a
 * command already on its way from a slider or from a companion's lane cannot
 * start a toy back up behind the owner. Every SDK call goes through the main thread's queue in the order it was
 * asked for, so the zeros land after anything that was queued before the stop,
 * and a command checks the hold again at the moment it would go out.
 *
 * Each toy is also told when it connects to stop by itself if this phone loses
 * it, and not to pick its last level back up when it comes back. A dropped
 * phone or a dead battery leaves a toy still, never running.
 *
 * The developer token never lives in the app file: the page asks the house for
 * it and hands it in through setToken().
 */
@CapacitorPlugin(
    name = "LovenseToys",
    permissions = {
        @Permission(alias = LovenseToysPlugin.BLUETOOTH, strings = {
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_CONNECT,
        }),
        @Permission(alias = LovenseToysPlugin.LOCATION, strings = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        }),
    }
)
public class LovenseToysPlugin extends Plugin {
    static final String BLUETOOTH = "bluetooth";
    static final String LOCATION = "location";
    private static final String TAG = "AerieLovense";

    /** How long the owner's stop refuses every command after it lands. */
    static final long STOP_HOLD_MS = 3000;

    /** Commands that take one level, and the highest level each takes. */
    private static final Map<CommandType, Integer> LEVELED = new EnumMap<>(CommandType.class);
    /** Commands that take nothing. */
    private static final Set<CommandType> PLAIN = EnumSet.of(
        CommandType.ROTATE_CHANGE,
        CommandType.FLASH,
        CommandType.LIGHT_ON,
        CommandType.LIGHT_OFF,
        CommandType.ALIGHT_ON,
        CommandType.ALIGHT_OFF,
        CommandType.GET_BATTERY,
        CommandType.GET_LIGHT_STATUS,
        CommandType.GET_ALIGHT_STATUS,
        CommandType.GET_DEVICE_TYPE
    );
    /** Questions, which move nothing and so go through even while the stop holds. */
    private static final Set<CommandType> QUESTIONS = EnumSet.of(
        CommandType.GET_BATTERY,
        CommandType.GET_LIGHT_STATUS,
        CommandType.GET_ALIGHT_STATUS,
        CommandType.GET_DEVICE_TYPE
    );
    /** Everything stop() sends a zero to, where the toy has it. */
    private static final Set<CommandType> MOTION = EnumSet.of(
        CommandType.VIBRATE,
        CommandType.VIBRATE1,
        CommandType.VIBRATE2,
        CommandType.VIBRATE3,
        CommandType.ROTATE,
        CommandType.THRUST,
        CommandType.FLEXER_VIBRATE,
        CommandType.FLEXER_FINGER,
        CommandType.OSCILLATE,
        CommandType.PRESET,
        CommandType.AIR_AUTO
    );

    static {
        for (CommandType c : new CommandType[] {
            CommandType.VIBRATE, CommandType.VIBRATE1, CommandType.VIBRATE2, CommandType.VIBRATE3,
            CommandType.ROTATE, CommandType.ROTATE_CLOCKWISE, CommandType.ROTATE_ANTI_CLOCKWISE,
            CommandType.THRUST, CommandType.FLEXER_VIBRATE, CommandType.FLEXER_FINGER,
            CommandType.OSCILLATE, CommandType.VIBRATE_FLASH,
        }) {
            LEVELED.put(c, 20);
        }
        LEVELED.put(CommandType.PRESET, 10);
        LEVELED.put(CommandType.AIR_IN, 3);
        LEVELED.put(CommandType.AIR_OUT, 3);
        LEVELED.put(CommandType.AIR_AUTO, 3);
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile long holdUntil = 0;
    private volatile boolean tokenSet = false;
    /** Every toy a search has turned up, by id. */
    private final Map<String, LovenseToy> seen = new ConcurrentHashMap<>();
    /** Toys whose battery and error listeners are attached. */
    private final Set<String> listening = Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());
    /** Toys told this connection to stop on their own if the phone loses them. */
    private final Set<String> prepared = Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());

    private Lovense sdk() {
        return Lovense.getInstance((Application) getContext().getApplicationContext());
    }

    private boolean held() {
        return SystemClock.elapsedRealtime() < holdUntil;
    }

    // ---- status and access ----

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (permitted()) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAlias(neededAlias(), call, "accessResult");
    }

    @PermissionCallback
    private void accessResult(PluginCall call) {
        call.resolve(statusObject());
    }

    /** Android 12 asks for nearby devices; anything older finds Bluetooth
     *  devices through the location permission. */
    private String neededAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? BLUETOOTH : LOCATION;
    }

    private boolean permitted() {
        return getPermissionState(neededAlias()) == PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    private JSObject statusObject() {
        JSObject o = new JSObject();
        BluetoothAdapter adapter = adapter();
        o.put("bluetoothSupported", adapter != null);
        boolean on = false;
        try {
            on = adapter != null && adapter.isEnabled();
        } catch (SecurityException e) {
            Log.w(TAG, "could not read whether Bluetooth is on", e);
        }
        o.put("bluetoothOn", on);
        o.put("permitted", permitted());
        o.put("tokenSet", tokenSet);
        o.put("holdMs", Math.max(0, holdUntil - SystemClock.elapsedRealtime()));
        o.put("toys", toysArray());
        return o;
    }

    @PluginMethod
    public void setToken(PluginCall call) {
        String token = call.getString("token", "");
        if (token == null || token.trim().isEmpty()) {
            call.reject("No token was handed in");
            return;
        }
        final String trimmed = token.trim();
        main.post(() -> {
            try {
                sdk().setDeveloperToken(trimmed);
                tokenSet = true;
                call.resolve(statusObject());
            } catch (Throwable t) {
                call.reject("Lovense would not take the token: " + t.getMessage());
            }
        });
    }

    // ---- finding and connecting ----

    @PluginMethod
    public void search(PluginCall call) {
        if (!tokenSet) {
            call.reject("The developer token has not been handed in yet");
            return;
        }
        if (!permitted()) {
            call.reject("Bluetooth permission has not been granted");
            return;
        }
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth is off");
            return;
        }
        main.post(() -> {
            try {
                sdk().searchToys(new OnSearchToyListener() {
                    @Override
                    public void onSearchToy(LovenseToy found) {
                        if (found == null) return;
                        if (found.getToyId() != null) seen.put(found.getToyId(), found);
                        notifyListeners("toyFound", toyObject(found));
                    }

                    @Override
                    public void finishSearch() {
                        // Saved, so a toy found tonight is known after the app restarts.
                        try {
                            sdk().saveToys(new ArrayList<>(seen.values()), quietErrors());
                        } catch (Throwable t) {
                            Log.w(TAG, "could not save the toys", t);
                        }
                        notifyListeners("searchFinished", new JSObject());
                    }

                    @Override
                    public void onError(LovenseError error) {
                        notifyListeners("toyError", errorObject(null, error));
                    }
                });
                call.resolve();
            } catch (Throwable t) {
                call.reject("The search would not start: " + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopSearch(PluginCall call) {
        main.post(() -> {
            try {
                sdk().stopSearching();
            } catch (Throwable t) {
                Log.w(TAG, "stopSearching", t);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        final String toyId = call.getString("toyId");
        if (toyId == null || toyId.isEmpty()) {
            call.reject("toyId is required");
            return;
        }
        main.post(() -> {
            try {
                sdk().connectToy(toyId, new OnConnectListener() {
                    @Override
                    public void onConnect(String id, String state) {
                        if (LovenseToy.STATE_CONNECTED.equals(state) || LovenseToy.SERVICE_DISCOVERED.equals(state)) {
                            prepare(id);
                        } else if (LovenseToy.STATE_FAILED.equals(state)) {
                            prepared.remove(id);
                        }
                        JSObject o = new JSObject();
                        o.put("toyId", id);
                        o.put("state", state);
                        notifyListeners("connection", o);
                    }

                    @Override
                    public void onError(LovenseError error) {
                        notifyListeners("toyError", errorObject(toyId, error));
                    }
                });
                call.resolve();
            } catch (Throwable t) {
                call.reject("Could not connect: " + t.getMessage());
            }
        });
    }

    /** Once per connection: listeners for the battery and for refused
     *  commands, and the toy told to stop on its own if the phone loses it. */
    private void prepare(final String toyId) {
        if (listening.add(toyId)) {
            try {
                sdk().addListener(toyId, new OnCallBackBatteryV2Listener() {
                    @Override
                    public void battery(String id, int level, boolean working) {
                        JSObject o = new JSObject();
                        o.put("toyId", id);
                        o.put("level", level);
                        o.put("working", working);
                        notifyListeners("battery", o);
                    }
                });
                sdk().addListener(toyId, new OnSendCommandErrorListener() {
                    @Override
                    public void sendCommandError(String id, LovenseError error) {
                        notifyListeners("toyError", errorObject(id, error));
                    }
                });
            } catch (Throwable t) {
                listening.remove(toyId);
                Log.w(TAG, "could not listen to " + toyId, t);
            }
        }
        if (prepared.add(toyId)) {
            // A beat after connecting, so the toy's services are there to answer.
            main.postDelayed(() -> {
                try {
                    List<CommandType> has = supported(toyId);
                    if (has == null || has.contains(CommandType.SET_AUTO_SWITCH)) {
                        // [autoStop, reconnectToLastLevel]
                        sdk().sendCommand(toyId, CommandType.SET_AUTO_SWITCH, new int[] { 1, 0 });
                    }
                } catch (Throwable t) {
                    prepared.remove(toyId);
                    Log.w(TAG, "could not set " + toyId + " to stop on its own", t);
                }
            }, 800);
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        final String toyId = call.getString("toyId");
        if (toyId == null || toyId.isEmpty()) {
            call.reject("toyId is required");
            return;
        }
        main.post(() -> {
            try {
                sdk().disconnect(toyId);
            } catch (Throwable t) {
                Log.w(TAG, "disconnect " + toyId, t);
            }
            prepared.remove(toyId);
            call.resolve();
        });
    }

    @PluginMethod
    public void toys(PluginCall call) {
        JSObject o = new JSObject();
        o.put("toys", toysArray());
        call.resolve(o);
    }

    // ---- commands ----

    @PluginMethod
    public void command(PluginCall call) {
        final String toyId = call.getString("toyId");
        final String name = call.getString("command");
        if (toyId == null || toyId.isEmpty() || name == null) {
            call.reject("toyId and command are required");
            return;
        }
        final CommandType type;
        try {
            type = CommandType.valueOf(name);
        } catch (IllegalArgumentException e) {
            call.reject("Not a command this house sends: " + name);
            return;
        }
        final boolean question = QUESTIONS.contains(type);
        if (!question && held()) {
            call.reject("The owner's stop is holding", "HELD");
            return;
        }
        final Integer max = LEVELED.get(type);
        if (max != null) {
            Integer level = call.getInt("level");
            int min = (type == CommandType.AIR_IN || type == CommandType.AIR_OUT) ? 1 : 0;
            if (level == null || level < min || level > max) {
                call.reject(name + " takes a level from " + min + " to " + max);
                return;
            }
            final int value = level;
            main.post(() -> {
                if (held()) {
                    call.reject("The owner's stop is holding", "HELD");
                    return;
                }
                try {
                    sdk().sendCommand(toyId, type, value);
                    call.resolve();
                } catch (Throwable t) {
                    call.reject("The toy did not take it: " + t.getMessage());
                }
            });
            return;
        }
        if (PLAIN.contains(type)) {
            main.post(() -> {
                if (!question && held()) {
                    call.reject("The owner's stop is holding", "HELD");
                    return;
                }
                try {
                    sdk().sendCommand(toyId, type);
                    call.resolve();
                } catch (Throwable t) {
                    call.reject("The toy did not take it: " + t.getMessage());
                }
            });
            return;
        }
        call.reject("Not a command this house sends: " + name);
    }

    /** The owner's stop. The hold starts on the calling thread, before anything is
     *  queued, so nothing asked for after this moment can get out. */
    @PluginMethod
    public void stop(PluginCall call) {
        holdUntil = SystemClock.elapsedRealtime() + STOP_HOLD_MS;
        main.post(() -> {
            int stopped = stopEverything();
            JSObject o = new JSObject();
            o.put("stopped", stopped);
            o.put("holdMs", STOP_HOLD_MS);
            notifyListeners("stopped", o);
            call.resolve(o);
        });
    }

    /** A zero to every motion each connected toy has. Runs on the main
     *  thread, after anything that was already queued there. */
    private int stopEverything() {
        Lovense sdk = sdk();
        int count = 0;
        for (String id : knownIds()) {
            boolean connected = false;
            try {
                connected = sdk.isConnected(id);
            } catch (Throwable t) {
                Log.w(TAG, "isConnected " + id, t);
            }
            if (!connected) continue;
            List<CommandType> has = supported(id);
            boolean sent = false;
            for (CommandType c : MOTION) {
                // A toy that has not said what it can do still gets the plain zero.
                if (has == null ? c != CommandType.VIBRATE : !has.contains(c)) continue;
                try {
                    sdk.sendCommand(id, c, 0);
                    sent = true;
                } catch (Throwable t) {
                    Log.w(TAG, "stop " + c + " on " + id, t);
                }
            }
            if (sent) count++;
        }
        return count;
    }

    @Override
    protected void handleOnDestroy() {
        // The page that holds the owner's stop is going away, so nothing keeps
        // running without a stop to answer to.
        holdUntil = SystemClock.elapsedRealtime() + STOP_HOLD_MS;
        try {
            stopEverything();
        } catch (Throwable t) {
            Log.w(TAG, "stop on the way out", t);
        }
        super.handleOnDestroy();
    }

    // ---- shapes ----

    /** Every toy this phone knows: found tonight, or saved from before. */
    private Set<String> knownIds() {
        Set<String> ids = new LinkedHashSet<>(seen.keySet());
        try {
            List<LovenseToy> saved = sdk().listToys(quietErrors());
            if (saved != null) {
                for (LovenseToy t : saved) {
                    if (t == null || t.getToyId() == null) continue;
                    ids.add(t.getToyId());
                    // A saved toy carries its name and type too; keep it so the
                    // page is not left with only a Bluetooth address.
                    seen.putIfAbsent(t.getToyId(), t);
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "listToys", t);
        }
        return ids;
    }

    private List<CommandType> supported(String toyId) {
        try {
            return sdk().getSupportedCommands(toyId);
        } catch (Throwable t) {
            return null;
        }
    }

    private boolean connectedSafely(String toyId) {
        try {
            return sdk().isConnected(toyId);
        } catch (Throwable t) {
            return false;
        }
    }

    private JSArray toysArray() {
        JSArray list = new JSArray();
        for (String id : knownIds()) {
            LovenseToy t = seen.get(id);
            if (t != null) {
                list.put(toyObject(t));
            } else {
                JSObject o = new JSObject();
                o.put("toyId", id);
                o.put("connected", connectedSafely(id));
                o.put("commands", commandNames(id));
                list.put(o);
            }
        }
        return list;
    }

    private JSArray commandNames(String toyId) {
        JSArray names = new JSArray();
        List<CommandType> has = supported(toyId);
        if (has != null) {
            for (CommandType c : has) names.put(c.name());
        }
        return names;
    }

    private JSObject toyObject(LovenseToy t) {
        JSObject o = new JSObject();
        o.put("toyId", t.getToyId());
        o.put("name", t.getName());
        o.put("type", t.getType());
        o.put("fullName", t.getFullName());
        o.put("deviceType", t.getDeviceType());
        o.put("version", t.getToyVersion());
        o.put("battery", t.getBattery());
        o.put("rssi", t.getRssi());
        o.put("connected", t.getToyId() != null && connectedSafely(t.getToyId()));
        o.put("commands", t.getToyId() == null ? new JSArray() : commandNames(t.getToyId()));
        return o;
    }

    private JSObject errorObject(String toyId, BaseError error) {
        JSObject o = new JSObject();
        if (toyId != null) o.put("toyId", toyId);
        if (error != null) {
            o.put("code", error.getCode());
            o.put("message", error.getMessage());
        }
        return o;
    }

    private OnErrorListener quietErrors() {
        return new OnErrorListener() {
            @Override
            public void onError(LovenseError error) {
                Log.w(TAG, "Lovense: " + (error == null ? "unknown error" : error.getMessage()));
            }
        };
    }
}
