package com.yubin.formyself;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ForMyselfWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        handleWidgetPinRequest(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleWidgetPinRequest(intent);
    }

    private void handleWidgetPinRequest(Intent intent) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || intent == null) return;

        Uri uri = intent.getData();
        boolean isPinRequest = Intent.ACTION_VIEW.equals(intent.getAction())
            && uri != null
            && "formyself".equals(uri.getScheme())
            && "widget".equals(uri.getHost())
            && "/add".equals(uri.getPath());
        if (!isPinRequest) return;

        getWindow().getDecorView().post(() -> {
            AppWidgetManager manager = AppWidgetManager.getInstance(this);
            if (!manager.isRequestPinAppWidgetSupported()) return;

            boolean scheduleWidget = "schedule".equals(uri.getQueryParameter("type"));
            ComponentName provider = new ComponentName(
                this,
                scheduleWidget ? ScheduleWidgetProvider.class : ForMyselfWidgetProvider.class
            );
            manager.requestPinAppWidget(provider, null, null);
        });
    }
}
