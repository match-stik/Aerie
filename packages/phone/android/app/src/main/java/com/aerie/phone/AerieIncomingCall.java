// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
package com.aerie.phone;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Shader;
import android.media.AudioAttributes;
import android.util.Base64;
import android.media.RingtoneManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;

import java.io.File;
import java.io.FileOutputStream;

/**
 * We call them, rather than waiting to be called. The house sends a data-only push of kind "ring-call"
 * (services/ring-call.ts); this shows it as an incoming call with Answer and
 * Decline, ringing on the ringtone channel. Answer opens Aerie and asks the
 * page to start the hands-free voice call (MainActivity, ACTION_ANSWER_RING);
 * Decline only stops the ringing. A ring nobody answers stops by itself.
 *
 * Android allows a call notification only with a full-screen screen behind
 * it, so a locked phone shows IncomingCallActivity; an unlocked one shows the
 * call as a banner at the top. Nothing here dials a phone number.
 */
public final class AerieIncomingCall {
    /** The push's kind, matching RING_KIND in the house's services/ring-call.ts. */
    public static final String RING_KIND = "ring-call";
    public static final String CHANNEL_ID = "aerie_incoming_call";
    public static final int NOTIFICATION_ID = 4107;
    public static final String ACTION_ANSWER_RING = "com.aerie.phone.action.ANSWER_RING";
    public static final String ACTION_DECLINE_RING = "com.aerie.phone.action.DECLINE_RING";
    public static final String EXTRA_TITLE = "title";
    /**
     * MainActivity is exported (it is the launcher), so any app could send it
     * ACTION_ANSWER_RING and open the microphone. Each ring carries a fresh
     * token on its own Answer intents, and an answer without it does nothing.
     */
    public static final String EXTRA_RING_TOKEN = "ringToken";
    private static volatile String ringToken;
    private static volatile long ringTokenAt;
    /** How long it rings before giving up, a little under a phone's own. */
    public static final long RING_MS = 40_000;

    private AerieIncomingCall() {}

    public static void ring(Context context, String title) {
        Context app = context.getApplicationContext();
        String who = title == null || title.trim().isEmpty() ? "Your companions" : title.trim();
        createChannel(app);

        ringToken = java.util.UUID.randomUUID().toString();
        ringTokenAt = android.os.SystemClock.elapsedRealtime();
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent answer = PendingIntent.getActivity(app, 41071,
                new Intent(app, MainActivity.class)
                        .setAction(ACTION_ANSWER_RING)
                        .putExtra(EXTRA_RING_TOKEN, ringToken)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                flags);
        PendingIntent decline = PendingIntent.getBroadcast(app, 41072,
                new Intent(app, PocketVoiceActionReceiver.class).setAction(ACTION_DECLINE_RING),
                flags);
        PendingIntent screen = PendingIntent.getActivity(app, 41073,
                new Intent(app, IncomingCallActivity.class)
                        .putExtra(EXTRA_TITLE, who)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION),
                flags);

