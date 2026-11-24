package com.yubin.formyself;

import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.Point;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Real Android DocumentsProvider test implementation for N-04 SAF lifecycle verification.
 * Exposed via android.content.action.DOCUMENTS_PROVIDER so Android's system DocumentsUI
 * (ACTION_OPEN_DOCUMENT / ACTION_CREATE_DOCUMENT) discovers and grants real system URI permissions.
 * Does NOT implement any custom permission map; URI grants/revocations rely strictly on Android OS.
 */
public final class KanataM6SyntheticSafProvider extends DocumentsProvider {
    public static final String AUTHORITY = "com.yubin.formyself.m2qa.documents";
    public static final String ROOT_ID = "kanata-m6-root";
    public static final String ROOT_DOC_ID = "root";
    public static final String ROOT_TITLE = "Kanata Synthetic Docs";

    public enum FaultMode {
        NORMAL,
        SHORT_READ,
        HALF_WRITE_ENOSPC,
        READBACK_CORRUPT,
        PROVIDER_IO_ERROR
    }

    private static final String[] DEFAULT_ROOT_PROJECTION = new String[] {
            DocumentsContract.Root.COLUMN_ROOT_ID,
            DocumentsContract.Root.COLUMN_MIME_TYPES,
            DocumentsContract.Root.COLUMN_FLAGS,
            DocumentsContract.Root.COLUMN_TITLE,
            DocumentsContract.Root.COLUMN_DOCUMENT_ID,
            DocumentsContract.Root.COLUMN_SUMMARY
    };

