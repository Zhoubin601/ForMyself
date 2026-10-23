import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const pluginFile = fileURLToPath(new URL(
  '../node_modules/@capgo/capacitor-native-biometric/android/src/main/java/ee/forgr/biometric/NativeBiometric.java',
  import.meta.url
))

// API credentials must be on disk before JS can report a successful save.
// Reading immediately after apply() only verifies SharedPreferences' memory cache.
const original = `                editor.putString(KEY_ALIAS + "-username", encryptString(username, KEY_ALIAS));
                editor.putString(KEY_ALIAS + "-password", encryptString(password, KEY_ALIAS));
                editor.apply();
                call.resolve();`
const patched = `                editor.putString(KEY_ALIAS + "-username", encryptString(username, KEY_ALIAS));
                editor.putString(KEY_ALIAS + "-password", encryptString(password, KEY_ALIAS));
                if (!editor.commit()) {
                    call.reject("Failed to persist credentials");
                    return;
                }
                call.resolve();`

const source = (await readFile(pluginFile, 'utf8')).replace(/\r\n/g, '\n')
if (source.includes(patched)) {
  console.log('Native Biometric credential durability patch already applied.')
} else if (source.includes(original)) {
  await writeFile(pluginFile, source.replace(original, patched), 'utf8')
  console.log('Applied Native Biometric credential durability patch.')
} else {
  throw new Error('Unsupported @capgo/capacitor-native-biometric source; credential durability patch was not applied.')
}
