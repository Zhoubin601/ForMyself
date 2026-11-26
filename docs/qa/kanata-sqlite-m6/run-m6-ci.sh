#!/usr/bin/env bash
set -euo pipefail

API_LEVEL="${1:-unknown}"
ARTIFACT_DIR="docs/qa/kanata-sqlite-m6/ci-artifacts/api-${API_LEVEL}"
mkdir -p "$ARTIFACT_DIR"

if [ -f release-block-check.log ]; then
  cp release-block-check.log "$ARTIFACT_DIR/release-block-check.log"
fi

collect_ci_artifacts() {
  local exit_code=$?
  set +e
  adb logcat -d > "$ARTIFACT_DIR/adb-logcat.txt" 2>&1 || true

  python3 - "$ARTIFACT_DIR" "$API_LEVEL" <<'PYEOF' || true
import json, re, statistics, sys
from pathlib import Path

art = Path(sys.argv[1])
api = sys.argv[2]
logcat_path = art / "adb-logcat.txt"
if not logcat_path.exists():
    sys.exit(0)

text = logcat_path.read_text(encoding="utf-8", errors="replace")

m6_probes = {}
bridge = {}
faults = {}
raw_samples = []
bench_summaries = {}

line_re = re.compile(r"^\d{2}-\d{2}\s+\S+\s+\d+\s+\d+\s+[A-Z]\s+(KanataM6\w+)\s*:\s*(.*)$")
for line in text.splitlines():
    m = line_re.match(line)
    if not m:
        continue
    tag, msg = m.group(1), m.group(2)
    if "=" not in msg:
        continue
    k, v_str = msg.split("=", 1)
    k = k.strip()
    try:
        v = json.loads(v_str)
    except Exception:
        v = v_str
    if tag in ("KanataM6N01", "KanataM6N02", "KanataM6N03", "KanataM6N04", "KanataM6SchemeC"):
        m6_probes.setdefault(tag, {})[k] = v
        if k in ("N03_BRIDGE_AND_WEBVIEW", "N03_LONG_FIELDS_AND_BOUNDED_MEMORY"):
            bridge[k] = v
    elif tag in ("KanataM6F02", "KanataM6Fix02", "KanataM6Fix03", "KanataM6Fix04"):
        faults.setdefault(tag, {})[k] = v
        if k == "P1_03":
            bridge[k] = v
    elif tag == "KanataM6Bench":
        if k.startswith("SAMPLE_"):
            scale = k.split("_", 1)[1]
            if isinstance(v, dict):
                v["scale"] = int(scale)
                raw_samples.append(v)
        elif k.startswith("BENCH_SUMMARY_"):
            bench_summaries[k] = v

(art / "m6-test-results.json").write_text(
    json.dumps({"apiLevel": api, "probes": m6_probes}, indent=2) + "\n", encoding="utf-8"
)
(art / "bridge-report.json").write_text(
    json.dumps({"apiLevel": api, "bridge": bridge}, indent=2) + "\n", encoding="utf-8"
)
(art / "fault-injection-report.json").write_text(
    json.dumps({"apiLevel": api, "faults": faults}, indent=2) + "\n", encoding="utf-8"
)
with (art / "benchmark-raw-samples.jsonl").open("w", encoding="utf-8") as fh:
    for item in raw_samples:
        fh.write(json.dumps(item) + "\n")

agg = {}
for scale in sorted({s["scale"] for s in raw_samples}):
    for route in ("A1", "A2", "C"):
        sub = [s for s in raw_samples if s["scale"] == scale and s.get("route") == route]
        warm = [s for s in sub if not s.get("cold")]
        if not warm:
            continue
        def stats(field):
            vals = [x[field] for x in warm if isinstance(x.get(field), (int, float)) and x[field] >= 0]
            if not vals:
                return None
            return {
                "warmMedian": statistics.median(vals),
                "warmMin": min(vals),
                "warmMax": max(vals),
            }
        agg[f"{scale}_{route}"] = {
            "countAll": len(sub),
            "countWarm": len(warm),
            "totalMs": stats("totalMs"),
            "writeBlockMs": stats("writeBlockMs"),
            "dbReadMs": stats("dbReadMs"),
            "kdfAeadMs": stats("kdfAeadMs"),
            "fsyncReadbackMs": stats("fsyncReadbackMs"),
            "finalBytes": stats("finalBytes"),
            "peakRssKiB": stats("peakRssKiB"),
            "peakNativeHeapBytes": stats("peakNativeHeapBytes"),
            "peakJavaHeapBytes": stats("peakJavaHeapBytes"),
            "logicalVerifiedCount": sum(1 for x in sub if x.get("logicalVerified")),
        }

(art / "benchmark-summary.json").write_text(
    json.dumps({"apiLevel": api, "sampleCount": len(raw_samples), "summaries": bench_summaries, "aggregatedWarm": agg}, indent=2) + "\n",
    encoding="utf-8",
)
PYEOF
  exit "$exit_code"
}
trap collect_ci_artifacts EXIT

