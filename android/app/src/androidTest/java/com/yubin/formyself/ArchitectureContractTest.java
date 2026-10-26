package com.yubin.formyself;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ArchitectureContractTest {
    @Test public void sharedTodoRulesMatchIndependentFixtures() throws Exception {
        Context instrumentation = InstrumentationRegistry.getInstrumentation().getContext();
        String text;
        try (InputStream stream = instrumentation.getAssets().open("todo-contract.json")) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
            text = bytes.toString("UTF-8");
        }
        JSONArray cases = new JSONObject(text).getJSONArray("cases");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject fixture = cases.getJSONObject(i);
            JSONArray queries = fixture.getJSONArray("queries");
            for (int j = 0; j < queries.length(); j++) {
                JSONObject query = queries.getJSONObject(j);
                List<JSONObject> actual = TodoRepository.day(fixture.getJSONObject("data"), query.getString("date"));
                JSONArray expected = query.getJSONArray("expected");
                String label = fixture.getString("name") + ": " + query.getString("date");
                assertEquals(label, expected.length(), actual.size());
                for (int k = 0; k < expected.length(); k++) {
                    JSONObject e = expected.getJSONObject(k), a = actual.get(k);
                    for (String field : new String[]{"id", "key", "title"}) assertEquals(label + ": " + field, e.getString(field), a.getString(field));
                    assertEquals(label, e.getBoolean("completed"), a.getBoolean("completed"));
                }
            }
        }
    }
    @Test public void nativeWidgetCannotModifyDataDuringPendingRestore() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File marker = new File(context.getFilesDir(), "formyself/restore-v1.enc");
        assertFalse("Run only in a clean isolated test app, never overwrite a real recovery record", marker.exists());
        String before = context.getSharedPreferences("CapacitorStorage", 0).getString(TodoRepository.KEY, null);
        marker.getParentFile().mkdirs();
        try {
            try (FileOutputStream stream = new FileOutputStream(marker)) { stream.write("synthetic test marker".getBytes(StandardCharsets.UTF_8)); stream.getFD().sync(); }
            try {
                TodoRepository.setCompleted(context, "synthetic", TodoRepository.today(), true);
                fail("A widget must not write while recovery is pending");
            } catch (Exception error) { assertEquals("RESTORE_RECOVERY_REQUIRED", error.getMessage()); }
            assertEquals(before, context.getSharedPreferences("CapacitorStorage", 0).getString(TodoRepository.KEY, null));
        } finally { assertTrue(marker.delete()); }
    }
    @Test public void actualWidgetReceiverPersistsAndReversesCompletion() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        android.content.SharedPreferences preferences = context.getSharedPreferences("CapacitorStorage", 0);
        String previous = preferences.getString(TodoRepository.KEY, null), date = TodoRepository.today();
        JSONObject task = new JSONObject().put("id", "synthetic-widget-action").put("title", "Synthetic widget action")
            .put("startDate", date).put("recurrence", new JSONObject().put("type", "none"));
        JSONObject fixture = new JSONObject().put("version", 1).put("revision", 0)
            .put("tasks", new JSONArray().put(task)).put("overrides", new JSONArray()).put("completions", new JSONArray());
        try {
            assertTrue(preferences.edit().putString(TodoRepository.KEY, fixture.toString()).commit());
            for (boolean expected : new boolean[]{true, false}) {
                java.util.concurrent.CountDownLatch finished = new java.util.concurrent.CountDownLatch(1);
                android.content.Intent intent = new android.content.Intent(context, TodoWidgetProvider.class)
                    .setAction(TodoWidgetProvider.ACTION).putExtra("action", "complete")
                    .putExtra("taskId", "synthetic-widget-action").putExtra("date", date)
                    .addFlags(android.content.Intent.FLAG_RECEIVER_FOREGROUND | android.content.Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
                context.sendOrderedBroadcast(intent, null, new android.content.BroadcastReceiver() {
                    @Override public void onReceive(Context c, android.content.Intent i) { finished.countDown(); }
                }, new android.os.Handler(android.os.Looper.getMainLooper()), 0, null, null);
                assertTrue("actual widget receiver must finish", finished.await(30, java.util.concurrent.TimeUnit.SECONDS));
                assertEquals("completion is read back from canonical native storage", expected,
                    TodoRepository.day(TodoRepository.read(context), date).get(0).getBoolean("completed"));
            }
        } finally {
            if (previous == null) assertTrue(preferences.edit().remove(TodoRepository.KEY).commit());
            else assertTrue(preferences.edit().putString(TodoRepository.KEY, previous).commit());
            TodoReminderReceiver.reschedule(context);
            TodoWidgetProvider.updateAll(context, false);
        }
    }
}
