package com.yubin.formyself;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ArchiveFileBatchTest {
    private final String wire = "U2FsdGVkX18xMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng==";
    private String key() throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(wire.getBytes(StandardCharsets.US_ASCII))) result.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
        return result.toString();
    }
    private File root() {
        // Instrumentation runs under the target UID. Use only a new synthetic cache subtree,
        // never the target's files/formyself directory or any recovery material.
        File root = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),"kanata-archive-batch-test-"+UUID.randomUUID());
        assertTrue(new File(root,"formyself/kanata-pages-v1").mkdirs());
        return root;
    }
    private JSONObject op(String operation,String key) throws Exception { return new JSONObject().put("operation",operation).put("key",key); }
    private File page(File root,String key) { return new File(root,"formyself/kanata-pages-v1/"+key+".enc"); }
    @Test public void actualCiphertextIoPreservesBytesAndDeleteIsIdempotent() throws Exception {
        File root = root();
        JSONArray commands = new JSONArray().put(op("write",key()).put("data",wire)).put(op("read",key()));
        JSONArray result = ArchiveFileBatchStore.execute(root,commands);
        assertTrue(result.getJSONObject(0).getBoolean("ok"));assertEquals(wire,result.getJSONObject(1).getString("data"));
        File unknown = new File(root,"formyself/kanata-pages-v1/unknown.keep");assertTrue(unknown.createNewFile());
        result = ArchiveFileBatchStore.execute(root,new JSONArray().put(op("delete",key())).put(op("delete",key())));
        assertTrue(result.getJSONObject(0).getBoolean("ok"));assertTrue(result.getJSONObject(1).getBoolean("ok"));
        assertFalse(page(root,key()).exists());assertTrue(unknown.exists());
    }
    @Test public void invalidLaterCommandCausesZeroEarlierWrites() throws Exception {
        File root = root();
        for (String bad : new String[]{"../outside", "A".repeat(64), "0".repeat(63)}) {
            try { ArchiveFileBatchStore.execute(root,new JSONArray().put(op("write",key()).put("data",wire)).put(op("delete",bad)));fail(); }
            catch (Exception expected) { assertEquals("ARCHIVE_FILE_BATCH_INVALID",expected.getMessage()); }
            assertFalse(page(root,key()).exists());
        }
        try { ArchiveFileBatchStore.execute(root,new JSONArray().put(op("write",key()).put("data","private plaintext")));fail(); }
        catch (Exception expected) { assertFalse(expected.getMessage().contains("private")); }
        assertFalse(page(root,key()).exists());
        try { ArchiveFileBatchStore.execute(root,new JSONArray().put(op("write","0".repeat(64)).put("data",wire)));fail(); }
        catch (Exception expected) { assertEquals("ARCHIVE_FILE_BATCH_INVALID",expected.getMessage()); }
        assertFalse(page(root,"0".repeat(64)).exists());
        JSONArray tooMany = new JSONArray();
        for (int i = 0; i < 5; i++) tooMany.put(op("write",key()).put("data",wire));
        try { ArchiveFileBatchStore.execute(root,tooMany);fail(); }
        catch (Exception expected) { assertEquals("ARCHIVE_FILE_BATCH_INVALID",expected.getMessage()); }
        assertFalse(page(root,key()).exists());
        JSONArray retirement = new JSONArray();
        for (int i = 0; i < 64; i++) retirement.put(op("delete",key()));
        assertEquals(64,ArchiveFileBatchStore.execute(root,retirement).length());
        retirement.put(op("delete",key()));
        try { ArchiveFileBatchStore.execute(root,retirement);fail(); }
        catch (Exception expected) { assertEquals("ARCHIVE_FILE_BATCH_INVALID",expected.getMessage()); }
    }
    @Test public void failedReadSettlesWithoutPreventingOtherResultsAndOversizeDoesNotReadBody() throws Exception {
        File root = root();
        ArchiveFileBatchStore.execute(root,new JSONArray().put(op("write",key()).put("data",wire)));
        JSONArray rows = ArchiveFileBatchStore.execute(root,new JSONArray().put(op("read","0".repeat(64))).put(op("read",key())));
        assertFalse(rows.getJSONObject(0).getBoolean("ok"));assertEquals(wire,rows.getJSONObject(1).getString("data"));
        try (FileOutputStream stream = new FileOutputStream(page(root,key()))) { stream.write(new byte[ArchiveFileBatchStore.MAX_BYTES+1]); }
        JSONObject large = ArchiveFileBatchStore.execute(root,new JSONArray().put(op("read",key()))).getJSONObject(0);
        assertTrue(large.getBoolean("oversized"));assertFalse(large.has("data"));
    }
    @Test public void symlinkAndDirectoryTargetsCannotDeleteOrOverwriteAnything() throws Exception {
        File root = root(),outside = new File(root,"outside.keep");assertTrue(outside.createNewFile());
        Files.createSymbolicLink(page(root,key()).toPath(),outside.toPath());
        try { ArchiveFileBatchStore.execute(root,new JSONArray().put(op("delete",key())));fail(); }
        catch (Exception expected) { assertEquals("ARCHIVE_FILE_BATCH_INVALID",expected.getMessage()); }
        assertTrue(outside.exists());
        assertTrue(page(root,key()).delete());assertTrue(page(root,key()).mkdir());
        try { ArchiveFileBatchStore.execute(root,new JSONArray().put(op("delete",key())));fail(); }
        catch (Exception expected) { assertEquals("ARCHIVE_FILE_BATCH_INVALID",expected.getMessage()); }
        assertTrue(page(root,key()).isDirectory());
    }
}