# Wait until system_server & package manager are stable after boot
qa_deadline=$((SECONDS + 120))
qa_stable=0
qa_previous_pid=''
while (( SECONDS < qa_deadline )); do
  qa_current_pid=$(timeout 10s adb shell pidof system_server | tr -d '\r' || true)
  qa_package=$(timeout 10s adb shell service check package | tr -d '\r' || true)
  if [[ -n "$qa_current_pid" && "$qa_current_pid" == "$qa_previous_pid" && "$qa_package" == 'Service package: found' ]]; then
    qa_stable=$((qa_stable + 1))
  else
    qa_stable=0
  fi
  if (( qa_stable >= 3 )); then break; fi
  qa_previous_pid=$qa_current_pid
  sleep 5
done
if (( qa_stable < 3 )); then
  echo 'Android framework did not stabilize'
  exit 1
fi

{
  echo "=== DEVICE INFO (API ${API_LEVEL}) ==="
  adb shell getprop ro.build.version.sdk | tr -d '\r' | sed 's/^/ro.build.version.sdk=/'
  adb shell getprop ro.build.version.release | tr -d '\r' | sed 's/^/ro.build.version.release=/'
  adb shell getprop ro.build.fingerprint | tr -d '\r' | sed 's/^/ro.build.fingerprint=/'
  adb shell getprop ro.product.cpu.abilist | tr -d '\r' | sed 's/^/ro.product.cpu.abilist=/'
  echo "=== WEBVIEW ==="
  adb shell dumpsys webviewupdate 2>&1 | tr -d '\r' || true
  adb shell dumpsys package com.google.android.webview 2>&1 | grep -m1 versionName | tr -d '\r' || true
  adb shell dumpsys package com.android.webview 2>&1 | grep -m1 versionName | tr -d '\r' || true
} > "$ARTIFACT_DIR/device-info.txt"

adb logcat -G 16M || true
adb logcat -c || true

TEST_CLASSES="com.yubin.formyself.KanataM6N01CryptoProbeTest,com.yubin.formyself.KanataM6N02SnapshotProbeTest,com.yubin.formyself.KanataM6N03BoundedMemoryTest,com.yubin.formyself.KanataM6N04SafLifecycleTest,com.yubin.formyself.KanataM6SchemeCInteropAndNegativeTest,com.yubin.formyself.KanataM6F02FaultMatrixTest,com.yubin.formyself.KanataM6Fix02FaultInjectionTest,com.yubin.formyself.KanataM6Fix03CommitAndLockTest,com.yubin.formyself.KanataM6Fix04StableLockTest,com.yubin.formyself.KanataM6AcBenchmarkTest"

(
  cd android
  bash ./gradlew --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1536m \
    -Pkotlin.compiler.execution.strategy=in-process \
    -PkanataM2Synthetic=true -PkanataM6Synthetic=true \
    :app:connectedDebugAndroidTest \
    "-Pandroid.testInstrumentationRunnerArguments.class=${TEST_CLASSES}"
) 2>&1 | tee "$ARTIFACT_DIR/gradle-connected-test.log"
