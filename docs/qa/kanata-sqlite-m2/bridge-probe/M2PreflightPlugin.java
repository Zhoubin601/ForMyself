package com.formyself.qa.m2probe;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
@CapacitorPlugin(name="M2Preflight")
public class M2PreflightPlugin extends Plugin {
 @PluginMethod public void ping(PluginCall call) { call.resolve(new JSObject().put("syntheticOnly",true).put("nonce",call.getString("nonce"))); }
}