        Bitmap faces = loadCallerFaces(app);
        Person.Builder person = new Person.Builder().setName(who).setImportant(true);
        if (faces != null) person.setIcon(IconCompat.createWithBitmap(faces));
        Person caller = person.build();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(app, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle(who)
                .setContentText("Calling you")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(true)
                .setTimeoutAfter(RING_MS)
                .setFullScreenIntent(screen, true)
                .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer));
        if (faces != null) builder.setLargeIcon(faces);
        try {
            NotificationManagerCompat.from(app).notify(NOTIFICATION_ID, builder.build());
            HouseLog.report(app, "ring-call", "rang: " + who);
        } catch (SecurityException | IllegalArgumentException refused) {
            HouseLog.report(app, "ring-call", "could not ring: " + refused.getClass().getSimpleName() + " " + refused.getMessage());
        }
    }

    /** The live ring's token, for the full-screen ringer's own Answer button. */
    static String currentRingToken() {
        return ringToken;
    }

    /** True once, for the token of the latest ring, within a minute of it ringing out. */
    static boolean takeRingToken(String token) {
        String live = ringToken;
        if (live == null || token == null || !live.equals(token)) return false;
        if (android.os.SystemClock.elapsedRealtime() - ringTokenAt > RING_MS + 60_000) return false;
        ringToken = null;
        return true;
    }

    public static void stop(Context context) {
        NotificationManagerCompat.from(context.getApplicationContext()).cancel(NOTIFICATION_ID);
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Calls from us", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("When your companions call you");
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 800, 600, 800, 600, 800});
        manager.createNotificationChannel(channel);
    }

    // ---- the caller picture ----
    //
    // The call showed one companion's initial alone, the letter Android draws
    // for a caller with no picture. The page hands over the same faces the
    // call dock wears (PocketVoicePlugin), and they are kept here as one round
    // picture, everybody together, read back when a ring arrives.

    private static final String FACES_FILE = "caller-faces.png";
    private static final int FACES_PX = 256;

    /** Draw the faces the page handed over into one round picture and keep it. */
    public static void saveCallerFaces(Context context, String[] pngs, String[] colors) {
        if (pngs == null) return;
        Bitmap[] decoded = new Bitmap[Math.min(pngs.length, 3)];
        int found = 0;
        for (int index = 0; index < decoded.length; index++) {
            decoded[index] = decode(pngs[index]);
            if (decoded[index] != null) found++;
        }
        if (found == 0) return;

        Bitmap out = Bitmap.createBitmap(FACES_PX, FACES_PX, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint back = new Paint(Paint.ANTI_ALIAS_FLAG);
        back.setColor(Color.parseColor("#17120F"));
        canvas.drawCircle(FACES_PX / 2f, FACES_PX / 2f, FACES_PX / 2f, back);

        // One face fills the circle; two sit side by side; three sit as a
        // triangle, the first at the top, the way the dock leads with him.
        float[][] spots;
        float radius;
        if (decoded.length == 1) {
            spots = new float[][] {{0.5f, 0.5f}};
            radius = 0.46f;
        } else if (decoded.length == 2) {
            spots = new float[][] {{0.31f, 0.5f}, {0.69f, 0.5f}};
            radius = 0.24f;
        } else {
            spots = new float[][] {{0.5f, 0.3f}, {0.29f, 0.66f}, {0.71f, 0.66f}};
            radius = 0.235f;
        }
        for (int index = decoded.length - 1; index >= 0; index--) {
            String colour = colors != null && index < colors.length ? colors[index] : null;
            drawFace(canvas, decoded[index], colour, spots[index][0] * FACES_PX, spots[index][1] * FACES_PX, radius * FACES_PX);
        }

        File target = new File(context.getApplicationContext().getFilesDir(), FACES_FILE);
        File temp = new File(target.getPath() + ".tmp");
        try (FileOutputStream stream = new FileOutputStream(temp)) {
            out.compress(Bitmap.CompressFormat.PNG, 100, stream);
        } catch (Exception failed) {
            temp.delete();
            return;
        }
        if (!temp.renameTo(target)) temp.delete();
    }

    /** The kept caller picture, or null before the page has handed one over. */
    public static Bitmap loadCallerFaces(Context context) {
        File file = new File(context.getApplicationContext().getFilesDir(), FACES_FILE);
        if (!file.isFile()) return null;
        try {
            return BitmapFactory.decodeFile(file.getPath());
        } catch (RuntimeException unreadable) {
            return null;
        }
    }

    private static void drawFace(Canvas canvas, Bitmap face, String colour, float cx, float cy, float radius) {
        int ring;
        try {
            ring = colour == null ? Color.parseColor("#e85d04") : Color.parseColor(colour);
        } catch (IllegalArgumentException bad) {
            ring = Color.parseColor("#e85d04");
        }
        Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
        edge.setColor(ring);
        canvas.drawCircle(cx, cy, radius, edge);
        if (face == null) return;
        float inner = radius - Math.max(3f, radius * 0.08f);
        float scale = (inner * 2f) / Math.min(face.getWidth(), face.getHeight());
        Bitmap scaled = Bitmap.createScaledBitmap(face,
                Math.max(1, Math.round(face.getWidth() * scale)),
                Math.max(1, Math.round(face.getHeight() * scale)), true);
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        BitmapShader shader = new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        android.graphics.Matrix shift = new android.graphics.Matrix();
        shift.setTranslate(cx - scaled.getWidth() / 2f, cy - scaled.getHeight() / 2f);
        shader.setLocalMatrix(shift);
        fill.setShader(shader);
        canvas.drawCircle(cx, cy, inner, fill);
    }

    private static Bitmap decode(String png) {
        if (png == null || png.isEmpty()) return null;
        try {
            byte[] bytes = Base64.decode(png, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException bad) {
            return null;
        }
    }
}
