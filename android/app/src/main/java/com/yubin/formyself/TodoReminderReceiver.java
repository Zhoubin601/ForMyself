package com.yubin.formyself;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Schedule one next reminder per task; receivers recheck canonical completion state. */
public class TodoReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL = "formyself-todo-v1";
    private static final Object LOCK = new Object();
    private static PendingIntent alarmIntent(Context c, String id, String date, String title) {
        Intent intent = new Intent(c, TodoReminderReceiver.class).setAction("com.yubin.formyself.TODO_REMINDER").setData(Uri.parse("formyself://todo-reminder/" + Uri.encode(id)));
        intent.putExtra("taskId", id); intent.putExtra("date", date); intent.putExtra("title", title);
        return PendingIntent.getBroadcast(c, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    public static void reschedule(Context c) throws Exception {
        synchronized (LOCK) {
            AlarmManager alarms = (AlarmManager)c.getSystemService(Context.ALARM_SERVICE);
            NotificationManager notifications = (NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "每日待办", NotificationManager.IMPORTANCE_DEFAULT));
            JSONObject data = TodoRepository.read(c);
            Set<String> old = c.getSharedPreferences("TodoReminders", Context.MODE_PRIVATE).getStringSet("ids", new HashSet<>());
            for (String id : old) alarms.cancel(alarmIntent(c, id, "", ""));
            Set<String> ids = new HashSet<>();
            Set<String> scheduled = new HashSet<>();
            long now = System.currentTimeMillis();
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US);
            // Tasks with a future start may be years away; begin from their own start date.
            JSONArray tasks = data.getJSONArray("tasks");
            for (int i=0; i<tasks.length(); i++) {
                JSONObject task = tasks.getJSONObject(i);
                String id=task.getString("id");
                if (task.optBoolean("archived")) continue;
                boolean canRemind=task.optBoolean("reminder");
                JSONArray overrides=data.getJSONArray("overrides");
                for(int o=0;o<overrides.length();o++){JSONObject state=overrides.getJSONObject(o);if(id.equals(state.optString("taskId")) && !state.optBoolean("cancelled") && state.optJSONObject("changes")!=null && state.getJSONObject("changes").optBoolean("reminder"))canRemind=true;}
                if(!canRemind)continue;
                ids.add(id);
                String first=task.getString("startDate").compareTo(TodoRepository.today())>0 ? task.getString("startDate") : TodoRepository.today();
                boolean relevant = false;
                for (int d=0; d<=365; d++) {
                    if (d>0 && "none".equals(task.getJSONObject("recurrence").optString("type"))) break;
                    String date = TodoRepository.addDays(first,d);
                    if (!task.optString("endsOn").isEmpty() && date.compareTo(task.getString("endsOn"))>0) break;
                    for (JSONObject item : TodoRepository.day(data,date)) {
                        if (!id.equals(item.getString("id"))) continue;
                        if (item.optBoolean("completed")) { notifications.cancel(item.getString("key"),0); continue; }
                        if (!item.optBoolean("reminder") || item.optString("time").isEmpty()) continue;
                        long at = format.parse(date + " " + item.getString("time")).getTime();
                        if (at<=now) continue;
                        if (Build.VERSION.SDK_INT>=33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) continue;
                        PendingIntent intent=alarmIntent(c,id,date,item.getString("title"));
                        if (Build.VERSION.SDK_INT<31 || alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
                        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
                        scheduled.add(id); relevant=true; break;
                    }
                    if (relevant) break;
                    if (!task.optBoolean("reminder") && data.getJSONArray("overrides").length()==0) break;
                }
            }
            // Cancel already visible notifications for every completed occurrence, including yesterday.
            JSONArray completions=data.getJSONArray("completions");
            for(int i=0;i<completions.length();i++) notifications.cancel(completions.getJSONObject(i).getString("key"),0);
            c.getSharedPreferences("TodoReminders",Context.MODE_PRIVATE).edit().putStringSet("ids",ids).apply();
            Intent rollover=new Intent(c,TodoReminderReceiver.class).setAction("com.yubin.formyself.TODO_DAY_CHANGED").setData(Uri.parse("formyself://todo-day-change"));
            PendingIntent dayIntent=PendingIntent.getBroadcast(c,1,rollover,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            long midnight=format.parse(TodoRepository.addDays(TodoRepository.today(),1)+" 00:00").getTime();
            if(Build.VERSION.SDK_INT<31 || alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,midnight,dayIntent);
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,midnight,dayIntent);
        }
    }
    @Override public void onReceive(Context c, Intent intent) {
        PendingResult result = goAsync();
        new Thread(() -> {
            try {
                String id=intent.getStringExtra("taskId"),date=intent.getStringExtra("date");
                if(id!=null && date!=null) {
                    for(JSONObject item:TodoRepository.day(TodoRepository.read(c),date)) {
                        if(!date.equals(TodoRepository.today()) || !id.equals(item.getString("id")) || item.optBoolean("completed") || !item.optBoolean("reminder") || item.optString("time").isEmpty()) continue;
                        if(new SimpleDateFormat("yyyy-MM-dd HH:mm",Locale.US).parse(date+" "+item.getString("time")).getTime()>System.currentTimeMillis()) continue;
                        Intent open=new Intent(c,MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("formyself://open/todo?item="+Uri.encode(id)+"&date="+date)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
                        PendingIntent click=PendingIntent.getActivity(c,item.getString("key").hashCode(),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                        NotificationManager manager=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
                        if(Build.VERSION.SDK_INT<33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED) manager.notify(item.getString("key"),0,new NotificationCompat.Builder(c,CHANNEL).setSmallIcon(R.drawable.ic_todo_notification).setContentTitle("待办 · "+item.getString("title")).setContentText(item.optString("note","今天的小计划，到时间了")).setAutoCancel(true).setContentIntent(click).build());
                    }
                }
                reschedule(c);
                TodoWidgetProvider.updateAll(c,false);
            } catch(Exception ignored) { /* Keep data intact if the system denies scheduling. */ }
            finally { new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(result::finish,TodoWidgetAnimation.allowed(c)?450:0); }
        },"todo-reminders").start();
    }
}
