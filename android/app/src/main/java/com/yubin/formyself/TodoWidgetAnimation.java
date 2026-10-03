package com.yubin.formyself;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.widget.RemoteViews;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/** One scheduler; frames never submit collection adapters or read task data. */
public final class TodoWidgetAnimation {
    public static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Map<Integer,Double> displayed = new HashMap<>();
    private static final Map<Integer,Transition> active = new HashMap<>();
    private static boolean scheduled;
    private static Context context;
    private static final int DURATION=400, FRAME_COUNT=25;
    private TodoWidgetAnimation() {}
    private static class Transition {
        final double from,to;
        long start;
        final Bitmap[] frames;
        Transition(double from,double to,long start,Bitmap[] frames) {
            this.from=from;this.to=to;this.start=start;this.frames=frames;
        }
        double at(long now) { return interpolate(from,to,Math.min(1,Math.max(0,(now-start)/(double)DURATION))); }
    }
    public static double interpolate(double from,double to,double t) { return from+(to-from)*t; }
    public static boolean allowed(Context c) { return TodoWidgetProvider.ANIMATED && Settings.Global.getFloat(c.getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1f)>0; }
    public static double previous(Context c,int id,double fallback) {
        // Provider refreshes, deletion and frames are serialized on MAIN.
        Double value=displayed.get(id);
        if(value!=null)return value;
        try {
            String saved=c.getSharedPreferences("TodoWidgetDisplay",Context.MODE_PRIVATE).getString("ratio-"+id,null);
            return saved==null?fallback:Math.max(0,Math.min(1,Double.parseDouble(saved)));
        } catch(Exception ignored) { return fallback; }
    }
    public static void forget(Context c,int id) {
        active.remove(id);displayed.remove(id);
        c.getSharedPreferences("TodoWidgetDisplay",Context.MODE_PRIVATE).edit().remove("initialized-"+id).remove("layout-version-"+id).remove("ratio-"+id).apply();
    }
    public static void setFill(RemoteViews views,double ratio,Bitmap frame) {
        double clamped=Math.max(0,Math.min(1,ratio));
        views.setImageViewBitmap(R.id.todo_widget_fill,frame==null?TodoWidgetRing.render(clamped):frame);
    }
    public static void startBatch(Context c,Map<Integer,Double> starts,double target,boolean animate) {
        context=c.getApplicationContext();
        Map<Double,Bitmap[]> shared=new HashMap<>();
        android.content.SharedPreferences.Editor saved=c.getSharedPreferences("TodoWidgetDisplay",Context.MODE_PRIVATE).edit();
        for(Map.Entry<Integer,Double> entry:starts.entrySet()) {
            int id=entry.getKey();double from=entry.getValue();
            Transition existing=active.get(id);
            if(animate && allowed(c) && existing!=null && existing.to==target)continue;
            active.remove(id);
            if(!animate || !allowed(c) || Math.abs(from-target)<.000001) {
                displayed.put(id,target);saved.putString("ratio-"+id,Double.toString(target));continue;
            }
            Bitmap[] frames=null;
            {
                frames=shared.get(from);
                if(frames==null) {
                    frames=new Bitmap[FRAME_COUNT+1];
                    for(int i=0;i<=FRAME_COUNT;i++)frames[i]=TodoWidgetRing.render(interpolate(from,target,i/(double)FRAME_COUNT));
                    shared.put(from,frames);
                }
            }
            // The first runnable can be delayed by process startup or a data update.
            // Start the 400ms clock when rendering begins, rather than consuming it in the queue.
            active.put(id,new Transition(from,target,-1,frames));
            displayed.put(id,from);
        }
        saved.apply();
        if(!scheduled && !active.isEmpty()) { scheduled=true;MAIN.postDelayed(tick,16); }
    }
    private static final Runnable tick=new Runnable() {
        @Override public void run() {
            long now=SystemClock.uptimeMillis();
            Map<Double,ArrayList<Integer>> groups=new LinkedHashMap<>();
            Map<Double,Bitmap> bitmaps=new HashMap<>();
            ArrayList<Integer> finished=new ArrayList<>();
            boolean reduced=!allowed(context);
            for(Map.Entry<Integer,Transition> entry:active.entrySet()) {
                Transition transition=entry.getValue();
                if(transition.start<0)transition.start=now;
                double ratio=reduced?transition.to:transition.at(now);
                if(transition.frames!=null) {
                    int index=reduced?FRAME_COUNT:Math.max(0,Math.min(FRAME_COUNT,(int)((now-transition.start)/16)));
                    ratio=interpolate(transition.from,transition.to,index/(double)FRAME_COUNT);
                    bitmaps.put(ratio,transition.frames[index]);
                }
                groups.computeIfAbsent(ratio,key->new ArrayList<>()).add(entry.getKey());
                displayed.put(entry.getKey(),ratio);
                if(reduced || now-transition.start>=DURATION)finished.add(entry.getKey());
            }
            AppWidgetManager manager=AppWidgetManager.getInstance(context);
            for(Map.Entry<Double,ArrayList<Integer>> group:groups.entrySet()) {
                RemoteViews views=new RemoteViews(context.getPackageName(),R.layout.widget_todo);
                views.setImageViewBitmap(R.id.todo_widget_fill,bitmaps.get(group.getKey()));
                int[] ids=new int[group.getValue().size()];
                for(int i=0;i<ids.length;i++)ids[i]=group.getValue().get(i);
                manager.partiallyUpdateAppWidget(ids,views);
            }
            if(!finished.isEmpty()) {
                android.content.SharedPreferences.Editor saved=context.getSharedPreferences("TodoWidgetDisplay",Context.MODE_PRIVATE).edit();
                for(int id:finished) { saved.putString("ratio-"+id,Double.toString(active.get(id).to));active.remove(id); }
                saved.apply();
            }
            scheduled=!active.isEmpty();
            if(scheduled)MAIN.postDelayed(this,Math.max(0,16-(SystemClock.uptimeMillis()-now)));
        }
    };
}
