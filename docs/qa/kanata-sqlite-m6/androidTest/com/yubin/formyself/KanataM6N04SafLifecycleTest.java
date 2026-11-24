package com.yubin.formyself;

import static org.junit.Assert.*;

import android.app.ActivityManager;
import android.app.UiAutomation;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.UriPermission;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Process;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.util.Log;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import androidx.core.content.FileProvider;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import net.zetetic.database.sqlcipher.SQLiteDatabase;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class KanataM6N04SafLifecycleTest {
    static {
        System.loadLibrary("sqlcipher");
    }

    private static final String TAG = "KanataM6N04";
    private static final int FLAGS_RW = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS;
    private static final int FLAGS_RO = SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS;

    private static void report(String key, JSONObject value) {
        Log.i(TAG, key + "=" + value.toString());
    }

    private static byte[] randomRawKey() throws Exception {
        byte[] dek = new byte[32];
        new SecureRandom().nextBytes(dek);
        try {
            return KanataKeyEnvelope.rawSqlCipherKey(dek);
        } finally {
            Arrays.fill(dek, (byte) 0);
        }
    }

    private static String sha256File(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (FileInputStream fis = new FileInputStream(f)) {
            byte[] buf = new byte[8192];
            int r;
            while ((r = fis.read(buf)) != -1) md.update(buf, 0, r);
        }
        return KanataM6PortableCrypto.bytesToHex(md.digest());
    }

    private static String sha256Uri(ContentResolver cr, Uri uri) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = cr.openInputStream(uri)) {
            assertNotNull(in);
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) != -1) md.update(buf, 0, r);
        }
        return KanataM6PortableCrypto.bytesToHex(md.digest());
    }

    private static void seedBasicSyntheticDb(KanataM6PortableCatalog catalog, File dbFile, byte[] rawKey) throws Exception {
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(
                dbFile.getPath(), rawKey, null, FLAGS_RW | SQLiteDatabase.CREATE_IF_NECESSARY, (d, e) -> {}, null)) {
            catalog.initSchema(db, 5, true);
            db.beginTransactionNonExclusive();
            try {
                db.execSQL("INSERT INTO dataset_metadata VALUES(1, 'u-n04', 2, '{}')");
                db.execSQL("INSERT INTO worlds VALUES('w1', 'N04World', 'r', 1, 'UTC', 100, 100, 1, 0, 1, 'daily', NULL, 'id-1', '{}')");
                db.execSQL("INSERT INTO world_identities VALUES('id-1', 'w1', 'u-n04', 'UserN04', 'bg', 1, '{}')");
                db.execSQL("INSERT INTO conversations VALUES('c1', 'w1', 'private', 'Chat', 'daily', 1, 100, NULL, NULL, NULL, NULL, '{}')");
                db.execSQL("INSERT INTO conversation_participants VALUES('w1', 'c1', 'id-1', 'user', 0)");
                db.execSQL("INSERT INTO messages VALUES('m1', 'w1', 'c1', 'user', 'user', 'id-1', 'UserN04', 'N04-msg-1', 100, 1, 'complete', 't1', 'b1', NULL, NULL, NULL, '{}')");
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        }
    }

    private static String sourceSummary(SQLiteDatabase db) throws Exception {
        try (Cursor c = db.rawQuery("SELECT count(*) || ':' || max(id) FROM messages", new Object[0])) {
            assertTrue(c.moveToFirst());
            return c.getString(0);
        }
    }

    private static AccessibilityNodeInfo findNodeByTextOrDesc(
            AccessibilityNodeInfo root, String... targets) {
        if (root == null) return null;
        ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
        q.add(root);
        while (!q.isEmpty()) {
            AccessibilityNodeInfo n = q.poll();
            CharSequence t = n.getText();
            CharSequence d = n.getContentDescription();
            String ts = t != null ? t.toString() : "";
            String ds = d != null ? d.toString() : "";
            for (String target : targets) {
                if (ts.equalsIgnoreCase(target) || ds.equalsIgnoreCase(target)
                        || ts.contains(target) || ds.contains(target)) {
                    return n;
                }
            }
            for (int i = 0; i < n.getChildCount(); i++) {
                AccessibilityNodeInfo ch = n.getChild(i);
                if (ch != null) q.add(ch);
            }
        }
        return null;
    }

    private static AccessibilityNodeInfo findNodeByViewIdSuffix(
            AccessibilityNodeInfo root, String suffix) {
        if (root == null) return null;
        ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
        q.add(root);
        while (!q.isEmpty()) {
            AccessibilityNodeInfo n = q.poll();
            String vid = n.getViewIdResourceName();
            if (vid != null && vid.endsWith(suffix)) {
                return n;
            }
            for (int i = 0; i < n.getChildCount(); i++) {
                AccessibilityNodeInfo ch = n.getChild(i);
                if (ch != null) q.add(ch);
            }
        }
        return null;
    }

    private static boolean tapNodeCenter(UiAutomation uia, AccessibilityNodeInfo node) {
        if (node == null) return false;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        if (bounds.isEmpty()) return false;
        float x = bounds.exactCenterX();
        float y = bounds.exactCenterY();
        long downTime = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        boolean ok1 = uia.injectInputEvent(down, true);
        down.recycle();
        SystemClock.sleep(60);
        long upTime = SystemClock.uptimeMillis();
        MotionEvent up = MotionEvent.obtain(downTime, upTime, MotionEvent.ACTION_UP, x, y, 0);
        up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        boolean ok2 = uia.injectInputEvent(up, true);
        up.recycle();
        return ok1 && ok2;
    }

    private static boolean shellTapNodeCenter(UiAutomation uia, AccessibilityNodeInfo node) {
        if (node == null) return false;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        if (bounds.isEmpty()) return false;
        int x = Math.round(bounds.exactCenterX());
        int y = Math.round(bounds.exactCenterY());
        try (android.os.ParcelFileDescriptor pfd = uia.executeShellCommand("input tap " + x + " " + y)) {
            if (pfd != null) {
                try (java.io.InputStream in = new android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd)) {
                    byte[] drain = new byte[256];
                    while (in.read(drain) != -1) {
                        // wait for input tap command completion
                    }
                }
            }
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static boolean focusAndEnterItemWithDpad(UiAutomation uia, String targetFileName)
            throws InterruptedException {
        for (int step = 0; step < 8; step++) {
            AccessibilityNodeInfo fileNode = findExactTextByViewIdSuffix(uia, ":id/title", targetFileName);
            if (fileNode == null) {
                fileNode = findAcrossWindowsByText(uia, targetFileName);
            }
            if (fileNode != null) {
                AccessibilityNodeInfo itemRoot = clickableSelfOrParent(fileNode);
                if (itemRoot != null && itemRoot.isFocused()) {
                    try (android.os.ParcelFileDescriptor pfd = uia.executeShellCommand("input keyevent 66")) {
                        if (pfd != null) {
                            try (java.io.InputStream in = new android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd)) {
                                byte[] drain = new byte[64];
                                while (in.read(drain) != -1) {}
                            }
                        }
                    } catch (Throwable ignored) {}
                    return true;
                }
            }
            try (android.os.ParcelFileDescriptor pfd = uia.executeShellCommand("input keyevent 20")) {
                if (pfd != null) {
                    try (java.io.InputStream in = new android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd)) {
                        byte[] drain = new byte[64];
                        while (in.read(drain) != -1) {}
                    }
                }
            } catch (Throwable ignored) {}
            Thread.sleep(200);
        }
        return false;
    }

    private static AccessibilityNodeInfo findDrawerItemByText(UiAutomation uia, String targetText) {
        for (AccessibilityWindowInfo win : uia.getWindows()) {
            AccessibilityNodeInfo r = win.getRoot();
            if (r == null) continue;
            ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
            q.add(r);
            while (!q.isEmpty()) {
                AccessibilityNodeInfo n = q.poll();
                CharSequence t = n.getText();
                if (t != null && targetText.equals(t.toString())) {
                    Rect b = new Rect();
                    n.getBoundsInScreen(b);
                    // Toolbar root title sits near top (top < 200); drawer root items sit below toolbar/drawer header
                    if (b.top >= 200) {
                        return n;
                    }
                }
                for (int i = 0; i < n.getChildCount(); i++) {
                    AccessibilityNodeInfo ch = n.getChild(i);
                    if (ch != null) q.add(ch);
                }
            }
        }
        return null;
    }

    private static AccessibilityNodeInfo clickableSelfOrParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo cur = node;
        while (cur != null) {
            String vid = cur.getViewIdResourceName();
            if (vid != null && vid.endsWith(":id/item_root")) {
                return cur;
            }
            cur = cur.getParent();
        }
        cur = node;
        while (cur != null) {
            String vid = cur.getViewIdResourceName();
            boolean isPreviewIcon = vid != null && vid.endsWith(":id/preview_icon");
            if (!isPreviewIcon && cur.isClickable() && cur.isEnabled()) {
                return cur;
            }
            cur = cur.getParent();
        }
        cur = node;
        while (cur != null) {
            if (cur.isFocusable() && cur.isEnabled()) {
                return cur;
            }
            cur = cur.getParent();
        }
        return node;
    }

    private static boolean clickClickableSelfOrParent(UiAutomation uia, AccessibilityNodeInfo node) {
        if (node == null) return false;
        AccessibilityNodeInfo cur = node;
        while (cur != null) {
            if (cur.isClickable() && cur.isEnabled()) {
                if (cur.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                    return true;
                }
            }
            cur = cur.getParent();
        }
        return tapNodeCenter(uia, node);
    }

    private static boolean dismissAnrIfPresent(UiAutomation uia) {
        for (AccessibilityWindowInfo win : uia.getWindows()) {
            AccessibilityNodeInfo r = win.getRoot();
            if (r == null) continue;
            AccessibilityNodeInfo closeBtn = findNodeByViewIdSuffix(r, ":id/aerr_close");
            if (closeBtn == null) closeBtn = findNodeByViewIdSuffix(r, ":id/aerr_wait");
            if (closeBtn != null && closeBtn.isEnabled()) {
                clickClickableSelfOrParent(uia, closeBtn);
                return true;
            }
        }
        return false;
    }

    private static AccessibilityNodeInfo findAcrossWindowsByText(UiAutomation uia, String... targets) {
        for (AccessibilityWindowInfo win : uia.getWindows()) {
            AccessibilityNodeInfo n = findNodeByTextOrDesc(win.getRoot(), targets);
            if (n != null) return n;
        }
        return findNodeByTextOrDesc(uia.getRootInActiveWindow(), targets);
    }

    private static AccessibilityNodeInfo findAcrossWindowsByViewIdSuffix(UiAutomation uia, String suffix) {
        for (AccessibilityWindowInfo win : uia.getWindows()) {
            AccessibilityNodeInfo n = findNodeByViewIdSuffix(win.getRoot(), suffix);
            if (n != null) return n;
        }
        return findNodeByViewIdSuffix(uia.getRootInActiveWindow(), suffix);
    }

    private static AccessibilityNodeInfo findExactTextByViewIdSuffix(
            UiAutomation uia, String viewIdSuffix, String exactText) {
        for (AccessibilityWindowInfo win : uia.getWindows()) {
            AccessibilityNodeInfo r = win.getRoot();
            if (r == null) continue;
            ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>();
            q.add(r);
            while (!q.isEmpty()) {
                AccessibilityNodeInfo n = q.poll();
                String vid = n.getViewIdResourceName();
                CharSequence t = n.getText();
                if (vid != null && vid.endsWith(viewIdSuffix)
                        && t != null && exactText.equals(t.toString())) {
                    return n;
                }
                for (int i = 0; i < n.getChildCount(); i++) {
                    AccessibilityNodeInfo ch = n.getChild(i);
                    if (ch != null) q.add(ch);
                }
            }
        }
        return null;
    }

    private static boolean isOurRootAlreadyActive(UiAutomation uia) {
        AccessibilityNodeInfo drawerHeader = findAcrossWindowsByText(uia, "Open from", "Save to", "打开自", "保存到");
        if (drawerHeader != null) return false;
        AccessibilityNodeInfo bc = findAcrossWindowsByViewIdSuffix(uia, ":id/breadcrumb_text");
        if (bc != null && bc.getText() != null && bc.getText().toString().contains(KanataM6SyntheticSafProvider.ROOT_TITLE)) {
            return true;
        }
        AccessibilityNodeInfo hdr = findAcrossWindowsByViewIdSuffix(uia, ":id/header_title");
        return hdr != null && hdr.getText() != null && hdr.getText().toString().contains(KanataM6SyntheticSafProvider.ROOT_TITLE);
    }

    private static void driveDocumentsUiCreate(UiAutomation uia, String expectedFileName) throws InterruptedException {
        long deadline = SystemClock.elapsedRealtime() + 25_000L;
        boolean drawerOpened = false;
        boolean selectedOurRoot = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (dismissAnrIfPresent(uia)) {
                Thread.sleep(400);
                continue;
            }
            if (!selectedOurRoot && isOurRootAlreadyActive(uia)) {
                selectedOurRoot = true;
            }
            if (!selectedOurRoot) {
                AccessibilityNodeInfo ourRootTitle = findAcrossWindowsByText(uia, KanataM6SyntheticSafProvider.ROOT_TITLE);
                if (ourRootTitle != null && drawerOpened) {
                    if (clickClickableSelfOrParent(uia, ourRootTitle)) {
                        selectedOurRoot = true;
                        Thread.sleep(800);
                        continue;
                    }
                }
                AccessibilityNodeInfo showRoots = findAcrossWindowsByText(uia, "Show roots", "显示根目录", "Open navigation drawer");
                if (showRoots != null && clickClickableSelfOrParent(uia, showRoots)) {
                    drawerOpened = true;
                    Thread.sleep(700);
                    continue;
                }
                if (ourRootTitle != null && clickClickableSelfOrParent(uia, ourRootTitle)) {
                    selectedOurRoot = true;
                    Thread.sleep(800);
                    continue;
                }
            } else {
                AccessibilityNodeInfo saveBtn = findAcrossWindowsByViewIdSuffix(uia, ":id/button1");
                if (saveBtn == null) {
                    saveBtn = findAcrossWindowsByText(uia, "SAVE", "Save", "保存");
                }
                if (saveBtn != null && saveBtn.isEnabled()) {
                    if (clickClickableSelfOrParent(uia, saveBtn)) {
                        return;
                    }
                }
            }
            Thread.sleep(300);
        }
        fail("Timed out driving DocumentsUI ACTION_CREATE_DOCUMENT for " + expectedFileName);
    }

    private static void driveDocumentsUiOpen(
            UiAutomation uia, String targetFileName, CountDownLatch openLatch) throws InterruptedException {
        long deadline = SystemClock.elapsedRealtime() + 25_000L;
        boolean drawerOpened = false;
        boolean selectedOurRoot = false;
        int fileAttempts = 0;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (openLatch != null && openLatch.getCount() == 0L) {
                return;
            }
            if (dismissAnrIfPresent(uia)) {
                Thread.sleep(400);
                continue;
            }
            if (!selectedOurRoot && isOurRootAlreadyActive(uia)) {
                selectedOurRoot = true;
            }
            if (selectedOurRoot) {
                AccessibilityNodeInfo drawerHeader = findAcrossWindowsByText(uia, "Open from", "Save to", "打开自", "保存到");
                if (drawerHeader != null) {
                    AccessibilityNodeInfo drawerRoot = findDrawerItemByText(uia, KanataM6SyntheticSafProvider.ROOT_TITLE);
                    if (drawerRoot != null) {
                        if (shellTapNodeCenter(uia, clickableSelfOrParent(drawerRoot))
                                || clickClickableSelfOrParent(uia, drawerRoot)) {
                            Thread.sleep(700);
                            continue;
                        }
                    }
                    if (android.os.Build.VERSION.SDK_INT >= 26) {
                        uia.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
                        Thread.sleep(500);
                        continue;
                    }
                }
                AccessibilityNodeInfo selectBtn = findAcrossWindowsByViewIdSuffix(uia, ":id/action_menu_select");
                if (selectBtn != null && selectBtn.isEnabled()) {
                    clickClickableSelfOrParent(uia, selectBtn);
                    Thread.sleep(500);
                    if (openLatch != null && openLatch.getCount() == 0L) return;
                }
                AccessibilityNodeInfo fileNode = findExactTextByViewIdSuffix(uia, ":id/title", targetFileName);
                if (fileNode == null) {
                    fileNode = findAcrossWindowsByText(uia, targetFileName);
                }
                if (fileNode != null) {
                    AccessibilityNodeInfo itemRoot = clickableSelfOrParent(fileNode);
                    boolean acted;
                    if (fileAttempts % 4 == 0) {
                        acted = shellTapNodeCenter(uia, itemRoot);
                    } else if (fileAttempts % 4 == 1) {
                        acted = focusAndEnterItemWithDpad(uia, targetFileName);
                    } else if (fileAttempts % 4 == 2) {
                        acted = tapNodeCenter(uia, itemRoot);
                    } else {
                        acted = clickClickableSelfOrParent(uia, itemRoot);
                    }
                    fileAttempts++;
                    if (acted) {
                        Thread.sleep(700);
                        if (openLatch != null && openLatch.getCount() == 0L) {
                            return;
                        }
                        AccessibilityNodeInfo postSelectBtn = findAcrossWindowsByViewIdSuffix(uia, ":id/action_menu_select");
                        if (postSelectBtn != null && postSelectBtn.isEnabled()) {
                            clickClickableSelfOrParent(uia, postSelectBtn);
                            Thread.sleep(500);
                        }
                        continue;
                    }
                }
            } else {
                AccessibilityNodeInfo ourRoot = findAcrossWindowsByText(uia, KanataM6SyntheticSafProvider.ROOT_TITLE);
                if (ourRoot != null && drawerOpened) {
                    if (clickClickableSelfOrParent(uia, ourRoot)) {
                        selectedOurRoot = true;
                        Thread.sleep(800);
                        continue;
                    }
                }
                AccessibilityNodeInfo showRoots = findAcrossWindowsByText(uia, "Show roots", "显示根目录", "Open navigation drawer");
                if (showRoots != null && clickClickableSelfOrParent(uia, showRoots)) {
                    drawerOpened = true;
                    Thread.sleep(700);
                    continue;
                }
                if (ourRoot != null && clickClickableSelfOrParent(uia, ourRoot)) {
                    selectedOurRoot = true;
                    Thread.sleep(800);
                    continue;
                }
            }
            Thread.sleep(300);
        }
        if (openLatch != null && openLatch.getCount() == 0L) {
            return;
        }
        fail("Timed out driving DocumentsUI ACTION_OPEN_DOCUMENT for " + targetFileName);
    }

    private static void driveShareChooserIfShown(UiAutomation uia, File expectedReportFile) throws InterruptedException {
        long deadline = SystemClock.elapsedRealtime() + 20_000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (expectedReportFile.exists()) return;
            if (dismissAnrIfPresent(uia)) {
                Thread.sleep(400);
                continue;
            }
            AccessibilityNodeInfo justOnce = findAcrossWindowsByViewIdSuffix(uia, ":id/button_once");
            if (justOnce != null && justOnce.isEnabled()) {
                clickClickableSelfOrParent(uia, justOnce);
                Thread.sleep(500);
                continue;
            }
            AccessibilityNodeInfo target = findAcrossWindowsByText(uia, "Kanata Share Test Receiver");
            if (target != null && clickClickableSelfOrParent(uia, target)) {
                Thread.sleep(500);
                AccessibilityNodeInfo justOnceAfter = findAcrossWindowsByViewIdSuffix(uia, ":id/button_once");
                if (justOnceAfter != null && justOnceAfter.isEnabled()) {
                    clickClickableSelfOrParent(uia, justOnceAfter);
                }
                long rDeadline = SystemClock.elapsedRealtime() + 8_000L;
                while (!expectedReportFile.exists() && SystemClock.elapsedRealtime() < rDeadline) {
                    Thread.sleep(100);
                }
                if (expectedReportFile.exists()) return;
            }
            Thread.sleep(300);
        }
        assertTrue("Share receiver report was not created", expectedReportFile.exists());
    }

    @Test
    public void probeSafDocumentsProviderPickerPermissionsAndFaults() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        UiAutomation uia = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        ContentResolver cr = targetCtx.getContentResolver();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);
        KanataM6SyntheticSafProvider.resetFaultsAndFiles(targetCtx);

        File dir = new File(targetCtx.getCacheDir(), "m6-n04-saf-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        File srcDbFile = new File(dir, "src.db");
        File spoolDir = new File(targetCtx.getNoBackupFilesDir(), "m6-n04-spool-" + UUID.randomUUID());
        File spoolFile = new File(spoolDir, "export.kpb1");
        File targetDbFile = new File(dir, "target.db");

        byte[] rawKey = randomRawKey();
        byte[] targetKey = randomRawKey();

        try {
            seedBasicSyntheticDb(catalog, srcDbFile, rawKey);
            String srcBefore;
            try (SQLiteDatabase sdb = SQLiteDatabase.openDatabase(srcDbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                srcBefore = sourceSummary(sdb);
            }

            AtomicBoolean cancelled = new AtomicBoolean(false);
            KanataM6SchemeCExporter.ExportMetrics em = KanataM6SchemeCExporter.exportToSpool(
                    srcDbFile.getPath(), rawKey, "n04-pw", catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, spoolFile,
                    null, null, cancelled, null);

            String docTitle = "kanata-n04-" + UUID.randomUUID().toString().substring(0, 8) + ".kpb1";
            Uri createdUri;
            Uri openedUri;
            boolean persistedGranted = false;
            boolean persistedReleased = false;

            try (ActivityScenario<KanataM6BridgeActivity> scenario = ActivityScenario.launch(KanataM6BridgeActivity.class)) {
                // 1. Real ACTION_CREATE_DOCUMENT through Android DocumentsUI picker
                AtomicReference<CountDownLatch> createLatchRef = new AtomicReference<>();
                scenario.onActivity(act -> {
                    Intent createIntent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("application/octet-stream")
                            .putExtra(Intent.EXTRA_TITLE, docTitle)
                            .putExtra(DocumentsContract.EXTRA_INITIAL_URI, KanataM6SyntheticSafProvider.rootUri());
                    createLatchRef.set(act.prepareForActivityResult(KanataM6BridgeActivity.REQ_SAF_CREATE, createIntent));
                });
                driveDocumentsUiCreate(uia, docTitle);
                assertTrue("Timed out waiting for ACTION_CREATE_DOCUMENT result",
                        createLatchRef.get().await(15_000L, java.util.concurrent.TimeUnit.MILLISECONDS));
                AtomicReference<Uri> createdUriRef = new AtomicReference<>();
                AtomicReference<Integer> createFlagsRef = new AtomicReference<>(0);
                scenario.onActivity(act -> {
                    createdUriRef.set(act.getLastResultUriIfOk());
                    createFlagsRef.set(act.getLastResultFlags());
                });
                createdUri = createdUriRef.get();
                int createFlags = createFlagsRef.get();
                assertNotNull("ACTION_CREATE_DOCUMENT must return a real system SAF Uri", createdUri);
                assertEquals(KanataM6SyntheticSafProvider.AUTHORITY, createdUri.getAuthority());

                // Take real OS persistable URI permission!
                // Note: On API 24/25, AMS skips persisting a UriPermission entry when caller UID == provider UID
                // (or DocumentsUI omits FLAG_GRANT_PERSISTABLE_URI_PERMISSION on same-UID CREATE); test explicitly on >=26 or whenever granted.
                boolean persistableTriedAndSkippedSameUidPre26 = false;
                try {
                    cr.takePersistableUriPermission(
                            createdUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    for (UriPermission p : cr.getPersistedUriPermissions()) {
                        if (createdUri.equals(p.getUri()) && p.isReadPermission() && p.isWritePermission()) {
                            persistedGranted = true;
                            break;
                        }
                    }
                    assertTrue("Persistable URI permission must be recorded by Android OS", persistedGranted);
                } catch (SecurityException se) {
                    if (android.os.Build.VERSION.SDK_INT < 26) {
                        persistableTriedAndSkippedSameUidPre26 = true;
                    } else {
                        throw se;
                    }
                }

                // Write exported KPB1 to created SAF Uri, flush/close, and readback-verify SHA-256
                try (OutputStream out = cr.openOutputStream(createdUri, "w");
                     FileInputStream in = new FileInputStream(spoolFile)) {
                    assertNotNull(out);
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                    out.flush();
                }
                assertEquals(em.packageSha256Hex, sha256Uri(cr, createdUri));

                // 2. Real ACTION_OPEN_DOCUMENT through Android DocumentsUI picker
                AtomicReference<CountDownLatch> openLatchRef = new AtomicReference<>();
                scenario.onActivity(act -> {
                    Intent openIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("*/*")
                            .putExtra(DocumentsContract.EXTRA_INITIAL_URI, KanataM6SyntheticSafProvider.rootUri());
                    openLatchRef.set(act.prepareForActivityResult(KanataM6BridgeActivity.REQ_SAF_OPEN, openIntent));
                });
                driveDocumentsUiOpen(uia, docTitle, openLatchRef.get());
                assertTrue("Timed out waiting for ACTION_OPEN_DOCUMENT result",
                        openLatchRef.get().await(15_000L, java.util.concurrent.TimeUnit.MILLISECONDS));
                AtomicReference<Uri> openedUriRef = new AtomicReference<>();
                AtomicReference<Integer> openFlagsRef = new AtomicReference<>(0);
                scenario.onActivity(act -> {
                    openedUriRef.set(act.getLastResultUriIfOk());
                    openFlagsRef.set(act.getLastResultFlags());
                });
                openedUri = openedUriRef.get();
                int openFlags = openFlagsRef.get();
                assertNotNull("ACTION_OPEN_DOCUMENT must return a real system SAF Uri", openedUri);

                String openedDocId = DocumentsContract.getDocumentId(openedUri);

                // Short-read (13 B chunks) SAF import into isolated target
                KanataM6SyntheticSafProvider.setFaultMode(openedDocId, KanataM6SyntheticSafProvider.FaultMode.SHORT_READ);
                try (InputStream in = cr.openInputStream(openedUri)) {
                    assertNotNull(in);
                    KanataM6SchemeCImporter.ImportResult ir = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            in, "n04-pw", catalog, dir, targetDbFile, targetKey, cancelled);
                    assertEquals(em.transcriptHex, ir.transcriptHex);
                    assertEquals(50, ir.footerVerifiers.size());
                }
                KanataM6SyntheticSafProvider.setFaultMode(openedDocId, KanataM6SyntheticSafProvider.FaultMode.NORMAL);

                // 3. Real OS persistable permission release & system URI grant/revocation check
                if (persistedGranted) {
                    cr.releasePersistableUriPermission(
                            createdUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    persistedReleased = true;
                    for (UriPermission p : cr.getPersistedUriPermissions()) {
                        if (createdUri.equals(p.getUri())) persistedReleased = false;
                    }
                    assertTrue("Released persistable URI permission must disappear", persistedReleased);
                } else if (!persistableTriedAndSkippedSameUidPre26) {
                    fail("Expected persistable URI permission grant on SDK " + android.os.Build.VERSION.SDK_INT);
                }

                // Real Android UriGrantsManagerService grant & revoke verification for external UID (Process.SHELL_UID)
                assertEquals(
                        PackageManager.PERMISSION_DENIED,
                        targetCtx.checkUriPermission(openedUri, 0, Process.SHELL_UID, Intent.FLAG_GRANT_READ_URI_PERMISSION));
                targetCtx.grantUriPermission("com.android.shell", openedUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                assertEquals(
                        PackageManager.PERMISSION_GRANTED,
                        targetCtx.checkUriPermission(openedUri, 0, Process.SHELL_UID, Intent.FLAG_GRANT_READ_URI_PERMISSION));
                targetCtx.revokeUriPermission(openedUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                assertEquals(
                        PackageManager.PERMISSION_DENIED,
                        targetCtx.checkUriPermission(openedUri, 0, Process.SHELL_UID, Intent.FLAG_GRANT_READ_URI_PERMISSION));

                // 4. Provider error injection -> FileNotFoundException
                KanataM6SyntheticSafProvider.setFaultMode(openedDocId, KanataM6SyntheticSafProvider.FaultMode.PROVIDER_IO_ERROR);
                assertThrows(FileNotFoundException.class, () -> {
                    try (InputStream ignored = cr.openInputStream(openedUri)) {}
                });
                KanataM6SyntheticSafProvider.setFaultMode(openedDocId, KanataM6SyntheticSafProvider.FaultMode.NORMAL);

                // 5. Readback corruption -> SHA-256 mismatch
                KanataM6SyntheticSafProvider.setFaultMode(openedDocId, KanataM6SyntheticSafProvider.FaultMode.READBACK_CORRUPT);
                assertNotEquals(em.packageSha256Hex, sha256Uri(cr, openedUri));
                KanataM6SyntheticSafProvider.setFaultMode(openedDocId, KanataM6SyntheticSafProvider.FaultMode.NORMAL);

                // 6. Half-write / ENOSPC on DocumentsProvider document
                String hwDocId = DocumentsContract.getDocumentId(
                        DocumentsContract.createDocument(cr, KanataM6SyntheticSafProvider.rootUri(), "application/octet-stream", "hw-" + docTitle));
                Uri hwUri = DocumentsContract.buildDocumentUri(KanataM6SyntheticSafProvider.AUTHORITY, hwDocId);
                KanataM6SyntheticSafProvider.setFaultMode(hwDocId, KanataM6SyntheticSafProvider.FaultMode.HALF_WRITE_ENOSPC);
                boolean halfWriteFailed = false;
                try (OutputStream out = cr.openOutputStream(hwUri, "w");
                     FileInputStream in = new FileInputStream(spoolFile)) {
                    byte[] buf = new byte[512];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                    out.flush();
                } catch (IOException expected) {
                    halfWriteFailed = true;
                }
                KanataM6SyntheticSafProvider.setFaultMode(hwDocId, KanataM6SyntheticSafProvider.FaultMode.NORMAL);
                String hwSha = sha256Uri(cr, hwUri);
                if (!halfWriteFailed && !em.packageSha256Hex.equals(hwSha)) halfWriteFailed = true;
                assertTrue(halfWriteFailed);
                assertNotEquals(em.packageSha256Hex, hwSha);
                // Existing valid createdUri remains intact!
                assertEquals(em.packageSha256Hex, sha256Uri(cr, createdUri));

                // 7. Zero-progress stream -> ERR_IO_FAILED("reader-zero-progress")
                InputStream zeroProgressStream = new InputStream() {
                    @Override public int read() { return 0; }
                    @Override public int read(byte[] b, int off, int len) { return 0; }
                };
                KanataM6PortableCrypto.PortableException zpEx = assertThrows(KanataM6PortableCrypto.PortableException.class, () ->
                        KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                                zeroProgressStream, "n04-pw", catalog, dir,
                                new File(dir, "zp_target.db"), targetKey, cancelled));
                assertEquals(KanataM6PortableCrypto.ERR_IO_FAILED, zpEx.code);
                assertEquals("reader-zero-progress", zpEx.stage);

                try (SQLiteDatabase sdb = SQLiteDatabase.openDatabase(srcDbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                    assertEquals(srcBefore, sourceSummary(sdb));
                    assertEquals("ok", KanataM6SnapshotOwner.scalar(sdb, "PRAGMA integrity_check"));
                }

                report("N04_SAF_DOCUMENTS_PROVIDER", new JSONObject()
                        .put("realCreateDocumentOk", true)
                        .put("realOpenDocumentOk", true)
                        .put("createResultFlags", createFlags)
                        .put("openResultFlags", openFlags)
                        .put("persistableGrantAndReleaseOk", persistedGranted && persistedReleased)
                        .put("sameUidPersistableSkippedPre26", persistableTriedAndSkippedSameUidPre26)
                        .put("osUriGrantAndRevokeOk", true)
                        .put("safShortReadImportOk", true)
                        .put("providerErrorCaught", true)
                        .put("readbackCorruptCaught", true)
                        .put("halfWriteRejected", true)
                        .put("zeroProgressRejected", zpEx.stage));
            }
        } finally {
            KanataM6SyntheticSafProvider.resetFaultsAndFiles(targetCtx);
            Arrays.fill(rawKey, (byte) 0);
            Arrays.fill(targetKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(srcDbFile);
            SQLiteDatabase.deleteDatabase(targetDbFile);
            deleteRecursive(dir);
            deleteRecursive(spoolDir);
        }
    }

    @Test
    public void probeShareChooserReceiverRevokeAndCleanup() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        UiAutomation uia = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File dir = new File(targetCtx.getCacheDir(), "m6-n04-share-src-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        File srcDbFile = new File(dir, "src.db");
        File spoolDir = new File(targetCtx.getNoBackupFilesDir(), "m6-n04-share-spool-" + UUID.randomUUID());
        File spoolFile = new File(spoolDir, "export.kpb1");
        File shareTmpDir = new File(targetCtx.getCacheDir(), "m6-n04-share-" + UUID.randomUUID());
        assertTrue(shareTmpDir.mkdirs());
        File unrelatedSentinel = new File(shareTmpDir, "unrelated-sentinel.dat");
        try (FileOutputStream fos = new FileOutputStream(unrelatedSentinel)) {
            fos.write("KEEP_ME".getBytes(StandardCharsets.UTF_8));
        }
        String sentinelSha = sha256File(unrelatedSentinel);
        File receiverReport = new File(targetCtx.getCacheDir(), KanataM6ShareReceiverActivity.REPORT_FILE_NAME);
        if (receiverReport.exists()) receiverReport.delete();

        byte[] rawKey = randomRawKey();

        try {
            seedBasicSyntheticDb(catalog, srcDbFile, rawKey);
            KanataM6SchemeCExporter.ExportMetrics em = KanataM6SchemeCExporter.exportToSpool(
                    srcDbFile.getPath(), rawKey, "n04-share-pw", catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, spoolFile,
                    null, null, new AtomicBoolean(false), null);

            File shareCopy = new File(shareTmpDir, "kanata-share-export.kpb1");
            try (FileInputStream in = new FileInputStream(spoolFile);
                 FileOutputStream out = new FileOutputStream(shareCopy)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                out.getFD().sync();
            }
            Uri shareUri = FileProvider.getUriForFile(targetCtx, targetCtx.getPackageName() + ".fileprovider", shareCopy);

            try (ActivityScenario<KanataM6BridgeActivity> scenario = ActivityScenario.launch(KanataM6BridgeActivity.class)) {
                scenario.onActivity(act -> {
                    Intent sendIntent = new Intent(Intent.ACTION_SEND)
                            .setType("application/x-kanata-kpb1")
                            .putExtra(Intent.EXTRA_STREAM, shareUri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    Intent chooser = Intent.createChooser(sendIntent, "Share Kanata Backup");
                    act.startActivity(chooser);
                });
                driveShareChooserIfShown(uia, receiverReport);
            }

            assertTrue("Receiver report must exist", receiverReport.exists());
            JSONObject recvJson = new JSONObject(readSmallText(receiverReport));
            assertTrue("Share receiver must succeed: " + recvJson, recvJson.optBoolean("ok", false));
            assertNotEquals("Share receiver must run in independent :m6sharerecv process",
                    Process.myPid(), recvJson.getInt("receiverPid"));
            assertEquals(em.finalFileBytes, recvJson.getLong("bytesRead"));
            assertEquals(em.packageSha256Hex, recvJson.getString("sha256"));

            // Grant and revoke OS URI permission and verify revocation
            targetCtx.grantUriPermission("com.android.shell", shareUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            assertEquals(PackageManager.PERMISSION_GRANTED,
                    targetCtx.checkUriPermission(shareUri, 0, Process.SHELL_UID, Intent.FLAG_GRANT_READ_URI_PERMISSION));
            targetCtx.revokeUriPermission(shareUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            assertEquals(PackageManager.PERMISSION_DENIED,
                    targetCtx.checkUriPermission(shareUri, 0, Process.SHELL_UID, Intent.FLAG_GRANT_READ_URI_PERMISSION));

            // Task-owned cleanup only
            assertTrue(shareCopy.delete());
            assertFalse(shareCopy.exists());
            assertTrue(unrelatedSentinel.exists());
            assertEquals(sentinelSha, sha256File(unrelatedSentinel));

            report("N04_SHARE_CHOOSER", new JSONObject()
                    .put("chooserLaunched", true)
                    .put("independentReceiverPid", recvJson.getInt("receiverPid"))
                    .put("receiverSha256Match", true)
                    .put("tempGrantRevoked", true)
                    .put("taskFileCleanedAndSentinelPreserved", true));
        } finally {
            if (receiverReport.exists()) receiverReport.delete();
            Arrays.fill(rawKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(srcDbFile);
            deleteRecursive(dir);
            deleteRecursive(spoolDir);
            deleteRecursive(shareTmpDir);
        }
    }

    @Test
    public void probeActivityLifecycleManagedOwnerAndRotation() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File dir = new File(targetCtx.getCacheDir(), "m6-n04-life-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        File srcDbFile = new File(dir, "src_life.db");
        byte[] rawKey = randomRawKey();

        try {
            seedBasicSyntheticDb(catalog, srcDbFile, rawKey);

            // 1. Host Activity + KanataM6LifecycleController owns DB, lease, and epoch.
            // Test code NEVER calls db.close() or epoch.incrementAndGet() manually!
            KanataM6BridgeActivity.resetLifecycleCounters();
            AtomicReference<KanataM6LifecycleController> ctrlRef = new AtomicReference<>();
            AtomicReference<KanataM6LifecycleController.OperationLease> lease1Ref = new AtomicReference<>();
            AtomicReference<SQLiteDatabase> db1Ref = new AtomicReference<>();

            try (ActivityScenario<KanataM6BridgeActivity> scenario = ActivityScenario.launch(KanataM6BridgeActivity.class)) {
                scenario.onActivity(act -> {
                    KanataM6LifecycleController ctrl = act.getLifecycleController();
                    ctrlRef.set(ctrl);
                    lease1Ref.set(ctrl.openManagedDatabase(srcDbFile.getPath(), rawKey));
                    db1Ref.set(ctrl.getOwnedDb());
                    assertTrue(ctrl.isDbOpen());
                    assertTrue(db1Ref.get().isOpen());
                });

                // Real Activity onPause (RESUMED -> STARTED) must automatically close DB & revoke epoch!
                scenario.moveToState(Lifecycle.State.STARTED);
                KanataM6LifecycleController ctrl = ctrlRef.get();
                assertFalse("Activity onPause must close managed DB automatically", ctrl.isDbOpen());
                assertFalse("Owned SQLiteDatabase must be closed", db1Ref.get().isOpen());
                assertTrue("Epoch must advance automatically on pause", ctrl.getEpoch() > lease1Ref.get().epoch);
                assertEquals(KanataM6LifecycleController.CompletionStatus.REJECTED_STALE_EPOCH,
                        ctrl.tryComplete(lease1Ref.get()));
                assertThrows(IllegalStateException.class, () -> {
                    try (Cursor c = db1Ref.get().rawQuery("SELECT count(*) FROM messages", new Object[0])) {
                        c.moveToFirst();
                    }
                });

                // Resume, open lease2, move to CREATED (onStop) -> must also auto-close & revoke!
                scenario.moveToState(Lifecycle.State.RESUMED);
                AtomicReference<KanataM6LifecycleController.OperationLease> lease2Ref = new AtomicReference<>();
                AtomicReference<SQLiteDatabase> db2Ref = new AtomicReference<>();
                scenario.onActivity(act -> {
                    lease2Ref.set(act.getLifecycleController().openManagedDatabase(srcDbFile.getPath(), rawKey));
                    db2Ref.set(act.getLifecycleController().getOwnedDb());
                });
                scenario.moveToState(Lifecycle.State.CREATED);
                assertTrue("onStop must have executed", KanataM6BridgeActivity.STOP_COUNT.get() >= 1);
                assertFalse(ctrl.isDbOpen());
                assertFalse(db2Ref.get().isOpen());
                assertEquals(KanataM6LifecycleController.CompletionStatus.REJECTED_STALE_EPOCH,
                        ctrl.tryComplete(lease2Ref.get()));

                // Resume, test idempotent completion & session invalidation
                scenario.moveToState(Lifecycle.State.RESUMED);
                AtomicReference<KanataM6LifecycleController.OperationLease> lease3Ref = new AtomicReference<>();
                scenario.onActivity(act -> lease3Ref.set(act.getLifecycleController().openManagedDatabase(srcDbFile.getPath(), rawKey)));
                assertEquals(KanataM6LifecycleController.CompletionStatus.COMPLETED, ctrl.tryComplete(lease3Ref.get()));
                assertEquals(KanataM6LifecycleController.CompletionStatus.ALREADY_COMPLETED, ctrl.tryComplete(lease3Ref.get()));
                assertEquals(1, ctrl.getCompletionCount());

                ctrl.invalidateSession();
                assertFalse(ctrl.isDbOpen());
                assertEquals(KanataM6LifecycleController.CompletionStatus.REJECTED_STALE_SESSION,
                        ctrl.tryComplete(lease3Ref.get()));
            }

            // 2. Real Activity rotation / recreate() closes DB & invalidates pre-rotation lease
            KanataM6RotationActivity.resetCounters();
            AtomicReference<KanataM6LifecycleController.OperationLease> rotLeaseRef = new AtomicReference<>();
            AtomicReference<SQLiteDatabase> rotDbRef = new AtomicReference<>();
            try (ActivityScenario<KanataM6RotationActivity> rotScenario = ActivityScenario.launch(KanataM6RotationActivity.class)) {
                rotScenario.onActivity(act -> {
                    KanataM6LifecycleController rc = act.getLifecycleController();
                    rotLeaseRef.set(rc.openManagedDatabase(srcDbFile.getPath(), rawKey));
                    rotDbRef.set(rc.getOwnedDb());
                    assertTrue(rc.isDbOpen());
                });
                rotScenario.recreate();
                assertTrue(KanataM6RotationActivity.CREATE_COUNT.get() >= 2);
                assertTrue(KanataM6RotationActivity.PAUSE_COUNT.get() >= 1);
                assertTrue(KanataM6RotationActivity.STOP_COUNT.get() >= 1);
                assertTrue(KanataM6RotationActivity.DESTROY_COUNT.get() >= 1);
                assertFalse("Rotation recreate must close pre-rotation DB automatically", rotDbRef.get().isOpen());
                rotScenario.onActivity(act -> assertEquals(
                        KanataM6LifecycleController.CompletionStatus.REJECTED_STALE_EPOCH,
                        act.getLifecycleController().tryComplete(rotLeaseRef.get())));
            }

            report("N04_ACTIVITY_LIFECYCLE", new JSONObject()
                    .put("managedControllerClosedDbOnPauseAndStop", true)
                    .put("staleEpochAndSessionRejected", ctrlRef.get().getStaleRejectedCount())
                    .put("duplicateCompletionIdempotentCount", ctrlRef.get().getCompletionCount())
                    .put("rotationCreateCount", KanataM6RotationActivity.CREATE_COUNT.get())
                    .put("rotationStopCount", KanataM6RotationActivity.STOP_COUNT.get())
                    .put("rotationDestroyCount", KanataM6RotationActivity.DESTROY_COUNT.get()));
        } finally {
            Arrays.fill(rawKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(srcDbFile);
            deleteRecursive(dir);
        }
    }

    @Test
    public void probeRealExporterProcessKillAcrossAllStages() throws Exception {
        Context targetCtx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context instrCtx = InstrumentationRegistry.getInstrumentation().getContext();
        KanataM6PortableCatalog catalog = KanataM6PortableCatalog.load(instrCtx);

        File dir = new File(targetCtx.getCacheDir(), "m6-n04-kill-src-" + UUID.randomUUID());
        assertTrue(dir.mkdirs());
        File srcDbFile = new File(dir, "src_kill.db");
        File killWorkDir = new File(targetCtx.getNoBackupFilesDir(), "m6-n04-kill-" + UUID.randomUUID());
        File spoolDir = new File(killWorkDir, "spool");
        assertTrue(spoolDir.mkdirs());
        File targetBackup = new File(killWorkDir, "backup_target.kpb1");
        File unrelatedFile = new File(killWorkDir, "unrelated-user-note.txt");
        try (FileOutputStream fos = new FileOutputStream(unrelatedFile)) {
            fos.write("UNRELATED".getBytes(StandardCharsets.UTF_8));
        }
        String unrelatedSha = sha256File(unrelatedFile);

        // Other unrelated active task's temp file must never be touched by recovery of killed task!
        File otherTaskTmp = new File(spoolDir, ".backup_target.kpb1.other-active-task.spool.tmp");
        try (FileOutputStream fos = new FileOutputStream(otherTaskTmp)) {
            fos.write("OTHER_ACTIVE_TEMP".getBytes(StandardCharsets.UTF_8));
        }

        byte[] rawKey = randomRawKey();
        String rawKeyHex = KanataM6PortableCrypto.bytesToHex(rawKey);
        String password = "kill-stage-pw";

        try {
            KanataM6SyntheticDataset.populateUniformDataset(srcDbFile, rawKey, catalog, 30);
            String srcDigestBefore;
            try (SQLiteDatabase sdb = SQLiteDatabase.openDatabase(srcDbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                srcDigestBefore = KanataM6SyntheticDataset.computeLogicalFingerprint(sdb, catalog, false).overallDigestHex;
            }

            // Produce real prior valid backup A using real Exporter
            KanataM6SchemeCExporter.ExportMetrics baseEm = KanataM6SchemeCExporter.exportToSpool(
                    srcDbFile.getPath(), rawKey, password, catalog,
                    new KanataM6SnapshotOwner.WriteGate(), spoolDir, targetBackup,
                    null, null, new AtomicBoolean(false), null, "kill-baseline-a");
            String priorValidSha = sha256File(targetBackup);
            assertEquals(baseEm.packageSha256Hex, priorValidSha);

            // Mutate source slightly so killed export B is distinct
            try (SQLiteDatabase rw = SQLiteDatabase.openDatabase(srcDbFile.getPath(), rawKey, null, FLAGS_RW, (d, e) -> {}, null)) {
                rw.execSQL("INSERT INTO messages VALUES('msg-kill-b', 'w1', 'c1', 'user', 'user', 'id-1', 'u', 'KILL_STAGE_MSG', 1700009999000, 1, 'complete', 'tk', 'bk', NULL, NULL, NULL, '{}')");
            }
            String srcDigestWithB;
            try (SQLiteDatabase sdb = SQLiteDatabase.openDatabase(srcDbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                srcDigestWithB = KanataM6SyntheticDataset.computeLogicalFingerprint(sdb, catalog, false).overallDigestHex;
            }

            String[] stages = new String[] {
                    KanataM6KillableWorkerService.STAGE_KDF,
                    KanataM6KillableWorkerService.STAGE_DB_READ,
                    KanataM6KillableWorkerService.STAGE_SPOOL_WRITE,
                    KanataM6KillableWorkerService.STAGE_COMMIT
            };
            JSONObject stageResults = new JSONObject();

            for (String stage : stages) {
                String taskId = "kill-" + stage.toLowerCase();
                File readyFile = new File(killWorkDir, "worker_ready.json");
                File recoveredFile = new File(killWorkDir, "worker_recovered.json");
                File errFile = new File(killWorkDir, "worker_error.txt");
                if (readyFile.exists()) readyFile.delete();
                if (recoveredFile.exists()) recoveredFile.delete();
                if (errFile.exists()) errFile.delete();

                Intent startWorker = new Intent(targetCtx, KanataM6KillableWorkerService.class)
                        .setAction(KanataM6KillableWorkerService.ACTION_START_EXPORT_PAUSE)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_DB_PATH, srcDbFile.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_RAW_KEY_HEX, rawKeyHex)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_PASSWORD, password)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TARGET_PATH, targetBackup.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, taskId)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_PAUSE_STAGE, stage);
                targetCtx.startService(startWorker);

                long deadline = SystemClock.elapsedRealtime() + 20_000L;
                while (!readyFile.exists() && !errFile.exists() && SystemClock.elapsedRealtime() < deadline) {
                    Thread.sleep(50);
                }
                assertFalse("Worker reported error: " + (errFile.exists() ? readSmallText(errFile) : ""), errFile.exists());
                assertTrue("Worker did not reach stage " + stage, readyFile.exists());
                JSONObject readyJson = new JSONObject(readSmallText(readyFile));
                int workerPid = readyJson.getInt("pid");
                assertNotEquals(Process.myPid(), workerPid);
                assertEquals(stage, readyJson.getString("stage"));
                String tmpSpoolPath = readyJson.optString("tmpSpoolPath", "");
                File tmpSpoolFile = tmpSpoolPath.isEmpty() ? null : new File(tmpSpoolPath);
                assertNotNull(tmpSpoolFile);
                assertTrue("Task tmp spool must exist at stage " + stage, tmpSpoolFile.exists());

                // Real OS SIGKILL
                Process.killProcess(workerPid);
                ActivityManager am = (ActivityManager) targetCtx.getSystemService(Context.ACTIVITY_SERVICE);
                long killDeadline = SystemClock.elapsedRealtime() + 10_000L;
                boolean workerGone = false;
                while (SystemClock.elapsedRealtime() < killDeadline) {
                    boolean found = false;
                    List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
                    if (procs != null) {
                        for (ActivityManager.RunningAppProcessInfo p : procs) {
                            if (p.pid == workerPid) {
                                found = true;
                                break;
                            }
                        }
                    }
                    if (!found) {
                        workerGone = true;
                        break;
                    }
                    Thread.sleep(50);
                }
                assertTrue(":m6worker must exit after SIGKILL at stage " + stage, workerGone);

                // Verify prior valid backup A and source DB are untouched immediately after SIGKILL
                assertEquals(priorValidSha, sha256File(targetBackup));

                // Restart :m6worker for recovery cleanup
                Intent recoverWorker = new Intent(targetCtx, KanataM6KillableWorkerService.class)
                        .setAction(KanataM6KillableWorkerService.ACTION_CHECK_RECOVERY)
                        .putExtra(KanataM6KillableWorkerService.EXTRA_WORK_DIR, killWorkDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_SPOOL_DIR, spoolDir.getPath())
                        .putExtra(KanataM6KillableWorkerService.EXTRA_TASK_ID, taskId);
                targetCtx.startService(recoverWorker);

                long recDeadline = SystemClock.elapsedRealtime() + 10_000L;
                while (!recoveredFile.exists() && SystemClock.elapsedRealtime() < recDeadline) {
                    Thread.sleep(50);
                }
                assertTrue("Recovery report missing for stage " + stage, recoveredFile.exists());
                JSONObject recJson = new JSONObject(readSmallText(recoveredFile));
                assertEquals(1, recJson.getInt("cleanedTasks"));
                assertFalse("Killed task tmpSpool must be cleaned", tmpSpoolFile.exists());
                assertFalse("Killed task pending journal must be cleaned",
                        new File(spoolDir, ".task-" + taskId + ".pending").exists());
                assertTrue("Other active task tmp must remain untouched", otherTaskTmp.exists());
                assertEquals(priorValidSha, sha256File(targetBackup));
                assertEquals(unrelatedSha, sha256File(unrelatedFile));

                stageResults.put(stage, new JSONObject()
                        .put("killedPid", workerPid)
                        .put("recoveryPid", recJson.getInt("pid"))
                        .put("cleanedTasks", recJson.getInt("cleanedTasks")));
            }

            // Verify source DB intact & baseline backup A still decrypts cleanly
            try (SQLiteDatabase sdb = SQLiteDatabase.openDatabase(srcDbFile.getPath(), rawKey, null, FLAGS_RO, (d, e) -> {}, null)) {
                assertEquals("ok", KanataM6SnapshotOwner.scalar(sdb, "PRAGMA integrity_check"));
                assertEquals(srcDigestWithB,
                        KanataM6SyntheticDataset.computeLogicalFingerprint(sdb, catalog, false).overallDigestHex);
            }
            byte[] verifyKey = randomRawKey();
            File verifyDb = new File(dir, "verify_a.db");
            try {
                try (FileInputStream fis = new FileInputStream(targetBackup)) {
                    KanataM6SchemeCImporter.ImportResult ir = KanataM6SchemeCImporter.importAndVerifyToIsolatedTarget(
                            fis, password, catalog, dir, verifyDb, verifyKey, new AtomicBoolean(false));
                    assertEquals(50, ir.footerVerifiers.size());
                }
            } finally {
                Arrays.fill(verifyKey, (byte) 0);
                SQLiteDatabase.deleteDatabase(verifyDb);
            }

            report("N04_REAL_EXPORTER_SIGKILL", stageResults);
        } finally {
            Arrays.fill(rawKey, (byte) 0);
            SQLiteDatabase.deleteDatabase(srcDbFile);
            deleteRecursive(dir);
            deleteRecursive(killWorkDir);
        }
    }

    private static String readSmallText(File f) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (FileInputStream fis = new FileInputStream(f)) {
            byte[] buf = new byte[512];
            int r;
            while ((r = fis.read(buf)) != -1) baos.write(buf, 0, r);
        }
        return new String(baos.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursive(child);
            }
        }
        f.delete();
    }
}
