// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The full screen behind a call from us on a locked phone (AerieIncomingCall).
 * Who is calling, Answer and Decline, and nothing else. It closes by itself
 * when the ring runs out.
 */
public class IncomingCallActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        String who = getIntent().getStringExtra(AerieIncomingCall.EXTRA_TITLE);
        if (who == null || who.trim().isEmpty()) who = "Your companions";

        float dp = getResources().getDisplayMetrics().density;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#090807"));
        root.setPadding((int) (32 * dp), (int) (32 * dp), (int) (32 * dp), (int) (32 * dp));

        android.graphics.Bitmap faces = AerieIncomingCall.loadCallerFaces(this);
        if (faces != null) {
            android.widget.ImageView picture = new android.widget.ImageView(this);
            picture.setImageBitmap(faces);
            int side = (int) (168 * dp);
            LinearLayout.LayoutParams frame = new LinearLayout.LayoutParams(side, side);
            frame.bottomMargin = (int) (24 * dp);
            picture.setLayoutParams(frame);
            root.addView(picture);
        }

        TextView name = new TextView(this);
        name.setText(who);
        name.setTextColor(Color.WHITE);
        name.setTextSize(30);
        name.setGravity(Gravity.CENTER);
        root.addView(name);

        TextView note = new TextView(this);
        note.setText("Calling you");
        note.setTextColor(Color.parseColor("#F4A261"));
        note.setTextSize(18);
        note.setGravity(Gravity.CENTER);
        note.setPadding(0, (int) (8 * dp), 0, (int) (64 * dp));
        root.addView(note);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.addView(button("Decline", "#B3261E", dp, v -> decline()));
        row.addView(button("Answer", "#2E7D32", dp, v -> answer()));
        root.addView(row);
        setContentView(root);

        main.postDelayed(this::finish, AerieIncomingCall.RING_MS);
    }

    private Button button(String label, String color, float dp, android.view.View.OnClickListener onClick) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(18);
        button.setAllCaps(false);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(Color.parseColor(color));
        shape.setCornerRadius(40 * dp);
        button.setBackground(shape);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams((int) (130 * dp), (int) (64 * dp));
        params.setMargins((int) (16 * dp), 0, (int) (16 * dp), 0);
        button.setLayoutParams(params);
        button.setOnClickListener(onClick);
        return button;
    }

    private void answer() {
        String token = AerieIncomingCall.currentRingToken();
        AerieIncomingCall.stop(this);
        startActivity(new Intent(this, MainActivity.class)
                .setAction(AerieIncomingCall.ACTION_ANSWER_RING)
                .putExtra(AerieIncomingCall.EXTRA_RING_TOKEN, token)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finish();
    }

    private void decline() {
        AerieIncomingCall.stop(this);
        HouseLog.report(this, "ring-call", "declined");
        finish();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
