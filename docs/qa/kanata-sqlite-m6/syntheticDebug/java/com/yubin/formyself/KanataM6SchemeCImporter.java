package com.yubin.formyself;

import android.database.Cursor;
import android.os.Process;
import android.system.ErrnoException;
import android.system.Os;
import android.system.StructStat;

import net.zetetic.database.sqlcipher.SQLiteDatabase;
import net.zetetic.database.sqlcipher.SQLiteStatement;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Isolated Scheme C KPB1 importer & Schema 005 target SQLCipher verifier.
 * Strictly experimental sink: never touches product RestoreCoordinator or canonical databases.
 */
public final class KanataM6SchemeCImporter {
    public static final class ImportResult {
        public final int dataFrameCount;
        public final long totalPlaintextBytes;
        public final long totalCiphertextBytes;
        public final long totalBusinessRows;
        public final String transcriptHex;
        public final List<KanataM6SchemeCExporter.Verifier> footerVerifiers;

        ImportResult(
                int dataFrameCount,
                long totalPlaintextBytes,
                long totalCiphertextBytes,
                long totalBusinessRows,
                String transcriptHex,
                List<KanataM6SchemeCExporter.Verifier> footerVerifiers) {
            this.dataFrameCount = dataFrameCount;
            this.totalPlaintextBytes = totalPlaintextBytes;
            this.totalCiphertextBytes = totalCiphertextBytes;
            this.totalBusinessRows = totalBusinessRows;
            this.transcriptHex = transcriptHex;
            this.footerVerifiers = footerVerifiers;
        }
    }

    private static final class BoundedStreamReader {
        private final InputStream in;
        private final AtomicBoolean cancelled;

        BoundedStreamReader(InputStream in, AtomicBoolean cancelled) {
            this.in = in;
            this.cancelled = cancelled;
        }

