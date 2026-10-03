package com.yubin.formyself;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;

/** Small transparent progress layer; the task list and count never enter animation frames. */
public final class TodoWidgetRing {
    private static final int SIZE=96;
    private static final Bitmap TRACK=createTrack();
    private TodoWidgetRing() {}
    private static Bitmap createTrack() {
        Bitmap bitmap=Bitmap.createBitmap(SIZE,SIZE,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(bitmap);
        Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        // Several translucent outlines give a quiet halo without runtime blur work.
        paint.setStyle(Paint.Style.STROKE);
        for(int stroke=18;stroke>=10;stroke-=2) {
            paint.setStrokeWidth(stroke);paint.setColor(Color.argb(7,57,225,192));
            canvas.drawCircle(48,48,35,paint);
        }
        paint.setStrokeWidth(7);paint.setColor(Color.rgb(53,91,94));
        canvas.drawCircle(48,48,35,paint);
        return bitmap;
    }
    public static Bitmap render(double ratio) {
        Bitmap bitmap=TRACK.copy(Bitmap.Config.ARGB_8888,true);
        double clamped=Math.max(0,Math.min(1,ratio));
        if(clamped>0) {
            Canvas canvas=new Canvas(bitmap);
            Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(7);
            paint.setStrokeCap(Paint.Cap.ROUND);paint.setColor(Color.rgb(57,225,192));
            canvas.drawArc(new RectF(13,13,83,83),-90,(float)(clamped*360),false,paint);
        }
        // Small mutable bitmaps are inlined into Binder parcels. With several
        // widgets, queued animation updates can exhaust the host's shared
        // transaction buffer. API31+ transports a shared-memory handle instead.
        if(android.os.Build.VERSION.SDK_INT>=31)return bitmap.asShared();
        Bitmap compact=Bitmap.createScaledBitmap(bitmap,64,64,true);
        return compact.copy(Bitmap.Config.ARGB_8888,false);
    }
}