    private static final String[] DEFAULT_DOCUMENT_PROJECTION = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_FLAGS,
            DocumentsContract.Document.COLUMN_SIZE
    };

    private static final ConcurrentHashMap<String, FaultMode> FAULT_MODES = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, AtomicInteger> OPEN_COUNTS = new ConcurrentHashMap<>();

    public static Uri rootUri() {
        return DocumentsContract.buildDocumentUri(AUTHORITY, ROOT_DOC_ID);
    }

    public static void setFaultMode(String docIdOrName, FaultMode mode) {
        FAULT_MODES.put(docIdOrName, mode);
    }

    public static void resetFaultsAndFiles(android.content.Context context) {
        FAULT_MODES.clear();
        OPEN_COUNTS.clear();
        if (context != null) {
            File dir = rootDirFor(context);
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) f.delete();
            }
        }
    }

    public static int openCount(String docId) {
        AtomicInteger c = OPEN_COUNTS.get(docId);
        return c == null ? 0 : c.get();
    }

    private static File rootDirFor(android.content.Context context) {
        File dir = new File(context.getNoBackupFilesDir(), "m6-saf-documents");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File fileForDocId(String documentId) throws FileNotFoundException {
        if (ROOT_DOC_ID.equals(documentId)) {
            return rootDirFor(getContext());
        }
        if (documentId == null || documentId.isEmpty() || documentId.contains("..") || documentId.contains("/")) {
            throw new FileNotFoundException("Invalid documentId: " + documentId);
        }
        return new File(rootDirFor(getContext()), documentId);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor queryRoots(String[] projection) {
        MatrixCursor result = new MatrixCursor(projection != null ? projection : DEFAULT_ROOT_PROJECTION);
        MatrixCursor.RowBuilder row = result.newRow();
        row.add(DocumentsContract.Root.COLUMN_ROOT_ID, ROOT_ID);
        row.add(DocumentsContract.Root.COLUMN_SUMMARY, "Isolated M6-02 SAF Test Root");
        row.add(DocumentsContract.Root.COLUMN_FLAGS,
                DocumentsContract.Root.FLAG_SUPPORTS_CREATE
                        | DocumentsContract.Root.FLAG_SUPPORTS_IS_CHILD
                        | DocumentsContract.Root.FLAG_LOCAL_ONLY);
        row.add(DocumentsContract.Root.COLUMN_TITLE, ROOT_TITLE);
        row.add(DocumentsContract.Root.COLUMN_DOCUMENT_ID, ROOT_DOC_ID);
        row.add(DocumentsContract.Root.COLUMN_MIME_TYPES, "*/*");
        return result;
    }

    @Override
    public boolean isChildDocument(String parentDocumentId, String documentId) {
        return ROOT_DOC_ID.equals(parentDocumentId)
                && documentId != null
                && !ROOT_DOC_ID.equals(documentId)
                && !documentId.contains("/")
                && !documentId.contains("..");
    }

    @Override
    public Cursor queryDocument(String documentId, String[] projection) throws FileNotFoundException {
        MatrixCursor result = new MatrixCursor(projection != null ? projection : DEFAULT_DOCUMENT_PROJECTION);
        File file = fileForDocId(documentId);
        if (!file.exists()) {
            throw new FileNotFoundException("Missing document: " + documentId);
        }
        includeFile(result, documentId, file);
        return result;
    }

    @Override
    public Cursor queryChildDocuments(String parentDocumentId, String[] projection, String sortOrder)
            throws FileNotFoundException {
        MatrixCursor result = new MatrixCursor(projection != null ? projection : DEFAULT_DOCUMENT_PROJECTION);
        File parent = fileForDocId(parentDocumentId);
        if (!parent.isDirectory()) {
            throw new FileNotFoundException("Not a directory: " + parentDocumentId);
        }
        File[] children = parent.listFiles();
        if (children != null) {
            for (File child : children) {
                includeFile(result, child.getName(), child);
            }
        }
        return result;
    }

    private void includeFile(MatrixCursor result, String docId, File file) {
        int flags = 0;
        String mimeType;
        if (file.isDirectory()) {
            mimeType = DocumentsContract.Document.MIME_TYPE_DIR;
            flags |= DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE;
        } else {
            mimeType = "application/octet-stream";
            flags |= DocumentsContract.Document.FLAG_SUPPORTS_WRITE
                    | DocumentsContract.Document.FLAG_SUPPORTS_DELETE;
        }
        MatrixCursor.RowBuilder row = result.newRow();
        row.add(DocumentsContract.Document.COLUMN_DOCUMENT_ID, docId);
        row.add(DocumentsContract.Document.COLUMN_DISPLAY_NAME, ROOT_DOC_ID.equals(docId) ? ROOT_TITLE : file.getName());
        row.add(DocumentsContract.Document.COLUMN_SIZE, file.isDirectory() ? 0L : file.length());
        row.add(DocumentsContract.Document.COLUMN_MIME_TYPE, mimeType);
        row.add(DocumentsContract.Document.COLUMN_LAST_MODIFIED, file.lastModified());
        row.add(DocumentsContract.Document.COLUMN_FLAGS, flags);
    }

    @Override
    public String createDocument(String parentDocumentId, String mimeType, String displayName)
            throws FileNotFoundException {
        if (!ROOT_DOC_ID.equals(parentDocumentId)) {
            throw new FileNotFoundException("Invalid parent: " + parentDocumentId);
        }
        String safeName = (displayName == null || displayName.trim().isEmpty())
                ? "kanata-doc-" + System.currentTimeMillis() + ".kpb1"
                : displayName.replace('/', '_');
        File file = new File(rootDirFor(getContext()), safeName);
        if (file.exists()) {
            int idx = 1;
            while (file.exists()) {
                file = new File(rootDirFor(getContext()), idx + "_" + safeName);
                idx++;
            }
        }
        try {
            if (!file.createNewFile()) {
                throw new FileNotFoundException("Failed to create document: " + file.getName());
            }
        } catch (IOException e) {
            throw new FileNotFoundException("Create error: " + e.getMessage());
        }
        return file.getName();
    }

    @Override
    public void deleteDocument(String documentId) throws FileNotFoundException {
        File file = fileForDocId(documentId);
        if (ROOT_DOC_ID.equals(documentId) || !file.delete()) {
            throw new FileNotFoundException("Unable to delete: " + documentId);
        }
    }

    @Override
    public AssetFileDescriptor openDocumentThumbnail(
            String documentId, Point sizeHint, CancellationSignal signal) throws FileNotFoundException {
        throw new FileNotFoundException("No thumbnail");
    }

    @Override
    public ParcelFileDescriptor openDocument(String documentId, String mode, CancellationSignal signal)
            throws FileNotFoundException {
        File target = fileForDocId(documentId);
        OPEN_COUNTS.computeIfAbsent(documentId, k -> new AtomicInteger()).incrementAndGet();

        FaultMode fm = FAULT_MODES.getOrDefault(documentId, FaultMode.NORMAL);
        if (fm == FaultMode.PROVIDER_IO_ERROR) {
            throw new FileNotFoundException("Injected provider error on document=" + documentId);
        }

        boolean write = mode != null && mode.contains("w");
        boolean read = mode == null || mode.contains("r") || !write;
        if (read && !write && fm == FaultMode.SHORT_READ) {
            return openShortReadPipe(target);
        }
        if (read && !write && fm == FaultMode.READBACK_CORRUPT) {
            return openCorruptedReadbackPipe(target);
        }
        if (write && fm == FaultMode.HALF_WRITE_ENOSPC) {
            return openHalfWriteFailingPipe(target);
        }

        int pfdMode = ParcelFileDescriptor.parseMode(mode != null ? mode : "r");
        try {
            return ParcelFileDescriptor.open(target, pfdMode, new Handler(getContext().getMainLooper()), e -> {});
        } catch (IOException e) {
            return ParcelFileDescriptor.open(target, pfdMode);
        }
    }

    private ParcelFileDescriptor openShortReadPipe(File source) throws FileNotFoundException {
        if (!source.exists()) throw new FileNotFoundException(source.getPath());
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createReliablePipe();
            Thread t = new Thread(() -> {
                try (ParcelFileDescriptor.AutoCloseOutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]);
                     InputStream in = new FileInputStream(source)) {
                    byte[] small = new byte[13];
                    int n;
                    while ((n = in.read(small)) != -1) {
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
                     InputStream in = new FileInputStream(source)) {
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
            OutputStream fos = new FileOutputStream(target);
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
}
