package com.yubin.formyself;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.webkit.WebViewCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;

/**
 * M6-03 Native Android Runtime & WebView / Capacitor Bridge Capability Inspector.
 * Uses WebViewCompat.getCurrentWebViewPackage() to detect actual WebView version against
 * Capacitor 8 thresholds (hard floor 55, default floor 60), verifies actual plugin
 * registration, SQLite activation isolation, and SAF availability.
 * Never claims SQLite is activated in ordinary APK (BuildConfig.KANATA_M2_SYNTHETIC == false).
 */
public final class KanataRuntimeCapabilityInspector {
    public static final int CAPACITOR_HARD_MIN_WEBVIEW = 55;
    public static final int CAPACITOR_DEFAULT_MIN_WEBVIEW = 60;

    private KanataRuntimeCapabilityInspector() {}

    public static int parseMajorVersion(String versionName) {
        if (versionName == null || versionName.isEmpty()) return -1;
        int dot = versionName.indexOf('.');
        String head = dot > 0 ? versionName.substring(0, dot) : versionName;
        StringBuilder digits = new StringBuilder();
        for (int i = 0; i < head.length(); i++) {
            char ch = head.charAt(i);
            if (ch >= '0' && ch <= '9') {
                digits.append(ch);
            } else {
                break;
            }
        }
        if (digits.length() == 0) return -1;
        try {
            return Integer.parseInt(digits.toString());
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    private static boolean isSafIntentResolvable(Context context, String action, String mimeType) {
        try {
            PackageManager pm = context.getPackageManager();
            if (pm == null) return false;
            Intent intent = new Intent(action);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mimeType);
            return intent.resolveActivity(pm) != null;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static boolean isSqlCipherClassAvailable() {
        try {
            Class.forName("net.zetetic.database.sqlcipher.SQLiteDatabase");
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static JSObject inspect(Context context, Bridge bridge) {
        String webviewPackage = "";
        String webviewVersion = "";
        int webviewMajor = -1;
        try {
            PackageInfo pkg = WebViewCompat.getCurrentWebViewPackage(context);
            if (pkg != null) {
                webviewPackage = pkg.packageName != null ? pkg.packageName : "";
                webviewVersion = pkg.versionName != null ? pkg.versionName : "";
                webviewMajor = parseMajorVersion(webviewVersion);
            }
        } catch (Throwable ignored) {
            // Keep explicit unknown (-1) when WebView package cannot be queried.
        }

        boolean bridgePresent = bridge != null;
        boolean capabilityRegistered = bridgePresent && bridge.getPlugin("KanataRuntimeCapability") != null;
        boolean sqliteRegistered = bridgePresent && bridge.getPlugin("KanataSqlite") != null;
        boolean portableRegistered = bridgePresent && bridge.getPlugin("KanataM6SyntheticPortable") != null;
        boolean sqliteActivated = BuildConfig.KANATA_M2_SYNTHETIC
                && "com.yubin.formyself.m2qa".equals(context.getPackageName());

        boolean safOpen = isSafIntentResolvable(context, Intent.ACTION_OPEN_DOCUMENT, "*/*");
        boolean safCreate = isSafIntentResolvable(context, Intent.ACTION_CREATE_DOCUMENT, "application/octet-stream");
        boolean safAvailable = safOpen && safCreate;

        boolean meetsHardFloor = webviewMajor >= CAPACITOR_HARD_MIN_WEBVIEW;
        boolean supportedForBridge = webviewMajor >= CAPACITOR_DEFAULT_MIN_WEBVIEW;

        JSObject out = new JSObject();
        out.put("platform", "android");
        out.put("androidApi", Build.VERSION.SDK_INT);
        out.put("androidRelease", Build.VERSION.RELEASE != null ? Build.VERSION.RELEASE : "");
        out.put("webviewPackage", webviewPackage);
        out.put("webviewVersion", webviewVersion);
        out.put("webviewMajorVersion", webviewMajor);
        out.put("capacitorHardMinWebView", CAPACITOR_HARD_MIN_WEBVIEW);
        out.put("capacitorDefaultMinWebView", CAPACITOR_DEFAULT_MIN_WEBVIEW);
        out.put("webviewMeetsHardFloor", meetsHardFloor);
        out.put("webviewSupportedForBridge", supportedForBridge);
        out.put("bridgePresent", bridgePresent);
        out.put("capabilityPluginRegistered", capabilityRegistered);
        out.put("sqlitePluginRegistered", sqliteRegistered);
        out.put("sqlitePluginActivated", sqliteActivated);
        out.put("portablePluginRegistered", portableRegistered);
        out.put("safOpenDocumentSupported", safOpen);
        out.put("safCreateDocumentSupported", safCreate);
        out.put("safAvailable", safAvailable);
        out.put("sqlcipherNativeAvailable", isSqlCipherClassAvailable());
        return out;
    }
}