        byte[] readExact(int len) {
            KanataM6PortableCrypto.checkCancelled(cancelled);
            byte[] out = new byte[len];
            int filled = 0;
            int zeroReads = 0;
            try {
                while (filled < len) {
                    KanataM6PortableCrypto.checkCancelled(cancelled);
                    int r = in.read(out, filled, len - filled);
                    if (r == -1) {
                        Arrays.fill(out, (byte) 0);
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "unexpected-eof");
                    }
                    if (r == 0) {
                        zeroReads++;
                        KanataM6PortableCrypto.requirePortable(
                                zeroReads < KanataM6PortableCrypto.MAX_ZERO_PROGRESS_READS,
                                KanataM6PortableCrypto.ERR_IO_FAILED, "reader-zero-progress");
                    } else {
                        zeroReads = 0;
                        filled += r;
                    }
                }
                return out;
            } catch (KanataM6PortableCrypto.PortableException pe) {
                Arrays.fill(out, (byte) 0);
                throw pe;
            } catch (IOException ioe) {
                Arrays.fill(out, (byte) 0);
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "reader-io", ioe);
            }
        }

        void assertEof() {
            KanataM6PortableCrypto.checkCancelled(cancelled);
            byte[] probe = new byte[1];
            int zeroReads = 0;
            try {
                while (true) {
                    KanataM6PortableCrypto.checkCancelled(cancelled);
                    int r = in.read(probe, 0, 1);
                    if (r == -1) return;
                    if (r == 0) {
                        zeroReads++;
                        KanataM6PortableCrypto.requirePortable(
                                zeroReads < KanataM6PortableCrypto.MAX_ZERO_PROGRESS_READS,
                                KanataM6PortableCrypto.ERR_IO_FAILED, "reader-zero-progress");
                    } else {
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "trailing-data");
                    }
                }
            } catch (KanataM6PortableCrypto.PortableException pe) {
                throw pe;
            } catch (IOException ioe) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "reader-eof-io", ioe);
            }
        }
    }

    private static final class FrameHeader {
        final int streamId;
        final int type;
        final int flags;
        final long index;
        final int plainLen;
        final int cipherLen;

        FrameHeader(byte[] b) {
            this.streamId = KanataM6PortableCrypto.readU16BE(b, 0);
            this.type = b[2] & 0xff;
            this.flags = b[3] & 0xff;
            this.index = KanataM6PortableCrypto.readU64BE(b, 4);
            long pl = KanataM6PortableCrypto.readU32BE(b, 12);
            long cl = KanataM6PortableCrypto.readU32BE(b, 16);
            KanataM6PortableCrypto.requirePortable(
                    pl <= KanataM6PortableCrypto.FRAME_LIMIT
                            && cl <= KanataM6PortableCrypto.FRAME_LIMIT + KanataM6PortableCrypto.TAG_SIZE,
                    KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "frame-limit");
            KanataM6PortableCrypto.requirePortable(
                    cl == pl + KanataM6PortableCrypto.TAG_SIZE,
                    KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "frame-cipher-len");
            this.plainLen = (int) pl;
            this.cipherLen = (int) cl;
        }
    }

    public interface ImportHooks {
        default void beforeStagingInstall(File targetStageFile) throws Exception {}
        default void afterInstallBeforeVerify(SQLiteDatabase targetStageDb) throws Exception {}
        default void afterStagingVerified(File targetStageFile) throws Exception {}
        default void afterTargetLockAcquiredBeforeCommit(File targetStageFile, File targetDbFile) throws Exception {}
        default void beforeImportJournalRename(String nextState, File tmpJournalFile, File journalFile) throws Exception {}
        default void beforeTargetCommit(File targetStageFile, File targetDbFile) throws Exception {}
        default void performAtomicTargetCommit(File targetStageFile, File targetDbFile) throws Exception {
            defaultAtomicRenameOnly(targetStageFile, targetDbFile);
        }
        default void afterTargetRenameBeforeJournalUpdate(File targetDbFile, File importJournalFile) throws Exception {}
        default void performTargetDirFsync(File targetParentDir) throws Exception {
            KanataM6SchemeCExporter.fsyncDirectoryStrict(targetParentDir);
        }
    }

    public interface ImportRecoveryHooks {
        default void performTargetDirFsync(File targetParentDir) throws IOException {
            KanataM6SchemeCExporter.fsyncDirectoryStrict(targetParentDir);
        }
        default void afterTargetLockAcquired(String importTaskId, File targetDbFile) throws IOException {}
        default void beforeJournalDelete(String importTaskId, File journal) throws IOException {}
    }

    public static final class ImportRecoveryReport {
        public final int scannedJournals;
        public final int cleanedTasks;
        public final int confirmedCommitTasks;
        public final int unconfirmedCommitTasks;
        public final int rejectedUntrustedJournals;
        public final List<String> cleanedTaskIds;
        public final List<String> skippedActiveTaskIds;
        public final List<String> confirmedCommitTaskIds;
        public final List<String> unconfirmedCommitTaskIds;
        public final List<String> rejectedJournalNames;

        ImportRecoveryReport(
                int scannedJournals,
                int cleanedTasks,
                int confirmedCommitTasks,
                int unconfirmedCommitTasks,
                int rejectedUntrustedJournals,
                List<String> cleanedTaskIds,
                List<String> skippedActiveTaskIds,
                List<String> confirmedCommitTaskIds,
                List<String> unconfirmedCommitTaskIds,
                List<String> rejectedJournalNames) {
            this.scannedJournals = scannedJournals;
            this.cleanedTasks = cleanedTasks;
            this.confirmedCommitTasks = confirmedCommitTasks;
            this.unconfirmedCommitTasks = unconfirmedCommitTasks;
            this.rejectedUntrustedJournals = rejectedUntrustedJournals;
            this.cleanedTaskIds = cleanedTaskIds;
            this.skippedActiveTaskIds = skippedActiveTaskIds;
            this.confirmedCommitTaskIds = confirmedCommitTaskIds;
            this.unconfirmedCommitTaskIds = unconfirmedCommitTaskIds;
            this.rejectedJournalNames = rejectedJournalNames;
        }
    }

    private static final class CommitLockSlot {
        final ReentrantLock mutex = new ReentrantLock(true);
        int refs = 0;
    }

    private static final ConcurrentHashMap<String, CommitLockSlot> TARGET_COMMIT_LOCKS =
            new ConcurrentHashMap<>();

    private static File canonicalTargetFile(File f) throws IOException {
        try {
            return f.getCanonicalFile();
        } catch (IOException e) {
            return f.getAbsoluteFile();
        }
    }

    private static File lockFileForTarget(File canonTarget) throws Exception {
        File parent = canonTarget.getParentFile();
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] hash = md.digest(canonTarget.getPath().getBytes(StandardCharsets.UTF_8));
        String hex = KanataM6PortableCrypto.bytesToHex(hash).substring(0, 24);
        return new File(parent, ".kanata-import-" + hex + ".lock");
    }

    public static boolean hasActiveCommitLock(File targetDbFile) throws Exception {
        File canon = canonicalTargetFile(targetDbFile);
        if (TARGET_COMMIT_LOCKS.containsKey(canon.getPath())) return true;
        File lf = lockFileForTarget(canon);
        return lf.exists();
    }

    private static final class TargetCommitLockHandle implements AutoCloseable {
        private final String key;
        private final CommitLockSlot slot;
        private final File lockFile;
        private final RandomAccessFile raf;
        private final FileLock fileLock;
        private final long lockDev;
        private final long lockIno;

        TargetCommitLockHandle(
                String key,
                CommitLockSlot slot,
                File lockFile,
                RandomAccessFile raf,
                FileLock fileLock,
                long lockDev,
                long lockIno) {
            this.key = key;
            this.slot = slot;
            this.lockFile = lockFile;
            this.raf = raf;
            this.fileLock = fileLock;
            this.lockDev = lockDev;
            this.lockIno = lockIno;
        }

        boolean isStillLiveInode() {
            try {
                StructStat fdStat = Os.fstat(raf.getFD());
                StructStat pathStat = Os.stat(lockFile.getPath());
                return fdStat.st_dev == lockDev
                        && fdStat.st_ino == lockIno
                        && fdStat.st_dev == pathStat.st_dev
                        && fdStat.st_ino == pathStat.st_ino;
            } catch (Throwable ignored) {
                return false;
            }
        }

        @Override
        public void close() {
            try {
                if (isStillLiveInode()) {
                    lockFile.delete();
                }
            } catch (Throwable ignored) {}
            if (fileLock != null) {
                try {
                    fileLock.release();
                } catch (Throwable ignored) {}
            }
            if (raf != null) {
                try {
                    raf.close();
                } catch (Throwable ignored) {}
            }
            synchronized (TARGET_COMMIT_LOCKS) {
                slot.refs--;
                if (slot.refs <= 0) {
                    TARGET_COMMIT_LOCKS.remove(key, slot);
                }
            }
            slot.mutex.unlock();
        }
    }

    private static TargetCommitLockHandle acquireTargetCommitLock(File targetAbs, AtomicBoolean cancelled) throws Exception {
        KanataM6PortableCrypto.checkCancelled(cancelled);
        File canon = canonicalTargetFile(targetAbs);
        String key = canon.getPath();
        File lockFile = lockFileForTarget(canon);
        CommitLockSlot slot;
        synchronized (TARGET_COMMIT_LOCKS) {
            slot = TARGET_COMMIT_LOCKS.get(key);
            if (slot == null) {
                slot = new CommitLockSlot();
                TARGET_COMMIT_LOCKS.put(key, slot);
            }
            slot.refs++;
        }
        boolean mutexLocked = false;
        boolean acquired = false;
        try {
            while (!mutexLocked) {
                KanataM6PortableCrypto.checkCancelled(cancelled);
                try {
                    mutexLocked = slot.mutex.tryLock(50L, TimeUnit.MILLISECONDS);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new KanataM6PortableCrypto.PortableException(
                            KanataM6PortableCrypto.ERR_CANCELLED, "lock-interrupted", ie);
                }
            }
            while (true) {
                KanataM6PortableCrypto.checkCancelled(cancelled);
                RandomAccessFile raf = new RandomAccessFile(lockFile, "rw");
                FileLock fl = null;
                boolean ok = false;
                try {
                    try {
                        fl = raf.getChannel().tryLock();
                    } catch (OverlappingFileLockException ofle) {
                        fl = null;
                    }
                    if (fl != null) {
                        try {
                            StructStat fdStat = Os.fstat(raf.getFD());
                            StructStat pathStat = Os.stat(lockFile.getPath());
                            if (fdStat.st_dev == pathStat.st_dev && fdStat.st_ino == pathStat.st_ino) {
                                ok = true;
                                acquired = true;
                                return new TargetCommitLockHandle(key, slot, lockFile, raf, fl, fdStat.st_dev, fdStat.st_ino);
                            }
                        } catch (ErrnoException ignored) {
                            // Unlinked concurrently in another process; retry on fresh inode.
                        }
                    }
                } finally {
                    if (!ok) {
                        if (fl != null) {
                            try { fl.release(); } catch (Throwable ignored) {}
                        }
                        try { raf.close(); } catch (Throwable ignored) {}
                    }
                }
                if (fl == null) {
                    try {
                        Thread.sleep(15L);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_CANCELLED, "lock-wait-interrupted", ie);
                    }
                }
            }
        } finally {
            if (!acquired) {
                synchronized (TARGET_COMMIT_LOCKS) {
                    slot.refs--;
                    if (slot.refs <= 0) {
                        TARGET_COMMIT_LOCKS.remove(key, slot);
                    }
                }
                if (mutexLocked) {
                    slot.mutex.unlock();
                }
            }
        }
    }

    private static TargetCommitLockHandle tryAcquireTargetCommitLock(File targetAbs) throws Exception {
        File canon = canonicalTargetFile(targetAbs);
        String key = canon.getPath();
        File lockFile = lockFileForTarget(canon);
        CommitLockSlot slot;
        synchronized (TARGET_COMMIT_LOCKS) {
            slot = TARGET_COMMIT_LOCKS.get(key);
            if (slot == null) {
                slot = new CommitLockSlot();
                TARGET_COMMIT_LOCKS.put(key, slot);
            }
            slot.refs++;
        }
        if (!slot.mutex.tryLock()) {
            synchronized (TARGET_COMMIT_LOCKS) {
                slot.refs--;
                if (slot.refs <= 0) {
                    TARGET_COMMIT_LOCKS.remove(key, slot);
                }
            }
            return null;
        }
        boolean acquired = false;
        try {
            for (int attempt = 0; attempt < 16; attempt++) {
                RandomAccessFile raf = new RandomAccessFile(lockFile, "rw");
                FileLock fl = null;
                boolean ok = false;
                try {
                    try {
                        fl = raf.getChannel().tryLock();
                    } catch (OverlappingFileLockException ofle) {
                        fl = null;
                    }
                    if (fl == null) {
                        return null;
                    }
                    try {
                        StructStat fdStat = Os.fstat(raf.getFD());
                        StructStat pathStat = Os.stat(lockFile.getPath());
                        if (fdStat.st_dev == pathStat.st_dev && fdStat.st_ino == pathStat.st_ino) {
                            ok = true;
                            acquired = true;
                            return new TargetCommitLockHandle(key, slot, lockFile, raf, fl, fdStat.st_dev, fdStat.st_ino);
                        }
                    } catch (ErrnoException ignored) {
                        // Unlinked concurrently by departing owner; retry on live inode.
                    }
                } finally {
                    if (!ok) {
                        if (fl != null) {
                            try { fl.release(); } catch (Throwable ignored) {}
                        }
                        try { raf.close(); } catch (Throwable ignored) {}
                    }
                }
            }
            return null;
        } finally {
            if (!acquired) {
                synchronized (TARGET_COMMIT_LOCKS) {
                    slot.refs--;
                    if (slot.refs <= 0) {
                        TARGET_COMMIT_LOCKS.remove(key, slot);
                    }
                }
                slot.mutex.unlock();
            }
        }
    }

    private static String sanitizeImportTaskId(String explicitTaskId) {
        if (explicitTaskId == null || explicitTaskId.isEmpty()) {
            return "imp-" + UUID.randomUUID();
        }
        if (explicitTaskId.contains("..") || !explicitTaskId.matches("[A-Za-z0-9._-]+")) {
            throw new KanataM6PortableCrypto.PortableException(
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "invalid-import-task-id");
        }
        return explicitTaskId;
    }

    private static StructStat writeImportJournalAtomic(
            File importJournal,
            File journalDir,
            String importTaskId,
            String state,
            File targetStageFile,
            File targetDbFile,
            String expectedSha256Hex,
            boolean syncJournalDir,
            ImportHooks hooks) throws IOException {
        try {
            if (expectedSha256Hex == null || expectedSha256Hex.isEmpty()) {
                throw new IOException("import-journal-missing-expected-sha:" + state);
            }
            JSONObject obj = new JSONObject()
                    .put("taskId", importTaskId)
                    .put("kind", "IMPORT")
                    .put("pid", Process.myPid())
                    .put("state", state)
                    .put("stagePath", targetStageFile.getCanonicalPath())
                    .put("targetPath", targetDbFile.getCanonicalPath())
                    .put("expectedSha256Hex", expectedSha256Hex);
            byte[] bytes = obj.toString().getBytes(StandardCharsets.UTF_8);
            File tmpNext = new File(journalDir, importJournal.getName() + ".next");
            try (FileOutputStream fos = new FileOutputStream(tmpNext, false)) {
                fos.write(bytes);
                fos.flush();
                fos.getFD().sync();
            }
            if (hooks != null) {
                hooks.beforeImportJournalRename(state, tmpNext, importJournal);
            }
            try {
                Os.rename(tmpNext.getAbsolutePath(), importJournal.getAbsolutePath());
            } catch (ErrnoException e) {
                tmpNext.delete();
                throw new IOException("import-journal-rename-failed(" + e.errno + "): " + e.getMessage(), e);
            }
            if (syncJournalDir) {
                KanataM6SchemeCExporter.fsyncDirectoryStrict(journalDir);
            }
            return KanataM6SchemeCExporter.lstatOrNull(importJournal);
        } catch (Exception e) {
            if (e instanceof IOException) throw (IOException) e;
            throw new IOException("import-journal-write", e);
        }
    }

    public static ImportRecoveryReport recoverIncompleteImports(File... dirs) {
        return recoverIncompleteImports((ImportRecoveryHooks) null, dirs);
    }

    /**
     * Startup recovery for incomplete or post-rename durability-unconfirmed Scheme C imports.
     * Uses canonical directory containment, Task ID binding, target commit mutex serialization,
     * and joint (expectedSha256Hex + staging file + target DB) verification.
     * Preserves UNCONFIRMED state whenever commit status cannot be proven; completely idempotent.
     */
    public static ImportRecoveryReport recoverIncompleteImports(ImportRecoveryHooks hooks, File... dirs) {
        int scanned = 0;
        int cleaned = 0;
        int confirmedCommits = 0;
        int unconfirmedCommits = 0;
        int rejectedUntrusted = 0;
        List<String> cleanedIds = new ArrayList<>();
        List<String> skippedIds = new ArrayList<>();
        List<String> confirmedIds = new ArrayList<>();
        List<String> unconfirmedIds = new ArrayList<>();
        List<String> rejectedNames = new ArrayList<>();
        if (dirs == null) {
            return new ImportRecoveryReport(0, 0, 0, 0, 0, cleanedIds, skippedIds, confirmedIds, unconfirmedIds, rejectedNames);
        }

        Set<File> allowedCanonDirs = new HashSet<>();
        for (File d : dirs) {
            if (d != null && d.isDirectory()) {
                try {
                    allowedCanonDirs.add(d.getCanonicalFile());
                } catch (IOException ignored) {}
            }
        }

        for (File dir : dirs) {
            if (dir == null || !dir.isDirectory()) continue;
            final File dirCanon;
            try {
                dirCanon = dir.getCanonicalFile();
            } catch (IOException e) {
                continue;
            }
            File[] files = dir.listFiles((d, name) -> name.startsWith(".import-") && name.endsWith(".pending"));
            if (files != null) {
                for (File journal : files) {
                    String name = journal.getName();
                    String tid = name.substring(".import-".length(), name.length() - ".pending".length());
                    if (tid.isEmpty() || tid.contains("..") || !tid.matches("[A-Za-z0-9._-]+")) {
                        scanned++;
                        rejectedUntrusted++;
                        rejectedNames.add(name);
                        continue;
                    }
                    // Pre-read targetPath strictly to derive the canonical target commit mutex;
                    // all authoritative validation & mutation happens AFTER acquiring the commit mutex!
                    File preliminaryTarget;
                    try {
                        byte[] preRaw = KanataM6SchemeCExporter.readSmallFileBounded(journal, 65536);
                        JSONObject preObj = new JSONObject(new String(preRaw, StandardCharsets.UTF_8));
                        String preTid = preObj.optString("taskId", "");
                        String preTarget = preObj.isNull("targetPath") ? "" : preObj.optString("targetPath", "");
                        if (!tid.equals(preTid) || preTarget.isEmpty() || preTarget.contains("..") || !new File(preTarget).isAbsolute()) {
                            scanned++;
                            rejectedUntrusted++;
                            rejectedNames.add(name);
                            continue;
                        }
                        preliminaryTarget = new File(preTarget).getCanonicalFile();
                        if (preliminaryTarget.getParentFile() == null
                                || !allowedCanonDirs.contains(preliminaryTarget.getParentFile())) {
                            scanned++;
                            rejectedUntrusted++;
                            rejectedNames.add(name);
                            continue;
                        }
                    } catch (Throwable preErr) {
                        scanned++;
                        rejectedUntrusted++;
                        rejectedNames.add(name);
                        continue;
                    }

                    try (TargetCommitLockHandle commitLock = tryAcquireTargetCommitLock(preliminaryTarget)) {
                        if (commitLock == null) {
                            scanned++;
                            skippedIds.add(tid);
                            continue;
                        }
                        if (!journal.exists()) {
                            continue;
                        }
                        StructStat journalStat = KanataM6SchemeCExporter.lstatOrNull(journal);
                        if (journalStat == null) {
                            continue;
                        }
                        scanned++;
                        if (hooks != null) {
                            hooks.afterTargetLockAcquired(tid, preliminaryTarget);
                        }
                        try {
                            byte[] raw = KanataM6SchemeCExporter.readSmallFileBounded(journal, 65536);
                            JSONObject obj = new JSONObject(new String(raw, StandardCharsets.UTF_8));
                            String jsonTid = obj.optString("taskId", "");
                            String state = obj.optString("state", "");
                            String stagePath = obj.isNull("stagePath") ? "" : obj.optString("stagePath", "");
                            String targetPath = obj.isNull("targetPath") ? "" : obj.optString("targetPath", "");
                            String expectedSha = obj.isNull("expectedSha256Hex") ? "" : obj.optString("expectedSha256Hex", "");

                            if (!tid.equals(jsonTid) || state.isEmpty()
                                    || stagePath.isEmpty() || stagePath.contains("..") || !new File(stagePath).isAbsolute()
                                    || targetPath.isEmpty() || targetPath.contains("..") || !new File(targetPath).isAbsolute()) {
                                rejectedUntrusted++;
                                rejectedNames.add(name);
                                continue;
                            }
                            File canonStage = new File(stagePath).getCanonicalFile();
                            File canonTarget = new File(targetPath).getCanonicalFile();
                            File targetParent = canonTarget.getParentFile();
                            if (!preliminaryTarget.equals(canonTarget)
                                    || targetParent == null || !allowedCanonDirs.contains(targetParent)
                                    || !dirCanon.equals(canonStage.getParentFile())
                                    || !canonStage.getName().startsWith(".stage-target-" + tid + "-")
                                    || !canonStage.getName().endsWith(".db")) {
                                rejectedUntrusted++;
                                rejectedNames.add(name);
                                continue;
                            }

                            StructStat stageStat = KanataM6SchemeCExporter.lstatOrNull(canonStage);
                            File pendingNext = new File(dirCanon, name + ".next");

                            if ("RENAMED_PENDING_DIR_SYNC".equals(state)) {
                                if (!canonTarget.exists() || expectedSha.isEmpty()) {
                                    unconfirmedCommits++;
                                    unconfirmedIds.add(tid);
                                    continue;
                                }
                                String actualSha = KanataM6SchemeCExporter.computeFileSha256Hex(canonTarget);
                                if (!expectedSha.equals(actualSha)) {
                                    unconfirmedCommits++;
                                    unconfirmedIds.add(tid);
                                    continue;
                                }
                                try {
                                    if (hooks != null) {
                                        hooks.performTargetDirFsync(targetParent);
                                    } else {
                                        KanataM6SchemeCExporter.fsyncDirectoryStrict(targetParent);
                                    }
                                    if (stageStat != null && !canonStage.equals(canonTarget)
                                            && KanataM6SchemeCExporter.sameInode(canonStage, stageStat)) {
                                        SQLiteDatabase.deleteDatabase(canonStage);
                                    }
                                    if (pendingNext.exists() && commitLock.isStillLiveInode()) {
                                        pendingNext.delete();
                                    }
                                    if (hooks != null) {
                                        hooks.beforeJournalDelete(tid, journal);
                                    }
                                    if (KanataM6SchemeCExporter.sameInode(journal, journalStat)) {
                                        journal.delete();
                                        KanataM6SchemeCExporter.fsyncDirectoryStrict(dirCanon);
                                    }
                                    confirmedCommits++;
                                    confirmedIds.add(tid);
                                } catch (IOException dirSyncErr) {
                                    unconfirmedCommits++;
                                    unconfirmedIds.add(tid);
                                }
                            } else if ("VERIFIED_READY_TO_COMMIT".equals(state)) {
                                if (!canonStage.exists()) {
                                    // Staged DB is gone: check whether rename to canonTarget already completed!
                                    if (!canonTarget.exists() || expectedSha.isEmpty()) {
                                        unconfirmedCommits++;
                                        unconfirmedIds.add(tid);
                                        continue;
                                    }
                                    String actualSha = KanataM6SchemeCExporter.computeFileSha256Hex(canonTarget);
                                    if (!expectedSha.equals(actualSha)) {
                                        unconfirmedCommits++;
                                        unconfirmedIds.add(tid);
                                        continue;
                                    }
                                    try {
                                        if (hooks != null) {
                                            hooks.performTargetDirFsync(targetParent);
                                        } else {
                                            KanataM6SchemeCExporter.fsyncDirectoryStrict(targetParent);
                                        }
                                        if (pendingNext.exists() && commitLock.isStillLiveInode()) {
                                            pendingNext.delete();
                                        }
                                        if (hooks != null) {
                                            hooks.beforeJournalDelete(tid, journal);
                                        }
                                        if (KanataM6SchemeCExporter.sameInode(journal, journalStat)) {
                                            journal.delete();
                                            KanataM6SchemeCExporter.fsyncDirectoryStrict(dirCanon);
                                        }
                                        confirmedCommits++;
                                        confirmedIds.add(tid);
                                    } catch (IOException dirSyncErr) {
                                        unconfirmedCommits++;
                                        unconfirmedIds.add(tid);
                                    }
                                } else {
                                    // Staged DB still exists: validate expected digest & target state before cleaning.
                                    if (expectedSha.isEmpty()) {
                                        unconfirmedCommits++;
                                        unconfirmedIds.add(tid);
                                        continue;
                                    }
                                    String stageSha = KanataM6SchemeCExporter.computeFileSha256Hex(canonStage);
                                    if (!expectedSha.equals(stageSha)) {
                                        unconfirmedCommits++;
                                        unconfirmedIds.add(tid);
                                        continue;
                                    }
                                    if (canonTarget.exists()
                                            && expectedSha.equals(KanataM6SchemeCExporter.computeFileSha256Hex(canonTarget))) {
                                        unconfirmedCommits++;
                                        unconfirmedIds.add(tid);
                                        continue;
                                    }
                                    if (stageStat != null && KanataM6SchemeCExporter.sameInode(canonStage, stageStat)) {
                                        SQLiteDatabase.deleteDatabase(canonStage);
                                    }
                                    if (pendingNext.exists() && commitLock.isStillLiveInode()) {
                                        pendingNext.delete();
                                    }
                                    if (hooks != null) {
                                        hooks.beforeJournalDelete(tid, journal);
                                    }
                                    if (KanataM6SchemeCExporter.sameInode(journal, journalStat)) {
                                        journal.delete();
                                        KanataM6SchemeCExporter.fsyncDirectoryStrict(dirCanon);
                                    }
                                    cleaned++;
                                    cleanedIds.add(tid);
                                }
                            } else if ("COMMITTED".equals(state)) {
                                if (pendingNext.exists() && commitLock.isStillLiveInode()) {
                                    pendingNext.delete();
                                }
                                if (hooks != null) {
                                    hooks.beforeJournalDelete(tid, journal);
                                }
                                if (KanataM6SchemeCExporter.sameInode(journal, journalStat)) {
                                    journal.delete();
                                    KanataM6SchemeCExporter.fsyncDirectoryStrict(dirCanon);
                                }
                                confirmedCommits++;
                                confirmedIds.add(tid);
                            } else {
                                rejectedUntrusted++;
                                rejectedNames.add(name);
                            }
                        } catch (Throwable parseOrIo) {
                            rejectedUntrusted++;
                            rejectedNames.add(name);
                        }
                    } catch (Throwable ignored) {}
                }
            }
        }
        return new ImportRecoveryReport(
                scanned, cleaned, confirmedCommits, unconfirmedCommits, rejectedUntrusted,
                cleanedIds, skippedIds, confirmedIds, unconfirmedIds, rejectedNames);
    }

    private KanataM6SchemeCImporter() {}

    private static boolean hasDatabaseOrSidecar(File dbFile) {
        File abs = dbFile.getAbsoluteFile();
        return abs.exists()
                || new File(abs.getPath() + "-wal").exists()
                || new File(abs.getPath() + "-shm").exists()
                || new File(abs.getPath() + "-journal").exists();
    }

    public static void defaultAtomicRenameOnly(File targetStageFile, File targetDbFile) throws IOException {
        File stagedAbs = targetStageFile.getAbsoluteFile();
        File targetAbs = targetDbFile.getAbsoluteFile();
        File stagedParent = stagedAbs.getParentFile();
        File targetParent = targetAbs.getParentFile();
        if (stagedParent == null || targetParent == null) {
            throw new IOException("missing-parent");
        }
        if (!KanataM6SchemeCExporter.sameFileSystem(stagedParent, targetParent)) {
            throw new IOException("EXDEV: cross-filesystem target commit refused");
        }
        try {
            Os.rename(stagedAbs.getPath(), targetAbs.getPath());
        } catch (ErrnoException e) {
            throw new IOException("target-atomic-rename-failed(" + e.errno + "): " + e.getMessage(), e);
        }
    }

    public static void defaultAtomicTargetCommit(File targetStageFile, File targetDbFile) throws IOException {
        defaultAtomicRenameOnly(targetStageFile, targetDbFile);
        File targetParent = targetDbFile.getAbsoluteFile().getParentFile();
        KanataM6SchemeCExporter.fsyncDirectoryStrict(targetParent);
    }

    private static byte[] buildFrameNonce(int streamId, int type, long index) {
        byte[] n = new byte[KanataM6PortableCrypto.FRAME_NONCE_SIZE];
        KanataM6PortableCrypto.writeU16BE(n, 0, streamId);
        n[2] = (byte) type;
        n[3] = 0;
        KanataM6PortableCrypto.writeU64BE(n, 4, index);
        return n;
    }

    private static byte[] buildFrameKeyInfo(int streamId, int type) {
        byte[] prefix = "KPB1/frame\0".getBytes(StandardCharsets.US_ASCII);
        byte[] out = new byte[prefix.length + 3];
        System.arraycopy(prefix, 0, out, 0, prefix.length);
        KanataM6PortableCrypto.writeU16BE(out, prefix.length, streamId);
        out[prefix.length + 2] = (byte) type;
        return out;
    }

    /**
     * Decodes, authenticates, verifies EOF + 50 verifiers, and installs into an isolated Schema 005 SQLCipher DB.
     * Refuses to overwrite an existing targetDbFile by default.
     */
    public static ImportResult importAndVerifyToIsolatedTarget(
            InputStream source,
            String password,
            KanataM6PortableCatalog catalog,
            File workDir,
            File targetDbFile,
            byte[] targetRawKey,
            AtomicBoolean cancelled) throws Exception {
        return importAndVerifyToIsolatedTarget(
                source, password, catalog, workDir, targetDbFile, targetRawKey, cancelled, false, null);
    }

    /**
     * Decodes, authenticates, verifies EOF + 50 verifiers, installs & fully verifies into an isolated staging DB,
     * then atomically commits to targetDbFile. Never deletes a pre-existing targetDbFile on any failure.
     */
    public static ImportResult importAndVerifyToIsolatedTarget(
            InputStream source,
            String password,
            KanataM6PortableCatalog catalog,
            File workDir,
            File targetDbFile,
            byte[] targetRawKey,
            AtomicBoolean cancelled,
            boolean allowOverwriteExistingTarget,
            ImportHooks hooks) throws Exception {
        return importAndVerifyToIsolatedTarget(
                source, password, catalog, workDir, targetDbFile, targetRawKey,
                cancelled, allowOverwriteExistingTarget, hooks, null);
    }

    /**
     * Decodes, authenticates, verifies EOF + 50 verifiers, installs & fully verifies into an isolated staging DB,
     * then atomically commits to targetDbFile with crash-safe durability journal and target commit mutex.
     * Never deletes a pre-existing targetDbFile on any failure.
     */
    public static ImportResult importAndVerifyToIsolatedTarget(
            InputStream source,
            String password,
            KanataM6PortableCatalog catalog,
            File workDir,
            File targetDbFile,
            byte[] targetRawKey,
            AtomicBoolean cancelled,
            boolean allowOverwriteExistingTarget,
            ImportHooks hooks,
            String explicitImportTaskId) throws Exception {
        String importTaskId = sanitizeImportTaskId(explicitImportTaskId);
        File targetAbs = targetDbFile.getAbsoluteFile();
        File targetParent = targetAbs.getParentFile();
        if (targetParent == null || (!targetParent.exists() && !targetParent.mkdirs())) {
            throw new KanataM6PortableCrypto.PortableException(
                    KanataM6PortableCrypto.ERR_IO_FAILED, "target-parent-mkdir");
        }
        if (hasDatabaseOrSidecar(targetAbs)) {
            if (!allowOverwriteExistingTarget) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "target-already-exists");
            }
        }
        if (!workDir.exists() && !workDir.mkdirs()) {
            throw new KanataM6PortableCrypto.PortableException(
                    KanataM6PortableCrypto.ERR_IO_FAILED, "work-dir-mkdir");
        }

        byte[] pwBytes = KanataM6PortableCrypto.encodeStrictPasswordUtf8(password);
        byte[] baseKek = new byte[KanataM6PortableCrypto.KEY_SIZE];
        byte[] wrapKey = null;
        byte[] bek = null;
        byte[] manifestKey = null;
        byte[] dataKey = null;
        byte[] footerKey = null;

        File stageFile = new File(workDir, ".stage-rows-" + UUID.randomUUID() + ".db");
        String stageNonce = UUID.randomUUID().toString().substring(0, 8);
        File targetStageFile = new File(targetParent, ".stage-target-" + importTaskId + "-" + stageNonce + ".db");
        byte[] stageKey = null;
        SQLiteDatabase stageDb = null;
        SQLiteDatabase targetStageDb = null;
        LogicalStreamDecoder logicalDecoder = null;
        boolean targetCommitted = false;
        boolean stageCleanedUnderLock = false;

        try {
            BoundedStreamReader reader = new BoundedStreamReader(source, cancelled);

            // 1. Read and validate 124-byte prefix BEFORE any KDF
            byte[] prefix = reader.readExact(KanataM6PortableCrypto.PREFIX_SIZE);
            byte[] header = Arrays.copyOfRange(prefix, 0, KanataM6PortableCrypto.HEADER_SIZE);
            byte[] wrapNonce = Arrays.copyOfRange(prefix, 64, 76);
            byte[] wrappedBek = Arrays.copyOfRange(prefix, 76, 124);

            for (int i = 0; i < 8; i++) {
                KanataM6PortableCrypto.requirePortable(header[i] == KanataM6PortableCrypto.MAGIC[i],
                        KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, "header-magic");
            }
            int format = KanataM6PortableCrypto.readU16BE(header, 8);
            int suite = KanataM6PortableCrypto.readU16BE(header, 10);
            int profile = KanataM6PortableCrypto.readU16BE(header, 12);
            int hdrFlags = KanataM6PortableCrypto.readU16BE(header, 14);
            long iter = KanataM6PortableCrypto.readU32BE(header, 16);
            byte[] salt = Arrays.copyOfRange(header, 20, 36);
            byte[] backupId = Arrays.copyOfRange(header, 36, 52);
            int scope = header[52] & 0xff;
            int payload = header[53] & 0xff;
            long frameLimit = KanataM6PortableCrypto.readU32BE(header, 54);
            boolean reservedZero = true;
            for (int i = 58; i < 64; i++) if (header[i] != 0) reservedZero = false;

            KanataM6PortableCrypto.requirePortable(
                    format == KanataM6PortableCrypto.FORMAT_VERSION
                            && suite == KanataM6PortableCrypto.CIPHER_SUITE
                            && profile == KanataM6PortableCrypto.SYNTHETIC_PROFILE
                            && hdrFlags == 0
                            && iter == KanataM6PortableCrypto.SYNTHETIC_ITERATIONS
                            && scope == KanataM6PortableCrypto.SCOPE_KANATA_SINGLE
                            && payload == KanataM6PortableCrypto.PAYLOAD_LOGICAL_V1
                            && frameLimit == KanataM6PortableCrypto.FRAME_LIMIT
                            && reservedZero,
                    KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, "header");

            byte[] kekSalt = KanataM6PortableCrypto.concat(
                    "KPB1/KEK\0".getBytes(StandardCharsets.US_ASCII), salt, backupId);
            KanataM6PortableCrypto.pbkdf2HmacSha256ZeroAllocInto(
                    pwBytes, kekSalt, (int) iter, KanataM6PortableCrypto.KEY_SIZE, cancelled, baseKek);
            KanataM6PortableCrypto.zeroize(pwBytes);

            wrapKey = KanataM6PortableCrypto.hkdfSha256(
                    baseKek, backupId,
                    KanataM6PortableCrypto.concat("KPB1/wrap\0".getBytes(StandardCharsets.US_ASCII), header),
                    KanataM6PortableCrypto.KEY_SIZE);
            KanataM6PortableCrypto.zeroize(baseKek);

            bek = KanataM6PortableCrypto.aesGcmDecrypt(
                    wrapKey, wrapNonce, wrappedBek, wrappedBek.length, header, "envelope");
            KanataM6PortableCrypto.requirePortable(bek.length == KanataM6PortableCrypto.KEY_SIZE,
                    KanataM6PortableCrypto.ERR_AUTH_FAILED, "bek-len");
            KanataM6PortableCrypto.zeroize(wrapKey);
            wrapKey = null;

            byte[] envelopeDigest = MessageDigest.getInstance("SHA-256").digest(prefix);
            MessageDigest transcriptSha = MessageDigest.getInstance("SHA-256");
            transcriptSha.update("KPB1/transcript\0".getBytes(StandardCharsets.US_ASCII));
            transcriptSha.update(envelopeDigest);

            manifestKey = KanataM6PortableCrypto.hkdfSha256(
                    bek, backupId,
                    buildFrameKeyInfo(KanataM6PortableCrypto.STREAM_CONTROL, KanataM6PortableCrypto.FRAME_MANIFEST),
                    KanataM6PortableCrypto.KEY_SIZE);
            dataKey = KanataM6PortableCrypto.hkdfSha256(
                    bek, backupId,
                    buildFrameKeyInfo(KanataM6PortableCrypto.STREAM_DATA, KanataM6PortableCrypto.FRAME_DATA),
                    KanataM6PortableCrypto.KEY_SIZE);
            footerKey = KanataM6PortableCrypto.hkdfSha256(
                    bek, backupId,
                    buildFrameKeyInfo(KanataM6PortableCrypto.STREAM_CONTROL, KanataM6PortableCrypto.FRAME_FOOTER),
                    KanataM6PortableCrypto.KEY_SIZE);

            // 2. Authenticate MANIFEST
            byte[] mfHdrBytes = reader.readExact(KanataM6PortableCrypto.FRAME_HEADER_SIZE);
            FrameHeader mf = new FrameHeader(mfHdrBytes);
            KanataM6PortableCrypto.requirePortable(
                    mf.streamId == KanataM6PortableCrypto.STREAM_CONTROL
                            && mf.type == KanataM6PortableCrypto.FRAME_MANIFEST
                            && mf.flags == KanataM6PortableCrypto.FLAG_CONTINUE
                            && mf.index == 0L
                            && mf.plainLen == KanataM6PortableCrypto.MANIFEST_SIZE,
                    KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "manifest-header");
            byte[] mfCipher = reader.readExact(mf.cipherLen);
            byte[] mfPlain = KanataM6PortableCrypto.aesGcmDecrypt(
                    manifestKey,
                    buildFrameNonce(mf.streamId, mf.type, mf.index),
                    mfCipher, mfCipher.length,
                    KanataM6PortableCrypto.concat(envelopeDigest, mfHdrBytes),
                    "manifest-decrypt");
            try {
                KanataM6PortableCrypto.requirePortable(mfPlain.length == KanataM6PortableCrypto.MANIFEST_SIZE,
                        KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "manifest-plain-len");
                transcriptSha.update(mfHdrBytes);
                transcriptSha.update(mfCipher);

                long appId = KanataM6PortableCrypto.readU32BE(mfPlain, 0);
                int schemaVer = KanataM6PortableCrypto.readU16BE(mfPlain, 4);
                byte[] mfFp = Arrays.copyOfRange(mfPlain, 6, 38);
                int taskPolicy = mfPlain[38] & 0xff;
                int profReserved = mfPlain[39] & 0xff;
                KanataM6PortableCrypto.requirePortable(
                        appId == KanataM6PortableCatalog.APPLICATION_ID
                                && schemaVer == KanataM6PortableCatalog.SCHEMA_VERSION
                                && taskPolicy == 1
                                && profReserved == 0,
                        KanataM6PortableCrypto.ERR_UNSUPPORTED_FORMAT, "manifest-format");
                KanataM6PortableCrypto.requirePortable(
                        KanataM6PortableCrypto.constantTimeEquals(mfFp, catalog.schemaFingerprintBytes),
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "manifest-fp");
            } finally {
                KanataM6PortableCrypto.zeroize(mfPlain);
            }

            // 3. Open isolated temporary encrypted staging SQLite DB (stores raw verified bodies per table)
            byte[] stageDek = KanataM6PortableCrypto.randomBytes(32);
            try {
                stageKey = KanataKeyEnvelope.rawSqlCipherKey(stageDek);
            } finally {
                KanataM6PortableCrypto.zeroize(stageDek);
            }
            stageDb = SQLiteDatabase.openDatabase(
                    stageFile.getPath(), stageKey, null,
                    SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                    (d, e) -> {}, null);
            stageDb.execSQL("CREATE TABLE staged_rows(table_id INTEGER NOT NULL, seq INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(table_id, seq))");
            stageDb.beginTransactionNonExclusive();

            // 4. Stream-decrypt DATA frames and feed bounded logical stream decoder
            logicalDecoder = new LogicalStreamDecoder(catalog, stageDb);
            int dataFrameCount = 0;
            long totalPlaintextBytes = 0L;
            long totalCiphertextBytes = 0L;
            long totalPackageBytes = KanataM6PortableCrypto.PREFIX_SIZE
                    + KanataM6PortableCrypto.FRAME_HEADER_SIZE + mf.cipherLen;
            boolean seenFinal = false;

            while (!seenFinal) {
                byte[] dhBytes = reader.readExact(KanataM6PortableCrypto.FRAME_HEADER_SIZE);
                FrameHeader df = new FrameHeader(dhBytes);
                KanataM6PortableCrypto.requirePortable(
                        df.streamId == KanataM6PortableCrypto.STREAM_DATA
                                && df.type == KanataM6PortableCrypto.FRAME_DATA
                                && df.index == dataFrameCount
                                && (df.flags == KanataM6PortableCrypto.FLAG_CONTINUE || df.flags == KanataM6PortableCrypto.FLAG_FINAL),
                        KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "data-frame-header");
                if (df.flags == KanataM6PortableCrypto.FLAG_CONTINUE) {
                    KanataM6PortableCrypto.requirePortable(df.plainLen == KanataM6PortableCrypto.FRAME_LIMIT,
                            KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "data-frame-full-len");
                } else {
                    KanataM6PortableCrypto.requirePortable(df.plainLen >= 1,
                            KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "data-frame-empty-final");
                }
                KanataM6PortableCrypto.requirePortable(
                        dataFrameCount < KanataM6PortableCrypto.MAX_DATA_FRAMES,
                        KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "data-frame-count");
                totalPlaintextBytes += df.plainLen;
                totalCiphertextBytes += df.cipherLen;
                totalPackageBytes += KanataM6PortableCrypto.FRAME_HEADER_SIZE + df.cipherLen;
                KanataM6PortableCrypto.requirePortable(
                        totalPlaintextBytes <= KanataM6PortableCrypto.MAX_DATA_PLAINTEXT_BYTES
                                && totalPackageBytes <= KanataM6PortableCrypto.MAX_PACKAGE_BYTES,
                        KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "package-size");

                byte[] dfCipher = reader.readExact(df.cipherLen);
                byte[] dfPlain = KanataM6PortableCrypto.aesGcmDecrypt(
                        dataKey,
                        buildFrameNonce(df.streamId, df.type, df.index),
                        dfCipher, dfCipher.length,
                        KanataM6PortableCrypto.concat(envelopeDigest, dhBytes),
                        "data-decrypt:" + df.index);
                try {
                    KanataM6PortableCrypto.requirePortable(dfPlain.length == df.plainLen,
                            KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "data-plain-len");
                    transcriptSha.update(dhBytes);
                    transcriptSha.update(dfCipher);
                    dataFrameCount++;
                    logicalDecoder.push(dfPlain);
                } finally {
                    KanataM6PortableCrypto.zeroize(dfPlain);
                }
                if (df.flags == KanataM6PortableCrypto.FLAG_FINAL) seenFinal = true;
            }
            stageDb.setTransactionSuccessful();
            stageDb.endTransaction();

            // 5. Authenticate FOOTER and verify exact EOF
            byte[] fhBytes = reader.readExact(KanataM6PortableCrypto.FRAME_HEADER_SIZE);
            FrameHeader ff = new FrameHeader(fhBytes);
            KanataM6PortableCrypto.requirePortable(
                    ff.streamId == KanataM6PortableCrypto.STREAM_CONTROL
                            && ff.type == KanataM6PortableCrypto.FRAME_FOOTER
                            && ff.flags == KanataM6PortableCrypto.FLAG_CONTINUE
                            && ff.index == 0L
                            && ff.plainLen == KanataM6PortableCrypto.FOOTER_SIZE,
                    KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "footer-frame-header");
            totalPackageBytes += KanataM6PortableCrypto.FRAME_HEADER_SIZE + ff.cipherLen;
            KanataM6PortableCrypto.requirePortable(totalPackageBytes <= KanataM6PortableCrypto.MAX_PACKAGE_BYTES,
                    KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "package-size");
            byte[] ffCipher = reader.readExact(ff.cipherLen);
            byte[] ffPlain = KanataM6PortableCrypto.aesGcmDecrypt(
                    footerKey,
                    buildFrameNonce(ff.streamId, ff.type, ff.index),
                    ffCipher, ffCipher.length,
                    KanataM6PortableCrypto.concat(envelopeDigest, fhBytes),
                    "footer-decrypt");
            List<KanataM6SchemeCExporter.Verifier> footerVerifiers = new ArrayList<>(50);
            Map<Integer, KanataM6SchemeCExporter.Verifier> footerById = new HashMap<>();
            byte[] actualTranscript;
            try {
                KanataM6PortableCrypto.requirePortable(ffPlain.length == KanataM6PortableCrypto.FOOTER_SIZE,
                        KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "footer-plain-len");

                reader.assertEof();
                KanataM6PortableCrypto.checkCancelled(cancelled);

                actualTranscript = transcriptSha.digest();
                long fFrames = KanataM6PortableCrypto.readU32BE(ffPlain, 0);
                long fPlain = KanataM6PortableCrypto.readU64BE(ffPlain, 4);
                long fCipher = KanataM6PortableCrypto.readU64BE(ffPlain, 12);
                byte[] fTranscript = Arrays.copyOfRange(ffPlain, 20, 52);
                KanataM6PortableCrypto.requirePortable(
                        fFrames == dataFrameCount
                                && fPlain == totalPlaintextBytes
                                && fCipher == totalCiphertextBytes
                                && KanataM6PortableCrypto.constantTimeEquals(fTranscript, actualTranscript),
                        KanataM6PortableCrypto.ERR_INVALID_CONTAINER, "footer-transcript-mismatch");

                int off = 52;
                for (int i = 0; i < 50; i++) {
                    int tid = KanataM6PortableCrypto.readU16BE(ffPlain, off);
                    long rc = KanataM6PortableCrypto.readU64BE(ffPlain, off + 2);
                    byte[] dg = Arrays.copyOfRange(ffPlain, off + 10, off + 42);
                    KanataM6PortableCrypto.requirePortable(
                            tid == catalog.footerTables.get(i).tableId,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "footer-table-order");
                    KanataM6SchemeCExporter.Verifier v = new KanataM6SchemeCExporter.Verifier(tid, rc, dg);
                    footerVerifiers.add(v);
                    footerById.put(tid, v);
                    off += KanataM6PortableCrypto.FOOTER_VERIFIER_SIZE;
                }
            } finally {
                KanataM6PortableCrypto.zeroize(ffPlain);
            }

            List<KanataM6SchemeCExporter.Verifier> bizVerifiers = logicalDecoder.finish();
            for (KanataM6SchemeCExporter.Verifier actual : bizVerifiers) {
                KanataM6SchemeCExporter.Verifier expected = footerById.get(actual.tableId);
                KanataM6PortableCrypto.requirePortable(
                        expected != null
                                && expected.rowCount == actual.rowCount
                                && KanataM6PortableCrypto.constantTimeEquals(expected.digest, actual.digest),
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "table-verifier:" + actual.tableId);
            }

            // 6. Install and fully verify inside isolated staging Schema 005 SQLCipher DB first!
            if (hooks != null) hooks.beforeStagingInstall(targetStageFile);
            targetStageDb = SQLiteDatabase.openDatabase(
                    targetStageFile.getPath(), targetRawKey, null,
                    SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                    (d, e) -> {}, null);
            catalog.initSchema(targetStageDb, 5, false);
            installStagedRowsIntoTarget(catalog, stageDb, targetStageDb);
            if (hooks != null) hooks.afterInstallBeforeVerify(targetStageDb);
            verifyTargetDatabase(catalog, targetStageDb, footerById);

            // Checkpoint TRUNCATE and close staging DB cleanly so targetStageFile is self-contained without sidecars
            try (Cursor ck = targetStageDb.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)", new Object[0])) {
                KanataM6PortableCrypto.requirePortable(ck.moveToFirst() && ck.getInt(0) == 0,
                        KanataM6PortableCrypto.ERR_IO_FAILED, "target-stage-checkpoint-busy");
            }
            targetStageDb.close();
            targetStageDb = null;

            File stageWal = new File(targetStageFile.getPath() + "-wal");
            File stageShm = new File(targetStageFile.getPath() + "-shm");
            if ((stageWal.exists() && stageWal.length() > 0L) || (stageShm.exists() && stageShm.length() > 0L)) {
                throw new KanataM6PortableCrypto.PortableException(
                        KanataM6PortableCrypto.ERR_IO_FAILED, "target-stage-sidecars-left");
            }
            if (stageWal.exists()) stageWal.delete();
            if (stageShm.exists()) stageShm.delete();

            // Strictly fsync closed staging DB file and compute expected SHA-256 before entering commit phase
            KanataM6SchemeCExporter.fsyncFileStrict(targetStageFile);
            String stageSha256Hex = KanataM6SchemeCExporter.computeFileSha256Hex(targetStageFile);
            StructStat targetStageStat = KanataM6SchemeCExporter.lstatOrNull(targetStageFile);

            if (hooks != null) hooks.afterStagingVerified(targetStageFile);
            KanataM6PortableCrypto.checkCancelled(cancelled);

            // 7. Target-path serialized mutex: cancel re-check, durable pre-commit journal, atomic rename, dir fsync
            File importJournal = new File(targetParent, ".import-" + importTaskId + ".pending");
            File importJournalNext = new File(targetParent, ".import-" + importTaskId + ".pending.next");
            boolean ownsImportJournal = false;
            boolean durabilityConfirmed = false;
            StructStat importJournalStat = null;

            try (TargetCommitLockHandle commitLock = acquireTargetCommitLock(targetAbs, cancelled)) {
                try {
                    // R02-6: Mandatory cancellation check AFTER acquiring target lock so cancelled waiters never commit!
                    KanataM6PortableCrypto.checkCancelled(cancelled);
                    if (hooks != null) {
                        hooks.afterTargetLockAcquiredBeforeCommit(targetStageFile, targetAbs);
                        KanataM6PortableCrypto.checkCancelled(cancelled);
                    }
                    if (hasDatabaseOrSidecar(targetAbs)) {
                        if (!allowOverwriteExistingTarget) {
                            throw new KanataM6PortableCrypto.PortableException(
                                    KanataM6PortableCrypto.ERR_IO_FAILED, "target-already-exists");
                        }
                        File wal = new File(targetAbs.getPath() + "-wal");
                        File shm = new File(targetAbs.getPath() + "-shm");
                        if ((wal.exists() && wal.length() > 0L) || (shm.exists() && shm.length() > 0L)) {
                            throw new KanataM6PortableCrypto.PortableException(
                                    KanataM6PortableCrypto.ERR_IO_FAILED, "target-active-sidecar");
                        }
                    }
                    if (importJournal.exists() && importJournal.length() > 0L) {
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_IO_FAILED, "import-task-id-unrecovered-collision");
                    }

                    // Persist VERIFIED_READY_TO_COMMIT journal + targetParent directory entry durably BEFORE Os.rename!
                    importJournalStat = writeImportJournalAtomic(
                            importJournal, targetParent, importTaskId, "VERIFIED_READY_TO_COMMIT",
                            targetStageFile, targetAbs, stageSha256Hex, true, hooks);
                    ownsImportJournal = true;

                    if (hooks != null) {
                        hooks.beforeTargetCommit(targetStageFile, targetAbs);
                        KanataM6PortableCrypto.checkCancelled(cancelled);
                        hooks.performAtomicTargetCommit(targetStageFile, targetAbs);
                    } else {
                        KanataM6PortableCrypto.checkCancelled(cancelled);
                        defaultAtomicRenameOnly(targetStageFile, targetAbs);
                    }
                    targetCommitted = true;

                    try {
                        if (hooks != null) {
                            hooks.afterTargetRenameBeforeJournalUpdate(targetAbs, importJournal);
                        }
                        importJournalStat = writeImportJournalAtomic(
                                importJournal, targetParent, importTaskId, "RENAMED_PENDING_DIR_SYNC",
                                targetStageFile, targetAbs, stageSha256Hex, false, hooks);
                        if (hooks != null) {
                            hooks.performTargetDirFsync(targetParent);
                        } else {
                            KanataM6SchemeCExporter.fsyncDirectoryStrict(targetParent);
                        }
                    } catch (IOException postRenameErr) {
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_DURABILITY_UNCONFIRMED, "target-dir-fsync-failed", postRenameErr);
                    }
                    durabilityConfirmed = true;
                    try {
                        importJournalStat = writeImportJournalAtomic(
                                importJournal, targetParent, importTaskId, "COMMITTED",
                                targetStageFile, targetAbs, stageSha256Hex, false, hooks);
                    } catch (IOException ignoredAfterDurableCommit) {
                        // Target rename + target dir fsync already succeeded; finally deletes journal under lock.
                    }
                } finally {
                    boolean lockStillValid = commitLock.isStillLiveInode();
                    if (!targetCommitted && targetStageStat != null
                            && KanataM6SchemeCExporter.sameInode(targetStageFile, targetStageStat)) {
                        SQLiteDatabase.deleteDatabase(targetStageFile);
                        stageCleanedUnderLock = true;
                    }
                    boolean keepImportJournalForRecovery = targetCommitted && !durabilityConfirmed;
                    if (ownsImportJournal && lockStillValid && importJournalNext.exists()) {
                        importJournalNext.delete();
                    }
                    if (ownsImportJournal && !keepImportJournalForRecovery
                            && KanataM6SchemeCExporter.sameInode(importJournal, importJournalStat)) {
                        importJournal.delete();
                    }
                }
            }

            return new ImportResult(
                    dataFrameCount,
                    totalPlaintextBytes,
                    totalCiphertextBytes,
                    logicalDecoder.totalBusinessRows,
                    KanataM6PortableCrypto.bytesToHex(actualTranscript),
                    footerVerifiers);
        } catch (KanataM6PortableCrypto.PortableException pe) {
            throw pe;
        } catch (IOException ioe) {
            throw new KanataM6PortableCrypto.PortableException(KanataM6PortableCrypto.ERR_IO_FAILED, "import-io", ioe);
        } finally {
            if (targetStageDb != null) {
                try {
                    if (targetStageDb.inTransaction()) targetStageDb.endTransaction();
                } catch (Throwable ignored) {}
                try {
                    targetStageDb.close();
                } catch (Throwable ignored) {}
            }
            if (!targetCommitted && !stageCleanedUnderLock) {
                // Only delete the staging DB created by THIS task; NEVER delete targetDbFile!
                SQLiteDatabase.deleteDatabase(targetStageFile);
            }
            if (logicalDecoder != null) {
                logicalDecoder.close();
            }
            if (stageDb != null) {
                try {
                    if (stageDb.inTransaction()) stageDb.endTransaction();
                } catch (Throwable ignored) {}
                try {
                    stageDb.close();
                } catch (Throwable ignored) {}
            }
            SQLiteDatabase.deleteDatabase(stageFile);
            KanataM6PortableCrypto.zeroize(pwBytes, baseKek, wrapKey, bek, manifestKey, dataKey, footerKey, stageKey);
        }
    }

    private static void installStagedRowsIntoTarget(
            KanataM6PortableCatalog catalog,
            SQLiteDatabase stageDb,
            SQLiteDatabase targetDb) throws Exception {
        List<Object[]> deferredReplies = new ArrayList<>();
        List<Object[]> deferredTasks = new ArrayList<>();

        targetDb.beginTransactionNonExclusive();
        try {
            for (String tableName : catalog.installOrder) {
                KanataM6PortableCatalog.TableDef tableDef = catalog.byName.get(tableName);
                List<KanataM6PortableCatalog.ColumnDef> cols = tableDef.columns;
                StringBuilder colNames = new StringBuilder();
                StringBuilder placeholders = new StringBuilder();
                for (int i = 0; i < cols.size(); i++) {
                    if (i > 0) {
                        colNames.append(", ");
                        placeholders.append(", ");
                    }
                    colNames.append(cols.get(i).name);
                    if (cols.get(i).type == KanataM6PortableCatalog.ColType.TEXT) {
                        placeholders.append("CAST(? AS TEXT)");
                    } else {
                        placeholders.append('?');
                    }
                }
                String insertSql = "INSERT INTO " + tableName + "(" + colNames + ") VALUES(" + placeholders + ")";
                try (SQLiteStatement stmt = targetDb.compileStatement(insertSql);
                     Cursor c = stageDb.rawQuery(
                             "SELECT seq, length(body), CASE WHEN length(body) <= 262144 THEN body ELSE NULL END FROM staged_rows WHERE table_id = ? ORDER BY seq ASC",
                             new Object[] { tableDef.tableId })) {
                    while (c.moveToNext()) {
                        long seq = c.getLong(0);
                        int bodyLen = (int) c.getLong(1);
                        byte[] body = null;
                        Object[] decoded = null;
                        try {
                            if (bodyLen <= 262_144) {
                                body = c.getBlob(2);
                            } else {
                                body = new byte[bodyLen];
                                int copied = 0;
                                while (copied < bodyLen) {
                                    int take = Math.min(262_144, bodyLen - copied);
                                    try (Cursor cc = stageDb.rawQuery(
                                            "SELECT substr(body, ?, ?) FROM staged_rows WHERE table_id = ? AND seq = ?",
                                            new Object[] { copied + 1, take, tableDef.tableId, seq })) {
                                        KanataM6PortableCrypto.requirePortable(cc.moveToFirst(),
                                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "stage-chunk-missing");
                                        byte[] piece = cc.getBlob(0);
                                        try {
                                            KanataM6PortableCrypto.requirePortable(piece != null && piece.length == take,
                                                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "stage-chunk-len");
                                            System.arraycopy(piece, 0, body, copied, take);
                                        } finally {
                                            KanataM6PortableCrypto.zeroize(piece);
                                        }
                                    }
                                    copied += take;
                                }
                            }
                            decoded = decodeBodyValues(tableDef, body);
                            stmt.clearBindings();
                            for (int i = 0; i < cols.size(); i++) {
                                String cname = cols.get(i).name;
                                Object val = decoded[i];
                                if ("messages".equals(tableName)
                                        && ("reply_to_message_id".equals(cname) || "reply_to_revision".equals(cname))) {
                                    val = null;
                                } else if ("background_tasks".equals(tableName) && "window_task_id".equals(cname)) {
                                    val = null;
                                }
                                bindValue(stmt, i + 1, val);
                            }
                            stmt.executeInsert();

                            if ("messages".equals(tableName)) {
                                int rIdCid = tableDef.columnsByName.get("reply_to_message_id").cid;
                                int rRevCid = tableDef.columnsByName.get("reply_to_revision").cid;
                                int idCid = tableDef.columnsByName.get("id").cid;
                                if (decoded[rIdCid] != null) {
                                    deferredReplies.add(new Object[] { decoded[rIdCid], decoded[rRevCid], decoded[idCid] });
                                    decoded[rIdCid] = null;
                                    decoded[idCid] = null;
                                }
                            } else if ("background_tasks".equals(tableName)) {
                                int wtCid = tableDef.columnsByName.get("window_task_id").cid;
                                int idCid = tableDef.columnsByName.get("id").cid;
                                if (decoded[wtCid] != null) {
                                    deferredTasks.add(new Object[] { decoded[wtCid], decoded[idCid] });
                                    decoded[wtCid] = null;
                                    decoded[idCid] = null;
                                }
                            }
                        } finally {
                            KanataM6PortableCrypto.zeroize(body);
                            zeroizeObjectArray(decoded);
                        }
                    }
                }
            }

            if (!deferredReplies.isEmpty()) {
                try (SQLiteStatement replyStmt = targetDb.compileStatement(
                        "UPDATE messages SET reply_to_message_id = CAST(? AS TEXT), reply_to_revision = ? WHERE id = CAST(? AS TEXT)")) {
                    for (Object[] item : deferredReplies) {
                        replyStmt.clearBindings();
                        bindValue(replyStmt, 1, item[0]);
                        bindValue(replyStmt, 2, item[1]);
                        bindValue(replyStmt, 3, item[2]);
                        replyStmt.executeUpdateDelete();
                    }
                }
            }
            if (!deferredTasks.isEmpty()) {
                try (SQLiteStatement taskStmt = targetDb.compileStatement(
                        "UPDATE background_tasks SET window_task_id = CAST(? AS TEXT) WHERE id = CAST(? AS TEXT)")) {
                    for (Object[] item : deferredTasks) {
                        taskStmt.clearBindings();
                        bindValue(taskStmt, 1, item[0]);
                        bindValue(taskStmt, 2, item[1]);
                        taskStmt.executeUpdateDelete();
                    }
                }
            }
            targetDb.setTransactionSuccessful();
        } finally {
            for (Object[] item : deferredReplies) zeroizeObjectArray(item);
            for (Object[] item : deferredTasks) zeroizeObjectArray(item);
            targetDb.endTransaction();
        }
    }

    private static void zeroizeObjectArray(Object[] arr) {
        if (arr == null) return;
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] instanceof byte[] b) {
                Arrays.fill(b, (byte) 0);
            }
            arr[i] = null;
        }
    }

    private static void verifyTargetDatabase(
            KanataM6PortableCatalog catalog,
            SQLiteDatabase targetDb,
            Map<Integer, KanataM6SchemeCExporter.Verifier> footerById) throws Exception {
        // 1. Metadata & schema fingerprint checks
        String userVersion = KanataM6SnapshotOwner.scalar(targetDb, "PRAGMA user_version");
        KanataM6PortableCrypto.requirePortable(
                Integer.toString(KanataM6PortableCatalog.SCHEMA_VERSION).equals(userVersion),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-user-version:" + userVersion);
        String appId = KanataM6SnapshotOwner.scalar(targetDb, "PRAGMA application_id");
        KanataM6PortableCrypto.requirePortable(
                Integer.toString(KanataM6PortableCatalog.APPLICATION_ID).equals(appId),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-app-id:" + appId);
        KanataM6PortableCrypto.requirePortable(
                KanataM6PortableCatalog.EXPECTED_SCHEMA_005_FP.equals(catalog.schemaFingerprintHex),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-schema-fp");
        String tableCount = KanataM6SnapshotOwner.scalar(targetDb,
                "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*'");
        KanataM6PortableCrypto.requirePortable(
                Integer.toString(catalog.allTables.size()).equals(tableCount),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-table-count:" + tableCount);

        for (KanataM6PortableCatalog.TableDef td : catalog.allTables) {
            int colIdx = 0;
            try (Cursor ti = targetDb.rawQuery("PRAGMA table_info(" + td.name + ")", new Object[0])) {
                while (ti.moveToNext()) {
                    KanataM6PortableCrypto.requirePortable(colIdx < td.columns.size(),
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-col-extra:" + td.name);
                    KanataM6PortableCatalog.ColumnDef expectedCol = td.columns.get(colIdx);
                    String actualName = ti.getString(1);
                    String actualType = ti.getString(2);
                    boolean actualNotNull = ti.getInt(3) != 0;
                    int actualPk = ti.getInt(5);
                    KanataM6PortableCrypto.requirePortable(
                            expectedCol.name.equals(actualName)
                                    && expectedCol.type.name().equalsIgnoreCase(actualType)
                                    && expectedCol.notnull == actualNotNull
                                    && expectedCol.pk == actualPk,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL,
                            "target-col-mismatch:" + td.name + "." + expectedCol.name);
                    colIdx++;
                }
            }
            KanataM6PortableCrypto.requirePortable(colIdx == td.columns.size(),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-col-missing:" + td.name);
        }

        // 2. Runtime tables must remain empty (excluded)
        for (KanataM6PortableCatalog.TableDef rt : catalog.runtimeTables) {
            String rtCount = KanataM6SnapshotOwner.scalar(targetDb, "SELECT count(*) FROM " + rt.name);
            KanataM6PortableCrypto.requirePortable("0".equals(rtCount),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-runtime-nonempty:" + rt.name);
        }

        // 3. SQLCipher & SQLite structural, cipher, FK, and 005 ordinal integrity
        String integrity = KanataM6SnapshotOwner.scalar(targetDb, "PRAGMA integrity_check");
        KanataM6PortableCrypto.requirePortable("ok".equals(integrity),
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-integrity");
        try (Cursor c = targetDb.rawQuery("PRAGMA cipher_integrity_check", new Object[0])) {
            KanataM6PortableCrypto.requirePortable(!c.moveToNext(),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-cipher-integrity");
        }
        try (Cursor c = targetDb.rawQuery("SELECT * FROM pragma_foreign_key_check", new Object[0])) {
            KanataM6PortableCrypto.requirePortable(!c.moveToNext(),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-fk");
        }
        KanataM6SnapshotOwner.verifySchema005Ordinals(targetDb);

        // 4. Verify pause-sending-v1 projection in restored background_tasks
        try (Cursor bt = targetDb.rawQuery("SELECT kind, state, lease_until FROM background_tasks", new Object[0])) {
            while (bt.moveToNext()) {
                String kind = bt.getString(0);
                String state = bt.getString(1);
                long leaseUntil = bt.getLong(2);
                KanataM6PortableCrypto.requirePortable(leaseUntil == 0L,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-task-lease");
                if ("reply".equals(kind) || "proactive".equals(kind) || "followup".equals(kind)) {
                    KanataM6PortableCrypto.requirePortable(
                            !"pending".equals(state) && !"running".equals(state) && !"failed".equals(state),
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-task-state:" + kind + ":" + state);
                } else {
                    KanataM6PortableCrypto.requirePortable(!"running".equals(state),
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-task-state:" + kind + ":" + state);
                }
            }
        }

        // 5. Verify ALL 50 Footer verifiers (45 business tables + 5 derived tables) against actual targetDb rows!
        KanataM6PortableCrypto.requirePortable(
                footerById.size() == KanataM6PortableCrypto.FOOTER_TABLE_COUNT,
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-footer-size");
        byte[] tableDomainPrefix = "KPB1/table\0".getBytes(StandardCharsets.US_ASCII);
        byte[] lenBuf = new byte[4];
        Set<Integer> verifiedIds = new HashSet<>(50);

        for (KanataM6PortableCatalog.TableDef td : catalog.footerTables) {
            MessageDigest tblSha = MessageDigest.getInstance("SHA-256");
            tblSha.update(tableDomainPrefix);
            byte[] tidBytes = new byte[2];
            KanataM6PortableCrypto.writeU16BE(tidBytes, 0, td.tableId);
            tblSha.update(tidBytes);
            long rowCount = 0L;
            String sql = KanataM6BoundedRowReader.buildSelectSql(td);
            try (Cursor c = targetDb.rawQuery(sql, new Object[0])) {
                while (c.moveToNext()) {
                    KanataM6BoundedRowReader.EncodedRow row = KanataM6BoundedRowReader.readAndEncodeCurrentRow(
                            targetDb, c, td, false, true);
                    try {
                        KanataM6PortableCrypto.writeU32BE(lenBuf, 0, row.bodyLen);
                        tblSha.update(lenBuf);
                        tblSha.update(row.body, 0, row.bodyLen);
                        rowCount++;
                    } finally {
                        KanataM6PortableCrypto.zeroize(row.body);
                        if (row.pkTextBytes != null) {
                            for (byte[] pb : row.pkTextBytes) KanataM6PortableCrypto.zeroize(pb);
                        }
                        KanataM6PortableCrypto.zeroize(row.ordinalWorldIdBytes);
                    }
                }
            }
            byte[] actualDigest = tblSha.digest();
            KanataM6SchemeCExporter.Verifier expected = footerById.get(td.tableId);
            KanataM6PortableCrypto.requirePortable(
                    expected != null
                            && expected.rowCount == rowCount
                            && KanataM6PortableCrypto.constantTimeEquals(expected.digest, actualDigest),
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-table-mismatch:" + td.name);
            verifiedIds.add(td.tableId);
        }
        KanataM6PortableCrypto.requirePortable(
                verifiedIds.size() == KanataM6PortableCrypto.FOOTER_TABLE_COUNT,
                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "target-verified-count");
    }

    private static void bindValue(SQLiteStatement stmt, int idx, Object val) {
        if (val == null) stmt.bindNull(idx);
        else if (val instanceof Long l) stmt.bindLong(idx, l);
        else if (val instanceof Double d) stmt.bindDouble(idx, d);
        else if (val instanceof byte[] b) stmt.bindBlob(idx, b);
        else stmt.bindString(idx, (String) val);
    }

    private static Object[] decodeBodyValues(KanataM6PortableCatalog.TableDef tableDef, byte[] body) {
        int off = tableDef.hasOrdinal ? 8 : 0;
        Object[] out = new Object[tableDef.columns.size()];
        boolean success = false;
        try {
            for (int i = 0; i < tableDef.columns.size(); i++) {
                KanataM6PortableCatalog.ColumnDef col = tableDef.columns.get(i);
                KanataM6PortableCrypto.requirePortable(off < body.length,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-flag-trunc");
                int flag = body[off++] & 0xff;
                if (flag == 0) {
                    KanataM6PortableCrypto.requirePortable(!col.notnull,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "notnull:" + tableDef.name + "." + col.name);
                    out[i] = null;
                    continue;
                }
                KanataM6PortableCrypto.requirePortable(flag == 1,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-null-flag");
                if (col.type == KanataM6PortableCatalog.ColType.INTEGER) {
                    KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-int-trunc");
                    long v = KanataM6PortableCrypto.readU64BE(body, off);
                    off += 8;
                    out[i] = v;
                } else if (col.type == KanataM6PortableCatalog.ColType.REAL) {
                    KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-real-trunc");
                    long bits = KanataM6PortableCrypto.readU64BE(body, off);
                    off += 8;
                    double d = Double.longBitsToDouble(bits);
                    KanataM6PortableCrypto.requirePortable(
                            !Double.isNaN(d) && !Double.isInfinite(d) && Double.doubleToRawLongBits(d) != Double.doubleToRawLongBits(-0.0d),
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-real-invalid");
                    out[i] = d;
                } else {
                    KanataM6PortableCrypto.requirePortable(off + 4 <= body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-text-len-trunc");
                    long len = KanataM6PortableCrypto.readU32BE(body, off);
                    off += 4;
                    KanataM6PortableCrypto.requirePortable(len <= KanataM6PortableCrypto.MAX_TEXT_FIELD_BYTES,
                            KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "col-text-limit");
                    KanataM6PortableCrypto.requirePortable(off + len <= body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-text-trunc");
                    KanataM6PortableCrypto.decodeStrictUtf8(body, off, (int) len, "col-text");
                    byte[] utf8 = Arrays.copyOfRange(body, off, off + (int) len);
                    off += (int) len;
                    out[i] = utf8;
                }
            }
            KanataM6PortableCrypto.requirePortable(off == body.length,
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-trailing-bytes");
            success = true;
            return out;
        } finally {
            if (!success) {
                zeroizeObjectArray(out);
            }
        }
    }

    /** Bounded O(1)-row streaming decoder for kanata-logical-v1 plaintext frames. */
    private static final class LogicalStreamDecoder {
        private static final int ST_TABLE_HEADER = 0;
        private static final int ST_ROW_LENGTH = 1;
        private static final int ST_ROW_BODY = 2;
        private static final int ST_DONE = 3;

        private final KanataM6PortableCatalog catalog;
        private final SQLiteDatabase stageDb;
        private final SQLiteStatement insertStageStmt;
        private final byte[] smallBuf = new byte[10];
        private final byte[] rowLenBytes = new byte[4];
        private final List<KanataM6SchemeCExporter.Verifier> businessVerifiers = new ArrayList<>(45);

        private int tableIndex = 0;
        private int state = ST_TABLE_HEADER;
        private int smallLen = 0;
        private int smallTarget = 10;

        private KanataM6PortableCatalog.TableDef currentTable;
        private long currentTableRowCount = 0L;
        private long currentTableRowsRead = 0L;
        long totalBusinessRows = 0L;
        private MessageDigest currentTableSha;
        private byte[] rowBodyBuf;
        private int rowBodyOff = 0;

        // O(1) order tracking state
        private byte[] prevOrdWorldId;
        private long prevOrd = -1;
        private byte[][] prevPkText;
        private long[] prevPkNum;

        LogicalStreamDecoder(KanataM6PortableCatalog catalog, SQLiteDatabase stageDb) {
            this.catalog = catalog;
            this.stageDb = stageDb;
            this.insertStageStmt = stageDb.compileStatement(
                    "INSERT INTO staged_rows(table_id, seq, body) VALUES(?, ?, ?)");
        }

        void push(byte[] chunk) throws Exception {
            int pos = 0;
            while (pos < chunk.length) {
                if (state == ST_DONE) {
                    throw new KanataM6PortableCrypto.PortableException(
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "logical-trailing-bytes");
                }
                if (state == ST_TABLE_HEADER || state == ST_ROW_LENGTH) {
                    int take = Math.min(smallTarget - smallLen, chunk.length - pos);
                    System.arraycopy(chunk, pos, smallBuf, smallLen, take);
                    smallLen += take;
                    pos += take;
                    if (smallLen < smallTarget) continue;

                    if (state == ST_TABLE_HEADER) {
                        int tableId = KanataM6PortableCrypto.readU16BE(smallBuf, 0);
                        long rowCount = KanataM6PortableCrypto.readU64BE(smallBuf, 2);
                        KanataM6PortableCatalog.TableDef expected = catalog.businessTables.get(tableIndex);
                        KanataM6PortableCatalog.TableDef known = catalog.byId.get(tableId);
                        KanataM6PortableCrypto.requirePortable(known != null,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "unknown-table");
                        KanataM6PortableCrypto.requirePortable(known.category == KanataM6PortableCatalog.Category.BUSINESS,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "non-business-table");
                        KanataM6PortableCrypto.requirePortable(tableId == expected.tableId,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "table-order");
                        KanataM6PortableCrypto.requirePortable(
                                rowCount >= 0 && rowCount <= KanataM6PortableCrypto.MAX_BUSINESS_ROWS
                                        && totalBusinessRows + rowCount <= KanataM6PortableCrypto.MAX_BUSINESS_ROWS,
                                KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "business-row-count");
                        totalBusinessRows += rowCount;
                        currentTable = expected;
                        currentTableRowCount = rowCount;
                        currentTableRowsRead = 0L;
                        prevOrdWorldId = null;
                        prevOrd = -1;
                        prevPkText = null;
                        prevPkNum = null;

                        currentTableSha = MessageDigest.getInstance("SHA-256");
                        currentTableSha.update("KPB1/table\0".getBytes(StandardCharsets.US_ASCII));
                        byte[] tidBytes = new byte[2];
                        KanataM6PortableCrypto.writeU16BE(tidBytes, 0, tableId);
                        currentTableSha.update(tidBytes);

                        if (rowCount == 0L) {
                            finishCurrentTable();
                        } else {
                            state = ST_ROW_LENGTH;
                            smallLen = 0;
                            smallTarget = 4;
                        }
                    } else {
                        long bodyLen = KanataM6PortableCrypto.readU32BE(smallBuf, 0);
                        KanataM6PortableCrypto.requirePortable(bodyLen <= KanataM6PortableCrypto.MAX_ROW_BODY_BYTES,
                                KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "row-body-size");
                        KanataM6PortableCrypto.requirePortable(bodyLen >= 1,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-body-empty");
                        System.arraycopy(smallBuf, 0, rowLenBytes, 0, 4);
                        rowBodyBuf = new byte[(int) bodyLen];
                        rowBodyOff = 0;
                        state = ST_ROW_BODY;
                    }
                } else if (state == ST_ROW_BODY) {
                    int take = Math.min(rowBodyBuf.length - rowBodyOff, chunk.length - pos);
                    System.arraycopy(chunk, pos, rowBodyBuf, rowBodyOff, take);
                    rowBodyOff += take;
                    pos += take;
                    if (rowBodyOff < rowBodyBuf.length) continue;

                    byte[] completedBody = rowBodyBuf;
                    rowBodyBuf = null;
                    rowBodyOff = 0;
                    try {
                        currentTableSha.update(rowLenBytes);
                        currentTableSha.update(completedBody);

                        validateRowBodyAndOrder(currentTable, completedBody);

                        insertStageStmt.clearBindings();
                        insertStageStmt.bindLong(1, currentTable.tableId);
                        insertStageStmt.bindLong(2, currentTableRowsRead);
                        insertStageStmt.bindBlob(3, completedBody);
                        insertStageStmt.executeInsert();
                    } finally {
                        KanataM6PortableCrypto.zeroize(completedBody);
                    }

                    currentTableRowsRead++;
                    if (currentTableRowsRead == currentTableRowCount) {
                        finishCurrentTable();
                    } else {
                        state = ST_ROW_LENGTH;
                        smallLen = 0;
                        smallTarget = 4;
                    }
                }
            }
        }

        private void validateRowBodyAndOrder(KanataM6PortableCatalog.TableDef tableDef, byte[] body) {
            int off = 0;
            long ordinal = -1;
            if (tableDef.hasOrdinal) {
                KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-ordinal-trunc");
                ordinal = KanataM6PortableCrypto.readU64BE(body, off);
                KanataM6PortableCrypto.requirePortable(
                        ordinal >= 0 && ordinal <= KanataM6PortableCrypto.MAX_ORDINAL,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-ordinal-range");
                off += 8;
            }

            int colCount = tableDef.columns.size();
            byte[][] rawTextCols = new byte[colCount][];
            long[] intCols = new long[colCount];
            double[] realCols = new double[colCount];
            String taskKind = null;
            String taskState = null;

            try {
                for (int i = 0; i < colCount; i++) {
                    KanataM6PortableCatalog.ColumnDef col = tableDef.columns.get(i);
                    KanataM6PortableCrypto.requirePortable(off < body.length,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-flag-trunc");
                    int flag = body[off++] & 0xff;
                    if (flag == 0) {
                        KanataM6PortableCrypto.requirePortable(!col.notnull,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "notnull:" + tableDef.name + "." + col.name);
                        continue;
                    }
                    KanataM6PortableCrypto.requirePortable(flag == 1,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-null-flag");
                    if (col.type == KanataM6PortableCatalog.ColType.INTEGER) {
                        KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-int-trunc");
                        intCols[i] = KanataM6PortableCrypto.readU64BE(body, off);
                        off += 8;
                    } else if (col.type == KanataM6PortableCatalog.ColType.REAL) {
                        KanataM6PortableCrypto.requirePortable(off + 8 <= body.length,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-real-trunc");
                        long bits = KanataM6PortableCrypto.readU64BE(body, off);
                        off += 8;
                        double d = Double.longBitsToDouble(bits);
                        KanataM6PortableCrypto.requirePortable(
                                !Double.isNaN(d) && !Double.isInfinite(d) && bits != Double.doubleToRawLongBits(-0.0d),
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-real-invalid");
                        realCols[i] = d;
                    } else {
                        KanataM6PortableCrypto.requirePortable(off + 4 <= body.length,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-text-len-trunc");
                        long len = KanataM6PortableCrypto.readU32BE(body, off);
                        off += 4;
                        KanataM6PortableCrypto.requirePortable(len <= KanataM6PortableCrypto.MAX_TEXT_FIELD_BYTES,
                                KanataM6PortableCrypto.ERR_RESOURCE_LIMIT, "col-text-limit");
                        KanataM6PortableCrypto.requirePortable(off + len <= body.length,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "col-text-trunc");
                        String decoded = KanataM6PortableCrypto.decodeStrictUtf8(body, off, (int) len, "col:" + col.name);
                        KanataM6BoundedRowReader.validateJsonColumn(col.name, decoded);
                        if (col.pk > 0 || (tableDef.hasOrdinal && "world_id".equals(col.name))) {
                            rawTextCols[i] = Arrays.copyOfRange(body, off, off + (int) len);
                        }
                        if ("background_tasks".equals(tableDef.name)) {
                            if ("kind".equals(col.name)) taskKind = decoded;
                            else if ("state".equals(col.name)) taskState = decoded;
                        }
                        off += (int) len;
                    }
                }
                KanataM6PortableCrypto.requirePortable(off == body.length,
                        KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "row-trailing-bytes");

                if ("background_tasks".equals(tableDef.name)) {
                    int leaseCid = tableDef.columnsByName.get("lease_until").cid;
                    KanataM6PortableCrypto.requirePortable(intCols[leaseCid] == 0L,
                            KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "task-lease");
                    if ("reply".equals(taskKind) || "proactive".equals(taskKind) || "followup".equals(taskKind)) {
                        KanataM6PortableCrypto.requirePortable(
                                !"pending".equals(taskState) && !"running".equals(taskState) && !"failed".equals(taskState),
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "task-state");
                    } else {
                        KanataM6PortableCrypto.requirePortable(!"running".equals(taskState),
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "task-state");
                    }
                }

                if (tableDef.hasOrdinal) {
                    int widCid = tableDef.columnsByName.get("world_id").cid;
                    byte[] wid = rawTextCols[widCid];
                    if (prevOrdWorldId == null) {
                        KanataM6PortableCrypto.requirePortable(ordinal == 0L,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-start");
                    } else {
                        int cmp = KanataM6PortableCrypto.compareUnsignedBytes(prevOrdWorldId, wid);
                        KanataM6PortableCrypto.requirePortable(cmp <= 0,
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-world-order");
                        if (cmp == 0) {
                            KanataM6PortableCrypto.requirePortable(ordinal == prevOrd + 1L,
                                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-sequence");
                        } else {
                            KanataM6PortableCrypto.requirePortable(ordinal == 0L,
                                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "ordinal-start");
                        }
                    }
                    KanataM6PortableCrypto.zeroize(prevOrdWorldId);
                    prevOrdWorldId = wid;
                    rawTextCols[widCid] = null;
                    prevOrd = ordinal;
                    return;
                }

                List<KanataM6PortableCatalog.ColumnDef> pks = tableDef.pkColumns;
                byte[][] curText = new byte[pks.size()][];
                long[] curNum = new long[pks.size()];
                for (int p = 0; p < pks.size(); p++) {
                    KanataM6PortableCatalog.ColumnDef pk = pks.get(p);
                    if (pk.type == KanataM6PortableCatalog.ColType.TEXT) {
                        curText[p] = rawTextCols[pk.cid];
                        rawTextCols[pk.cid] = null;
                    } else {
                        curNum[p] = intCols[pk.cid];
                    }
                }
                if (prevPkText != null) {
                    int cmp = 0;
                    for (int p = 0; p < pks.size(); p++) {
                        KanataM6PortableCatalog.ColumnDef pk = pks.get(p);
                        if (pk.type == KanataM6PortableCatalog.ColType.TEXT) {
                            cmp = KanataM6PortableCrypto.compareUnsignedBytes(prevPkText[p], curText[p]);
                        } else {
                            cmp = Long.compare(prevPkNum[p], curNum[p]);
                        }
                        if (cmp != 0) break;
                    }
                    if (cmp >= 0) {
                        for (byte[] b : curText) KanataM6PortableCrypto.zeroize(b);
                        throw new KanataM6PortableCrypto.PortableException(
                                KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "pk-order:" + tableDef.name);
                    }
                }
                if (prevPkText != null) {
                    for (byte[] b : prevPkText) KanataM6PortableCrypto.zeroize(b);
                }
                prevPkText = curText;
                prevPkNum = curNum;
            } finally {
                for (byte[] b : rawTextCols) KanataM6PortableCrypto.zeroize(b);
            }
        }

        private void finishCurrentTable() {
            businessVerifiers.add(new KanataM6SchemeCExporter.Verifier(
                    currentTable.tableId, currentTableRowCount, currentTableSha.digest()));
            KanataM6PortableCrypto.zeroize(prevOrdWorldId);
            prevOrdWorldId = null;
            if (prevPkText != null) {
                for (byte[] b : prevPkText) KanataM6PortableCrypto.zeroize(b);
                prevPkText = null;
            }
            prevPkNum = null;
            currentTable = null;
            currentTableSha = null;
            tableIndex++;
            if (tableIndex == catalog.businessTables.size()) {
                state = ST_DONE;
                smallLen = 0;
            } else {
                state = ST_TABLE_HEADER;
                smallLen = 0;
                smallTarget = 10;
            }
        }

        List<KanataM6SchemeCExporter.Verifier> finish() {
            insertStageStmt.close();
            KanataM6PortableCrypto.requirePortable(
                    state == ST_DONE && smallLen == 0 && rowBodyBuf == null && businessVerifiers.size() == 45,
                    KanataM6PortableCrypto.ERR_INVALID_LOGICAL, "logical-incomplete");
            return businessVerifiers;
        }

        void close() {
            try {
                insertStageStmt.close();
            } catch (Throwable ignored) {}
            KanataM6PortableCrypto.zeroize(rowBodyBuf);
            rowBodyBuf = null;
            KanataM6PortableCrypto.zeroize(smallBuf);
            KanataM6PortableCrypto.zeroize(rowLenBytes);
            KanataM6PortableCrypto.zeroize(prevOrdWorldId);
            prevOrdWorldId = null;
            if (prevPkText != null) {
                for (byte[] b : prevPkText) KanataM6PortableCrypto.zeroize(b);
                prevPkText = null;
            }
            prevPkNum = null;
        }
    }
}
