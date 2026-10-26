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
}
