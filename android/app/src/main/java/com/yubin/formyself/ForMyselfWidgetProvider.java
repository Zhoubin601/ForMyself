package com.yubin.formyself;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class ForMyselfWidgetProvider extends AppWidgetProvider {
    private static final String PREFERENCES_FILE = "CapacitorStorage";
    private static final String MOOD_KEY = "my_mood_records_data";
    private static final String WEIGHT_KEY = "my_weight_records_data";
    private static final String SAVINGS_KEY = "my_debt_manager_data";

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
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());

        MoodSnapshot mood = readMood(preferences.getString(MOOD_KEY, null), today);
        WeightSnapshot weight = readWeight(preferences.getString(WEIGHT_KEY, null), today);
        SavingsSnapshot savings = readSavings(preferences.getString(SAVINGS_KEY, null), today);

        int todayCount = 0;
        if (mood.loggedToday) todayCount++;
        if (weight.loggedToday) todayCount++;
        if (savings.loggedToday) todayCount++;

        return new WidgetSnapshot(
            mood.text,
            weight.text,
            savings.text,
            todayCount
        );
    }

    private static MoodSnapshot readMood(String rawValue, String today) {
        String latestMood = null;
        long latestCreatedAt = Long.MIN_VALUE;

        try {
            JSONArray records = new JSONArray(rawValue == null ? "[]" : rawValue);
            for (int index = 0; index < records.length(); index++) {
                JSONObject record = records.optJSONObject(index);
                if (record == null || !today.equals(record.optString("date"))) continue;
                if (record.optBoolean("autoFilled", false)) continue;

                long createdAt = record.optLong("createdAt", 0);
                if (latestMood == null || createdAt >= latestCreatedAt) {
                    latestMood = record.optString("mood", "normal");
                    latestCreatedAt = createdAt;
                }
            }
        } catch (Exception ignored) {
            latestMood = null;
        }

        if (latestMood == null) return new MoodSnapshot("未记录", false);
        return new MoodSnapshot(moodLabel(latestMood), true);
    }

    private static String moodLabel(String mood) {
        switch (mood) {
            case "great": return "超赞";
            case "good": return "开心";
            case "bad": return "低落";
            case "terrible": return "很糟";
            default: return "一般";
        }
    }

    private static WeightSnapshot readWeight(String rawValue, String today) {
        String latestDate = "";
        long latestCreatedAt = Long.MIN_VALUE;
        double latestWeight = Double.NaN;

        try {
            JSONArray records = new JSONArray(rawValue == null ? "[]" : rawValue);
            for (int index = 0; index < records.length(); index++) {
                JSONObject record = records.optJSONObject(index);
                if (record == null) continue;

                String date = record.optString("date", "");
                double value = record.optDouble("weight", Double.NaN);
                long createdAt = record.optLong("createdAt", record.optLong("id", 0));
                if (date.isEmpty() || Double.isNaN(value)) continue;

                if (date.compareTo(latestDate) > 0
                    || (date.equals(latestDate) && createdAt >= latestCreatedAt)) {
                    latestDate = date;
                    latestCreatedAt = createdAt;
                    latestWeight = value;
                }
            }
        } catch (Exception ignored) {
            latestWeight = Double.NaN;
        }

        if (Double.isNaN(latestWeight)) return new WeightSnapshot("暂无", false);
        DecimalFormat formatter = new DecimalFormat("0.#");
        return new WeightSnapshot(
            formatter.format(latestWeight) + " kg",
            today.equals(latestDate)
        );
    }

    private static SavingsSnapshot readSavings(String rawValue, String today) {
        int bestProgress = -1;
        boolean loggedToday = false;

        try {
            JSONArray debts = new JSONArray(rawValue == null ? "[]" : rawValue);
            for (int index = 0; index < debts.length(); index++) {
                JSONObject debt = debts.optJSONObject(index);
                if (debt == null) continue;

                JSONArray records = debt.optJSONArray("records");
                double saved = 0;
                if (records != null) {
                    for (int recordIndex = 0; recordIndex < records.length(); recordIndex++) {
                        JSONObject record = records.optJSONObject(recordIndex);
                        if (record == null) continue;
                        saved += record.optDouble("amount", 0);
                        if (today.equals(record.optString("date"))) loggedToday = true;
                    }
                }

                if (debt.optBoolean("isCleared", false)) continue;
                double total = debt.optDouble("totalAmount", 0);
                int progress = total > 0
                    ? (int) Math.round(Math.min(100, (saved / total) * 100))
                    : 0;
                if (progress > bestProgress) bestProgress = progress;
            }
        } catch (Exception ignored) {
            bestProgress = -1;
            loggedToday = false;
        }

        String text = bestProgress < 0 ? "暂无" : bestProgress + "%";
        return new SavingsSnapshot(text, loggedToday);
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

    private static final class MoodSnapshot {
        final String text;
        final boolean loggedToday;

        MoodSnapshot(String text, boolean loggedToday) {
            this.text = text;
            this.loggedToday = loggedToday;
        }
    }

    private static final class WeightSnapshot {
        final String text;
        final boolean loggedToday;

        WeightSnapshot(String text, boolean loggedToday) {
            this.text = text;
            this.loggedToday = loggedToday;
        }
    }

    private static final class SavingsSnapshot {
        final String text;
        final boolean loggedToday;

        SavingsSnapshot(String text, boolean loggedToday) {
            this.text = text;
            this.loggedToday = loggedToday;
        }
    }
}
