package com.formyself.qa.m2probe;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override protected void onCreate(Bundle state) { registerPlugin(M2PreflightPlugin.class); super.onCreate(state); }
}
