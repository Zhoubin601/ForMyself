package com.yubin.formyself;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.Assume;
import androidx.test.platform.app.InstrumentationRegistry;

/** Explicit opt-in fixture driver, present only in the instrumentation APK. */
public class TodoWidgetHarness {
    @Test public void launcherFixture() throws Exception {
        String action=InstrumentationRegistry.getArguments().getString("todoQaAction");
        Assume.assumeTrue(action!=null);
        Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
        SharedPreferences storage=c.getSharedPreferences("CapacitorStorage",0);
        SharedPreferences saved=c.getSharedPreferences("TodoWidgetQaFixture",0);
        if("restore".equals(action)) {
            String original=saved.getString("todo",null);
            if(original==null)storage.edit().remove(TodoRepository.KEY).commit();
            else storage.edit().putString(TodoRepository.KEY,original).commit();
            saved.edit().clear().commit();
        } else if("fixture".equals(action)) {
            if(!saved.getBoolean("saved",false))saved.edit().putBoolean("saved",true).putString("todo",storage.getString(TodoRepository.KEY,null)).commit();
            int count=Integer.parseInt(InstrumentationRegistry.getArguments().getString("todoQaCount","30"));
            JSONArray tasks=new JSONArray();
            for(int i=1;i<=count;i++) {
                JSONObject task=new JSONObject().put("id",String.format(java.util.Locale.US,"qa-widget-%02d",i)).put("title",i==1?"QA 桌面长标题：阅读并整理今天的学习内容，再核对明天的安排":String.format(java.util.Locale.US,"QA 桌面任务 %02d",i)).put("startDate",TodoRepository.today()).put("recurrenceAnchorDate",TodoRepository.today()).put("createdAt",i).put("note",i==1?"QA 合成备注":"").put("recurrence",new JSONObject().put("type","daily"));
                tasks.put(task);
            }
            JSONObject snapshot=new JSONObject().put("version",1).put("revision",TodoRepository.read(c).optLong("revision")+1).put("tasks",tasks).put("overrides",new JSONArray()).put("completions",new JSONArray());
            if("reference".equals(InstrumentationRegistry.getArguments().getString("todoQaStyle"))) {
                String[] titles={"QA 今天阅读","QA 完成学习","QA 整理收获","QA 明日计划"};
                for(int i=0;i<Math.min(count,titles.length);i++)tasks.getJSONObject(i).put("title",titles[i]);
                snapshot.getJSONArray("completions").put(new JSONObject().put("taskId","qa-widget-02").put("key","qa-widget-02@"+TodoRepository.today()).put("date",TodoRepository.today()).put("completedAt",System.currentTimeMillis()));
            }
            storage.edit().putString(TodoRepository.KEY,snapshot.toString()).commit();
        } else if("pin".equals(action)) {
            c.startActivity(new android.content.Intent(c,MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            Thread.sleep(500);
            AppWidgetManager m=AppWidgetManager.getInstance(c);
            org.junit.Assert.assertTrue(m.isRequestPinAppWidgetSupported());
            org.junit.Assert.assertTrue(m.requestPinAppWidget(new ComponentName(c,TodoWidgetProvider.class),null,null));
        } else throw new IllegalArgumentException("Unknown QA action");
        if(!"pin".equals(action)) {
            TodoWidgetProvider.updateAll(c,false);
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            Thread.sleep(500);
        }
    }
}
