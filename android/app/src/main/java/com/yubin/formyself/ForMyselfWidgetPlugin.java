package com.yubin.formyself;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ForMyselfWidget")
public class ForMyselfWidgetPlugin extends Plugin {
    @PluginMethod
    public void refresh(PluginCall call) {
        ForMyselfWidgetProvider.updateAll(getContext());
        call.resolve();
    }
}
