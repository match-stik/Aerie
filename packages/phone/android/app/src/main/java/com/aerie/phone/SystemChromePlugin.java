// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the status bar and the navigation strip the colors the page asks
 * for, so the APK's frame follows the theme the way the installed web app
 * follows its theme-color. The navigation strip arrived in 1.38.
 *
 * The app targets Android 15 and opts out of edge-to-edge in styles.xml, so
 * the window still owns a solid bar and setStatusBarColor still lands. That
 * opt-out only stops counting for apps that target Android 16, so it holds on
 * an Android 16 phone too. @capacitor/status-bar refuses on every Android 16
 * phone whatever the app targets, which is why the house paints its own.
 */
@CapacitorPlugin(name = "SystemChrome")
public class SystemChromePlugin extends Plugin {

    @PluginMethod
    @SuppressWarnings("deprecation")
    public void setStatusBar(PluginCall call) {
        Integer color = colorFrom(call);
        if (color == null) return;
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            window.setStatusBarColor(color);
            // Icons are chosen off the color itself rather than the mode: the
            // home screen paints the bar black even in Daylight, and dark icons
            // on black would disappear.
            WindowInsetsControllerCompat icons = WindowCompat.getInsetsController(window, window.getDecorView());
            icons.setAppearanceLightStatusBars(isLight(color));
            call.resolve();
        });
    }

    /** The strip Android draws under the app, gesture handle or buttons. */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void setNavigationBar(PluginCall call) {
        Integer color = colorFrom(call);
        if (color == null) return;
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            window.setNavigationBarColor(color);
            WindowInsetsControllerCompat icons = WindowCompat.getInsetsController(window, window.getDecorView());
            icons.setAppearanceLightNavigationBars(isLight(color));
            call.resolve();
        });
    }

    /**
     * What Android shows behind the page for the instant between the keyboard
     * closing and the page repainting at its new height: the window's own
     * background, which was the theme default, so a block of the wrong color
     * flashed under the footer (measured: the page itself filled the new
     * height in the same frame, every time). Painted the footer's color, there
     * is nothing to see.
     */
    @PluginMethod
    public void setWindowBackground(PluginCall call) {
        Integer color = colorFrom(call);
        if (color == null) return;
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().setBackgroundDrawable(new ColorDrawable(color));
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setBackgroundColor(color);
            }
            call.resolve();
        });
    }

    /** The call's color, or null after rejecting the call for it. */
    private static Integer colorFrom(PluginCall call) {
        String hex = call.getString("color");
        if (hex == null) {
            call.reject("color is required");
            return null;
        }
        try {
            return Color.parseColor(hex);
        } catch (IllegalArgumentException notAColor) {
            call.reject("not a color: " + hex);
            return null;
        }
    }

    /** Whether a color wants dark icons on it: relative luminance past the
     *  point where black text out-contrasts white (about 0.179). */
    static boolean isLight(int color) {
        double luminance = 0.2126 * linear(Color.red(color))
            + 0.7152 * linear(Color.green(color))
            + 0.0722 * linear(Color.blue(color));
        return luminance > 0.179;
    }

    private static double linear(int channel) {
        double s = channel / 255.0;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
}
