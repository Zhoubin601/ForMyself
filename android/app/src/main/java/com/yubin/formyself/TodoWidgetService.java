package com.yubin.formyself;

import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public class TodoWidgetService extends RemoteViewsService {
    private static volatile List<JSONObject> published;
    public static void publish(List<JSONObject> items) { published=new ArrayList<>(items); }
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
        int id=intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID,android.appwidget.AppWidgetManager.INVALID_APPWIDGET_ID);
        return new RemoteViewsFactory() {
            List<JSONObject> items=new ArrayList<>();
            TodoWidgetSpacing spacing;
            @Override public void onCreate() { onDataSetChanged(); }
            @Override public void onDataSetChanged() { try { List<JSONObject> current=published;items=current==null?TodoRepository.day(TodoRepository.read(TodoWidgetService.this),TodoRepository.today()):new ArrayList<>(current);spacing=TodoWidgetSpacing.forWidget(TodoWidgetService.this,id,android.appwidget.AppWidgetManager.getInstance(TodoWidgetService.this).getAppWidgetOptions(id)); } catch(Exception ignored) { items=new ArrayList<>(); } }
            @Override public void onDestroy() { items.clear(); }
            @Override public int getCount() { return items.size(); }
            @Override public RemoteViews getViewAt(int position) { try { return TodoWidgetProvider.row(TodoWidgetService.this,items.get(position),spacing); } catch(Exception ignored) { return null; } }
            @Override public RemoteViews getLoadingView() { return null; }
            @Override public int getViewTypeCount() { return 1; }
            @Override public long getItemId(int position) { return TodoWidgetProvider.stableId(items.get(position).optString("key")); }
            @Override public boolean hasStableIds() { return true; }
        };
    }
}
