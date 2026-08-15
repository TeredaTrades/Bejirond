package com.teredatrades.bejirond;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.widget.RemoteViews;

/**
 * Small Home screen widget: shows the last balance pushed from the app (see
 * TallyWidgetPlugin#updateBalance) and opens TallyBook when tapped anywhere on it.
 * Purely a shortcut + glanceable summary — it does not read app storage directly,
 * since that would require duplicating the entries/business data model natively.
 */
public class ExpensesWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(
                TallyWidgetPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String balanceText = prefs.getString(TallyWidgetPlugin.KEY_BALANCE_TEXT, "Open TallyBook");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_expenses);
        views.setTextViewText(R.id.widget_balance, balanceText);

        Intent launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, appWidgetId, launch, flags);
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
