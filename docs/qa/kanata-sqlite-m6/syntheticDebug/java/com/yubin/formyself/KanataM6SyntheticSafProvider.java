package com.yubin.formyself;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.UriMatcher;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Isolated synthetic ContentProvider mimicking SAF document URIs, permission grant/revocation,
 * short reads, zero-progress reads, half-writes, ENOSPC, and readback corruption faults.
 */
public final class KanataM6SyntheticSafProvider extends ContentProvider {
    public static final String AUTHORITY = "com.yubin.formyself.m2qa.saf";
    public static final Uri BASE_URI = Uri.parse("content://" + AUTHORITY + "/doc");

    public enum FaultMode {
        NORMAL,
        REVOKED,
        SHORT_READ,
        HALF_WRITE_ENOSPC,
        READBACK_CORRUPT
    }

    private static final ConcurrentHashMap<String, Integer> GRANTED_MODES = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, FaultMode> FAULT_MODES = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, AtomicInteger> OPEN_COUNTS = new ConcurrentHashMap<>();

    public static Uri uriForDoc(String docId) {
        return BASE_URI.buildUpon().appendPath(docId).build();
    }

    public static void grantDoc(String docId, int modeFlags) {
        GRANTED_MODES.put(docId, modeFlags);
    }

    public static void revokeDoc(String docId) {
        GRANTED_MODES.remove(docId);
    }

    public static void setFaultMode(String docId, FaultMode mode) {
        FAULT_MODES.put(docId, mode);
    }

    public static void resetAll() {
        GRANTED_MODES.clear();
        FAULT_MODES.clear();
        OPEN_COUNTS.clear();
    }

    public static int openCount(String docId) {
        AtomicInteger c = OPEN_COUNTS.get(docId);
        return c == null ? 0 : c.get();
    }

    private File docFile(String docId) {
        File dir = new File(getContext().getCacheDir(), "m6-saf-provider-docs");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, docId);
    }

    private String docIdFromUri(Uri uri) {
        String id = uri.getLastPathSegment();
        if (id == null || id.contains("..") || id.contains("/")) {
            throw new SecurityException("Invalid docId");
        }
        return id;
    }

    private void checkGrant(String docId, int requiredFlag) {
        FaultMode fm = FAULT_MODES.getOrDefault(docId, FaultMode.NORMAL);
        if (fm == FaultMode.REVOKED) {
            throw new SecurityException("SAF URI permission revoked (fault)");
        }
        Integer granted = GRANTED_MODES.get(docId);
        if (granted == null || (granted & requiredFlag) != requiredFlag) {
            throw new SecurityException("SAF URI permission denied for doc=" + docId);
        }
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        String docId = docIdFromUri(uri);
        boolean write = mode.contains("w");
        boolean read = mode.contains("r") || !write;
        if (write) checkGrant(docId, android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (read && !write) checkGrant(docId, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        OPEN_COUNTS.computeIfAbsent(docId, k -> new AtomicInteger()).incrementAndGet();

        FaultMode fm = FAULT_MODES.getOrDefault(docId, FaultMode.NORMAL);
        File target = docFile(docId);

        if (read && !write && fm == FaultMode.SHORT_READ) {
            return openShortReadPipe(target, docId);
        }
        if (read && !write && fm == FaultMode.READBACK_CORRUPT) {
            return openCorruptedReadbackPipe(target);
        }
        if (write && fm == FaultMode.HALF_WRITE_ENOSPC) {
            return openHalfWriteFailingPipe(target);
        }

        int pfdMode = ParcelFileDescriptor.parseMode(mode);
        return ParcelFileDescriptor.open(target, pfdMode);
    }

    private ParcelFileDescriptor openShortReadPipe(File source, String docId) throws FileNotFoundException {
        if (!source.exists()) throw new FileNotFoundException(source.getPath());
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createReliablePipe();
            Thread t = new Thread(() -> {
                try (ParcelFileDescriptor.AutoCloseOutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]);
                     InputStream in = new java.io.FileInputStream(source)) {
                    byte[] small = new byte[13]; // Force tiny 13-byte short reads across frame headers & payloads
                    int n;
                    while ((n = in.read(small)) != -1) {
                        if (FAULT_MODES.getOrDefault(docId, FaultMode.NORMAL) == FaultMode.REVOKED) {
                            pipe[1].closeWithError("URI permission revoked mid-read");
                            return;
                        }
                        out.write(small, 0, n);
                        out.flush();
                    }
                } catch (IOException ignored) {}
            }, "m6-saf-short-read");
            t.start();
            return pipe[0];
        } catch (IOException e) {
            throw new FileNotFoundException("pipe failed: " + e.getMessage());
        }
    }

    private ParcelFileDescriptor openCorruptedReadbackPipe(File source) throws FileNotFoundException {
        if (!source.exists()) throw new FileNotFoundException(source.getPath());
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createReliablePipe();
            Thread t = new Thread(() -> {
                try (ParcelFileDescriptor.AutoCloseOutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]);
                     InputStream in = new java.io.FileInputStream(source)) {
                    byte[] buf = new byte[4096];
                    int n;
                    boolean flipped = false;
                    while ((n = in.read(buf)) != -1) {
                        if (!flipped && n > 10) {
                            buf[10] ^= 0x55;
                            flipped = true;
                        }
                        out.write(buf, 0, n);
                    }
                    out.flush();
                } catch (IOException ignored) {}
            }, "m6-saf-corrupt-readback");
            t.start();
            return pipe[0];
        } catch (IOException e) {
            throw new FileNotFoundException("pipe failed: " + e.getMessage());
        }
    }

    private ParcelFileDescriptor openHalfWriteFailingPipe(File target) throws FileNotFoundException {
        try {
            OutputStream fos = new java.io.FileOutputStream(target);
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createReliablePipe();
            Thread t = new Thread(() -> {
                long written = 0L;
                try (ParcelFileDescriptor.AutoCloseInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pipe[0]);
                     OutputStream outFile = fos) {
                    byte[] buf = new byte[512];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        int allow = (int) Math.min(n, Math.max(0L, 1024L - written));
                        if (allow > 0) {
                            outFile.write(buf, 0, allow);
                            written += allow;
                        }
                        if (written >= 1024L) {
                            outFile.flush();
                            pipe[0].closeWithError("ENOSPC: simulated provider disk full at 1 KiB");
                            return;
                        }
                    }
                } catch (IOException ignored) {}
            }, "m6-saf-half-write");
            t.start();
            return pipe[1];
        } catch (IOException e) {
            throw new FileNotFoundException("pipe failed: " + e.getMessage());
        }
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        String docId = docIdFromUri(uri);
        checkGrant(docId, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        File f = docFile(docId);
        MatrixCursor mc = new MatrixCursor(new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE });
        mc.addRow(new Object[] { docId, f.exists() ? f.length() : 0L });
        return mc;
    }

    @Override
    public String getType(Uri uri) {
        return "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        String docId = docIdFromUri(uri);
        checkGrant(docId, android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        return docFile(docId).delete() ? 1 : 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
