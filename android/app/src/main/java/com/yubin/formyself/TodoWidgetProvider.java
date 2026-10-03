package com.yubin.formyself;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;
import android.util.SizeF;
import android.content.res.Configuration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONObject;
import java.util.List;

public class TodoWidgetProvider extends AppWidgetProvider {
    public static final String ACTION="com.yubin.formyself.TODO_WIDGET_ACTION";
    public static final boolean ANIMATED=true;
    private static final int LAYOUT_VERSION=8;
    public static void updateAll(Context c) {
        updateAll(c,true);
    }
    public static void updateAll(Context c,boolean animate) {
        Context app=c.getApplicationContext();
        TodoWidgetAnimation.MAIN.post(()->refresh(app,AppWidgetManager.getInstance(app).getAppWidgetIds(new ComponentName(app,TodoWidgetProvider.class)),animate,false));
    }
    public static RemoteViews row(Context c, JSONObject item,TodoWidgetSpacing spacing) throws Exception {
        RemoteViews row=new RemoteViews(c.getPackageName(),R.layout.widget_todo_row);
        boolean done=item.optBoolean("completed");
        row.setTextViewText(R.id.todo_row_title,item.getString("title"));
        row.setTextViewText(R.id.todo_row_time,item.optString("time"));
        float density=c.getResources().getDisplayMetrics().density;
        int vertical=Math.round(spacing.rowPaddingDp*density);
        row.setViewPadding(R.id.todo_row_root,0,vertical,0,vertical);
        int iconPadding=Math.round((40-spacing.iconDp)*density/2);
        int iconVerticalPadding=Math.round((32-spacing.iconDp)*density/2);
        row.setViewPadding(R.id.todo_row_check,iconPadding,iconVerticalPadding,iconPadding,iconVerticalPadding);
        row.setImageViewResource(R.id.todo_row_check,done?R.drawable.todo_checked:R.drawable.todo_unchecked);
        row.setTextViewTextSize(R.id.todo_row_title,android.util.TypedValue.COMPLEX_UNIT_SP,spacing.titleSp);
        row.setTextViewTextSize(R.id.todo_row_time,android.util.TypedValue.COMPLEX_UNIT_SP,Math.max(10,10*spacing.scale));
        row.setContentDescription(R.id.todo_row_check,(done?"撤销完成 ":"完成 ")+item.getString("title"));
        row.setInt(R.id.todo_row_title,"setPaintFlags",1);
        row.setTextColor(R.id.todo_row_title,done?Color.rgb(174,191,192):Color.WHITE);
        Intent toggle=new Intent().putExtra("action","complete").putExtra("taskId",item.getString("id")).putExtra("date",item.getString("date")).putExtra("completed",!done);
        row.setOnClickFillInIntent(R.id.todo_row_check,toggle);
        Intent open=new Intent().putExtra("action","open").putExtra("taskId",item.getString("id")).putExtra("date",item.getString("date"));
        row.setOnClickFillInIntent(R.id.todo_row_title,open);
        return row;
    }
    public static void update(Context c,AppWidgetManager m,int id) {
        Context app=c.getApplicationContext();
        TodoWidgetAnimation.MAIN.post(()->refresh(app,new int[]{id},false,true));
    }
    public static SizeF availableSize(Bundle options,boolean landscape) {
        if(Build.VERSION.SDK_INT>=31) {
            ArrayList<SizeF> sizes=options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
            if(sizes!=null && !sizes.isEmpty()) {
                SizeF result=sizes.get(0);
                for(SizeF size:sizes) {
                    if(size.getWidth()<=0 || size.getHeight()<=0)continue;
                    if((landscape?size.getWidth():size.getHeight())>(landscape?result.getWidth():result.getHeight()))result=size;
                }
                if(result.getWidth()>0 && result.getHeight()>0)return result;
            }
        }
        int width=options.getInt(landscape?AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH:AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,180);
        int height=options.getInt(landscape?AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT:AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,180);
        return new SizeF(width>0?width:180,height>0?height:180);
    }
    public static boolean compact(SizeF size) { return size.getWidth()<220 || size.getHeight()<220; }
    private static void refresh(Context c,int[] ids,boolean animate,boolean initialize) {
        if(ids.length==0)return;
        AppWidgetManager m=AppWidgetManager.getInstance(c);
        try {
            List<JSONObject> items=TodoRepository.day(TodoRepository.read(c),TodoRepository.today());
            TodoWidgetService.publish(items);
            int done=0; for(JSONObject item:items) if(item.optBoolean("completed")) done++;
            double ratio=items.isEmpty()?0:(double)done/items.size();
            Map<Integer,Double> starts=new LinkedHashMap<>();
            for(int id:ids) {
            RemoteViews views=new RemoteViews(c.getPackageName(),R.layout.widget_todo);
            Bundle options=m.getAppWidgetOptions(id);
            boolean small=compact(availableSize(options,c.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE));
            TodoWidgetSpacing spacing=TodoWidgetSpacing.forWidget(c,id,options);
            float density=c.getResources().getDisplayMetrics().density;
            int padding=Math.round(spacing.outerPaddingDp(small)*density);
            views.setViewPadding(R.id.todo_widget_content,padding,padding,padding,padding);
            int inset=Math.round((small?5:8)*spacing.scale*density);
            views.setViewPadding(R.id.todo_widget_header,inset+Math.round(6*density),inset,inset,inset);
            views.setViewPadding(R.id.todo_widget_body,0,Math.round(spacing.headerGapDp()*density),0,0);
            views.setTextViewTextSize(R.id.todo_widget_date,android.util.TypedValue.COMPLEX_UNIT_SP,Math.max(13,Math.min(17,14*spacing.scale)));
            views.setTextViewTextSize(R.id.todo_widget_count,android.util.TypedValue.COMPLEX_UNIT_SP,items.size()>=100?8:items.size()>=10?10:11);
            java.util.Calendar calendar=java.util.Calendar.getInstance();
            String[] weekdays={"周日","周一","周二","周三","周四","周五","周六"};
            String date=TodoRepository.today().substring(5).replace('-','/');
            views.setTextViewText(R.id.todo_widget_date,date+" "+weekdays[calendar.get(java.util.Calendar.DAY_OF_WEEK)-1]);
            views.setTextViewText(R.id.todo_widget_count,done+"/"+items.size());
            views.setContentDescription(R.id.todo_widget_fill,"今日完成 "+done+"/"+items.size()+"，"+Math.round(ratio*100)+"%进度");
            double previous=animate && TodoWidgetAnimation.allowed(c)?TodoWidgetAnimation.previous(c,id,ratio):ratio;
            starts.put(id,previous);
            TodoWidgetAnimation.setFill(views,previous,null);
            views.setViewVisibility(R.id.todo_widget_empty,items.isEmpty()?View.VISIBLE:View.GONE);
            views.setViewVisibility(R.id.todo_widget_list,items.isEmpty()?View.GONE:View.VISIBLE);
            Intent click=new Intent(c,TodoWidgetProvider.class).setAction(ACTION).setData(Uri.parse("formyself://todo-widget/"+id));
            views.setPendingIntentTemplate(R.id.todo_widget_list,PendingIntent.getBroadcast(c,id,click,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0)));
            if(Build.VERSION.SDK_INT>=35) {
                // Newer frameworks convert service adapters asynchronously.
                // Supply the stable collection directly to avoid a stale conversion.
                RemoteViews.RemoteCollectionItems.Builder builder=new RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1);
                for(JSONObject item:items)builder.addItem(stableId(item.getString("key")),row(c,item,spacing));
                views.setRemoteAdapter(R.id.todo_widget_list,builder.build());
            } else {
                // Android12 delivers merged cached views even for partial frames.
                // Keep rows in the service so animation never resends the list.
                Intent service=new Intent(c,TodoWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).setData(Uri.parse("formyself://todo-list/"+id));
                views.setRemoteAdapter(R.id.todo_widget_list,service);
            }
            views.setEmptyView(R.id.todo_widget_list,R.id.todo_widget_empty);
            Intent open=new Intent(c,MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("formyself://open/todo")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent launch=PendingIntent.getActivity(c,710,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.todo_widget_header,launch);
            views.setOnClickPendingIntent(R.id.todo_widget_empty,launch);
            boolean ready=c.getSharedPreferences("TodoWidgetDisplay",Context.MODE_PRIVATE).getBoolean("initialized-"+id,false) && c.getSharedPreferences("TodoWidgetDisplay",Context.MODE_PRIVATE).getInt("layout-version-"+id,0)==LAYOUT_VERSION;
            if(initialize || !ready) {
                m.updateAppWidget(id,views);
                c.getSharedPreferences("TodoWidgetDisplay",Context.MODE_PRIVATE).edit().putBoolean("initialized-"+id,true).putInt("layout-version-"+id,LAYOUT_VERSION).apply();
            } else m.partiallyUpdateAppWidget(id,views);
            if(Build.VERSION.SDK_INT<35)m.notifyAppWidgetViewDataChanged(id,R.id.todo_widget_list);
            }
            TodoWidgetAnimation.startBatch(c,starts,ratio,animate);
        } catch(Exception ignored) {
            for(int id:ids) {
            RemoteViews views=new RemoteViews(c.getPackageName(),R.layout.widget_todo);
            views.setTextViewText(R.id.todo_widget_empty,"暂时无法读取待办，请打开 App 重试");
            views.setViewVisibility(R.id.todo_widget_empty,View.VISIBLE);
            views.setViewVisibility(R.id.todo_widget_list,View.GONE);
            m.updateAppWidget(id,views);
            }
        }
    }
    public static long stableId(String key) { long hash=1469598103934665603L; for(char c:key.toCharArray()){hash^=c;hash*=1099511628211L;} return hash; }
    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids) { Context app=c.getApplicationContext();TodoWidgetAnimation.MAIN.post(()->refresh(app,ids,false,true)); }
    @Override public void onEnabled(Context c) { new Thread(()->{try{TodoReminderReceiver.reschedule(c);}catch(Exception ignored){}},"todo-rollover").start(); }
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int id,Bundle options) { update(c,m,id); }
    @Override public void onDeleted(Context c,int[] ids) { TodoWidgetAnimation.MAIN.post(()->{ for(int id:ids) {TodoWidgetAnimation.forget(c,id);TodoWidgetSpacing.forget(c,id);} }); }
    @Override public void onReceive(Context c,Intent intent) {
        super.onReceive(c,intent);
        if(!ACTION.equals(intent.getAction())) return;
        if("open".equals(intent.getStringExtra("action"))) {
            c.startActivity(new Intent(c,MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("formyself://open/todo?item="+Uri.encode(intent.getStringExtra("taskId"))+"&date="+intent.getStringExtra("date"))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP));
            return;
        }
        if(!"complete".equals(intent.getStringExtra("action"))) return;
        PendingResult result=goAsync();
        new Thread(()->{
            try { TodoRepository.toggleCompleted(c,intent.getStringExtra("taskId"),intent.getStringExtra("date")); updateAll(c); TodoReminderReceiver.reschedule(c); }
            catch(Exception e) { new android.os.Handler(android.os.Looper.getMainLooper()).post(()->Toast.makeText(c,"任务已变化，请刷新组件后重试",Toast.LENGTH_SHORT).show()); updateAll(c); }
            // Allow the first render runnable to begin after a cold-process data update.
            finally { TodoWidgetAnimation.MAIN.postDelayed(result::finish,TodoWidgetAnimation.allowed(c)?650:0); }
        },"todo-widget").start();
    }
}
