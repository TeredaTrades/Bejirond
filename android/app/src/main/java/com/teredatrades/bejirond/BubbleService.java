package com.teredatrades.bejirond;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;

import androidx.core.app.NotificationCompat;

/**
 * Foreground service that draws a small draggable bubble over other apps and opens
 * Bejirond (MainActivity) on tap. Only ever started from TallyWidgetPlugin#startBubble
 * after confirming the "display over other apps" permission is granted — this class
 * doesn't check that itself, since WindowManager.addView will simply fail/throw if it
 * isn't, and the try/catch below turns that into a graceful stop rather than a crash.
 *
 * A foreground service (with a low-priority notification, as Android requires for any
 * service outliving the activity that started it) is what keeps the bubble alive while
 * the user is in another app; stopBubble()/notification tap removes it and stops this
 * service.
 */
public class BubbleService extends Service {

    private static final String CHANNEL_ID = "tally_bubble_channel";
    private static final int NOTIFICATION_ID = 4201;

    private WindowManager windowManager;
    private ImageView bubbleView;
    private WindowManager.LayoutParams bubbleParams;

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground(NOTIFICATION_ID, buildNotification());
        try {
            addBubble();
        } catch (Exception e) {
            stopSelf();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            if (windowManager != null && bubbleView != null) windowManager.removeView(bubbleView);
        } catch (Exception e) { /* view may already be gone */ }
    }

    @SuppressLint("ClickableViewAccessibility")
    private void addBubble() {
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);

        int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

        bubbleParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        bubbleParams.gravity = Gravity.TOP | Gravity.START;
        bubbleParams.x = 0;
        bubbleParams.y = 300;

        bubbleView = new ImageView(this);
        bubbleView.setImageResource(R.mipmap.ic_launcher_round);
        // Smaller and semi-transparent by design — it's a quick shortcut back into the
        // app, not something that should compete for attention while it floats over
        // whatever else the user is doing.
        int sizePx = (int) (40 * getResources().getDisplayMetrics().density);
        bubbleView.setLayoutParams(new WindowManager.LayoutParams(sizePx, sizePx));
        bubbleView.setAlpha(0.55f);

        windowManager.addView(bubbleView, bubbleParams);

        bubbleView.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;
            private boolean dragged = false;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = bubbleParams.x;
                        initialY = bubbleParams.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        dragged = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (event.getRawX() - initialTouchX);
                        int dy = (int) (event.getRawY() - initialTouchY);
                        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) dragged = true;
                        bubbleParams.x = initialX + dx;
                        bubbleParams.y = initialY + dy;
                        windowManager.updateViewLayout(bubbleView, bubbleParams);
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!dragged) openApp();
                        return true;
                }
                return false;
            }
        });
    }

    private void openApp() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(launch);
    }

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Floating icon", NotificationManager.IMPORTANCE_MIN);
            channel.setDescription("Keeps the Bejirond floating icon visible over other apps");
            nm.createNotificationChannel(channel);
        }

        Intent stopIntent = new Intent(this, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, stopIntent, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Bejirond floating icon is on")
                .setContentText("Turn it off from Settings > Quick Access")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(contentIntent)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setOngoing(true)
                .build();
    }
}
