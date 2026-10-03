package com.yubin.formyself;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/** One process-local lock protects plugin and widget read/modify/commit operations. */
public final class TodoRepository {
    public static final String KEY = "my_todo_data_v1";
    private static final Object LOCK = new Object();
    private TodoRepository() {}

    public static String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()); }
    public static String addDays(String date, int amount) throws Exception {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        format.setLenient(false);
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(format.parse(date)); calendar.add(Calendar.DATE, amount);
        return format.format(calendar.getTime());
    }
    private static JSONObject readUnlocked(Context context) throws Exception {
        String value = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString(KEY, null);
        JSONObject data = value == null ? new JSONObject("{\"version\":1,\"revision\":0,\"tasks\":[],\"overrides\":[],\"completions\":[]}") : new JSONObject(value);
        if (data.optInt("version") != 1 || !(data.opt("tasks") instanceof JSONArray) || !(data.opt("completions") instanceof JSONArray) || !(data.opt("overrides") instanceof JSONArray)) throw new Exception("INVALID_TODO_DATA");
        return data;
    }
    public static JSONObject read(Context context) throws Exception { synchronized (LOCK) { return readUnlocked(context); } }
    private static void commit(Context context, JSONObject data) throws Exception {
        if (!context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().putString(KEY, data.toString()).commit()) throw new Exception("TODO_WRITE_FAILED");
    }
    public static JSONObject compareAndSet(Context context, long expected, JSONObject data) throws Exception {
        synchronized (LOCK) {
            JSONObject current = readUnlocked(context);
            if (current.optLong("revision") != expected) throw new Exception("TODO_CONFLICT");
            if (data.optInt("version") != 1 || data.optLong("revision") != expected + 1) throw new Exception("INVALID_TODO_DATA");
            commit(context, data);
            return data;
        }
    }
    public static boolean matches(JSONObject task, String date) throws Exception {
        if (task.optBoolean("archived") || date.compareTo(task.getString("startDate")) < 0 || (!task.optString("endsOn").isEmpty() && date.compareTo(task.getString("endsOn")) > 0)) return false;
        JSONObject rule = task.getJSONObject("recurrence");
        String type = rule.optString("type");
        if ("none".equals(type)) return date.equals(task.getString("startDate"));
        if ("daily".equals(type)) return true;
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US); format.setLenient(false);
        if ("weekly".equals(type)) {
            Calendar c = Calendar.getInstance(); c.setTime(format.parse(date));
            int day = c.get(Calendar.DAY_OF_WEEK) - 1;
            JSONArray weekdays = rule.getJSONArray("weekdays");
            for (int i=0; i<weekdays.length(); i++) if (weekdays.getInt(i) == day) return true;
            return false;
        }
        if ("custom".equals(type)) {
            format.setTimeZone(TimeZone.getTimeZone("UTC"));
            long days = (format.parse(date).getTime() - format.parse(task.optString("recurrenceAnchorDate", task.getString("startDate"))).getTime()) / 86400000L;
            int interval = rule.optInt("intervalDays", 2);
            return interval >= 1 && interval <= 365 && days % interval == 0;
        }
        return false;
    }
    public static List<JSONObject> day(JSONObject data, String date) throws Exception {
        List<JSONObject> result = new ArrayList<>();
        JSONArray tasks = data.getJSONArray("tasks"), overrides = data.getJSONArray("overrides"), completions = data.getJSONArray("completions");
        Set<String> done = new HashSet<>();
        for (int i=0; i<completions.length(); i++) done.add(completions.getJSONObject(i).getString("key"));
        for (int i=0; i<tasks.length(); i++) {
            JSONObject task = tasks.getJSONObject(i);
            if (!matches(task, date)) continue;
            JSONObject item = new JSONObject(task.toString());
            String key = item.getString("id") + "@" + date;
            boolean cancelled = false;
            for (int j=0; j<overrides.length(); j++) {
                JSONObject state = overrides.getJSONObject(j);
                if (!key.equals(state.optString("key"))) continue;
                cancelled = state.optBoolean("cancelled");
                JSONObject changes = state.optJSONObject("changes");
                if (changes != null) for (String field : new String[]{"title","note","time","reminder"}) if (changes.has(field)) item.put(field, changes.get(field));
            }
            if (!cancelled) { item.put("date", date); item.put("key", key); item.put("completed", done.contains(key)); result.add(item); }
        }
        result.sort(Comparator.comparing((JSONObject t) -> t.optString("time").isEmpty() ? "99:99" : t.optString("time")).thenComparingLong(t -> t.optLong("createdAt")).thenComparing(t -> t.optString("id")));
        return result;
    }
    public static JSONObject toggleCompleted(Context context,String taskId,String date) throws Exception {
        synchronized (LOCK) {
            if (!today().equals(date)) throw new Exception("TODO_STALE_WIDGET");
            for(JSONObject item:day(readUnlocked(context),date)) {
                if(item.getString("id").equals(taskId)) return setCompleted(context,taskId,date,!item.optBoolean("completed"));
            }
            throw new Exception("TODO_STALE_WIDGET");
        }
    }
    public static JSONObject setCompleted(Context context, String taskId, String date, boolean completed) throws Exception {
        synchronized (LOCK) {
            if (!today().equals(date)) throw new Exception("TODO_STALE_WIDGET");
            JSONObject data = readUnlocked(context);
            boolean valid = false;
            for (JSONObject item : day(data, date)) if (item.getString("id").equals(taskId)) valid = true;
            if (!valid) throw new Exception("TODO_STALE_WIDGET");
            String key = taskId + "@" + date;
            JSONArray old = data.getJSONArray("completions"), next = new JSONArray();
            boolean wasCompleted = false;
            for (int i=0; i<old.length(); i++) {
                JSONObject item = old.getJSONObject(i);
                if (key.equals(item.optString("key"))) { wasCompleted=true; if (completed) next.put(item); }
                else next.put(item);
            }
            if (wasCompleted == completed) return data;
            if (completed) next.put(new JSONObject().put("taskId", taskId).put("date", date).put("key", key).put("completedAt", System.currentTimeMillis()));
            data.put("completions", next); data.put("revision", data.optLong("revision") + 1);
            commit(context, data);
            return data;
        }
    }
}
