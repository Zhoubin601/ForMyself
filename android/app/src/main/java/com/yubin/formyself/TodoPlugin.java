package com.yubin.formyself;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import android.content.SharedPreferences;

@CapacitorPlugin(name = "Todo")
public class TodoPlugin extends Plugin {
    private SharedPreferences.OnSharedPreferenceChangeListener listener;
    private android.view.ViewTreeObserver.OnGlobalLayoutListener viewportListener;
    private int lastViewportHeight=-1,lastViewportTop=-1;
    private JSObject measureViewport() {
        android.webkit.WebView view=getBridge().getWebView();
        android.graphics.Rect frame=new android.graphics.Rect();
        int[] origin=new int[2];view.getLocationOnScreen(origin);view.getWindowVisibleDisplayFrame(frame);
        return new JSObject().put("leftPx",origin[0]).put("topPx",origin[1]).put("heightPx",Math.max(0,Math.min(view.getHeight(),frame.bottom-origin[1])));
    }
    @Override public void load() {
        listener=(preferences,key)-> {
            if (!TodoRepository.KEY.equals(key)) return;
            try { notifyListeners("changed",new JSObject().put("revision",TodoRepository.read(getContext()).optLong("revision"))); }
            catch(Exception ignored) {}
        };
        getContext().getSharedPreferences("CapacitorStorage",0).registerOnSharedPreferenceChangeListener(listener);
        getActivity().runOnUiThread(()->{
            viewportListener=()->{
                JSObject size=measureViewport();int height=size.optInt("heightPx"),top=size.optInt("topPx");
                if(height==lastViewportHeight && top==lastViewportTop)return;
                lastViewportHeight=height;lastViewportTop=top;
                notifyListeners("viewportChanged",size);
            };
            getBridge().getWebView().getViewTreeObserver().addOnGlobalLayoutListener(viewportListener);
        });
    }
    @Override protected void handleOnDestroy() {
        getContext().getSharedPreferences("CapacitorStorage",0).unregisterOnSharedPreferenceChangeListener(listener);
        if(viewportListener!=null)getActivity().runOnUiThread(()->getBridge().getWebView().getViewTreeObserver().removeOnGlobalLayoutListener(viewportListener));
    }
    @PluginMethod public void viewport(PluginCall call) { getActivity().runOnUiThread(()->call.resolve(measureViewport())); }
    @PluginMethod public void read(PluginCall call) {
        try { call.resolve(JSObject.fromJSONObject(TodoRepository.read(getContext()))); }
        catch (Exception e) { call.reject("无法读取待办数据", e.getMessage()); }
    }
    @PluginMethod public void write(PluginCall call) {
        JSONObject saved;
        try {
            JSONObject data = call.getObject("data");
            saved = TodoRepository.compareAndSet(getContext(), call.getData().optLong("expectedRevision", -1L), data);
        } catch (Exception e) { call.reject("待办保存失败，请重试", e.getMessage()); return; }
        try { call.resolve(JSObject.fromJSONObject(saved)); }
        catch (Exception e) { call.reject("待办结果读取失败，请重新加载", e.getMessage()); return; }
        // A refresh failure must never turn an already committed write into a rejected write.
        try { TodoWidgetProvider.updateAll(getContext()); TodoReminderReceiver.reschedule(getContext()); }
        catch (Exception ignored) {}
        notifyListeners("changed", new JSObject().put("revision", saved.optLong("revision")));
    }
    @PluginMethod public void syncReminders(PluginCall call) {
        try { TodoReminderReceiver.reschedule(getContext()); call.resolve(); }
        catch (Exception e) { call.reject("待办提醒同步失败", e.getMessage()); }
    }
}
