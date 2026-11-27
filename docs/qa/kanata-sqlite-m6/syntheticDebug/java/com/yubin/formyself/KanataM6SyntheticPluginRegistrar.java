package com.yubin.formyself;

import com.getcapacitor.BridgeActivity;

/**
 * Compiled ONLY in the isolated synthetic QA source set (-PkanataM2Synthetic=true -PkanataM6Synthetic=true).
 * Ordinary production APK never compiles or packages this class or any synthetic plugin.
 */
public final class KanataM6SyntheticPluginRegistrar {
    private KanataM6SyntheticPluginRegistrar() {}

    public static void register(BridgeActivity activity) {
        if (activity == null) return;
        if (!BuildConfig.KANATA_M2_SYNTHETIC || !"com.yubin.formyself.m2qa".equals(activity.getPackageName())) {
            return;
        }
        activity.registerPlugin(KanataM6SyntheticPortablePlugin.class);
        activity.registerPlugin(KanataM6RestoreBridgePlugin.class);
    }
}
