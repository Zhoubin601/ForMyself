#!/usr/bin/env bash
set -euo pipefail
if [[ ! -c /dev/kvm ]]; then
  echo "BLOCKED: /dev/kvm is required for the supported acceleration path." >&2
  exit 20
fi
export ANDROID_USER_HOME=/workspace/work/kanata-android/user
export ANDROID_EMULATOR_HOME=/workspace/work/kanata-android/user
export ANDROID_AVD_HOME=/workspace/work/kanata-android/avds
export ANDROID_HOME=/workspace/work/kanata-android/sdk
export ADB_VENDOR_KEYS=/workspace/work/kanata-android/user/adbkey
export ANDROID_ADB_SERVER_PORT=5589
exec /workspace/work/kanata-android/sdk/emulator/emulator -avd KanataP2ATD34 -port 5580 -accel on -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics -gpu swiftshader -feature -Vulkan -memory 2048 -cores 2 -skin 360x640 -dpi-device 160 -show-kernel
