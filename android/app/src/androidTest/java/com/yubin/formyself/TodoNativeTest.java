package com.yubin.formyself;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.content.Context;
import android.content.Intent;
import android.app.NotificationManager;
import android.service.notification.StatusBarNotification;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TodoNativeTest {
    @Test public void responsiveRowsKeepTouchAreaAndInstanceBaseline() throws Exception {
        Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
        int id=-98765;
        try {
            TodoWidgetSpacing.forget(c,id);
            android.os.Bundle options=new android.os.Bundle();
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,240);
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,300);
            TodoWidgetSpacing baseline=TodoWidgetSpacing.forWidget(c,id,options);
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,160);
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,200);
            TodoWidgetSpacing small=TodoWidgetSpacing.forWidget(c,id,options);
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,320);
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,400);
            TodoWidgetSpacing large=TodoWidgetSpacing.forWidget(c,id,options);
            assertEquals(36,baseline.rowHeightDp());
            assertEquals(32,small.rowHeightDp());assertEquals(40,large.rowHeightDp());
            assertTrue(small.iconDp<baseline.iconDp);assertTrue(large.iconDp>baseline.iconDp);
            assertEquals(large.rowHeightDp(),TodoWidgetSpacing.forWidget(c,id,options).rowHeightDp());
            JSONObject item=new JSONObject().put("id","qa-size").put("date",TodoRepository.today()).put("title","QA completed task").put("completed",true);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
                try {
                    float density=c.getResources().getDisplayMetrics().density;
                    for(TodoWidgetSpacing spacing:new TodoWidgetSpacing[]{small,baseline,large}) {
                        android.view.View row=TodoWidgetProvider.row(c,item,spacing).apply(c,null);
                        row.measure(android.view.View.MeasureSpec.makeMeasureSpec(Math.round(220*density),android.view.View.MeasureSpec.EXACTLY),android.view.View.MeasureSpec.makeMeasureSpec(0,android.view.View.MeasureSpec.UNSPECIFIED));
                        android.widget.ImageView check=row.findViewById(R.id.todo_row_check);
                        assertEquals(Math.round(40*density),check.getMeasuredWidth());
                        assertEquals(Math.round(32*density),check.getMeasuredHeight());
                        assertEquals(spacing.rowHeightDp()*density,row.getMeasuredHeight(),2);
                        assertNotNull(check.getDrawable());
                        assertTrue(check.getContentDescription().toString().startsWith("撤销完成"));
                    }
                } catch(Exception e) {throw new AssertionError(e);}
            });
            // Observed legacy pin dimensions: it starts at 2x2, not 3x3.
            TodoWidgetSpacing.forget(c,id);
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,137);
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,240);
            assertEquals(32,TodoWidgetSpacing.forWidget(c,id,options).rowHeightDp());
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,213);
            options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,368);
            assertEquals(36,TodoWidgetSpacing.forWidget(c,id,options).rowHeightDp());
        } finally { TodoWidgetSpacing.forget(c,id); }
    }
    @Test public void widgetSizeAndFillContract() throws Exception {
        Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
        android.os.Bundle options=new android.os.Bundle();
        options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,180);
        options.putInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,240);
        assertTrue(TodoWidgetProvider.compact(TodoWidgetProvider.availableSize(options,false)));
        assertFalse(TodoWidgetProvider.compact(new android.util.SizeF(220,220)));
        assertTrue(TodoWidgetProvider.compact(new android.util.SizeF(400,120)));
        if(android.os.Build.VERSION.SDK_INT>=31) {
            java.util.ArrayList<android.util.SizeF> sizes=new java.util.ArrayList<>();
            sizes.add(new android.util.SizeF(240,300));sizes.add(new android.util.SizeF(320,180));
            options.putParcelableArrayList(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_SIZES,sizes);
            assertEquals(240,TodoWidgetProvider.availableSize(options,false).getWidth(),.01);
            assertEquals(320,TodoWidgetProvider.availableSize(options,true).getWidth(),.01);
        }
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
            android.widget.RemoteViews views=new android.widget.RemoteViews(c.getPackageName(),R.layout.widget_todo);
            TodoWidgetAnimation.setFill(views,.4,null);
            android.os.Parcel parcel=android.os.Parcel.obtain();
            try {
                views.writeToParcel(parcel,0);
                assertTrue("ring frame IPC stays small",parcel.dataSize()<(android.os.Build.VERSION.SDK_INT>=31?8192:20480));
            } finally {parcel.recycle();}
            android.view.View rendered=views.apply(c,null);
            android.widget.ImageView fill=rendered.findViewById(R.id.todo_widget_fill);
            assertTrue(fill.getDrawable() instanceof android.graphics.drawable.BitmapDrawable);
            assertEquals(1,fill.getScaleX(),.0001);
            android.graphics.Bitmap empty=TodoWidgetRing.render(0),quarter=TodoWidgetRing.render(.25),full=TodoWidgetRing.render(1);
            int size=android.os.Build.VERSION.SDK_INT>=31?96:64;
            assertEquals(size,full.getWidth());assertEquals(size,full.getHeight());
            assertFalse("animation parcels use immutable frames",full.isMutable());
            assertEquals(0,android.graphics.Color.alpha(full.getPixel(0,0)));
            int right=quarter.getPixel(Math.round(size*83/96f),size/2),left=quarter.getPixel(Math.round(size*13/96f),size/2);
            assertTrue("quarter ring reaches clockwise right edge",android.graphics.Color.green(right)>180);
            assertTrue("quarter ring leaves left track unfilled",android.graphics.Color.green(left)<130);
            assertTrue(android.graphics.Color.green(full.getPixel(Math.round(size*13/96f),size/2))>180);
            assertTrue(android.graphics.Color.green(empty.getPixel(Math.round(size*83/96f),size/2))<130);
        });
    }
    private static boolean notificationVisible(NotificationManager manager,String key) {
        for(StatusBarNotification n:manager.getActiveNotifications()) if(key.equals(n.getTag()))return true;
        return false;
    }
    @Test public void receiverRechecksCompletionAndCancelsVisibleReminder() throws Exception {
        Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
        String existing=c.getSharedPreferences("CapacitorStorage",0).getString(TodoRepository.KEY,null);
        String today=TodoRepository.today(),key="qa-reminder@"+today;
        NotificationManager manager=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        try {
            String time=new SimpleDateFormat("HH:mm",Locale.US).format(new Date(System.currentTimeMillis()-120000));
            JSONObject fixture=new JSONObject("{\"version\":1,\"revision\":0,\"tasks\":[{\"id\":\"qa-reminder\",\"title\":\"QA reminder\",\"startDate\":\""+today+"\",\"time\":\""+time+"\",\"reminder\":true,\"recurrence\":{\"type\":\"none\"}}],\"overrides\":[],\"completions\":[]}");
            c.getSharedPreferences("CapacitorStorage",0).edit().putString(TodoRepository.KEY,fixture.toString()).commit();
            TodoReminderReceiver.reschedule(c);
            Intent reminder=new Intent(c,TodoReminderReceiver.class).setAction("com.yubin.formyself.TODO_REMINDER").putExtra("taskId","qa-reminder").putExtra("date",today);
            c.sendBroadcast(reminder);
            for(int n=0;n<40 && !notificationVisible(manager,key);n++)Thread.sleep(100);
            assertTrue("actual Android notification must appear",notificationVisible(manager,key));
            TodoRepository.setCompleted(c,"qa-reminder",today,true);
            TodoReminderReceiver.reschedule(c);
            for(int n=0;n<40 && notificationVisible(manager,key);n++)Thread.sleep(50);
            assertFalse("completion cancels visible reminder",notificationVisible(manager,key));
            c.sendBroadcast(reminder);
            Thread.sleep(400);
            assertFalse("stale alarm may not notify a completed task",notificationVisible(manager,key));
        } finally {
            manager.cancel(key,0);
            if(existing==null)c.getSharedPreferences("CapacitorStorage",0).edit().remove(TodoRepository.KEY).commit();
            else c.getSharedPreferences("CapacitorStorage",0).edit().putString(TodoRepository.KEY,existing).commit();
            TodoReminderReceiver.reschedule(c);
            TodoWidgetProvider.updateAll(c);
            Thread.sleep(500);
        }
    }
    @Test public void nativeAndJsContractAndCompareAndSet() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        String existing=context.getSharedPreferences("CapacitorStorage",Context.MODE_PRIVATE).getString(TodoRepository.KEY,null);
        try {
            String today=TodoRepository.today();
            JSONObject fixture=new JSONObject("{\"version\":1,\"revision\":0,\"tasks\":[{\"id\":\"qa\",\"title\":\"QA\",\"startDate\":\""+today+"\",\"recurrenceAnchorDate\":\""+today+"\",\"recurrence\":{\"type\":\"custom\",\"intervalDays\":3},\"createdAt\":1}],\"overrides\":[],\"completions\":[]}");
            context.getSharedPreferences("CapacitorStorage",Context.MODE_PRIVATE).edit().putString(TodoRepository.KEY,fixture.toString()).commit();
            assertEquals(1,TodoRepository.day(fixture,today).size());
            assertEquals(0,TodoRepository.day(fixture,TodoRepository.addDays(today,1)).size());
            assertEquals(1,TodoRepository.day(fixture,TodoRepository.addDays(today,3)).size());
            JSONObject done=TodoRepository.setCompleted(context,"qa",today,true);
            assertEquals(1,done.getJSONArray("completions").length());
            assertEquals(1,TodoRepository.setCompleted(context,"qa",today,true).optLong("revision"));
            assertTrue(TodoRepository.day(done,today).get(0).getBoolean("completed"));
            try { TodoRepository.compareAndSet(context,0,fixture); fail("stale JS write must be rejected"); } catch(Exception e) { assertEquals("TODO_CONFLICT",e.getMessage()); }
            try { TodoRepository.setCompleted(context,"qa",TodoRepository.addDays(today,-1),true); fail("stale widget date"); } catch(Exception e) { assertEquals("TODO_STALE_WIDGET",e.getMessage()); }
            assertEquals(0,TodoRepository.setCompleted(context,"qa",today,false).getJSONArray("completions").length());
            assertEquals(1,TodoRepository.toggleCompleted(context,"qa",today).getJSONArray("completions").length());
            assertEquals(0,TodoRepository.toggleCompleted(context,"qa",today).getJSONArray("completions").length());
            assertNotEquals(TodoWidgetProvider.stableId("qa@"+today),TodoWidgetProvider.stableId("qa@"+TodoRepository.addDays(today,1)));
        } finally {
            if(existing==null)context.getSharedPreferences("CapacitorStorage",Context.MODE_PRIVATE).edit().remove(TodoRepository.KEY).commit();
            else context.getSharedPreferences("CapacitorStorage",Context.MODE_PRIVATE).edit().putString(TodoRepository.KEY,existing).commit();
        }
    }
}
