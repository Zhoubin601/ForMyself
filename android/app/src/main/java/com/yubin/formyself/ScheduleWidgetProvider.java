package com.yubin.formyself;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class ScheduleWidgetProvider extends AppWidgetProvider {
    private static final String PREFERENCES_FILE = "CapacitorStorage";
    private static final String SNAPSHOT_KEY = "my_schedule_widget_snapshot";
    private static final long SEVEN_DAYS_MS = 7L * 24L * 60L * 60L * 1000L;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) updateWidget(context, manager, appWidgetId);
    }

    public static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        android.content.ComponentName provider =
            new android.content.ComponentName(context, ScheduleWidgetProvider.class);
        int[] appWidgetIds = manager.getAppWidgetIds(provider);
        for (int appWidgetId : appWidgetIds) updateWidget(context, manager, appWidgetId);
    }

    private static void updateWidget(Context context, AppWidgetManager manager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_schedule);
        List<AgendaItem> items = readUpcoming(context);
        int todayCount = 0;
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        for (AgendaItem item : items) if (today.equals(item.date)) todayCount++;
        views.setTextViewText(R.id.schedule_widget_count, todayCount + " 今日");

        int[] rows = { R.id.schedule_row_1, R.id.schedule_row_2, R.id.schedule_row_3 };
        int[] icons = { R.id.schedule_icon_1, R.id.schedule_icon_2, R.id.schedule_icon_3 };
        int[] times = { R.id.schedule_time_1, R.id.schedule_time_2, R.id.schedule_time_3 };
        int[] titles = { R.id.schedule_title_1, R.id.schedule_title_2, R.id.schedule_title_3 };

        if (items.isEmpty()) {
            views.setViewVisibility(rows[0], View.VISIBLE);
            views.setViewVisibility(icons[0], View.VISIBLE);
            views.setTextViewText(icons[0], "○");
            views.setTextViewText(times[0], "7天");
            views.setTextViewText(titles[0], context.getString(R.string.schedule_widget_empty));
            bindOpenSchedule(context, views, rows[0], 520);
            views.setViewVisibility(rows[1], View.GONE);
            views.setViewVisibility(rows[2], View.GONE);
        } else {
            for (int index = 0; index < rows.length; index++) {
                if (index >= items.size()) {
                    views.setViewVisibility(rows[index], View.GONE);
                    continue;
                }
                AgendaItem item = items.get(index);
                views.setViewVisibility(rows[index], View.VISIBLE);
                views.setViewVisibility(icons[index], View.VISIBLE);
                views.setTextViewText(icons[index], "●");
                try {
                    views.setTextColor(icons[index], Color.parseColor(item.color));
                } catch (Exception ignored) {
                    views.setTextColor(icons[index], Color.parseColor("#ff4d55"));
                }
                views.setTextViewText(times[index], formatTimeLabel(item, today));
                views.setTextViewText(titles[index], item.title);
                bindItem(context, views, rows[index], item, 521 + index);
            }
        }

        bindOpenSchedule(context, views, R.id.schedule_widget_header, 519);
        manager.updateAppWidget(appWidgetId, views);
    }

    private static String formatTimeLabel(AgendaItem item, String today) {
        if (today.equals(item.date)) return item.time;
        try {
            Date date = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(item.date);
            return new SimpleDateFormat("M/d", Locale.CHINA).format(date);
        } catch (Exception ignored) {
            return item.date;
        }
    }

    private static List<AgendaItem> readUpcoming(Context context) {
        SharedPreferences preferences =
            context.getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE);
        String raw = preferences.getString(SNAPSHOT_KEY, null);
        List<AgendaItem> result = new ArrayList<>();
        long now = System.currentTimeMillis();
        long limit = now + SEVEN_DAYS_MS;
        try {
            JSONObject snapshot = new JSONObject(raw == null ? "{}" : raw);
            JSONArray occurrences = snapshot.optJSONArray("occurrences");
            if (occurrences == null) return result;
            for (int index = 0; index < occurrences.length() && result.size() < 3; index++) {
                JSONObject item = occurrences.optJSONObject(index);
                if (item == null) continue;
                long startAt = item.optLong("startAt", 0L);
                long endAt = item.optLong("endAt", startAt);
                if (endAt < now || startAt > limit) continue;
                result.add(new AgendaItem(
                    item.optString("seriesId", ""),
                    item.optString("key", ""),
                    item.optString("title", context.getString(R.string.schedule_widget_untitled)),
                    item.optString("date", ""),
                    item.optString("time", ""),
                    item.optString("color", "#ff4d55")
                ));
            }
        } catch (Exception ignored) {
            result.clear();
        }
        return result;
    }

    private static void bindOpenSchedule(Context context, RemoteViews views, int viewId, int requestCode) {
        Intent intent = new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("formyself://open/schedule"),
            context,
            MainActivity.class
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(viewId, PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        ));
    }

    private static void bindItem(
        Context context,
        RemoteViews views,
        int viewId,
        AgendaItem item,
        int requestCode
    ) {
        Uri uri = new Uri.Builder()
            .scheme("formyself")
            .authority("open")
            .appendPath("schedule")
            .appendQueryParameter("item", item.seriesId)
            .appendQueryParameter("occurrence", item.key)
            .build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(viewId, PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        ));
    }

    private static final class AgendaItem {
        final String seriesId;
        final String key;
        final String title;
        final String date;
        final String time;
        final String color;

        AgendaItem(String seriesId, String key, String title, String date, String time, String color) {
            this.seriesId = seriesId;
            this.key = key;
            this.title = title;
            this.date = date;
            this.time = time;
            this.color = color;
        }
    }
}
