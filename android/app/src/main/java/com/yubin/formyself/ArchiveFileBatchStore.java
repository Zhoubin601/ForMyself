package com.yubin.formyself;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/** Bounded ciphertext-only I/O. No credentials, decryption, business state or recursive removal. */
final class ArchiveFileBatchStore {
    static final int MAX_BYTES = 256 * 1024;
    private static final class Command {
        String operation, data;
        File file;
    }
    static JSONArray execute(File filesRoot, JSONArray operations) throws Exception {
        if (operations == null || operations.length() < 1 || operations.length() > 64) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
        File root = filesRoot.getCanonicalFile();
        File folder = new File(root, "formyself/kanata-pages-v1");
        if (!folder.getCanonicalFile().equals(folder.getAbsoluteFile())) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
        List<Command> commands = new ArrayList<>();
        // Validate the entire request before the first mutation; reject path traversal,
        // symlinks, directories, plaintext, malformed and oversized writes without logging input.
        for (int i = 0; i < operations.length(); i++) {
            JSONObject input = operations.getJSONObject(i);
            Object rawKey = input.opt("key"), rawOperation = input.opt("operation");
            if (!(rawKey instanceof String) || !((String)rawKey).matches("[a-f0-9]{64}") || !(rawOperation instanceof String)) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
            Command command = new Command();
            command.operation = (String)rawOperation;
            if (!command.operation.equals("read") && !command.operation.equals("write") && !command.operation.equals("delete")) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
            if (operations.length() > 4 && !command.operation.equals("delete")) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
            if (!command.operation.equals("write") && input.has("data")) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
            command.file = new File(folder, rawKey + ".enc");
            if (!command.file.getCanonicalFile().equals(command.file.getAbsoluteFile()) || command.file.isDirectory()) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
            if (command.operation.equals("write")) {
                Object rawData = input.opt("data");
                if (!(rawData instanceof String)) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
                command.data = (String)rawData;
                if (command.data.length() < 44 || command.data.length() > MAX_BYTES || command.data.length() % 4 != 0 || !command.data.startsWith("U2FsdGVkX1") || !command.data.matches("[A-Za-z0-9+/]+={0,2}")) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(command.data.getBytes(StandardCharsets.US_ASCII));
                StringBuilder key = new StringBuilder(64);
                for (byte value : digest) { int b = value & 255; key.append(Character.forDigit(b >>> 4, 16)).append(Character.forDigit(b & 15, 16)); }
                if (!key.toString().equals(rawKey)) throw new Exception("ARCHIVE_FILE_BATCH_INVALID");
            }
            commands.add(command);
        }
        JSONArray results = new JSONArray();
        for (Command command : commands) {
            JSONObject row = new JSONObject();
            try {
                if (command.operation.equals("read")) {
                    if (!command.file.isFile()) throw new Exception("READ_FAILED");
                    if (command.file.length() > MAX_BYTES) row.put("oversized", true);
                    else {
                        try (FileInputStream stream = new FileInputStream(command.file); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                            byte[] buffer = new byte[8192];
                            int size;
                            while ((size = stream.read(buffer)) != -1) {
                                if (bytes.size() + size > MAX_BYTES) throw new Exception("READ_FAILED");
                                bytes.write(buffer, 0, size);
                            }
                            row.put("data", bytes.toString("UTF-8"));
                        }
                    }
                } else if (command.operation.equals("write")) {
                    try (FileOutputStream stream = new FileOutputStream(command.file, false)) {
                        stream.write(command.data.getBytes(StandardCharsets.US_ASCII));
                        stream.getFD().sync();
                    }
                } else if (command.file.exists() && !command.file.delete()) throw new Exception("DELETE_FAILED");
                row.put("ok", true);
            } catch (Exception ignored) {
                row = new JSONObject();
                row.put("ok", false);
            }
            results.put(row);
        }
        return results;
    }
    private ArchiveFileBatchStore() {}
}
