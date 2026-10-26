#!/usr/bin/env bash
# Dedicated GitHub emulator only; no application-test retry.
set -euo pipefail
qa_native_dir=docs/qa/architecture-20261026/native
collect_device_diagnostics() {
  local qa_result=$?
  if (( qa_result != 0 )); then
    adb logcat -b crash -d > "$qa_native_dir/framework-crash.txt" 2>&1 || true
    adb shell service check package || true
    adb shell pidof system_server || true
    tail -n 65 "$qa_native_dir/framework-crash.txt"
  fi
}
trap collect_device_diagnostics EXIT
adb shell pm disable-user --user 0 com.google.android.gms
adb shell wm density 160
# Boot completion can precede a framework restart; require the package service
# and the same system_server to remain available for three observations.
qa_deadline=$((SECONDS + 90))
qa_stable=0
qa_previous_pid=''
while (( SECONDS < qa_deadline )); do
  qa_current_pid=$(adb shell pidof system_server | tr -d '\r')
  qa_package=$(adb shell service check package | tr -d '\r')
  if [[ -n "$qa_current_pid" && "$qa_current_pid" == "$qa_previous_pid" && "$qa_package" == *found* ]]; then
    qa_stable=$((qa_stable + 1))
  else
    qa_stable=0
  fi
  if (( qa_stable >= 3 )); then break; fi
  qa_previous_pid=$qa_current_pid
  sleep 5
done
if (( qa_stable < 3 )); then echo 'Android framework did not stabilize'; exit 1; fi
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant com.yubin.formyself android.permission.POST_NOTIFICATIONS
(cd android && bash ./gradlew --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1024m -Pkotlin.compiler.execution.strategy=in-process :app:connectedDebugAndroidTest)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
npm run test:e2e:android
