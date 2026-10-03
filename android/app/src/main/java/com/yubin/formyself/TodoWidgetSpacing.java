package com.yubin.formyself;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.SizeF;

/** Bounded spacing relative to each launcher's initial widget size. */
public final class TodoWidgetSpacing {
    public final float scale;
    public final int rowPaddingDp, iconDp;
    public final float titleSp;

    private TodoWidgetSpacing(float scale) {
        this.scale=scale;
        rowPaddingDp=Math.max(0,Math.round((36+16*(scale-1)-32)/2));
        iconDp=Math.max(18,Math.min(24,Math.round(20*scale)));
        titleSp=Math.max(12,Math.min(14,13*scale));
    }
    public int rowHeightDp() { return 32+2*rowPaddingDp; }
    public int outerPaddingDp(boolean compact) { return Math.round((compact?8:12)*scale); }
    public int headerGapDp() { return Math.round(2*scale); }
    public static TodoWidgetSpacing at(SizeF size,SizeF baseline) {
        double width=size.getWidth()/Math.max(1,baseline.getWidth());
        double height=size.getHeight()/Math.max(1,baseline.getHeight());
        float scale=(float)Math.max(.8,Math.min(1.25,Math.pow(width,.35)*Math.pow(height,.65)));
        return new TodoWidgetSpacing(scale);
    }
    public static TodoWidgetSpacing forWidget(Context c,int id,Bundle options) {
        boolean landscape=c.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE;
        SizeF size=TodoWidgetProvider.availableSize(options,landscape);
        SharedPreferences saved=c.getSharedPreferences("TodoWidgetDisplay",Context.MODE_PRIVATE);
        String widthKey="spacing-width-"+id,heightKey="spacing-height-"+id,orientationKey="spacing-landscape-"+id,versionKey="spacing-reference-"+id;
        float width=saved.getFloat(widthKey,0),height=saved.getFloat(heightKey,0);
        if(width<=0 || height<=0 || saved.getInt(versionKey,0)!=2) {
            width=size.getWidth();height=size.getHeight();
            // Legacy pin flows can start at the 2-cell resize minimum, below the
            // declared 180dp default. Anchor that size to an estimated 3-cell
            // reference, rather than treating a small initial widget as normal.
            if(Math.min(width,height)<180) {
                width=(width+16)*1.5f-16;height=(height+16)*1.5f-16;
            }
            // Some launchers first deliver an empty options bundle; wait for real dimensions.
            boolean valid=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,0)>0 && options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,0)>0;
            if(android.os.Build.VERSION.SDK_INT>=31) {
                java.util.ArrayList<SizeF> sizes=options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
                valid=valid || (sizes!=null && !sizes.isEmpty());
            }
            if(valid)saved.edit().putFloat(widthKey,width).putFloat(heightKey,height).putBoolean(orientationKey,landscape).putInt(versionKey,2).apply();
        } else if(saved.getBoolean(orientationKey,false)!=landscape) {
            float swap=width;width=height;height=swap;
        }
        return at(size,new SizeF(width,height));
    }
    public static void forget(Context c,int id) {
        c.getSharedPreferences("TodoWidgetDisplay",Context.MODE_PRIVATE).edit().remove("spacing-width-"+id).remove("spacing-height-"+id).remove("spacing-landscape-"+id).remove("spacing-reference-"+id).apply();
    }
}
