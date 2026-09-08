package com.yubin.formyself;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

public class ForMyselfWidgetProvider extends AppWidgetProvider {
    private static final String PREFERENCES_FILE = "CapacitorStorage";
    private static final String SNAPSHOT_KEY = "my_home_widget_snapshot_v1";
    private static final int SNAPSHOT_VERSION = 1;

    private static final int REQUEST_MOOD = 101;
    private static final int REQUEST_WEIGHT = 102;
    private static final int REQUEST_SAVINGS = 103;
    private static final int REQUEST_SUMMARY = 104;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        android.content.ComponentName provider =
            new android.content.ComponentName(context, ForMyselfWidgetProvider.class);
        int[] appWidgetIds = manager.getAppWidgetIds(provider);
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, manager, appWidgetId);
        }
    }

    private static void updateWidget(Context context, AppWidgetManager manager, int appWidgetId) {
        WidgetSnapshot snapshot = readSnapshot(context);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_formyself);

        views.setTextViewText(R.id.widget_mood_value, snapshot.moodText);
        views.setTextViewText(R.id.widget_weight_value, snapshot.weightText);
        views.setTextViewText(R.id.widget_savings_value, snapshot.savingsText);
        views.setTextViewText(R.id.widget_summary_value, snapshot.todayCount + "/3");

        bindShortcut(context, views, R.id.widget_mood, "mood", REQUEST_MOOD);
        bindShortcut(context, views, R.id.widget_weight, "weight", REQUEST_WEIGHT);
        bindShortcut(context, views, R.id.widget_savings, "savings", REQUEST_SAVINGS);
        bindShortcut(context, views, R.id.widget_summary, "home", REQUEST_SUMMARY);

        manager.updateAppWidget(appWidgetId, views);
    }

    private static void bindShortcut(
        Context context,
        RemoteViews views,
        int viewId,
        String target,
        int requestCode
    ) {
        Intent intent = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("formyself://open/" + target),
            context,
            MainActivity.class
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(viewId, pendingIntent);
    }

    private static WidgetSnapshot readSnapshot(Context context) {
        SharedPreferences preferences =
            context.getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE);
        try {
            JSONObject snapshot = new JSONObject(preferences.getString(SNAPSHOT_KEY, "{}"));
            if (snapshot.optInt("version", 0) != SNAPSHOT_VERSION) {
                return new WidgetSnapshot("未记录", "暂无", "暂无", 0);
            }
            return new WidgetSnapshot(
                snapshot.optString("moodText", "未记录"),
                snapshot.optString("weightText", "暂无"),
                snapshot.optString("savingsText", "暂无"),
                Math.max(0, Math.min(3, snapshot.optInt("todayCount", 0)))
            );
        } catch (Exception ignored) {
            return new WidgetSnapshot("未记录", "暂无", "暂无", 0);
        }
    }

    private static final class WidgetSnapshot {
        final String moodText;
        final String weightText;
        final String savingsText;
        final int todayCount;

        WidgetSnapshot(String moodText, String weightText, String savingsText, int todayCount) {
            this.moodText = moodText;
            this.weightText = weightText;
            this.savingsText = savingsText;
            this.todayCount = todayCount;
        }
    }

}
